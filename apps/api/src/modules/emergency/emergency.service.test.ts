import { describe, expect, it, vi } from 'vitest'
import {
  Channel,
  EmergencyStatus,
  EmergencyTrigger,
  EscalationContext,
  EscalationRunStatus,
  NotificationStatus,
  NotificationType,
  VitalSource,
} from '@careloop/shared'
import {
  createEmergencyFromAnomaly,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  type EmergencyPrismaClient,
} from './emergency.service'
import { ingestVitalSign } from '../vitals/vitals.service'
import { InMemoryEscalationQueueAdapter } from '../escalation/timeout.service'

describe('emergency.service (CL-204)', () => {
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'
  const dummyUserId = '22222222-2222-4222-8222-222222222222'
  const dummyEmergencyId = '33333333-3333-4333-8333-333333333333'
  const dummyRunId = '44444444-4444-4444-8444-444444444444'

  function createMockEmergencyPrisma(options?: {
    patientExists?: boolean
    patientPhone?: string
    patientName?: string
  }): EmergencyPrismaClient {
    const patientExists = options?.patientExists ?? true
    const patientPhone = options?.patientPhone ?? '081234567890'
    const patientName = options?.patientName ?? 'Bu Siti Test'

    return {
      patient: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (!patientExists || where.id !== dummyPatientId) return null
          return {
            id: dummyPatientId,
            smartwatchEnabled: true,
            healthConditions: ['hipertensi'],
            user: {
              id: dummyUserId,
              fullName: patientName,
              phone: patientPhone,
            },
          }
        }),
      },
      emergencyAlert: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          return {
            id: dummyEmergencyId,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        }),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      escalationRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          return {
            id: where?.id ?? dummyRunId,
            patientId: dummyPatientId,
            context: EscalationContext.EMERGENCY,
            sourceEmergencyId: dummyEmergencyId,
            status: EscalationRunStatus.WAITING_PATIENT,
            steps: [],
          }
        }),
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          return {
            id: dummyRunId,
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        }),
        update: vi.fn(),
      },
      escalationStep: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          return {
            id: 'step-1',
            ...data,
            createdAt: new Date(),
          }
        }),
      },
      notification: {
        create: vi.fn().mockImplementation(async ({ data }: any) => {
          return {
            id: 'notif-1',
            ...data,
            createdAt: new Date(),
          }
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    }
  }

  describe('getEmergencyTimeoutSec', () => {
    it('menggunakan nilai default 45 detik saat tidak ada override', () => {
      const timeout = getEmergencyTimeoutSec()
      expect(timeout).toBe(45)
    })

    it('menghormati custom snapshot tetapi dibatasi clamped 30-60 detik (FR-4.3)', () => {
      // Di bawah 30s -> dipaksa minimal 30s
      expect(getEmergencyTimeoutSec({ patientWaitSec: 10 })).toBe(30)
      // Di atas 60s -> dipaksa maksimal 60s
      expect(getEmergencyTimeoutSec({ patientWaitSec: 120 })).toBe(60)
      // Di antara 30 dan 60s -> dihormati
      expect(getEmergencyTimeoutSec({ patientWaitSec: 50 })).toBe(50)
    })
  })

  describe('formatPatientEmergencyConfirmationMessage', () => {
    it('menyusun pesan dengan nama pasien, hrBpm, dan batas waktu timeout', () => {
      const msg = formatPatientEmergencyConfirmationMessage({
        patientName: 'Pak Budi',
        hrBpm: 145,
        timeoutSec: 45,
      })

      expect(msg).toContain('Pak Budi')
      expect(msg).toContain('145 bpm')
      expect(msg).toContain('45 detik')
      expect(msg).toContain("balas 'AMAN'")
    })
  })

  describe('createEmergencyFromAnomaly', () => {
    it('melempar 404 jika pasien tidak ditemukan', async () => {
      const mockPrisma = createMockEmergencyPrisma({ patientExists: false })

      await expect(
        createEmergencyFromAnomaly(mockPrisma, {
          patientId: dummyPatientId,
          hrBpm: 145,
        }),
      ).rejects.toThrow('Data pasien dengan ID 11111111-1111-4111-8111-111111111111 tidak ditemukan')
    })

    it('membuat EmergencyAlert status PENDING_PATIENT_CONFIRM dan EscalationRun context EMERGENCY (AC-4.1)', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      const mockQueue = new InMemoryEscalationQueueAdapter()
      const mockWa = {
        sendText: vi.fn().mockResolvedValue({ providerMessageId: 'wa-msg-123' }),
        send: vi.fn(),
        sendTemplate: vi.fn(),
        sendInteractive: vi.fn(),
        sendAudio: vi.fn(),
        provider: {} as any,
      }

      const result = await createEmergencyFromAnomaly(
        mockPrisma,
        {
          patientId: dummyPatientId,
          hrBpm: 145,
          anomalyReason: 'hr>120',
        },
        {
          queueAdapter: mockQueue,
          whatsAppService: mockWa,
        },
      )

      // 1. Verifikasi EmergencyAlert
      expect(mockPrisma.emergencyAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: dummyPatientId,
            status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
            hrBpm: 145,
            triggerType: EmergencyTrigger.ANOMALY_HR,
          }),
        }),
      )
      expect(result.emergencyAlert.id).toBe(dummyEmergencyId)

      // 2. Verifikasi EscalationRun context EMERGENCY
      expect(mockPrisma.escalationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: dummyPatientId,
            context: EscalationContext.EMERGENCY,
            sourceEmergencyId: dummyEmergencyId,
            status: EscalationRunStatus.WAITING_PATIENT,
          }),
        }),
      )
      expect(result.escalationRun.id).toBe(dummyRunId)

      // 3. Verifikasi pesan konfirmasi WA terkirim ke pasien
      expect(mockWa.sendText).toHaveBeenCalledWith(
        '081234567890',
        expect.stringContaining("balas 'AMAN'"),
      )
      expect(result.waMessageId).toBe('wa-msg-123')

      // 4. Verifikasi langkah eskalasi tercatat
      expect(mockPrisma.escalationStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: dummyRunId,
            channel: Channel.WHATSAPP,
            messageKey: 'emergency.confirm_patient',
            providerMessageId: 'wa-msg-123',
          }),
        }),
      )

      // 5. Verifikasi notifikasi in-app
      expect(mockPrisma.notification?.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patientId: dummyPatientId,
            channel: Channel.IN_APP,
            type: NotificationType.EMERGENCY,
            status: NotificationStatus.SENT,
            payload: expect.objectContaining({
              emergencyAlertId: dummyEmergencyId,
              runId: dummyRunId,
              hrBpm: 145,
              actionPrompt: 'Apakah Anda aman?',
            }),
          }),
        }),
      )

      // 6. Verifikasi timeout dijadwalkan
      expect(result.timeoutSec).toBe(45)
      expect(mockQueue.activeJobCount).toBe(1)

      // 7. Verifikasi audit log
      expect(mockPrisma.auditLog?.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'emergency.triggered',
            resourceType: 'EmergencyAlert',
            resourceId: dummyEmergencyId,
            patientId: dummyPatientId,
          }),
        }),
      )
    })
  })

  describe('Integrasi ingestVitalSign -> createEmergencyFromAnomaly', () => {
    it('saat anomali berurutan terjadi, otomatis memicu emergency alert dan escalation run', async () => {
      const baseTime = new Date('2026-08-16T08:00:00.000Z')
      const prevTime = new Date(baseTime.getTime() - 20_000)

      const mockEmergencyPrisma = createMockEmergencyPrisma()
      const mockFullPrisma: any = {
        ...mockEmergencyPrisma,
        vitalSign: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([{ recordedAt: prevTime, hrBpm: 140 }]),
          create: vi.fn().mockImplementation(((args: any) =>
            Promise.resolve({
              id: 'vital-new',
              ...args.data,
              createdAt: new Date(),
            })) as any),
        },
      }

      const mockQueue = new InMemoryEscalationQueueAdapter()
      const mockWa = {
        sendText: vi.fn().mockResolvedValue({ providerMessageId: 'wa-msg-999' }),
        send: vi.fn(),
        sendTemplate: vi.fn(),
        sendInteractive: vi.fn(),
        sendAudio: vi.fn(),
        provider: {} as any,
      }

      const ingestResult = await ingestVitalSign(
        mockFullPrisma,
        {
          patientId: dummyPatientId,
          recordedAt: baseTime.toISOString(),
          source: VitalSource.MOCK,
          hrBpm: 145,
        },
        {
          emergencyDeps: {
            queueAdapter: mockQueue,
            whatsAppService: mockWa,
          },
        },
      )

      expect(ingestResult.vitalSign.isAnomalous).toBe(true)
      expect(ingestResult.vitalSign.anomalyReason).toBe('hr>120')
      expect(ingestResult.emergencyAlert).toBeDefined()
      expect(ingestResult.emergencyAlert.id).toBe(dummyEmergencyId)
      expect(ingestResult.escalationRun).toBeDefined()
      expect(ingestResult.escalationRun.id).toBe(dummyRunId)
      expect(mockEmergencyPrisma.emergencyAlert.create).toHaveBeenCalledTimes(1)
      expect(mockEmergencyPrisma.escalationRun.create).toHaveBeenCalledTimes(1)
    })

    it('bacaan normal tidak memicu emergency alert', async () => {
      const baseTime = new Date('2026-08-16T08:00:00.000Z')
      const prevTime = new Date(baseTime.getTime() - 20_000)

      const mockEmergencyPrisma = createMockEmergencyPrisma()
      const mockFullPrisma: any = {
        ...mockEmergencyPrisma,
        vitalSign: {
          findUnique: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([{ recordedAt: prevTime, hrBpm: 75 }]),
          create: vi.fn().mockImplementation(((args: any) =>
            Promise.resolve({
              id: 'vital-normal',
              ...args.data,
              createdAt: new Date(),
            })) as any),
        },
      }

      const ingestResult = await ingestVitalSign(mockFullPrisma, {
        patientId: dummyPatientId,
        recordedAt: baseTime.toISOString(),
        source: VitalSource.MOCK,
        hrBpm: 78,
      })

      expect(ingestResult.vitalSign.isAnomalous).toBe(false)
      expect(ingestResult.emergencyAlert).toBeUndefined()
      expect(ingestResult.escalationRun).toBeUndefined()
      expect(mockEmergencyPrisma.emergencyAlert.create).not.toHaveBeenCalled()
    })
  })
})

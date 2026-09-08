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
  handlePatientEmergencyResponse,
  handleEmergencyTimeout,
  formatEmergencyLocation,
  formatEmergencyFamilyAlertMessage,
  formatEmergencyNakesAlertMessage,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  type EmergencyPrismaClient,
} from './emergency.service'
import { ingestVitalSign } from '../vitals/vitals.service'
import { InMemoryEscalationQueueAdapter } from '../escalation/timeout.service'

describe('emergency.service (CL-204 & CL-206)', () => {
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'
  const dummyUserId = '22222222-2222-4222-8222-222222222222'
  const dummyEmergencyId = '33333333-3333-4333-8333-333333333333'
  const dummyRunId = '44444444-4444-4444-8444-444444444444'

  function createMockEmergencyPrisma(options?: {
    patientExists?: boolean
    patientPhone?: string
    patientName?: string
    livingSituation?: string
    emergencyPreference?: string
    lastKnownLat?: number | null
    lastKnownLng?: number | null
    familyContacts?: any[]
    nakesContacts?: any[]
  }): EmergencyPrismaClient {
    const patientExists = options?.patientExists ?? true
    const patientPhone = options?.patientPhone ?? '081234567890'
    const patientName = options?.patientName ?? 'Bu Siti Test'

    let currentRunStatus = EscalationRunStatus.WAITING_PATIENT

    return {
      patient: {
        findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
          if (!patientExists || where.id !== dummyPatientId) return null
          return {
            id: dummyPatientId,
            smartwatchEnabled: true,
            healthConditions: ['hipertensi'],
            emergencyPreference: options?.emergencyPreference ?? 'FAMILY_FIRST',
            livingSituation: options?.livingSituation ?? 'WITH_FAMILY',
            lastKnownLat: options?.lastKnownLat !== undefined ? options.lastKnownLat : null,
            lastKnownLng: options?.lastKnownLng !== undefined ? options.lastKnownLng : null,
            familyContacts: options?.familyContacts ?? [
              { id: 'fc-1', name: 'Budi (Anak)', phone: '08111111111', tier: 'TIER_1', priority: 1, isActive: true },
            ],
            nakesContacts: options?.nakesContacts ?? [
              { id: 'nc-1', nakesName: 'Bidan Siti', phone: '08222222222', isPrimary: true, isActive: true },
            ],
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
            status: currentRunStatus,
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
        update: vi.fn().mockImplementation(async ({ data }: any) => {
          if (data.status) {
            currentRunStatus = data.status
          }
          return {
            id: dummyRunId,
            patientId: dummyPatientId,
            context: EscalationContext.EMERGENCY,
            sourceEmergencyId: dummyEmergencyId,
            status: currentRunStatus,
            ...data,
          }
        }),
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

  describe('handlePatientEmergencyResponse (CL-205)', () => {
    it('melempar 404 jika alert darurat tidak ditemukan', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue(null)

      await expect(
        handlePatientEmergencyResponse(mockPrisma, {
          emergencyId: 'non-existent-id',
          response: 'SAFE',
        }),
      ).rejects.toThrow('Emergency alert dengan ID non-existent-id tidak ditemukan')
    })

    it('respons SAFE: menyelesaikan emergency menjadi RESOLVED_SAFE dan keluarga TIDAK dialert (AC-4.2)', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      const mockQueue = new InMemoryEscalationQueueAdapter()
      const cancelSpy = vi.spyOn(mockQueue, 'cancelTimeout')

      const alertRecord = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        patientConfirmedSafe: null,
        notes: 'Anomali detak jantung',
        escalationRun: {
          id: dummyRunId,
          patientId: dummyPatientId,
          status: EscalationRunStatus.WAITING_PATIENT,
          currentTier: null,
          configSnapshot: { jobId: 'job-123' },
          steps: [],
        },
        patient: {
          id: dummyPatientId,
          user: { id: dummyUserId, fullName: 'Bu Siti Test', phone: '081234567890' },
        },
      }

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue(alertRecord)
      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        ...alertRecord,
        ...data,
      }))
      let runStatus = EscalationRunStatus.WAITING_PATIENT
      mockPrisma.escalationRun.findUnique = vi.fn().mockImplementation(async () => ({
        ...alertRecord.escalationRun,
        status: runStatus,
      }))
      mockPrisma.escalationRun.update = vi.fn().mockImplementation(async ({ data }: any) => {
        runStatus = data.status
        return { ...alertRecord.escalationRun, ...data }
      })

      const result = await handlePatientEmergencyResponse(
        mockPrisma,
        {
          emergencyId: dummyEmergencyId,
          response: 'SAFE',
          notes: 'Saya baru saja selesai olahraga',
        },
        { queueAdapter: mockQueue },
      )

      // 1. Verifikasi status EmergencyAlert menjadi RESOLVED_SAFE
      expect(result.status).toBe(EmergencyStatus.RESOLVED_SAFE)
      expect(result.patientConfirmedSafe).toBe(true)
      expect(result.resolvedAt).toBeInstanceOf(Date)
      expect(mockPrisma.emergencyAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: dummyEmergencyId },
          data: expect.objectContaining({
            status: EmergencyStatus.RESOLVED_SAFE,
            patientConfirmedSafe: true,
          }),
        }),
      )

      // 2. Verifikasi EscalationRun status diselesaikan (RESOLVED)
      expect(result.escalationStatus).toBe('RESOLVED')

      // 3. Verifikasi timer timeout dibatalkan
      expect(cancelSpy).toHaveBeenCalledWith('job-123')

      // 4. Verifikasi langkah dicatat di escalation_steps
      expect(mockPrisma.escalationStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: dummyRunId,
            messageKey: 'emergency.patient_confirmed_safe',
            response: 'ACK_HANDLE',
          }),
        }),
      )

      // 5. Verifikasi AuditLog dicatat
      expect(mockPrisma.auditLog?.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'emergency.resolved',
            resourceType: 'EmergencyAlert',
            resourceId: dummyEmergencyId,
          }),
        }),
      )
    })

    it('respons SAFE idempoten: memanggil ulang SAFE pada alert yang sudah RESOLVED_SAFE mengembalikan data yang sama', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      const resolvedRecord = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.RESOLVED_SAFE,
        patientConfirmedSafe: true,
        patientConfirmedAt: new Date(),
        resolvedAt: new Date(),
        updatedAt: new Date(),
        escalationRun: {
          id: dummyRunId,
          status: EscalationRunStatus.RESOLVED,
        },
      }

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue(resolvedRecord)

      const result = await handlePatientEmergencyResponse(mockPrisma, {
        emergencyId: dummyEmergencyId,
        response: 'SAFE',
      })

      expect(result.status).toBe(EmergencyStatus.RESOLVED_SAFE)
      expect(result.patientConfirmedSafe).toBe(true)
      expect(mockPrisma.emergencyAlert.update).not.toHaveBeenCalled()
    })

    it('respons NEED_HELP: langsung mempercepat eskalasi tanpa menunggu sisa timeout', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      const mockQueue = new InMemoryEscalationQueueAdapter()
      const cancelSpy = vi.spyOn(mockQueue, 'cancelTimeout')

      const alertRecord = {
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        patientConfirmedSafe: null,
        escalationRun: {
          id: dummyRunId,
          patientId: dummyPatientId,
          status: EscalationRunStatus.WAITING_PATIENT,
          currentTier: null,
          configSnapshot: { jobId: 'job-patient-timeout' },
          steps: [],
        },
        patient: {
          id: dummyPatientId,
          user: { id: dummyUserId, fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [{ tier: 'TIER_1', isActive: true }],
        },
      }

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue(alertRecord)
      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        ...alertRecord,
        ...data,
      }))
      let runStatus = EscalationRunStatus.WAITING_PATIENT
      let currentTier: any = null
      mockPrisma.escalationRun.findUnique = vi.fn().mockImplementation(async () => ({
        ...alertRecord.escalationRun,
        status: runStatus,
        currentTier,
      }))
      mockPrisma.escalationRun.update = vi.fn().mockImplementation(async ({ data }: any) => {
        runStatus = data.status
        currentTier = data.currentTier
        return { ...alertRecord.escalationRun, ...data }
      })

      const result = await handlePatientEmergencyResponse(
        mockPrisma,
        {
          emergencyId: dummyEmergencyId,
          response: 'NEED_HELP',
          notes: 'Dada terasa sesak',
        },
        { queueAdapter: mockQueue },
      )

      // 1. Verifikasi EmergencyAlert beralih ke status ESCALATING
      expect(result.status).toBe(EmergencyStatus.ESCALATING)
      expect(result.patientConfirmedSafe).toBe(false)
      expect(mockPrisma.emergencyAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: dummyEmergencyId },
          data: expect.objectContaining({
            status: EmergencyStatus.ESCALATING,
            patientConfirmedSafe: false,
          }),
        }),
      )

      // 2. Verifikasi timer timeout pasien dibatalkan karena eskalasi dipercepat
      expect(cancelSpy).toHaveBeenCalledWith('job-patient-timeout')

      // 3. Verifikasi status eskalasi langsung dipercepat ke FAMILY_TIER_1
      expect(result.escalationStatus).toBe(EscalationRunStatus.FAMILY_TIER_1)

      // 4. Verifikasi langkah dicatat di escalation_steps
      expect(mockPrisma.escalationStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: dummyRunId,
            messageKey: 'emergency.patient_requested_help',
          }),
        }),
      )
    })

    it('menolak transisi ilegal jika alert sudah TIMED_OUT', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        status: EmergencyStatus.TIMED_OUT,
      })

      await expect(
        handlePatientEmergencyResponse(mockPrisma, {
          emergencyId: dummyEmergencyId,
          response: 'SAFE',
        }),
      ).rejects.toThrow('Batas waktu konfirmasi darurat sudah habis (TIMED_OUT)')
    })
  })

  describe('CL-206: formatEmergencyLocation & Message Formatters', () => {
    it('formatEmergencyLocation menyusun tautan Google Maps saat koordinat tersedia (AC-4.3)', () => {
      const result = formatEmergencyLocation(-6.2088, 106.8456)
      expect(result.hasLocation).toBe(true)
      expect(result.mapsUrl).toBe('https://maps.google.com/?q=-6.2088,106.8456')
      expect(result.locationText).toContain('https://maps.google.com/?q=-6.2088,106.8456')
    })

    it('formatEmergencyLocation menggunakan fallback saat koordinat null/kosong (AC-4.3)', () => {
      const result = formatEmergencyLocation(null, null)
      expect(result.hasLocation).toBe(false)
      expect(result.mapsUrl).toBeUndefined()
      expect(result.locationText).toBe('Lokasi pasien tidak tersedia')
    })

    it('formatEmergencyFamilyAlertMessage memuat nama, kondisi, lokasi, dan deep link tel:112 tanpa auto-dial (AC-4.3, AC-4.6)', () => {
      const msg = formatEmergencyFamilyAlertMessage({
        patientName: 'Pak Budi',
        patientPhone: '08123456789',
        hrBpm: 135,
        locationText: 'Lokasi terakhir: https://maps.google.com/?q=-6.2,106.8',
        mapsUrl: 'https://maps.google.com/?q=-6.2,106.8',
      })

      expect(msg.tel112).toBe('tel:112')
      expect(msg.body).toContain('Pak Budi')
      expect(msg.body).toContain('135 bpm')
      expect(msg.body).toContain('tel:112')
      expect(msg.body).toContain('https://maps.google.com/?q=-6.2,106.8')
    })

    it('formatEmergencyNakesAlertMessage menyertakan tag ALONE jika pasien tinggal sendiri (AC-4.5, AC-4.6)', () => {
      const msg = formatEmergencyNakesAlertMessage({
        patientName: 'Nenek Aminah',
        patientPhone: '08987654321',
        hrBpm: 45,
        locationText: 'Lokasi pasien tidak tersedia',
        livingSituation: 'ALONE',
      })

      expect(msg.tel112).toBe('tel:112')
      expect(msg.body).toContain('Nenek Aminah')
      expect(msg.body).toContain('ALONE')
      expect(msg.body).toContain('tel:112')
    })
  })

  describe('CL-206: handleEmergencyTimeout', () => {
    it('saat timeout dengan lokasi GPS: update status ESCALATING, simpan lokasi, kirim alert WA keluarga + tel:112 (AC-4.3, AC-4.4, AC-4.6, AC-4.7)', async () => {
      const mockPrisma = createMockEmergencyPrisma({
        lastKnownLat: -6.2088,
        lastKnownLng: 106.8456,
        familyContacts: [
          { id: 'fc-1', name: 'Dewi (Anak)', phone: '081299998888', tier: 'TIER_1', priority: 1, isActive: true },
        ],
      })

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        hrBpm: 140,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        notes: 'Anomali detak jantung tinggi',
        patient: {
          id: dummyPatientId,
          livingSituation: 'WITH_FAMILY',
          lastKnownLat: -6.2088,
          lastKnownLng: 106.8456,
          user: { id: dummyUserId, fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [
            { id: 'fc-1', name: 'Dewi (Anak)', phone: '081299998888', tier: 'TIER_1', priority: 1, isActive: true },
          ],
          nakesContacts: [],
        },
        escalationRun: {
          id: dummyRunId,
          status: EscalationRunStatus.WAITING_PATIENT,
          steps: [],
        },
      })

      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyEmergencyId,
        ...data,
      }))

      mockPrisma.escalationRun.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyRunId,
        ...data,
      }))

      const sentWa: any[] = []
      const mockWaService = {
        sendText: vi.fn().mockImplementation(async (to: string, text: string) => {
          sentWa.push({ to, text })
          return { providerMessageId: 'wa-msg-123' }
        }),
      }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      // 1. Verifikasi hasil dan status darurat
      expect(result.emergencyId).toBe(dummyEmergencyId)
      expect(result.status).toBe(EmergencyStatus.ESCALATING)
      expect(result.hasLocation).toBe(true)
      expect(result.locationLat).toBe('-6.2088')
      expect(result.locationLng).toBe('106.8456')
      expect(result.notifiedFamilyCount).toBe(1)
      expect(result.tel112).toBe('tel:112')

      // 2. Verifikasi update tabel EmergencyAlert (AC-4.3, AC-4.7)
      expect(mockPrisma.emergencyAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: dummyEmergencyId },
          data: expect.objectContaining({
            status: EmergencyStatus.ESCALATING,
            locationLat: -6.2088,
            locationLng: 106.8456,
            alertSentToFamilyAt: expect.any(Date),
          }),
        }),
      )

      // 3. Verifikasi pesan WhatsApp terkirim ke keluarga dengan link maps dan tel:112 (AC-4.3, AC-4.6)
      expect(mockWaService.sendText).toHaveBeenCalledTimes(1)
      expect(sentWa[0].to).toBe('081299998888')
      expect(sentWa[0].text).toContain('https://maps.google.com/?q=-6.2088,106.8456')
      expect(sentWa[0].text).toContain('tel:112')

      // 4. Verifikasi notifikasi tersimpan dengan payload tel112 (AC-4.6)
      expect(mockPrisma.notification!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: Channel.WHATSAPP,
            type: NotificationType.EMERGENCY,
            payload: expect.objectContaining({
              tel112: 'tel:112',
              hasAutoDial: false,
              hasLocation: true,
            }),
          }),
        }),
      )

      // 5. Verifikasi escalation_steps dan audit_logs terisi (AC-4.7)
      expect(mockPrisma.escalationStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            runId: dummyRunId,
            tier: 'TIER_1',
            messageKey: 'emergency.alert_family',
          }),
        }),
      )
      expect(mockPrisma.auditLog!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'escalation.step',
            resourceType: 'EmergencyAlert',
            meta: expect.objectContaining({
              event: 'EMERGENCY_TIMEOUT',
              hasLocation: true,
              tel112: 'tel:112',
            }),
          }),
        }),
      )
    })

    it('saat timeout tanpa lokasi GPS: kirim pesan fallback "Lokasi pasien tidak tersedia" (AC-4.3)', async () => {
      const mockPrisma = createMockEmergencyPrisma({
        lastKnownLat: null,
        lastKnownLng: null,
      })

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        hrBpm: 130,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        patient: {
          id: dummyPatientId,
          livingSituation: 'WITH_FAMILY',
          lastKnownLat: null,
          lastKnownLng: null,
          user: { id: dummyUserId, fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: [
            { id: 'fc-1', name: 'Dewi (Anak)', phone: '081299998888', tier: 'TIER_1', priority: 1, isActive: true },
          ],
          nakesContacts: [],
        },
        escalationRun: {
          id: dummyRunId,
          status: EscalationRunStatus.WAITING_PATIENT,
          steps: [],
        },
      })

      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyEmergencyId,
        ...data,
      }))
      mockPrisma.escalationRun.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyRunId,
        ...data,
      }))

      const sentWa: any[] = []
      const mockWaService = {
        sendText: vi.fn().mockImplementation(async (to: string, text: string) => {
          sentWa.push({ to, text })
          return { providerMessageId: 'wa-msg-fallback' }
        }),
      }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      expect(result.hasLocation).toBe(false)
      expect(result.locationLat).toBeNull()
      expect(result.locationLng).toBeNull()
      expect(sentWa[0].text).toContain('Lokasi pasien tidak tersedia')
      expect(sentWa[0].text).toContain('tel:112')
    })

    it('mengirim alert ke semua kontak keluarga aktif terurut tier (AC-4.4)', async () => {
      const contacts = [
        { id: 'fc-2', name: 'Pak RT (Tier 2)', phone: '08222222222', tier: 'TIER_2', priority: 1, isActive: true },
        { id: 'fc-1', name: 'Budi (Anak Tier 1)', phone: '08111111111', tier: 'TIER_1', priority: 1, isActive: true },
      ]

      const mockPrisma = createMockEmergencyPrisma({
        familyContacts: contacts,
      })

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        hrBpm: 125,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        patient: {
          id: dummyPatientId,
          livingSituation: 'WITH_FAMILY',
          user: { id: dummyUserId, fullName: 'Bu Siti Test', phone: '081234567890' },
          familyContacts: contacts,
          nakesContacts: [],
        },
        escalationRun: {
          id: dummyRunId,
          status: EscalationRunStatus.WAITING_PATIENT,
          steps: [],
        },
      })

      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyEmergencyId,
        ...data,
      }))
      mockPrisma.escalationRun.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyRunId,
        ...data,
      }))

      const calledPhones: string[] = []
      const mockWaService = {
        sendText: vi.fn().mockImplementation(async (to: string) => {
          calledPhones.push(to)
          return { providerMessageId: 'wa-tier-msg' }
        }),
      }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      expect(result.notifiedFamilyCount).toBe(2)
      // TIER_1 (08111111111) wajib dinotifikasi sebelum TIER_2 (08222222222)
      expect(calledPhones[0]).toBe('08111111111')
      expect(calledPhones[1]).toBe('08222222222')
    })

    it('pasien living_situation=alone tanpa tier-1 langsung dieskalasi ke nakes (AC-4.5)', async () => {
      const nakesList = [
        { id: 'nc-1', nakesName: 'Bidan Ratna', phone: '087777777777', nakesUserId: 'u-nakes-1', isPrimary: true, isActive: true },
      ]

      const mockPrisma = createMockEmergencyPrisma({
        livingSituation: 'ALONE',
        familyContacts: [], // tidak ada kontak tier-1
        nakesContacts: nakesList,
      })

      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        hrBpm: 145,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        patient: {
          id: dummyPatientId,
          livingSituation: 'ALONE',
          user: { id: dummyUserId, fullName: 'Kakek Joyo', phone: '081234567890' },
          familyContacts: [],
          nakesContacts: nakesList,
        },
        escalationRun: {
          id: dummyRunId,
          status: EscalationRunStatus.WAITING_PATIENT,
          steps: [],
        },
      })

      mockPrisma.emergencyAlert.update = vi.fn().mockImplementation(async ({ data }: any) => ({
        id: dummyEmergencyId,
        ...data,
      }))

      const sentWa: any[] = []
      const mockWaService = {
        sendText: vi.fn().mockImplementation(async (to: string, text: string) => {
          sentWa.push({ to, text })
          return { providerMessageId: 'wa-nakes-1' }
        }),
      }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      // 1. Verifikasi eskalasi langsung ke NAKES (tanpa menunggu tier keluarga)
      expect(result.escalationStatus).toBe(EscalationRunStatus.NAKES)
      expect(result.notifiedNakesCount).toBe(1)
      expect(result.notifiedFamilyCount).toBe(0)

      // 2. Verifikasi pesan alert WA terkirim ke kontak nakes pembina
      expect(mockWaService.sendText).toHaveBeenCalledWith('087777777777', expect.stringContaining('ALONE'))

      // 3. Verifikasi tabel EmergencyAlert mencatat alertSentToNakesAt
      expect(mockPrisma.emergencyAlert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            alertSentToNakesAt: expect.any(Date),
          }),
        }),
      )

      // 4. Verifikasi notifikasi IN_APP nakes dashboard terbuat dengan priority HIGH
      expect(mockPrisma.notification!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            channel: Channel.IN_APP,
            type: NotificationType.EMERGENCY,
            payload: expect.objectContaining({
              priority: 'HIGH',
              livingSituation: 'ALONE',
              tel112: 'tel:112',
            }),
          }),
        }),
      )
    })

    it('mengabaikan timeout secara idempoten jika status sudah RESOLVED_SAFE (AC-4.2)', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        status: EmergencyStatus.RESOLVED_SAFE,
        patient: { id: dummyPatientId },
      })

      const mockWaService = { sendText: vi.fn() }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      expect(result.skipped).toBe(true)
      expect(result.reason).toBe('EMERGENCY_ALREADY_RESOLVED')
      expect(mockWaService.sendText).not.toHaveBeenCalled()
    })

    it('mencegah spam ganda jika alert sudah ESCALATING dan alert sudah terkirim', async () => {
      const mockPrisma = createMockEmergencyPrisma()
      mockPrisma.emergencyAlert.findUnique = vi.fn().mockResolvedValue({
        id: dummyEmergencyId,
        status: EmergencyStatus.ESCALATING,
        alertSentToFamilyAt: new Date(),
        patient: { id: dummyPatientId },
      })

      const mockWaService = { sendText: vi.fn() }

      const result = await handleEmergencyTimeout(
        mockPrisma,
        { emergencyId: dummyEmergencyId },
        { whatsAppService: mockWaService as any },
      )

      expect(result.skipped).toBe(true)
      expect(result.reason).toBe('EMERGENCY_ALREADY_ESCALATED')
      expect(mockWaService.sendText).not.toHaveBeenCalled()
    })
  })
})

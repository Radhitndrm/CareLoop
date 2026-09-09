import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import {
  EscalationContext,
  EscalationRunStatus,
  EscalationTier,
  ResolutionType,
} from '@careloop/shared'

describe('Escalation Routes (CL-207, docs/API.md §3.6)', () => {
  let app: FastifyInstance
  const dummyRunId = '44444444-4444-4444-8444-444444444444'
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'
  const dummyUserId = '22222222-2222-4222-8222-222222222222'

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma))
    if (prisma.auditLog) {
      vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'audit-default' } as any)
    }
    if (prisma.notification) {
      vi.spyOn(prisma.notification, 'create').mockResolvedValue({ id: 'notif-default' } as any)
    }
    if (prisma.familyContact) {
      vi.spyOn(prisma.familyContact, 'findMany').mockResolvedValue([])
    }
    if (prisma.nakesContact) {
      vi.spyOn(prisma.nakesContact, 'findMany').mockResolvedValue([])
    }
  })

  describe('GET /v1/escalations/active', () => {
    it('mengembalikan daftar run eskalasi aktif dengan status 200', async () => {
      vi.spyOn(prisma.escalationRun, 'findMany').mockResolvedValue([
        {
          id: dummyRunId,
          patientId: dummyPatientId,
          context: EscalationContext.SCHEDULE,
          status: EscalationRunStatus.WAITING_PATIENT,
          currentTier: null,
          startedAt: new Date(),
          steps: [],
          patient: {
            id: dummyPatientId,
            nik: '3471010000000001',
            livingSituation: 'WITH_FAMILY',
            emergencyPreference: 'FAMILY_FIRST',
            user: {
              id: dummyUserId,
              fullName: 'Bu Siti Test',
              phone: '081234567890',
            },
          },
        } as any,
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/v1/escalations/active',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(dummyRunId)
      expect(body.data[0].status).toBe(EscalationRunStatus.WAITING_PATIENT)
    })
  })

  describe('GET /v1/escalations/:id', () => {
    it('mengembalikan detail run eskalasi jika ditemukan', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: dummyRunId,
        patientId: dummyPatientId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.FAMILY_TIER_1,
        currentTier: EscalationTier.TIER_1,
        startedAt: new Date(),
        steps: [
          {
            id: 'step-1',
            runId: dummyRunId,
            tier: EscalationTier.TIER_1,
            messageKey: 'alert.family.tier_1',
            contactPhone: '081299990001',
            sentAt: new Date(),
          },
        ],
        patient: {
          id: dummyPatientId,
          nik: '3471010000000001',
          livingSituation: 'WITH_FAMILY',
          emergencyPreference: 'FAMILY_FIRST',
        },
        resolvedByUser: null,
      } as any)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/escalations/${dummyRunId}`,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.id).toBe(dummyRunId)
      expect(body.data.status).toBe(EscalationRunStatus.FAMILY_TIER_1)
      expect(body.data.steps).toHaveLength(1)
    })

    it('mengembalikan 404 jika run tidak ditemukan', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/escalations/${dummyRunId}`,
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('mengembalikan 400 jika param id bukan UUID valid', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/escalations/not-a-valid-uuid',
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /v1/escalations/:id/respond (AC-7.2)', () => {
    it('respons HANDLE oleh keluarga menghentikan eskalasi (status HANDLED, 200)', async () => {
      let runState: any = {
        id: dummyRunId,
        patientId: dummyPatientId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.FAMILY_TIER_1,
        currentTier: EscalationTier.TIER_1,
        steps: [],
        patient: {
          id: dummyPatientId,
          user: { fullName: 'Bu Siti' },
        },
      }

      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async () => runState) as any)
      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
        id: dummyPatientId,
        emergencyPreference: 'FAMILY_FIRST',
        livingSituation: 'WITH_FAMILY',
        familyContacts: [{ tier: 'TIER_1', isActive: true }],
      } as any)

      vi.spyOn(prisma.escalationRun, 'update').mockImplementation((async ({ data }: any) => {
        runState = {
          ...runState,
          ...data,
          resolvedByUserId: data.resolvedByUserId ?? 'user-family-1',
        }
        return runState
      }) as any)

      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({
        id: 'step-handled',
      } as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${dummyRunId}/respond`,
        payload: {
          response: 'HANDLE',
          note: 'Saya akan ke rumah Bu Ratna sekarang',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.runId).toBe(dummyRunId)
      expect(body.data.status).toBe(EscalationRunStatus.HANDLED)
      expect(body.data.resolutionType).toBe(ResolutionType.FAMILY_HANDLED)
      expect(body.data.remainingTiersCancelled).toBe(true)
    })

    it('respons LOOKING mencatat pengakuan tanpa menghentikan eskalasi', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: dummyRunId,
        patientId: dummyPatientId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.FAMILY_TIER_1,
        currentTier: EscalationTier.TIER_1,
        steps: [],
      } as any)

      const createStepSpy = vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({
        id: 'step-looking',
      } as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${dummyRunId}/respond`,
        payload: {
          response: 'LOOKING',
          note: 'Sedang mengecek pesan',
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.runId).toBe(dummyRunId)
      expect(body.data.status).toBe(EscalationRunStatus.FAMILY_TIER_1)
      expect(body.data.acknowledged).toBe(true)
      expect(createStepSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            response: 'ACK_LOOKING',
            messageKey: 'respond.looking',
          }),
        }),
      )
    })

    it('menolak transisi dengan 422 INVALID_TRANSITION jika run sudah selesai', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: dummyRunId,
        patientId: dummyPatientId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.RESOLVED,
        currentTier: null,
      } as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${dummyRunId}/respond`,
        payload: {
          response: 'HANDLE',
        },
      })

      expect(res.statusCode).toBe(422)
      const body = res.json()
      expect(body.error.code).toBe('INVALID_TRANSITION')
    })

    it('mengembalikan 404 jika run tidak ditemukan saat merespons', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${dummyRunId}/respond`,
        payload: {
          response: 'HANDLE',
        },
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('mengembalikan 400 jika request payload tidak valid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${dummyRunId}/respond`,
        payload: {
          response: 'INVALID_OPTION',
        },
      })

      expect(res.statusCode).toBe(400)
      const body = res.json()
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('GET /v1/escalations/:runId/steps (AC-7.4)', () => {
    it('mengembalikan seluruh riwayat langkah eskalasi yang terurut', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: dummyRunId,
        steps: [
          {
            id: 'step-1',
            runId: dummyRunId,
            tier: null,
            messageKey: 'reminder.metformin',
            sentAt: new Date('2026-08-16T08:00:00Z'),
          },
          {
            id: 'step-2',
            runId: dummyRunId,
            tier: EscalationTier.TIER_1,
            messageKey: 'alert.family.tier_1',
            sentAt: new Date('2026-08-16T08:30:00Z'),
          },
        ],
      } as any)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/escalations/${dummyRunId}/steps`,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toHaveLength(2)
      expect(body.data[0].messageKey).toBe('reminder.metformin')
      expect(body.data[1].messageKey).toBe('alert.family.tier_1')
    })

    it('mengembalikan 404 jika run tidak ditemukan', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/escalations/${dummyRunId}/steps`,
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('POST /internal/jobs/escalation-timeout', () => {
    it('menjalankan transisi timeout jadwal obat dan mengembalikan state baru', async () => {
      let runState: any = {
        id: dummyRunId,
        patientId: dummyPatientId,
        context: EscalationContext.SCHEDULE,
        status: EscalationRunStatus.WAITING_PATIENT,
        steps: [],
        patient: {
          id: dummyPatientId,
          user: { fullName: 'Bu Siti' },
        },
      }

      vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async () => runState) as any)

      vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
        id: dummyPatientId,
        emergencyPreference: 'FAMILY_FIRST',
        livingSituation: 'WITH_FAMILY',
        familyContacts: [{ tier: 'TIER_1', isActive: true }],
      } as any)

      vi.spyOn(prisma.escalationRun, 'update').mockImplementation((async ({ data }: any) => {
        runState = { ...runState, ...data }
        return runState
      }) as any)

      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({
        id: 'step-new',
      } as any)

      vi.spyOn(prisma.familyContact, 'findMany').mockResolvedValue([
        {
          id: 'fc-1',
          patientId: dummyPatientId,
          name: 'Budi (Anak Tier 1)',
          phone: '081299990001',
          tier: 'TIER_1',
          priority: 1,
          isActive: true,
        },
      ] as any)

      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        payload: {
          runId: dummyRunId,
          currentState: EscalationRunStatus.WAITING_PATIENT,
        },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.runId).toBe(dummyRunId)
      expect(body.data.newState).toBe(EscalationRunStatus.FAMILY_TIER_1)
    })

    it('mengembalikan 422 STATE_CHANGED jika status run sudah berubah di DB', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue({
        id: dummyRunId,
        status: EscalationRunStatus.RESOLVED,
        context: EscalationContext.SCHEDULE,
        patientId: dummyPatientId,
      } as any)

      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        payload: {
          runId: dummyRunId,
          currentState: EscalationRunStatus.WAITING_PATIENT,
        },
      })

      expect(res.statusCode).toBe(422)
      const body = res.json()
      expect(body.error.code).toBe('STATE_CHANGED')
    })

    it('mengembalikan 404 jika run tidak ditemukan', async () => {
      vi.spyOn(prisma.escalationRun, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        payload: {
          runId: dummyRunId,
        },
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })
})

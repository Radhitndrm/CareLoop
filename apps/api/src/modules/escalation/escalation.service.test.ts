// CL-109: Unit tests untuk Persistensi Escalation Run & Step ke Database.
// Menguji pembuatan run, guard single active run (cancel old vs 409 conflict),
// pencatatan step transaksional (AC-7.4), transisi state, dan audit log.
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import {
  startEscalationRun,
  transitionEscalationRun,
  resolveEscalationRun,
  handleEscalationRun,
  cancelEscalationRun,
  getActiveEscalationRun,
  getEscalationRunById,
  resolvePatientEscalationContext,
  type EscalationPrismaClient,
} from './escalation.service'
import { InvalidTransitionError } from './state-machine'
import { ApiError, ApiErrorCode } from '../../lib/errors'

interface MockStore {
  runs: any[]
  steps: any[]
  patients: any[]
  auditLogs: any[]
}

function createMockPrisma(initialStore?: Partial<MockStore>): EscalationPrismaClient & { store: MockStore } {
  const store: MockStore = {
    runs: initialStore?.runs ? [...initialStore.runs] : [],
    steps: initialStore?.steps ? [...initialStore.steps] : [],
    patients: initialStore?.patients ? [...initialStore.patients] : [],
    auditLogs: initialStore?.auditLogs ? [...initialStore.auditLogs] : [],
  }

  const client: any = {
    store,
    escalationRun: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          store.runs.find((r) => {
            if (where.patientId && r.patientId !== where.patientId) return false
            if (where.context && r.context !== where.context) return false
            if (where.status?.in && !where.status.in.includes(r.status)) return false
            return true
          }) ?? null
        )
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const found = store.runs.find((r) => r.id === where.id)
        if (!found) return null
        return {
          ...found,
          steps: store.steps.filter((s) => s.runId === found.id),
        }
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = data.id ?? `run-${store.runs.length + 1}`
        const run = {
          id,
          patientId: data.patientId,
          context: data.context,
          sourceScheduleId: data.sourceScheduleId ?? null,
          sourceEmergencyId: data.sourceEmergencyId ?? null,
          status: data.status ?? 'WAITING_PATIENT',
          currentTier: data.currentTier ?? null,
          startedAt: data.startedAt ?? new Date(),
          resolvedAt: data.resolvedAt ?? null,
          resolutionType: data.resolutionType ?? null,
          resolvedByUserId: data.resolvedByUserId ?? null,
          configSnapshot: data.configSnapshot ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        store.runs.push(run)
        return run
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = store.runs.findIndex((r) => r.id === where.id)
        if (index === -1) throw new Error(`Run ${where.id} not found in mock store`)
        const current = store.runs[index]
        const updated = {
          ...current,
          ...data,
          updatedAt: new Date(),
        }
        store.runs[index] = updated
        return updated
      }),
      findMany: vi.fn(async ({ where }: any = {}) => {
        return store.runs.filter((r) => {
          if (where?.status?.in && !where.status.in.includes(r.status)) return false
          return true
        })
      }),
    },
    escalationStep: {
      create: vi.fn(async ({ data }: any) => {
        const id = data.id ?? `step-${store.steps.length + 1}`
        const step = {
          id,
          runId: data.runId,
          tier: data.tier ?? null,
          contactUserId: data.contactUserId ?? null,
          contactPhone: data.contactPhone,
          channel: data.channel ?? 'WHATSAPP',
          messageKey: data.messageKey,
          sentAt: data.sentAt ?? new Date(),
          deliveredAt: data.deliveredAt ?? null,
          readAt: data.readAt ?? null,
          respondedAt: data.respondedAt ?? null,
          response: data.response ?? 'NONE',
          providerMessageId: data.providerMessageId ?? null,
          error: data.error ?? null,
          createdAt: new Date(),
        }
        store.steps.push(step)
        return step
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.steps.filter((s) => s.runId === where.runId)
      }),
    },
    patient: {
      findUnique: vi.fn(async ({ where }: any) => {
        return store.patients.find((p) => p.id === where.id) ?? null
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const id = `audit-${store.auditLogs.length + 1}`
        const log = { id, ...data, createdAt: new Date() }
        store.auditLogs.push(log)
        return { id }
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(client)),
  }

  return client
}

describe('CL-109: EscalationService — Persistensi Escalation Run & Step', () => {
  const PATIENT_ID = 'patient-bu-ratna'
  const SCHEDULE_ID = 'schedule-metformin-pagi'

  describe('startEscalationRun', () => {
    it('membuat EscalationRun baru dalam state WAITING_PATIENT dan mencatat initialStep', async () => {
      const client = createMockPrisma()

      const run = await startEscalationRun(client, {
        patientId: PATIENT_ID,
        context: 'SCHEDULE',
        sourceScheduleId: SCHEDULE_ID,
        initialStep: {
          contactPhone: '081234567890',
          channel: 'WHATSAPP',
          messageKey: 'reminder.metformin',
        },
      })

      expect(run).toBeDefined()
      expect(run.id).toBeDefined()
      expect(run.status).toBe('WAITING_PATIENT')
      expect(run.context).toBe('SCHEDULE')
      expect(run.sourceScheduleId).toBe(SCHEDULE_ID)

      // Step awal tercatat
      expect(client.store.steps).toHaveLength(1)
      expect(client.store.steps[0].runId).toBe(run.id)
      expect(client.store.steps[0].messageKey).toBe('reminder.metformin')

      // Audit log tercatat
      expect(client.store.auditLogs).toHaveLength(1)
      expect(client.store.auditLogs[0].action).toBe('escalation.step')
      expect(client.store.auditLogs[0].patientId).toBe(PATIENT_ID)
    })

    it('guard active run: cancelExisting=true (default) membatalkan run aktif yang lama', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-lama',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(Date.now() - 60000),
          },
        ],
      })

      const newRun = await startEscalationRun(client, {
        patientId: PATIENT_ID,
        context: 'SCHEDULE',
        sourceScheduleId: SCHEDULE_ID,
      })

      expect(newRun.id).not.toBe('run-lama')
      expect(newRun.status).toBe('WAITING_PATIENT')

      // Run lama dibatalkan
      const oldRun = client.store.runs.find((r) => r.id === 'run-lama')
      expect(oldRun.status).toBe('RESOLVED')
      expect(oldRun.resolutionType).toBe('CANCELLED')
      expect(oldRun.resolvedAt).toBeInstanceOf(Date)

      // Step pembatalan tercatat di run lama
      const cancelStep = client.store.steps.find((s) => s.runId === 'run-lama')
      expect(cancelStep).toBeDefined()
      expect(cancelStep?.messageKey).toBe('run.cancelled_by_new_run')
    })

    it('guard active run: cancelExisting=false melempar 409 CONFLICT jika sudah ada run aktif', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-aktif-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'FAMILY_TIER_1',
            currentTier: 'TIER_1',
            startedAt: new Date(),
          },
        ],
      })

      await expect(
        startEscalationRun(client, {
          patientId: PATIENT_ID,
          context: 'SCHEDULE',
          cancelExisting: false,
        }),
      ).rejects.toThrow(ApiError)

      try {
        await startEscalationRun(client, {
          patientId: PATIENT_ID,
          context: 'SCHEDULE',
          cancelExisting: false,
        })
      } catch (err: any) {
        expect(err.statusCode).toBe(409)
        expect(err.code).toBe(ApiErrorCode.CONFLICT)
      }
    })

    it('mendukung context EMERGENCY bersamaan dengan SCHEDULE tanpa saling bentrok', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-schedule',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            startedAt: new Date(),
          },
        ],
      })

      // Run EMERGENCY baru untuk pasien yang sama diizinkan
      const emergencyRun = await startEscalationRun(client, {
        patientId: PATIENT_ID,
        context: 'EMERGENCY',
        sourceEmergencyId: 'emergency-alert-1',
        cancelExisting: false,
      })

      expect(emergencyRun.context).toBe('EMERGENCY')
      expect(client.store.runs).toHaveLength(2)
      expect(client.store.runs[0].status).toBe('WAITING_PATIENT') // run schedule tetap aktif
      expect(client.store.runs[1].status).toBe('WAITING_PATIENT') // run emergency baru aktif
    })

    it('menerjemahkan pelanggaran unique index P2002 menjadi 409 CONFLICT', async () => {
      const client = createMockPrisma()
      client.escalationRun.create = vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['EscalationRun_active_patient_context_key'] },
        }),
      )

      await expect(
        startEscalationRun(client, {
          patientId: PATIENT_ID,
          context: 'SCHEDULE',
        }),
      ).rejects.toThrow(ApiError)
    })
  })

  describe('transitionEscalationRun & AC-7.4 (Pencatatan Steps)', () => {
    const defaultCtx = { hasTier1: true, hasTier2: true, nakesFirst: false }

    it('transisi TIMEOUT dari WAITING_PATIENT -> FAMILY_TIER_1 dan mencatat step (AC-7.4)', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
      })

      const { run, transition } = await transitionEscalationRun(client, {
        runId: 'run-1',
        event: 'TIMEOUT',
        context: defaultCtx,
      })

      expect(transition.to).toBe('FAMILY_TIER_1')
      expect(transition.notify).toEqual(['FAMILY_TIER_1'])
      expect(run.status).toBe('FAMILY_TIER_1')
      expect(run.currentTier).toBe('TIER_1')

      // Memastikan step tersimpan di DB (AC-7.4)
      expect(client.store.steps).toHaveLength(1)
      const step = client.store.steps[0]
      expect(step.runId).toBe('run-1')
      expect(step.tier).toBe('TIER_1')
      expect(step.messageKey).toBe('transition.timeout')

      // Audit log dicatat
      expect(client.store.auditLogs).toHaveLength(1)
      expect(client.store.auditLogs[0].action).toBe('escalation.step')
    })

    it('pasien konfirmasi (PATIENT_CONFIRMED) -> RESOLVED dan menandai waktu selesai', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'FAMILY_TIER_1',
            currentTier: 'TIER_1',
            startedAt: new Date(),
          },
        ],
      })

      const { run, transition } = await transitionEscalationRun(client, {
        runId: 'run-1',
        event: 'PATIENT_CONFIRMED',
        context: defaultCtx,
      })

      expect(transition.to).toBe('RESOLVED')
      expect(run.status).toBe('RESOLVED')
      expect(run.resolutionType).toBe('PATIENT_CONFIRMED')
      expect(run.resolvedAt).toBeInstanceOf(Date)
    })

    it('keluarga menangani (FAMILY_HANDLED) -> HANDLED dan mencatat response ACK_HANDLE', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'FAMILY_TIER_1',
            currentTier: 'TIER_1',
            startedAt: new Date(),
          },
        ],
      })

      const { run, transition } = await transitionEscalationRun(client, {
        runId: 'run-1',
        event: 'FAMILY_HANDLED',
        actorUserId: 'family-user-1',
        context: defaultCtx,
      })

      expect(transition.to).toBe('HANDLED')
      expect(run.status).toBe('HANDLED')
      expect(run.resolutionType).toBe('FAMILY_HANDLED')
      expect(run.resolvedByUserId).toBe('family-user-1')

      const step = client.store.steps[0]
      expect(step.response).toBe('ACK_HANDLE')
      expect(step.contactUserId).toBe('family-user-1')

      // Audit log dicatat dengan action escalation.handled
      expect(client.store.auditLogs[0].action).toBe('escalation.handled')
    })

    it('transisi ilegal pada status final (HANDLED/RESOLVED) melempar InvalidTransitionError', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-done',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'RESOLVED',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
      })

      await expect(
        transitionEscalationRun(client, {
          runId: 'run-done',
          event: 'TIMEOUT',
          context: defaultCtx,
        }),
      ).rejects.toThrow(InvalidTransitionError)
    })

    it('mencatat step kustom saat disediakan di input', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
      })

      await transitionEscalationRun(client, {
        runId: 'run-1',
        event: 'TIMEOUT',
        context: defaultCtx,
        step: {
          tier: 'TIER_1',
          contactPhone: '081299998888',
          channel: 'WHATSAPP',
          messageKey: 'alert.family_tier_1',
          providerMessageId: 'wamid-12345',
        },
      })

      expect(client.store.steps).toHaveLength(1)
      expect(client.store.steps[0].contactPhone).toBe('081299998888')
      expect(client.store.steps[0].providerMessageId).toBe('wamid-12345')
    })
  })

  describe('resolvePatientEscalationContext', () => {
    it('membaca tier keluarga dan preferensi nakesFirst dari data pasien di DB', async () => {
      const client = createMockPrisma({
        patients: [
          {
            id: 'patient-1',
            emergencyPreference: 'NAKES_FIRST',
            familyContacts: [
              { id: 'c1', tier: 'TIER_2', isActive: true },
              { id: 'c2', tier: 'TIER_1', isActive: false }, // tidak aktif
            ],
          },
        ],
      })

      const ctx = await resolvePatientEscalationContext(client, 'patient-1')

      expect(ctx.hasTier1).toBe(false)
      expect(ctx.hasTier2).toBe(true)
      expect(ctx.nakesFirst).toBe(true)
    })

    it('melempar 404 jika pasien tidak ditemukan', async () => {
      const client = createMockPrisma()
      await expect(resolvePatientEscalationContext(client, 'non-existent')).rejects.toThrow(ApiError)
    })
  })

  describe('Helper functions (resolve, handle, cancel, getActive)', () => {
    it('resolveEscalationRun menyelesaikan run sebagai PATIENT_CONFIRMED', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            startedAt: new Date(),
          },
        ],
        patients: [{ id: PATIENT_ID, emergencyPreference: 'FAMILY_FIRST', familyContacts: [] }],
      })

      const { run } = await resolveEscalationRun(client, { runId: 'run-1' })
      expect(run.status).toBe('RESOLVED')
      expect(run.resolutionType).toBe('PATIENT_CONFIRMED')
    })

    it('handleEscalationRun menandai run sebagai HANDLED oleh NAKES', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'NAKES',
            currentTier: 'NAKES',
            startedAt: new Date(),
          },
        ],
        patients: [{ id: PATIENT_ID, emergencyPreference: 'FAMILY_FIRST', familyContacts: [] }],
      })

      const { run } = await handleEscalationRun(client, {
        runId: 'run-1',
        actorUserId: 'dr-dewi',
        actorRole: 'NAKES',
      })
      expect(run.status).toBe('HANDLED')
      expect(run.resolutionType).toBe('NAKES_HANDLED')
      expect(run.resolvedByUserId).toBe('dr-dewi')
    })

    it('cancelEscalationRun membatalkan run aktif', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            startedAt: new Date(),
          },
        ],
      })

      const run = await cancelEscalationRun(client, { runId: 'run-1' })
      expect(run.status).toBe('RESOLVED')
      expect(run.resolutionType).toBe('CANCELLED')
    })

    it('getActiveEscalationRun mengembalikan run yang sedang aktif saja', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-done',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'RESOLVED',
            startedAt: new Date(Date.now() - 100000),
          },
          {
            id: 'run-active',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'FAMILY_TIER_1',
            startedAt: new Date(),
          },
        ],
      })

      const active = await getActiveEscalationRun(client, PATIENT_ID, 'SCHEDULE')
      expect(active).toBeDefined()
      expect(active?.id).toBe('run-active')
    })

    it('getEscalationRunById mengembalikan run berdasarkan ID', async () => {
      const client = createMockPrisma({
        runs: [
          {
            id: 'run-1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            startedAt: new Date(),
          },
        ],
      })

      const found = await getEscalationRunById(client, 'run-1')
      expect(found).toBeDefined()
      expect(found?.id).toBe('run-1')
    })
  })
})

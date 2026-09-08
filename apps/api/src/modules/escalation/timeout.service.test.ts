// CL-110: Unit tests untuk Timeout Pasien + Alert Keluarga.
// Menguji:
// 1. Durasi timeout configurable (bukan hardcode).
// 2. Format pesan berisi instruksi menghubungi pasien (AC-3.3).
// 3. Scheduler queue & fake timers (AC-3.1).
// 4. Pengiriman alert ke semua kontak keluarga aktif di tier tsb (AC-3.1).
// 5. Anti-spam: hanya sekali per jendela eskalasi (AC-3.2).
// 6. Pasien konfirmasi sebelum timeout -> tidak ada alert keluarga (AC-3.4).
// 7. Persistensi lengkap ke Notification, EscalationStep, & AuditLog (CL-010).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  handlePatientEscalationTimeout,
  getPatientTimeoutSec,
  formatFamilyAlertMessage,
  InMemoryEscalationQueueAdapter,
  MockEscalationNotifier,
  type EscalationTimeoutJobPayload,
} from './timeout.service'
import type { EscalationPrismaClient } from './escalation.service'

interface MockStore {
  runs: any[]
  steps: any[]
  patients: any[]
  familyContacts: any[]
  notifications: any[]
  auditLogs: any[]
}

function createMockTimeoutPrisma(
  initialStore?: Partial<MockStore>,
): EscalationPrismaClient & {
  store: MockStore
  notification: any
  familyContact: any
} {
  const store: MockStore = {
    runs: initialStore?.runs ? [...initialStore.runs] : [],
    steps: initialStore?.steps ? [...initialStore.steps] : [],
    patients: initialStore?.patients ? [...initialStore.patients] : [],
    familyContacts: initialStore?.familyContacts ? [...initialStore.familyContacts] : [],
    notifications: initialStore?.notifications ? [...initialStore.notifications] : [],
    auditLogs: initialStore?.auditLogs ? [...initialStore.auditLogs] : [],
  }

  const client: any = {
    store,
    escalationRun: {
      findUnique: vi.fn(async ({ where }: any) => {
        const found = store.runs.find((r) => r.id === where.id)
        if (!found) return null
        const patient = store.patients.find((p) => p.id === found.patientId)
        return {
          ...found,
          steps: store.steps.filter((s) => s.runId === found.id),
          patient: patient ?? null,
        }
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const index = store.runs.findIndex((r) => r.id === where.id)
        if (index === -1) throw new Error(`Run ${where.id} not found`)
        store.runs[index] = { ...store.runs[index], ...data }
        return store.runs[index]
      }),
      findFirst: vi.fn(async () => null),
    },
    escalationStep: {
      create: vi.fn(async ({ data }: any) => {
        const step = { id: `step-${store.steps.length + 1}`, ...data, createdAt: new Date() }
        store.steps.push(step)
        return step
      }),
    },
    patient: {
      findUnique: vi.fn(async ({ where }: any) => {
        const patient = store.patients.find((p) => p.id === where.id)
        if (!patient) return null
        const contacts = store.familyContacts.filter((c) => c.patientId === patient.id && c.isActive)
        return { ...patient, familyContacts: contacts }
      }),
    },
    familyContact: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.familyContacts.filter((c) => {
          if (where.patientId && c.patientId !== where.patientId) return false
          if (where.tier && c.tier !== where.tier) return false
          if (where.isActive !== undefined && c.isActive !== where.isActive) return false
          return true
        })
      }),
    },
    notification: {
      create: vi.fn(async ({ data }: any) => {
        const notif = { id: `notif-${store.notifications.length + 1}`, ...data, createdAt: new Date() }
        store.notifications.push(notif)
        return notif
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        const log = { id: `audit-${store.auditLogs.length + 1}`, ...data, createdAt: new Date() }
        store.auditLogs.push(log)
        return log
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(client)),
  }

  return client
}

describe('CL-110: Timeout Pasien + Alert Keluarga', () => {
  const PATIENT_ID = 'patient-pak-haji'
  const RUN_ID = 'run-110'

  beforeAll(() => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('Durasi Timeout Configurable', () => {
    it('menggunakan default 1800 detik (30 menit) untuk SCHEDULE', () => {
      const sec = getPatientTimeoutSec('SCHEDULE')
      expect(sec).toBe(1800)
    })

    it('menggunakan default 45 detik (30-60 detik) untuk EMERGENCY', () => {
      const sec = getPatientTimeoutSec('EMERGENCY')
      expect(sec).toBe(45)
    })

    it('mendukung override timeout spesifik per-pasien via configSnapshot', () => {
      const sec = getPatientTimeoutSec('SCHEDULE', { patientWaitSec: 600 })
      expect(sec).toBe(600)
    })
  })

  describe('Format Pesan Alert Keluarga (AC-3.3)', () => {
    it('memuat instruksi jelas untuk menghubungi pasien dan mengecek kondisi', () => {
      const { body, instructions } = formatFamilyAlertMessage({
        patientName: 'H. Ahmad Subagio',
        patientPhone: '081122334455',
        medicationName: 'Amlodipine',
        scheduledTime: '07:00 WIB',
      })

      expect(body).toContain('H. Ahmad Subagio')
      expect(body).toContain('Amlodipine')
      expect(body).toContain('07:00 WIB')
      expect(body).toContain('081122334455')
      expect(instructions).toContain('hubungi beliau di nomor 081122334455 atau kunjungi tempat tinggalnya')
    })
  })

  describe('Queue Adapter & Fake Timers', () => {
    it('menjadwalkan timeout dan memicu eksekusi saat waktu habis', async () => {
      const executed: string[] = []
      const adapter = new InMemoryEscalationQueueAdapter(async (payload) => {
        executed.push(payload.runId)
      })

      await adapter.scheduleTimeout(
        {
          runId: 'run-queue-1',
          patientId: PATIENT_ID,
          context: 'SCHEDULE',
          expectedStatus: 'WAITING_PATIENT',
          scheduledAt: new Date().toISOString(),
        },
        1800 * 1000,
      )

      expect(adapter.activeJobCount).toBe(1)
      expect(executed).toHaveLength(0)

      // Majukan waktu 15 menit (belum timeout)
      vi.advanceTimersByTime(900 * 1000)
      expect(executed).toHaveLength(0)

      // Majukan hingga 30 menit (timeout tercapai)
      vi.advanceTimersByTime(900 * 1000)
      expect(executed).toEqual(['run-queue-1'])
      expect(adapter.activeJobCount).toBe(0)
    })

    it('dapat dibatalkan sebelum timer meledak (AC-3.4)', async () => {
      const executed: string[] = []
      const adapter = new InMemoryEscalationQueueAdapter(async (payload) => {
        executed.push(payload.runId)
      })

      const jobId = await adapter.scheduleTimeout(
        {
          runId: 'run-queue-cancel',
          patientId: PATIENT_ID,
          context: 'SCHEDULE',
          expectedStatus: 'WAITING_PATIENT',
          scheduledAt: new Date().toISOString(),
        },
        1800 * 1000,
      )

      // Pasien konfirmasi sebelum waktu habis -> batalkan job
      await adapter.cancelTimeout(jobId)
      expect(adapter.activeJobCount).toBe(0)

      // Majukan timer melampaui 30 menit
      vi.advanceTimersByTime(2000 * 1000)
      expect(executed).toHaveLength(0)
    })
  })

  describe('handlePatientEscalationTimeout — Eksekusi Transisi & Alert', () => {
    const payload: EscalationTimeoutJobPayload = {
      runId: RUN_ID,
      patientId: PATIENT_ID,
      context: 'SCHEDULE',
      expectedStatus: 'WAITING_PATIENT',
      scheduledAt: new Date().toISOString(),
    }

    it('AC-3.1: saat WAITING_PATIENT habis -> transisi ke FAMILY_TIER_1 dan kirim notifikasi ke semua kontak keluarga Tier 1', async () => {
      const client = createMockTimeoutPrisma({
        runs: [
          {
            id: RUN_ID,
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
        patients: [
          {
            id: PATIENT_ID,
            emergencyPreference: 'FAMILY_FIRST',
            user: { fullName: 'H. Ahmad Subagio', phone: '081122334455' },
          },
        ],
        familyContacts: [
          {
            id: 'fc-1',
            patientId: PATIENT_ID,
            name: 'Sari Rahmawati',
            phone: '081299990001',
            tier: 'TIER_1',
            isActive: true,
            priority: 1,
            userId: 'user-sari',
          },
          {
            id: 'fc-2',
            patientId: PATIENT_ID,
            name: 'Budi Rahmawan',
            phone: '081299990002',
            tier: 'TIER_1',
            isActive: true,
            priority: 2,
            userId: 'user-budi',
          },
          {
            id: 'fc-3',
            patientId: PATIENT_ID,
            name: 'Paman Jauh',
            phone: '081299990003',
            tier: 'TIER_2', // Tier 2 tidak boleh menerima alert di Tier 1
            isActive: true,
            priority: 1,
          },
        ],
      })

      const notifier = new MockEscalationNotifier()

      const result = await handlePatientEscalationTimeout(client, { notifier }, payload)

      // 1. Verifikasi transisi status
      expect(result.previousStatus).toBe('WAITING_PATIENT')
      expect(result.newStatus).toBe('FAMILY_TIER_1')
      expect(result.notifiedCount).toBe(2)

      // 2. Verifikasi pengiriman alert WhatsApp (hanya ke 2 kontak Tier 1)
      expect(notifier.sentAlerts).toHaveLength(2)
      expect(notifier.sentAlerts[0].contactPhone).toBe('081299990001')
      expect(notifier.sentAlerts[0].tier).toBe('TIER_1')
      expect(notifier.sentAlerts[0].instructions).toContain('hubungi beliau di nomor 081122334455')
      expect(notifier.sentAlerts[1].contactPhone).toBe('081299990002')

      // 3. Verifikasi record di tabel Notification
      expect(client.store.notifications).toHaveLength(2)
      expect(client.store.notifications[0].type).toBe('ESCALATION')
      expect(client.store.notifications[0].status).toBe('SENT')

      // 4. Verifikasi record di tabel EscalationStep (AC-7.4)
      // Terdapat step transisi + 2 step pengiriman alert keluarga
      const familySteps = client.store.steps.filter((s) => s.messageKey.startsWith('alert.family'))
      expect(familySteps).toHaveLength(2)
      expect(familySteps[0].tier).toBe('TIER_1')
      expect(familySteps[0].contactPhone).toBe('081299990001')

      // 5. Verifikasi AuditLog terisi (CL-010)
      const timeoutAudit = client.store.auditLogs.filter(
        (a) => a.meta?.event === 'TIMEOUT_FAMILY_ALERT',
      )
      expect(timeoutAudit).toHaveLength(2)
    })

    it('AC-3.2: Anti-Spam — jika alert tier sudah pernah terkirim di jendela run, alert ganda dilewati', async () => {
      const client = createMockTimeoutPrisma({
        runs: [
          {
            id: RUN_ID,
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
        steps: [
          {
            id: 'step-old-alert',
            runId: RUN_ID,
            tier: 'TIER_1',
            contactPhone: '081299990001',
            messageKey: 'alert.family.tier_1',
            sentAt: new Date(),
          },
        ],
        patients: [
          {
            id: PATIENT_ID,
            emergencyPreference: 'FAMILY_FIRST',
            user: { fullName: 'H. Ahmad Subagio', phone: '081122334455' },
          },
        ],
        familyContacts: [
          {
            id: 'fc-1',
            patientId: PATIENT_ID,
            name: 'Sari Rahmawati',
            phone: '081299990001',
            tier: 'TIER_1',
            isActive: true,
          },
        ],
      })

      const notifier = new MockEscalationNotifier()

      const result = await handlePatientEscalationTimeout(client, { notifier }, payload)

      expect(result.skippedAntiSpam).toBe(true)
      expect(result.notifiedCount).toBe(0)
      expect(notifier.sentAlerts).toHaveLength(0)
    })

    it('AC-3.4: Pasien konfirmasi sebelum timeout -> timeout diabaikan dan keluarga TIDAK dialert', async () => {
      const client = createMockTimeoutPrisma({
        runs: [
          {
            id: RUN_ID,
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'RESOLVED', // sudah selesai karena pasien konfirmasi
            currentTier: null,
            startedAt: new Date(),
            resolvedAt: new Date(),
            resolutionType: 'PATIENT_CONFIRMED',
          },
        ],
        patients: [{ id: PATIENT_ID, user: { fullName: 'H. Ahmad' } }],
        familyContacts: [{ id: 'fc-1', patientId: PATIENT_ID, tier: 'TIER_1', isActive: true }],
      })

      const notifier = new MockEscalationNotifier()

      const result = await handlePatientEscalationTimeout(client, { notifier }, payload)

      expect(result.details?.skipped).toBe(true)
      expect(result.notifiedCount).toBe(0)
      expect(notifier.sentAlerts).toHaveLength(0)
      expect(client.store.notifications).toHaveLength(0)
    })

    it('pasien tinggal sendiri tanpa keluarga Tier 1 -> langsung transisi ke NAKES (ES-7/AC-7.3)', async () => {
      const client = createMockTimeoutPrisma({
        runs: [
          {
            id: RUN_ID,
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            status: 'WAITING_PATIENT',
            currentTier: null,
            startedAt: new Date(),
          },
        ],
        patients: [
          {
            id: PATIENT_ID,
            emergencyPreference: 'FAMILY_FIRST',
            user: { fullName: 'Bu Siti Alone' },
          },
        ],
        familyContacts: [], // Tidak punya keluarga sama sekali
      })

      const notifier = new MockEscalationNotifier()

      const result = await handlePatientEscalationTimeout(client, { notifier }, payload)

      // Masuk ke NAKES langsung
      expect(result.newStatus).toBe('NAKES')
      expect(result.notifiedCount).toBe(0)
      expect(notifier.sentAlerts).toHaveLength(0)
    })
  })
})

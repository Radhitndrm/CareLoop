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
  handleEscalationTimeout,
  getPatientTimeoutSec,
  getTierTimeoutSec,
  formatFamilyAlertMessage,
  formatNakesEscalationAlertMessage,
  InMemoryEscalationQueueAdapter,
  MockEscalationNotifier,
  type EscalationTimeoutJobPayload,
} from './timeout.service'
import {
  handleEscalationRun,
  resolveEscalationRun,
  type EscalationPrismaClient,
} from './escalation.service'

interface MockStore {
  runs: any[]
  steps: any[]
  patients: any[]
  familyContacts: any[]
  nakesContacts: any[]
  notifications: any[]
  auditLogs: any[]
}

function createMockTimeoutPrisma(
  initialStore?: Partial<MockStore>,
): EscalationPrismaClient & {
  store: MockStore
  notification: any
  familyContact: any
  nakesContact: any
} {
  const store: MockStore = {
    runs: initialStore?.runs ? [...initialStore.runs] : [],
    steps: initialStore?.steps ? [...initialStore.steps] : [],
    patients: initialStore?.patients ? [...initialStore.patients] : [],
    familyContacts: initialStore?.familyContacts ? [...initialStore.familyContacts] : [],
    nakesContacts: initialStore?.nakesContacts ? [...initialStore.nakesContacts] : [],
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
    nakesContact: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.nakesContacts.filter((c) => {
          if (where.patientId && c.patientId !== where.patientId) return false
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

  describe('CL-207: Eskalasi Multi-Tier Lengkap (AC-7.1..7.5)', () => {
    describe('Timeout per Tier Configurable (AC-7.1, AC-7.5)', () => {
      it('mengembalikan durasi default per tier dari env atau standar', () => {
        expect(getTierTimeoutSec('WAITING_PATIENT', 'SCHEDULE')).toBe(1800)
        expect(getTierTimeoutSec('WAITING_PATIENT', 'EMERGENCY')).toBe(45)
        expect(getTierTimeoutSec('FAMILY_TIER_1')).toBe(900)
        expect(getTierTimeoutSec('FAMILY_TIER_2')).toBe(900)
        expect(getTierTimeoutSec('NAKES')).toBe(1800)
      })

      it('mendukung konfigurasi timeout kustom per-pasien via configSnapshot (AC-7.5)', () => {
        const customConfig = {
          patientWaitSec: 300,
          tier1WaitSec: 600,
          tier2WaitSec: 450,
          nakesWaitSec: 1200,
        }
        expect(getTierTimeoutSec('WAITING_PATIENT', 'SCHEDULE', customConfig)).toBe(300)
        expect(getTierTimeoutSec('FAMILY_TIER_1', 'SCHEDULE', customConfig)).toBe(600)
        expect(getTierTimeoutSec('FAMILY_TIER_2', 'SCHEDULE', customConfig)).toBe(450)
        expect(getTierTimeoutSec('NAKES', 'SCHEDULE', customConfig)).toBe(1200)
      })
    })

    describe('Format Pesan Alert Nakes (AC-7.1, AC-7.3)', () => {
      it('memuat informasi pasien, nama obat, dan instruksi pemeriksaan', () => {
        const { body, instructions } = formatNakesEscalationAlertMessage({
          patientName: 'Bu Ratna',
          medicationName: 'Amlodipine 10mg',
          scheduledTime: '08:00',
        })
        expect(body).toContain('Bu Ratna')
        expect(body).toContain('Amlodipine 10mg')
        expect(body).toContain('(jadwal 08:00)')
        expect(instructions).toContain('tenaga kesehatan/kader memeriksa')
      })
    })

    describe('Chaining Journey Multi-Tier Penuh (AC-7.1, AC-7.4)', () => {
      it('menjalankan eskalasi bertingkat penuh: WAITING_PATIENT -> T1 -> T2 -> NAKES -> TIMED_OUT', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-multi-tier',
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
              livingSituation: 'WITH_FAMILY',
              user: { fullName: 'Bu Ratna Lestari', phone: '081200000001' },
            },
          ],
          familyContacts: [
            {
              id: 'fc-t1',
              patientId: PATIENT_ID,
              name: 'Ari Pratama (Anak T1)',
              phone: '081211110001',
              tier: 'TIER_1',
              priority: 1,
              isActive: true,
            },
            {
              id: 'fc-t2',
              patientId: PATIENT_ID,
              name: 'Sari Dewi (Keponakan T2)',
              phone: '081222220002',
              tier: 'TIER_2',
              priority: 1,
              isActive: true,
            },
          ],
          nakesContacts: [
            {
              id: 'nc-1',
              patientId: PATIENT_ID,
              nakesName: 'dr. Dewi Puskesmas',
              phone: '081333330003',
              nakesUserId: 'user-nakes-dewi',
              isPrimary: true,
              isActive: true,
            },
          ],
        })

        const notifier = new MockEscalationNotifier()
        const queueAdapter = new InMemoryEscalationQueueAdapter()

        // 1. Timeout WAITING_PATIENT -> Masuk ke FAMILY_TIER_1 (AC-7.1)
        const step1 = await handleEscalationTimeout(
          client,
          { notifier, queueAdapter },
          {
            runId: 'run-multi-tier',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'WAITING_PATIENT',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(step1.newStatus).toBe('FAMILY_TIER_1')
        expect(step1.notifiedCount).toBe(1)
        expect(notifier.sentAlerts).toHaveLength(1)
        expect(notifier.sentAlerts[0].contactPhone).toBe('081211110001')
        expect(notifier.sentAlerts[0].tier).toBe('TIER_1')
        expect(step1.scheduledNextJobId).toBeDefined()

        // 2. Timeout FAMILY_TIER_1 -> Masuk ke FAMILY_TIER_2 (AC-7.1, ES-4)
        const step2 = await handleEscalationTimeout(
          client,
          { notifier, queueAdapter },
          {
            runId: 'run-multi-tier',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'FAMILY_TIER_1',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(step2.newStatus).toBe('FAMILY_TIER_2')
        expect(step2.notifiedCount).toBe(1)
        expect(notifier.sentAlerts).toHaveLength(2)
        expect(notifier.sentAlerts[1].contactPhone).toBe('081222220002')
        expect(notifier.sentAlerts[1].tier).toBe('TIER_2')
        expect(step2.scheduledNextJobId).toBeDefined()

        // 3. Timeout FAMILY_TIER_2 -> Masuk ke NAKES (AC-7.1, ES-5)
        const step3 = await handleEscalationTimeout(
          client,
          { notifier, queueAdapter },
          {
            runId: 'run-multi-tier',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'FAMILY_TIER_2',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(step3.newStatus).toBe('NAKES')
        expect(step3.notifiedCount).toBe(1)
        expect(notifier.sentNakesAlerts).toHaveLength(1)
        expect(notifier.sentNakesAlerts[0].contactPhone).toBe('081333330003')
        expect(step3.scheduledNextJobId).toBeDefined()

        // 4. Timeout NAKES -> TIMED_OUT (AC-7.1, state final)
        const step4 = await handleEscalationTimeout(
          client,
          { notifier, queueAdapter },
          {
            runId: 'run-multi-tier',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'NAKES',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(step4.newStatus).toBe('TIMED_OUT')
        expect(step4.notifiedCount).toBe(0)
        expect(step4.scheduledNextJobId).toBeUndefined()

        // 5. Verifikasi riwayat langkah escalation_steps lengkap (AC-7.4)
        const stepKeys = client.store.steps.map((s) => s.messageKey)
        expect(stepKeys).toContain('alert.family.tier_1')
        expect(stepKeys).toContain('alert.family.tier_2')
        expect(stepKeys).toContain('alert.nakes')
        expect(stepKeys).toContain('transition.timeout')

        // 6. Verifikasi audit log lengkap (CL-010)
        const auditEvents = client.store.auditLogs.map((a) => a.meta?.event)
        expect(auditEvents).toContain('TIMEOUT_FAMILY_ALERT')
        expect(auditEvents).toContain('TIMEOUT_NAKES_ALERT')
      })
    })

    describe('AC-7.2: Respons HANDLE Menghentikan Eskalasi', () => {
      it('respons keluarga di TIER_1 -> HANDLED dan timeout berikutnya diabaikan', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-handle-t1',
              patientId: PATIENT_ID,
              context: 'SCHEDULE',
              status: 'FAMILY_TIER_1',
              currentTier: 'TIER_1',
              startedAt: new Date(),
            },
          ],
          patients: [
            {
              id: PATIENT_ID,
              user: { fullName: 'Bu Siti' },
            },
          ],
          familyContacts: [
            {
              id: 'fc-t2',
              patientId: PATIENT_ID,
              name: 'Sari Dewi',
              phone: '081222220002',
              tier: 'TIER_2',
              isActive: true,
            },
          ],
        })

        const notifier = new MockEscalationNotifier()

        // Keluarga T1 merespons "Saya tangani" (AC-7.2)
        await handleEscalationRun(client, {
          runId: 'run-handle-t1',
          actorUserId: 'user-ari-t1',
          actorRole: 'FAMILY',
          notes: 'Saya sedang menuju rumah ibu',
        })

        expect(client.store.runs[0].status).toBe('HANDLED')
        expect(client.store.runs[0].resolutionType).toBe('FAMILY_HANDLED')

        // Saat timer jatuh tempo untuk FAMILY_TIER_1, proses dilewati
        const timeoutResult = await handleEscalationTimeout(
          client,
          { notifier },
          {
            runId: 'run-handle-t1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'FAMILY_TIER_1',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(timeoutResult.details?.skipped).toBe(true)
        expect(timeoutResult.notifiedCount).toBe(0)
        expect(notifier.sentAlerts).toHaveLength(0)
      })

      it('respons nakes di NAKES -> HANDLED dan eskalasi berhenti', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-handle-nakes',
              patientId: PATIENT_ID,
              context: 'SCHEDULE',
              status: 'NAKES',
              currentTier: 'NAKES',
              startedAt: new Date(),
            },
          ],
          patients: [{ id: PATIENT_ID, user: { fullName: 'Bu Siti' } }],
        })

        await handleEscalationRun(client, {
          runId: 'run-handle-nakes',
          actorUserId: 'user-nakes-1',
          actorRole: 'NAKES',
          notes: 'Kader desa sudah mengecek ke rumah',
        })

        expect(client.store.runs[0].status).toBe('HANDLED')
        expect(client.store.runs[0].resolutionType).toBe('NAKES_HANDLED')
      })
    })

    describe('Skip Tier Kosong & Emergency Preference (AC-7.3, ES-7, ES-8, ES-9)', () => {
      it('ES-8: pasien hanya punya T2 -> skip T1, langsung masuk FAMILY_TIER_2', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-skip-t1',
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
              livingSituation: 'WITH_FAMILY',
              user: { fullName: 'Pak Joko' },
            },
          ],
          familyContacts: [
            {
              id: 'fc-t2',
              patientId: PATIENT_ID,
              name: 'Keponakan Jauh',
              phone: '081299990002',
              tier: 'TIER_2',
              isActive: true,
            },
          ],
        })

        const notifier = new MockEscalationNotifier()

        const result = await handleEscalationTimeout(
          client,
          { notifier },
          {
            runId: 'run-skip-t1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'WAITING_PATIENT',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(result.newStatus).toBe('FAMILY_TIER_2')
        expect(notifier.sentAlerts).toHaveLength(1)
        expect(notifier.sentAlerts[0].tier).toBe('TIER_2')
      })

      it('ES-9: pasien darurat dengan NAKES_FIRST dan keluarga T2 -> T2 dan NAKES diberi tahu paralel', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-nakes-first',
              patientId: PATIENT_ID,
              context: 'EMERGENCY',
              status: 'WAITING_PATIENT',
              currentTier: null,
              startedAt: new Date(),
            },
          ],
          patients: [
            {
              id: PATIENT_ID,
              emergencyPreference: 'NAKES_FIRST',
              livingSituation: 'FAR_FROM_FAMILY',
              user: { fullName: 'Mbah Slamet' },
            },
          ],
          familyContacts: [
            {
              id: 'fc-t2',
              patientId: PATIENT_ID,
              name: 'Kerabat Luar Kota',
              phone: '081288880002',
              tier: 'TIER_2',
              isActive: true,
            },
          ],
          nakesContacts: [
            {
              id: 'nc-1',
              patientId: PATIENT_ID,
              nakesName: 'Bidan Desa',
              phone: '081777770001',
              isActive: true,
            },
          ],
        })

        const notifier = new MockEscalationNotifier()

        const result = await handleEscalationTimeout(
          client,
          { notifier },
          {
            runId: 'run-nakes-first',
            patientId: PATIENT_ID,
            context: 'EMERGENCY',
            expectedStatus: 'WAITING_PATIENT',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(result.newStatus).toBe('FAMILY_TIER_2')
        expect(notifier.sentAlerts).toHaveLength(1)
        expect(notifier.sentNakesAlerts).toHaveLength(1)
      })
    })

    describe('ES-11 / ES-11b: Pasien Konfirmasi Saat Eskalasi Berjalan', () => {
      it('pasien konfirmasi di FAMILY_TIER_1 -> status RESOLVED dan timeout berikutnya diabaikan', async () => {
        const client = createMockTimeoutPrisma({
          runs: [
            {
              id: 'run-confirm-t1',
              patientId: PATIENT_ID,
              context: 'SCHEDULE',
              status: 'FAMILY_TIER_1',
              currentTier: 'TIER_1',
              startedAt: new Date(),
            },
          ],
          patients: [{ id: PATIENT_ID, user: { fullName: 'Pak Hendra' } }],
        })

        await resolveEscalationRun(client, {
          runId: 'run-confirm-t1',
          actorUserId: 'user-patient',
          notes: 'Pasien meminum obat secara mandiri',
        })

        expect(client.store.runs[0].status).toBe('RESOLVED')
        expect(client.store.runs[0].resolutionType).toBe('PATIENT_CONFIRMED')

        const notifier = new MockEscalationNotifier()
        const result = await handleEscalationTimeout(
          client,
          { notifier },
          {
            runId: 'run-confirm-t1',
            patientId: PATIENT_ID,
            context: 'SCHEDULE',
            expectedStatus: 'FAMILY_TIER_1',
            scheduledAt: new Date().toISOString(),
          },
        )

        expect(result.details?.skipped).toBe(true)
        expect(notifier.sentAlerts).toHaveLength(0)
      })
    })
  })
})


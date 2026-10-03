import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { ComplianceStatus } from '@careloop/shared'
import {
  assertScheduleOwner,
  classifyConfirmation,
  confirmMedicationIntake,
  isBeyondLatenessLimit,
  resolveConfirmSlot,
  type CompliancePrismaClient,
  type ConfirmSchedule,
} from './compliance.service'

const WIB = 'Asia/Jakarta'

/** Slot 09:00 WIB = 02:00 UTC. */
const SLOT_0900 = new Date('2026-08-16T02:00:00.000Z')
const AT_0900 = new Date('2026-08-16T02:00:00.000Z')
const AT_0915 = new Date('2026-08-16T02:15:00.000Z')
const AT_0930 = new Date('2026-08-16T02:30:00.000Z')
const AT_1100 = new Date('2026-08-16T04:00:00.000Z')
const NEXT_DAY_0900 = new Date('2026-08-17T02:00:00.000Z')

function schedule(overrides: Partial<ConfirmSchedule> = {}): ConfirmSchedule {
  return {
    id: 'schedule-1',
    patientId: 'patient-1',
    medicationId: 'med-1',
    timeOfDay: '09:00',
    timezone: WIB,
    timeWindowMinutes: 30,
    ...overrides,
  }
}

describe('classifyConfirmation', () => {
  it('tepat pada waktu jadwal → CONFIRMED', () => {
    expect(
      classifyConfirmation({ scheduledAt: SLOT_0900, confirmedAt: AT_0900, timeWindowMinutes: 30 }),
    ).toBe(ComplianceStatus.CONFIRMED)
  })

  it('di dalam time window → CONFIRMED', () => {
    expect(
      classifyConfirmation({ scheduledAt: SLOT_0900, confirmedAt: AT_0915, timeWindowMinutes: 30 }),
    ).toBe(ComplianceStatus.CONFIRMED)
  })

  it('tepat di batas time window → CONFIRMED (inklusif)', () => {
    expect(
      classifyConfirmation({ scheduledAt: SLOT_0900, confirmedAt: AT_0930, timeWindowMinutes: 30 }),
    ).toBe(ComplianceStatus.CONFIRMED)
  })

  it('lewat time window → CONFIRMED_LATE, bukan MISSED (AC-2.3)', () => {
    const status = classifyConfirmation({
      scheduledAt: SLOT_0900,
      confirmedAt: AT_1100,
      timeWindowMinutes: 30,
    })
    expect(status).toBe(ComplianceStatus.CONFIRMED_LATE)
    expect(status).not.toBe(ComplianceStatus.MISSED)
  })

  it('terlambat 2 jam tetap CONFIRMED_LATE', () => {
    expect(
      classifyConfirmation({
        scheduledAt: SLOT_0900,
        confirmedAt: new Date('2026-08-16T04:00:01.000Z'),
        timeWindowMinutes: 30,
      }),
    ).toBe(ComplianceStatus.CONFIRMED_LATE)
  })

  it('konfirmasi sebelum jadwal (antre lebih dulu) → CONFIRMED', () => {
    expect(
      classifyConfirmation({
        scheduledAt: SLOT_0900,
        confirmedAt: new Date('2026-08-16T01:45:00.000Z'),
        timeWindowMinutes: 30,
      }),
    ).toBe(ComplianceStatus.CONFIRMED)
  })

  it('timeWindowMinutes nol → hanya tepat waktu yang CONFIRMED', () => {
    expect(
      classifyConfirmation({ scheduledAt: SLOT_0900, confirmedAt: AT_0900, timeWindowMinutes: 0 }),
    ).toBe(ComplianceStatus.CONFIRMED)
    expect(
      classifyConfirmation({ scheduledAt: SLOT_0900, confirmedAt: AT_0915, timeWindowMinutes: 0 }),
    ).toBe(ComplianceStatus.CONFIRMED_LATE)
  })
})

describe('isBeyondLatenessLimit', () => {
  it('tepat di batas batas-maksimum belum dianggap basi', () => {
    expect(isBeyondLatenessLimit(SLOT_0900, new Date('2026-08-17T02:00:00.000Z'), 1440)).toBe(false)
  })

  it('melewati batas → basi', () => {
    expect(isBeyondLatenessLimit(SLOT_0900, new Date('2026-08-17T02:00:01.000Z'), 1440)).toBe(true)
  })
})

describe('resolveConfirmSlot', () => {
  it('memilih slot 09:00 WIB yang sudah jatuh tempo', () => {
    const slot = resolveConfirmSlot(schedule(), { now: AT_0915, maxLateMinutes: 1440 })
    expect(slot.scheduledAt?.toISOString()).toBe(SLOT_0900.toISOString())
    expect(slot.tooLate).toBe(false)
  })

  it('sebelum jam remind → memakai slot kemarin', () => {
    const slot = resolveConfirmSlot(schedule(), {
      now: new Date('2026-08-16T01:00:00.000Z'),
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt?.toISOString()).toBe(new Date('2026-08-15T02:00:00.000Z').toISOString())
  })

  it('hanya mengambil slot terbaru, tidak slot lama', () => {
    // 02:05 UTC = 09:05 WIB, jadi slot 02:00 UTC hari itu yang dipakai.
    const slot = resolveConfirmSlot(schedule(), {
      now: new Date('2026-08-17T02:05:00.000Z'),
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt?.toISOString()).toBe(NEXT_DAY_0900.toISOString())
  })

  it('slot yang lewat batas keterlambatan → tooLate', () => {
    // 11:00 WIB: slot 09:00 sudah 2 jam lalu dan slot berikutnya (besok 09:00) belum
    // jatuh tempo, jadi dengan batas 60 menit konfirmasi sudah basi.
    const slot = resolveConfirmSlot(schedule(), { now: AT_1100, maxLateMinutes: 60 })
    expect(slot.scheduledAt?.toISOString()).toBe(SLOT_0900.toISOString())
    expect(slot.tooLate).toBe(true)
  })

  it('batas 24 jam default tidak pernah menandai slot harian sebagai basi', () => {
    // Jadwal harian selalu punya slot baru < 24 jam, jadi batas default tidak menyaring
    // apa pun. Ini yang membuat default 1440 aman dipakai tanpa konfigurasi.
    const slot = resolveConfirmSlot(schedule(), {
      now: new Date('2026-08-17T02:00:00.000Z'),
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt?.toISOString()).toBe(NEXT_DAY_0900.toISOString())
    expect(slot.tooLate).toBe(false)
  })

  it('jadwal harian: setiap hari punya slot sendiri', () => {
    const slot = resolveConfirmSlot(schedule({ daysOfWeek: [] }), {
      now: new Date('2026-08-16T02:05:00.000Z'),
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt?.toISOString()).toBe(SLOT_0900.toISOString())
  })

  it('jadwal mingguan: slot dari hari yang tidak aktif tidak dipilih', () => {
    // 2026-08-16 adalah Minggu. Hanya Senin (1) yang diizinkan, jadi slot terakhir
    // adalah Senin 2026-08-10 — bukan Jumat seperti bila daysOfWeek diabaikan.
    const slot = resolveConfirmSlot(schedule({ daysOfWeek: [1] }), {
      now: AT_0915,
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt?.toISOString()).toBe('2026-08-10T02:00:00.000Z')
    expect(slot.tooLate).toBe(true)
  })

  it('jadwal yang belum mulai → tidak ada slot', () => {
    const slot = resolveConfirmSlot(schedule({ startDate: '2026-09-01' }), {
      now: AT_0915,
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt).toBeNull()
    expect(slot.tooLate).toBe(false)
  })

  it('jadwal yang sudah berakhir → tidak ada slot', () => {
    const slot = resolveConfirmSlot(schedule({ endDate: '2026-08-01' }), {
      now: AT_0915,
      maxLateMinutes: 1440,
    })
    expect(slot.scheduledAt).toBeNull()
  })

  it('zona waktu pasien dipakai, bukan jam server (08:00 WIB vs UTC)', () => {
    const slot = resolveConfirmSlot(schedule({ timeOfDay: '08:00', timezone: 'Asia/Makassar' }), {
      now: new Date('2026-08-16T02:00:00.000Z'),
      maxLateMinutes: 1440,
    })
    // 08:00 WITA (UTC+8) = 00:00 UTC
    expect(slot.scheduledAt?.toISOString()).toBe('2026-08-16T00:00:00.000Z')
  })
})

describe('assertScheduleOwner', () => {
  it('pasien mengonfirmasi jadwalnya sendiri → boleh', () => {
    expect(() =>
      assertScheduleOwner({ claimsRole: 'PATIENT', claimsSub: 'p1', patientId: 'p1' }),
    ).not.toThrow()
  })

  it('pasien mengonfirmasi jadwal orang lain → forbidden', () => {
    expect(() =>
      assertScheduleOwner({ claimsRole: 'PATIENT', claimsSub: 'p1', patientId: 'p2' }),
    ).toThrowError(/bukan milik Anda/)
  })

  it('guard ini tidak membatasi role — pembatasan role ada di route', () => {
    // `assertScheduleOwner` hanya mengunci kepemilikan untuk role PASIEN. Role lain
    // ditolak oleh `requireRole(UserRole.PATIENT)` di route, bukan oleh guard ini.
    // Dicatat eksplisit supaya tidak disalah baca sebagai izin bagi nakes.
    expect(() =>
      assertScheduleOwner({ claimsRole: 'NAKES', claimsSub: 'n1', patientId: 'p2' }),
    ).not.toThrow()
  })
})

/** `runOnce` membedakan pelanggaran unique lewat `instanceof`, jadi error-nya harus asli. */
function uniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  })
}

function fakeClient(overrides: Record<string, unknown> = {}): CompliancePrismaClient {
  return {
    schedule: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'schedule-1',
        patientId: 'patient-1',
        medicationId: 'med-1',
        timeOfDay: '09:00',
        daysOfWeek: [],
        timeWindowMinutes: 30,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: null,
        patient: { user: { timezone: WIB } },
      }),
    },
    complianceLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    escalationRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: 'run-7',
        patientId: 'patient-1',
        status: 'WAITING_PATIENT',
        currentTier: null,
        steps: [],
      }),
      update: vi.fn().mockResolvedValue({ id: 'run-7', status: 'RESOLVED' }),
    },
    escalationStep: { create: vi.fn().mockResolvedValue({ id: 'step-1' }) },
    patient: {
      findUnique: vi.fn().mockResolvedValue({
        emergencyPreference: 'FAMILY_FIRST',
        livingSituation: 'WITH_FAMILY',
        familyContacts: [{ tier: 'TIER_1', isActive: true }],
      }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    ...overrides,
  } as unknown as CompliancePrismaClient
}

describe('confirmMedicationIntake — penolakan', () => {
  it('jadwal tidak ada → 404', async () => {
    const client = fakeClient({ schedule: { findUnique: vi.fn().mockResolvedValue(null) } })
    await expect(
      confirmMedicationIntake(client, { scheduleId: 'hilang', channel: 'IN_APP' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' })
  })

  it('slot basi → 422 dan tidak menulis log', async () => {
    const client = fakeClient()

    await expect(
      confirmMedicationIntake(client, {
        scheduleId: 'schedule-1',
        channel: 'IN_APP',
        now: AT_1100,
        maxLateMinutes: 60,
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_TRANSITION' })

    expect(client.complianceLog.create).not.toHaveBeenCalled()
  })

  it('slot sudah pernah dikonfirmasi → 409 ALREADY_PROCESSED', async () => {
    const client = fakeClient({
      complianceLog: {
        create: vi.fn().mockRejectedValue(uniqueViolation(['scheduleId', 'scheduledAt'])),
        findUnique: vi.fn().mockResolvedValue({
          id: 'log-9',
          status: ComplianceStatus.CONFIRMED,
          confirmedAt: AT_0915,
        }),
      },
    })

    await expect(
      confirmMedicationIntake(client, {
        scheduleId: 'schedule-1',
        channel: 'WHATSAPP',
        now: AT_0915,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_PROCESSED' })
  })

  it('duplikat tanpa eskalasi aktif → 409 tanpa menyentuh run', async () => {
    const escalationUpdate = vi.fn()
    const client = fakeClient({
      complianceLog: {
        create: vi.fn().mockRejectedValue(uniqueViolation(['scheduleId', 'scheduledAt'])),
        findUnique: vi.fn().mockResolvedValue({
          id: 'log-9',
          status: ComplianceStatus.CONFIRMED,
          confirmedAt: AT_0915,
        }),
      },
      escalationRun: { findFirst: vi.fn().mockResolvedValue(null), update: escalationUpdate },
    })

    await expect(
      confirmMedicationIntake(client, {
        scheduleId: 'schedule-1',
        channel: 'IN_APP',
        now: AT_0915,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(escalationUpdate).not.toHaveBeenCalled()
  })

  it('duplikat tetap menutup eskalasi yang gagal ditutup di percobaan pertama', async () => {
    const escalationUpdate = vi.fn().mockResolvedValue({ id: 'run-9', status: 'RESOLVED' })
    const client = fakeClient({
      complianceLog: {
        create: vi.fn().mockRejectedValue(uniqueViolation(['scheduleId', 'scheduledAt'])),
        findUnique: vi.fn().mockResolvedValue({
          id: 'log-9',
          status: ComplianceStatus.CONFIRMED,
          confirmedAt: AT_0915,
        }),
      },
      escalationRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run-9' }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'run-9',
          patientId: 'patient-1',
          status: 'WAITING_PATIENT',
          currentTier: null,
          steps: [],
        }),
        update: escalationUpdate,
      },
    })

    await expect(
      confirmMedicationIntake(client, {
        scheduleId: 'schedule-1',
        channel: 'IN_APP',
        now: AT_0915,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(escalationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-9' } }),
    )
  })

  it('unique violation dari kolom lain tetap dilempar, bukan dianggap duplikat', async () => {
    const client = fakeClient({
      complianceLog: {
        create: vi.fn().mockRejectedValue(uniqueViolation(['sourceMessageId'])),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    })

    await expect(
      confirmMedicationIntake(client, {
        scheduleId: 'schedule-1',
        channel: 'IN_APP',
        now: AT_0915,
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError)
  })
})

describe('confirmMedicationIntake — penulisan', () => {
  it('menulis schedule_id, medication_id, patient_id, confirmed_at (AC-2.1)', async () => {
    const client = fakeClient()

    const result = await confirmMedicationIntake(client, {
      scheduleId: 'schedule-1',
      channel: 'IN_APP',
      now: AT_0915,
    })

    expect(result.status).toBe(ComplianceStatus.CONFIRMED)
    expect(result.scheduledAt.toISOString()).toBe(SLOT_0900.toISOString())
    expect(client.complianceLog.create).toHaveBeenCalledWith({
      data: {
        patientId: 'patient-1',
        scheduleId: 'schedule-1',
        medicationId: 'med-1',
        scheduledAt: SLOT_0900,
        confirmedAt: AT_0915,
        status: ComplianceStatus.CONFIRMED,
        channel: 'IN_APP',
        sourceMessageId: null,
        notes: null,
      },
    })
  })

  it('mencatat eskalasi yang diselesaikan, atau null bila tidak ada', async () => {
    const tanpaEskalasi = await confirmMedicationIntake(fakeClient(), {
      scheduleId: 'schedule-1',
      channel: 'IN_APP',
      now: AT_0915,
    })
    expect(tanpaEskalasi.escalationRunId).toBeNull()
    expect(tanpaEskalasi.escalationResolved).toBe(false)

    const denganEskalasi = await confirmMedicationIntake(
      fakeClient({
        escalationRun: {
          findFirst: vi.fn().mockResolvedValue({ id: 'run-7', status: 'WAITING_PATIENT' }),
          findUnique: vi.fn().mockResolvedValue({
            id: 'run-7',
            patientId: 'patient-1',
            status: 'WAITING_PATIENT',
            currentTier: null,
            steps: [],
          }),
          update: vi.fn().mockResolvedValue({ id: 'run-7', status: 'RESOLVED' }),
        },
      }),
      { scheduleId: 'schedule-1', channel: 'IN_APP', now: AT_0915 },
    )
    expect(denganEskalasi.escalationRunId).toBe('run-7')
    expect(denganEskalasi.escalationResolved).toBe(true)
  })

  it('sourceMessageId dari webhook WhatsApp ikut tersimpan', async () => {
    const client = fakeClient()

    await confirmMedicationIntake(client, {
      scheduleId: 'schedule-1',
      channel: 'WHATSAPP',
      sourceMessageId: 'wamid.ABC123',
      now: AT_0915,
    })

    expect(client.complianceLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceMessageId: 'wamid.ABC123' }),
      }),
    )
  })
})

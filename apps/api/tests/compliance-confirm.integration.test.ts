// Integration test CL-107: konfirmasi 1-tap terhadap DB sungguhan — unique index, klasifikasi
// CONFIRMED/CONFIRMED_LATE, dan transisi state machine eskalasi.
//
// Level service dengan `createTestPrisma()`, bukan lewat `buildApp`: `lib/env` meng-`import
// 'dotenv/config'` dan menolak startup bila DATABASE_URL == TEST_DATABASE_URL, jadi
// mengarahkan app singleton ke DB test justru merusak guard tersebut. Kontrak HTTP-nya
// diuji di src/modules/compliance/compliance.routes.test.ts. Pola ini sama dengan
// integration test DB nyata yang lain (tests/reminder-worker.integration.test.ts).
//
// Dilewati otomatis bila TEST_DATABASE_URL tidak diset (mis. `npm run test` tanpa docker).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { ComplianceStatus } from '@careloop/shared'
import {
  assertScheduleOwner,
  confirmMedicationIntake,
} from '../src/modules/compliance/compliance.service'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const PATIENT_ID = '7a1c4e10-0001-4000-8000-000000000001'
const OTHER_PATIENT_ID = '7a1c4e10-0002-4000-8000-000000000002'
const MISSING_ID = '7a1c4e10-9999-4000-8000-000000000009'

const WIB_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Jam dinding WIB `minutesAgo` menit lalu — dipakai sebagai timeOfDay agar slot ada. */
function timeOfDayMinutesAgo(minutesAgo: number): string {
  return WIB_FORMATTER.format(new Date(Date.now() - minutesAgo * 60_000))
}

interface Fixture {
  scheduleId: string
}

async function seedPatient(
  prisma: PrismaClient,
  userId: string,
  phone: string,
  timeOfDay: string,
): Promise<Fixture> {
  await prisma.user.create({
    data: {
      id: userId,
      phone,
      fullName: 'Bu Siti Test',
      role: 'PATIENT',
      timezone: 'Asia/Jakarta',
      isVerified: true,
    },
  })
  await prisma.patient.create({
    data: { id: userId, voiceEnabled: false, emergencyPreference: 'FAMILY_FIRST' },
  })
  await prisma.familyContact.create({
    data: {
      patientId: userId,
      name: 'Keluarga Test',
      phone: '081234567891',
      relationship: 'ANAK',
      tier: 'TIER_1',
      isActive: true,
    },
  })
  const medication = await prisma.medication.create({
    data: {
      patientId: userId,
      name: 'Metformin 500 mg',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  })
  const schedule = await prisma.schedule.create({
    data: {
      patientId: userId,
      medicationId: medication.id,
      timeOfDay,
      daysOfWeek: [],
      timeWindowMinutes: 30,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      // endDate sengaja null: kolomnya nullable dan itu nilai yang dibaca Prisma di produksi.
      endDate: null,
    },
  })

  return { scheduleId: schedule.id }
}

/** Satu baris yang harus terisi penuh: AC-2.1. */
function expectCompleteLog(log: Record<string, unknown>, patientId: string, scheduleId: string) {
  expect(log.id).toBeTruthy()
  expect(log.patientId).toBe(patientId)
  expect(log.scheduleId).toBe(scheduleId)
  expect(log.medicationId).toBeTruthy()
  expect(log.confirmedAt).toBeInstanceOf(Date)
}

describe.skipIf(!isTestDbConfigured())('CL-107 konfirmasi kepatuhan (integration)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  beforeEach(async () => {
    await resetTestDb(prisma)
  })

  function confirm(scheduleId: string, channel: 'IN_APP' | 'WHATSAPP' | 'VOICE' = 'IN_APP') {
    return confirmMedicationIntake(prisma, { scheduleId, channel, actorUserId: PATIENT_ID })
  }

  /** Pasien kedua dengan jadwal aktif — dipakai untuk uji kepemilikan. */
  function seedOtherPatient(): Promise<Fixture> {
    return seedPatient(prisma, OTHER_PATIENT_ID, '081234567892', timeOfDayMinutesAgo(10))
  }

  it('confirm → baris compliance_logs terbentuk lengkap (AC-2.1)', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )

    const result = await confirm(scheduleId)

    expect(result.status).toBe(ComplianceStatus.CONFIRMED)
    expect(result.escalationResolved).toBe(false)
    expect(result.escalationRunId).toBeNull()

    const logs = await prisma.complianceLog.findMany({ where: { scheduleId } })
    expect(logs).toHaveLength(1)
    expectCompleteLog(logs[0], PATIENT_ID, scheduleId)
    expect(logs[0].status).toBe(ComplianceStatus.CONFIRMED)
    expect(logs[0].channel).toBe('IN_APP')
    // Slot = waktu jadwal, bukan waktu konfirmasi.
    expect(logs[0].scheduledAt.getTime()).toBeLessThan(logs[0].confirmedAt!.getTime())

    const audit = await prisma.auditLog.findMany({ where: { resourceId: logs[0].id } })
    expect(audit).toHaveLength(1)
    expect(audit[0].action).toBe('compliance.confirmed')
  })

  it('konfirmasi ganda → 409 dan jumlah record tetap satu (AC-2.2)', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )

    await confirm(scheduleId)

    await expect(confirm(scheduleId, 'WHATSAPP')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_PROCESSED',
    })
    expect(await prisma.complianceLog.count({ where: { scheduleId } })).toBe(1)

    // Kanal pada record tidak ditimpa oleh konfirmasi kedua (AC-2.2: satu record sama).
    const log = await prisma.complianceLog.findFirstOrThrow({ where: { scheduleId } })
    expect(log.channel).toBe('IN_APP')
  })

  it('konfirmasi lewat 2 jam → CONFIRMED_LATE, bukan MISSED (AC-2.3)', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(120),
    )

    const result = await confirm(scheduleId)

    expect(result.status).toBe(ComplianceStatus.CONFIRMED_LATE)
    const log = await prisma.complianceLog.findFirstOrThrow({ where: { scheduleId } })
    expect(log.status).toBe(ComplianceStatus.CONFIRMED_LATE)
    expect(log.status).not.toBe(ComplianceStatus.MISSED)
  })

  it('konfirmasi menyelesaikan run eskalasi aktif menjadi RESOLVED', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )
    const run = await prisma.escalationRun.create({
      data: {
        patientId: PATIENT_ID,
        context: 'SCHEDULE',
        sourceScheduleId: scheduleId,
        status: 'WAITING_PATIENT',
      },
    })

    const result = await confirm(scheduleId)

    expect(result.escalationResolved).toBe(true)
    expect(result.escalationRunId).toBe(run.id)

    const after = await prisma.escalationRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe('RESOLVED')
    expect(after.resolutionType).toBe('PATIENT_CONFIRMED')
    expect(after.resolvedAt).toBeInstanceOf(Date)
    expect(after.resolvedByUserId).toBe(PATIENT_ID)

    const steps = await prisma.escalationStep.findMany({ where: { runId: run.id } })
    expect(steps).toHaveLength(1)
    expect(steps[0].messageKey).toBe('transition.patient_confirmed')
  })

  it('eskalasi yang sudah berjalan di tier 1 juga ditutup, bukan hanya WAITING_PATIENT', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )
    const run = await prisma.escalationRun.create({
      data: {
        patientId: PATIENT_ID,
        context: 'SCHEDULE',
        sourceScheduleId: scheduleId,
        status: 'FAMILY_TIER_1',
        currentTier: 'TIER_1',
      },
    })

    await confirm(scheduleId)

    const after = await prisma.escalationRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe('RESOLVED')
    expect(after.resolutionType).toBe('PATIENT_CONFIRMED')
  })

  it('run milik jadwal lain tidak ikut diselesaikan', async () => {
    const milikPasien = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )
    const milikPasienLain = await seedOtherPatient()
    const run = await prisma.escalationRun.create({
      data: {
        patientId: OTHER_PATIENT_ID,
        context: 'SCHEDULE',
        sourceScheduleId: milikPasienLain.scheduleId,
        status: 'WAITING_PATIENT',
      },
    })

    const result = await confirm(milikPasien.scheduleId)

    expect(result.escalationRunId).toBeNull()
    const after = await prisma.escalationRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe('WAITING_PATIENT')
  })

  it('kepemilikan dijaga lapisan pemanggil, bukan di dalam service', async () => {
    await seedOtherPatient()

    // Service sengaja transport-agnostic: ia tidak tahu siapa pemanggilnya, jadi tidak boleh
    // mengarang guard JWT. Route wajib memanggil assertScheduleOwner lebih dulu — sudah diuji di
    // compliance.routes.test.ts. Test ini mengunci pembagian tanggung jawab itu.
    expect(() =>
      assertScheduleOwner({
        claimsRole: 'PATIENT',
        claimsSub: PATIENT_ID,
        patientId: OTHER_PATIENT_ID,
      }),
    ).toThrow()
  })

  it('jadwal tidak ada → 404', async () => {
    await expect(confirm(MISSING_ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    })
  })

  it('jadwal yang belum mulai → 422 tanpa menulis apa pun', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )
    await prisma.schedule.update({
      where: { id: scheduleId },
      data: { startDate: new Date(Date.now() + 86_400_000) },
    })

    await expect(confirm(scheduleId)).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_TRANSITION',
    })
    expect(await prisma.complianceLog.count()).toBe(0)
  })

  it('sourceMessageId webhook WhatsApp tersimpan untuk jejak asal pesan', async () => {
    const { scheduleId } = await seedPatient(
      prisma,
      PATIENT_ID,
      '081234567890',
      timeOfDayMinutesAgo(10),
    )

    await confirmMedicationIntake(prisma, {
      scheduleId,
      channel: 'WHATSAPP',
      sourceMessageId: 'wamid.TEST123',
      actorUserId: PATIENT_ID,
    })

    const log = await prisma.complianceLog.findFirstOrThrow({ where: { scheduleId } })
    expect(log.sourceMessageId).toBe('wamid.TEST123')
  })
})

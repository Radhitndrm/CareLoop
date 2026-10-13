// Integration test jadwal obat milik pasien sendiri.
//
// Endpoint ini adalah sumber data layar "Sudah minum" di aplikasi pasien. Kalau ia
// mengembalikan jadwal orang lain atau jadwal yang belum disetujui dokter, konfirmasi
// 1-tap bisa jatuh ke slot yang salah — jadi ownership dan gate klinis diuji di sini.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'
import { listOwnSchedules } from '../src/modules/reminders'

const PATIENT_A = '00000000-0000-4000-8000-0000000000a1'
const PATIENT_B = '00000000-0000-4000-8000-0000000000a2'

describe.skipIf(!isTestDbConfigured())('Jadwal obat milik pasien sendiri', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    migrateTestDb()
    prisma = createTestPrisma()
  }, 180_000)

  afterAll(async () => {
    await teardownTestDb(prisma)
  })

  beforeEach(async () => {
    await resetTestDb(prisma)

    for (const [id, name] of [
      [PATIENT_A, 'Bu Satu Test'],
      [PATIENT_B, 'Bu Dua Test'],
    ] as const) {
      await prisma.user.create({
        data: { id, phone: `0811${id.slice(-4)}0000`, fullName: name, role: 'PATIENT' },
      })
      await prisma.patient.create({
        data: { id, districtCode: '3471', healthConditions: ['DIABETES'] },
      })
    }
  })

  async function seedSchedule(opts: {
    patientId: string
    medicationStatus: 'APPROVED' | 'DRAFT' | 'REJECTED'
    scheduleStatus?: 'APPROVED' | 'DRAFT'
    isActive?: boolean
    timeOfDay?: string
  }) {
    const medication = await prisma.medication.create({
      data: {
        patientId: opts.patientId,
        name: `Obat ${opts.patientId.slice(-2)}`,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: opts.medicationStatus,
        isActive: opts.isActive ?? true,
      },
    })
    return prisma.schedule.create({
      data: {
        patientId: opts.patientId,
        medicationId: medication.id,
        timeOfDay: opts.timeOfDay ?? '08:00',
        doseQty: '1 tablet',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: opts.scheduleStatus ?? 'APPROVED',
        isActive: opts.isActive ?? true,
      },
      select: { id: true },
    })
  }

  it('mengembalikan jadwal milik pasien itu sendiri saja', async () => {
    const mine = await seedSchedule({ patientId: PATIENT_A, medicationStatus: 'APPROVED' })
    await seedSchedule({ patientId: PATIENT_B, medicationStatus: 'APPROVED' })

    const schedules = await listOwnSchedules(prisma, PATIENT_A)

    expect(schedules).toHaveLength(1)
    expect(schedules[0].id).toBe(mine.id)
  })

  it('tidak membocorkan identitas pasien lain', async () => {
    await seedSchedule({ patientId: PATIENT_B, medicationStatus: 'APPROVED' })

    const schedules = await listOwnSchedules(prisma, PATIENT_A)

    expect(schedules).toEqual([])
  })

  it('menyembunyikan jadwal dengan resep DRAFT', async () => {
    await seedSchedule({ patientId: PATIENT_A, medicationStatus: 'DRAFT' })

    expect(await listOwnSchedules(prisma, PATIENT_A)).toEqual([])
  })

  it('menyembunyikan jadwal dengan resep REJECTED', async () => {
    await seedSchedule({ patientId: PATIENT_A, medicationStatus: 'REJECTED' })

    expect(await listOwnSchedules(prisma, PATIENT_A)).toEqual([])
  })

  it('menyembunyikan jadwal yang belum disetujui walau resepnya sah', async () => {
    await seedSchedule({
      patientId: PATIENT_A,
      medicationStatus: 'APPROVED',
      scheduleStatus: 'DRAFT',
    })

    expect(await listOwnSchedules(prisma, PATIENT_A)).toEqual([])
  })

  it('menyembunyikan jadwal yang dinonaktifkan', async () => {
    await seedSchedule({
      patientId: PATIENT_A,
      medicationStatus: 'APPROVED',
      isActive: false,
    })

    expect(await listOwnSchedules(prisma, PATIENT_A)).toEqual([])
  })

  it('mengembalikan nama obat, dosis, dan jam dari server', async () => {
    await seedSchedule({ patientId: PATIENT_A, medicationStatus: 'APPROVED', timeOfDay: '21:30' })

    const [schedule] = await listOwnSchedules(prisma, PATIENT_A)

    expect(schedule).toMatchObject({
      medicationName: 'Obat a1',
      doseQty: '1 tablet',
      timeOfDay: '21:30',
    })
  })

  it('menghitung waktu berikutnya dalam UTC dari jam dinding pasien', async () => {
    await seedSchedule({ patientId: PATIENT_A, medicationStatus: 'APPROVED', timeOfDay: '08:00' })

    const [schedule] = await listOwnSchedules(prisma, PATIENT_A)

    expect(schedule.nextFireAt).toBeTruthy()
    // 08:00 WIB = 01:00 UTC. Slot berikutnya selalu di masa depan.
    const next = new Date(schedule.nextFireAt as string).getTime()
    expect(next).toBeGreaterThan(Date.now())
    const utcHour = new Date(schedule.nextFireAt as string).getUTCHours()
    expect(utcHour).toBe(1)
  })

  it('mengembalikan array kosong untuk pasien tanpa jadwal', async () => {
    expect(await listOwnSchedules(prisma, PATIENT_A)).toEqual([])
  })
})
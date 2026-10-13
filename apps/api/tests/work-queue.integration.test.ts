// Integration test antrean kerja nakes (Fase F).
//
// Yang dijaga:
//   1. Antrean memakai scope yang sama dengan dashboard — tidak boleh membocorkan pasien
//      puskesmas lain lewat jalur "agregat".
//   2. Kelompok-kelompoknya benar-benar mencerminkan prasyarat aktivasi, bukan
//      penghitungan status yang terbalik.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'
import { getWorkQueue, type WorkQueueBucket } from '../src/modules/dashboard/work-queue.service'

const CLINIC_A = '00000000-0000-4000-8000-0000000000c1'
const CLINIC_B = '00000000-0000-4000-8000-0000000000c2'
const NAKES_A = '00000000-0000-4000-8000-0000000000c3'
const ADMIN_ID = '00000000-0000-4000-8000-0000000000c4'

const claimsA = { sub: NAKES_A, role: 'NAKES', nakesRole: 'PERAWAT' } as any
const claimsAdmin = { sub: ADMIN_ID, role: 'ADMIN' } as any

describe.skipIf(!isTestDbConfigured())('Antrean kerja nakes (Fase F)', () => {
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

    await prisma.puskesmas.createMany({
      data: [
        { id: CLINIC_A, name: 'Puskesmas Timur', districtCode: '3471' },
        { id: CLINIC_B, name: 'Puskesmas Barat', districtCode: '3472' },
      ],
    })
    await prisma.user.createMany({
      data: [
        { id: NAKES_A, phone: '081160000001', fullName: 'Perawat Timur', role: 'NAKES', nakesRole: 'PERAWAT', staffStatus: 'ACTIVE' },
        { id: ADMIN_ID, phone: '081160000002', fullName: 'Admin', role: 'ADMIN', isVerified: true },
      ],
    })
    await prisma.nakesAssignment.create({
      data: { nakesUserId: NAKES_A, puskesmasId: CLINIC_A, scopeType: 'PUSKESMAS', isActive: true },
    })
  })

  const db = () => prisma as any

  interface SeedOptions {
    status?: 'ONBOARDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED'
    clinicId?: string | null
    fullName?: string
    isVerified?: boolean
    gender?: 'M' | 'F' | null
    districtCode?: string | null
    healthConditions?: string[]
    withNakesContact?: boolean
  }

  async function seedPatient(options: SeedOptions = {}) {
    const id = crypto.randomUUID()
    await prisma.user.create({
      data: {
        id,
        phone: `0811${id.slice(-9, -5)}0000`,
        fullName: options.fullName ?? `Pasien ${id.slice(-4)}`,
        role: 'PATIENT',
        isVerified: options.isVerified ?? false,
        consentPdpAt: new Date(),
      },
    })
    await prisma.patient.create({
      data: {
        id,
        status: options.status ?? 'ONBOARDING',
        primaryPuskesmasId: options.clinicId === undefined ? CLINIC_A : options.clinicId,
        districtCode: options.districtCode === undefined ? '3471' : options.districtCode,
        gender: options.gender === undefined ? 'F' : options.gender,
        dateOfBirth: new Date('1970-01-01T00:00:00.000Z'),
        healthConditions: options.healthConditions ?? ['DIABETES'],
      },
    })
    if (options.withNakesContact) {
      await prisma.nakesContact.create({
        data: {
          patientId: id,
          nakesUserId: NAKES_A,
          nakesName: 'Perawat Timur',
          nakesRole: 'PERAWAT',
          phone: '081160000001',
          puskesmasId: CLINIC_A,
          isActive: true,
        },
      })
    }
    return id
  }

  const bucket = (buckets: WorkQueueBucket[], key: string): WorkQueueBucket | undefined =>
    buckets.find((b) => b.key === key)

  const idsIn = (b: WorkQueueBucket | undefined): string[] =>
    (b?.items ?? []).map((item) => item.patientId)

  it('menampilkan pasien yang belum terverifikasi di kelompok yang tepat', async () => {
    const id = await seedPatient({ withNakesContact: true })

    const result = await getWorkQueue(db(), claimsA)
    const unverified = bucket(result.buckets, 'UNVERIFIED')

    expect(idsIn(unverified)).toContain(id)
  })

  it('menandai pasien tanpa tujuan eskalasi', async () => {
    const id = await seedPatient({ isVerified: true })

    const result = await getWorkQueue(db(), claimsA)

    expect(idsIn(bucket(result.buckets, 'NO_ESCALATION_CONTACT'))).toContain(id)
  })

  it('tidak menandai pasien yang punya NakesContact sebagai tanpa tujuan eskalasi', async () => {
    const id = await seedPatient({ isVerified: true, withNakesContact: true })

    const result = await getWorkQueue(db(), claimsA)

    expect(idsIn(bucket(result.buckets, 'NO_ESCALATION_CONTACT'))).not.toContain(id)
  })

  it('menandai pasien tanpa resep approved', async () => {
    const id = await seedPatient({ isVerified: true, withNakesContact: true })

    const result = await getWorkQueue(db(), claimsA)

    expect(idsIn(bucket(result.buckets, 'NO_APPROVED_MEDICATION'))).toContain(id)
  })

  it('tidak menandai pasien yang sudah punya resep APPROVED sebagai "belum ada resep"', async () => {
    const id = await seedPatient({ isVerified: true, withNakesContact: true })
    const medication = await prisma.medication.create({
      data: {
        patientId: id,
        name: 'Metformin',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'APPROVED',
        isActive: true,
      },
    })
    await prisma.schedule.create({
      data: {
        patientId: id,
        medicationId: medication.id,
        timeOfDay: '08:00',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'APPROVED',
        isActive: true,
      },
    })

    const result = await getWorkQueue(db(), claimsA)

    expect(idsIn(bucket(result.buckets, 'NO_APPROVED_MEDICATION'))).not.toContain(id)
    expect(idsIn(bucket(result.buckets, 'NO_ACTIVE_SCHEDULE'))).not.toContain(id)
    expect(result.buckets).toEqual([])
  })

  it('pasien ACTIVE tidak pernah muncul di antrean onboarding', async () => {
    await seedPatient({ status: 'ACTIVE', isVerified: true, withNakesContact: true })

    const result = await getWorkQueue(db(), claimsA)

    expect(result.buckets).toEqual([])
  })

  it('menampilkan field yang kosong sebagai alasan yang bisa ditindaklanjuti', async () => {
    await seedPatient({
      isVerified: true,
      withNakesContact: true,
      gender: null,
      healthConditions: [],
    })

    const result = await getWorkQueue(db(), claimsA)
    const incomplete = bucket(result.buckets, 'INCOMPLETE')

    expect(incomplete).toBeDefined()
    const reasons = incomplete?.items[0]?.reasons.join(' ') ?? ''
    expect(reasons).toContain('jenis kelamin')
    expect(reasons).toContain('kondisi penyakit')
  })

  it('nakes hanya melihat antrean puskesmasnya sendiri', async () => {
    const mine = await seedPatient({ clinicId: CLINIC_A, withNakesContact: true })
    const theirs = await seedPatient({ clinicId: CLINIC_B })

    const result = await getWorkQueue(db(), claimsA)
    const allIds = result.buckets.flatMap((b) => idsIn(b))

    expect(allIds).toContain(mine)
    expect(allIds).not.toContain(theirs)
  })

  it('admin melihat seluruh antrean', async () => {
    const theirs = await seedPatient({ clinicId: CLINIC_B })

    const result = await getWorkQueue(db(), claimsAdmin)
    const allIds = result.buckets.flatMap((b) => idsIn(b))

    expect(allIds).toContain(theirs)
  })

  it('menyaring berdasarkan puskesmas', async () => {
    const a = await seedPatient({ clinicId: CLINIC_A, withNakesContact: true })
    await seedPatient({ clinicId: CLINIC_B })

    const result = await getWorkQueue(db(), claimsAdmin, { clinicId: CLINIC_A })
    // Satu pasien bisa muncul di beberapa kelompok, jadi yang dicek himpunan unik.
    const allIds = new Set(result.buckets.flatMap((b) => idsIn(b)))

    expect([...allIds]).toEqual([a])
  })

  it('menghitung jumlah insiden keselamatan tanpa-butuh daftar pasien', async () => {
    await seedPatient({ isVerified: true, withNakesContact: true })
    const other = await seedPatient({ isVerified: true, withNakesContact: true })
    await prisma.emergencyAlert.create({
      data: {
        patientId: other,
        triggeredAt: new Date(),
        triggerType: 'ANOMALY_HR',
        status: 'PENDING_PATIENT_CONFIRM',
        hrBpm: 150,
      },
    })

    const result = await getWorkQueue(db(), claimsA)
    const emergency = bucket(result.buckets, 'OPEN_EMERGENCY')

    expect(emergency?.count).toBe(1)
    // Kelompok keselamatan sengaja tanpa items: penanganannya di layar emergency.
    expect(emergency?.items).toEqual([])
  })

  it('membatasi jumlah item per kelompok tanpa mengubah count', async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedPatient({ isVerified: true })
    }

    const result = await getWorkQueue(db(), claimsA, { perBucketLimit: 1 })
    const bucketNoContact = bucket(result.buckets, 'NO_ESCALATION_CONTACT')

    expect(bucketNoContact?.count).toBe(3)
    expect(bucketNoContact?.items).toHaveLength(1)
  })

  it('tidak mengirim data klinis ke klien', async () => {
    await seedPatient({ isVerified: true })
    const result = await getWorkQueue(db(), claimsA)

    for (const b of result.buckets) {
      for (const item of b.items) {
        expect(Object.keys(item).sort()).toEqual(
          ['fullName', 'phone', 'patientId', 'reasons', 'status', 'primaryPuskesmasName'].sort(),
        )
      }
    }
  })
})
// Integration test alur klinis Tahap 1 & 2 (docs/API.md §3.1, §3.2).
//
// Skenario yang dijaga: perawat membuat draft -> pasien tidak boleh punya
// jadwal aktif -> dokter menyetujui -> jadwal aktif. Diuji terhadap DB sungguhan
// karena aturan ini bergantung pada kolom & constraint, bukan logika murni.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createPatient, listPatients, getPatient, setHrThresholds } from '../src/modules/patients/patients.service'
import {
  draftMedication,
  createSchedule,
  approveMedication,
} from '../src/modules/medications/medications.service'
import { loadReminderSchedule } from '../src/modules/reminders/reminder.worker'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const PUSKESMAS_ID = '00000000-0000-4000-8000-000000000010'
const DISTRICT_CODE = '3471'

function claimsFor(role: 'NAKES' | 'ADMIN' | 'PATIENT', nakesRole?: string, sub = 'nakes-1') {
  return { sub, role, ...(nakesRole ? { nakesRole } : {}) } as any
}

const audit = { actorUserId: 'nakes-1', actorRole: 'NAKES' as const }

describe.skipIf(!isTestDbConfigured())('alur klinis: daftar pasien & persetujuan resep', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
  }, 180_000)

  beforeEach(async () => {
    await resetTestDb(prisma)
    await prisma.puskesmas.create({
      data: { id: PUSKESMAS_ID, name: 'Puskesmas Demo', districtCode: DISTRICT_CODE },
    })
    await prisma.user.create({
      data: {
        id: 'nakes-1',
        phone: '081100000001',
        fullName: 'dr. Dewi Lestari',
        role: 'NAKES',
        nakesRole: 'DOKTER',
        passwordHash: null,
        isVerified: true,
      },
    })
    await prisma.user.create({
      data: {
        id: 'perawat-1',
        phone: '081100000002',
        fullName: 'Nuning S.',
        role: 'NAKES',
        nakesRole: 'PERAWAT',
        passwordHash: null,
        isVerified: true,
      },
    })
await prisma.nakesAssignment.create({
      data: { nakesUserId: 'nakes-1', puskesmasId: PUSKESMAS_ID },
    })
    // Perawat bekerja di puskesmas yang sama, jadi punya scope atas pasien yang
    // didaftarkan dokter — inilah alur draft yang wajar terjadi.
    await prisma.nakesAssignment.create({
      data: { nakesUserId: 'perawat-1', puskesmasId: PUSKESMAS_ID },
    })
  })

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  async function seedPatient(fullName = 'Bu Ratna') {
    return createPatient(prisma as any, {
      input: {
        fullName,
        phone: '081200000001',
        districtCode: DISTRICT_CODE,
        puskesmasId: PUSKESMAS_ID,
        healthConditions: ['HIPERTENSI'],
      },
      claims: claimsFor('NAKES', 'DOKTER'),
      audit,
    })
  }

  describe('Tahap 1: pendaftaran pasien oleh nakes', () => {
    it('mendaftarkan pasien dan otomatis mengaitkannya ke nakes yang mendaftar', async () => {
      const patient = await seedPatient()

      expect(patient.fullName).toBe('Bu Ratna')
      expect(patient.phone).toBe('081200000001')
      expect(patient.districtCode).toBe(DISTRICT_CODE)

      // Pasien baru harus langsung terlihat oleh nakes pendatarnya, kalau tidak
      // ia akan hilang dari dashboardnya sendiri setelah didaftarkan.
      const contacts = await prisma.nakesContact.findMany({
        where: { patientId: patient.id },
      })
      expect(contacts).toHaveLength(1)
      expect(contacts[0].nakesUserId).toBe('nakes-1')
      expect(contacts[0].isPrimary).toBe(true)
    })

    it('akun pasien dibuat tanpa kata sandi agar hanya bisa masuk lewat OTP', async () => {
      const patient = await seedPatient()
      const user = await prisma.user.findUnique({ where: { id: patient.id } })

      expect(user?.role).toBe('PATIENT')
      expect(user?.passwordHash).toBeNull()
    })

    it('nakes tanpa penugasan ditolak saat mendaftarkan pasien', async () => {
      await prisma.user.create({
        data: {
          id: 'tanpa-scope',
          phone: '081100000009',
          fullName: 'Tanpa Scope',
          role: 'NAKES',
          nakesRole: 'PERAWAT',
        },
      })

      await expect(
        createPatient(prisma as any, {
          input: {
            fullName: 'Buhek',
            phone: '081200000099',
            districtCode: DISTRICT_CODE,
            puskesmasId: PUSKESMAS_ID,
          },
          claims: claimsFor('NAKES', 'PERAWAT', 'tanpa-scope'),
          audit,
        }),
      ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('nomor HP ganda ditolak 409', async () => {
      await seedPatient()
      await expect(
        createPatient(prisma as any, {
          input: {
            fullName: 'Buhek',
            phone: '081200000001',
            districtCode: DISTRICT_CODE,
            puskesmasId: PUSKESMAS_ID,
          },
          claims: claimsFor('NAKES', 'DOKTER'),
          audit,
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('pasien yang tidak ada di scope nakes lain tidak bisa dibaca', async () => {
      const patient = await seedPatient()
      await prisma.user.create({
        data: {
          id: 'nakes-2',
          phone: '081100000003',
          fullName: 'Dokter Lain',
          role: 'NAKES',
          nakesRole: 'DOKTER',
        },
      })

      await expect(
        getPatient(prisma as any, claimsFor('NAKES', 'DOKTER', 'nakes-2'), patient.id),
      ).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('Tahap 2: draft perawat lalu persetujuan dokter', () => {
    it('perawat membuat draft yang tidak aktif', async () => {
      const patient = await seedPatient()

      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      expect(medication.status).toBe('DRAFT')
      expect(medication.isActive).toBe(false)

      const row = await prisma.medication.findUnique({ where: { id: medication.id } })
      expect(row?.status).toBe('DRAFT')
      expect(row?.isActive).toBe(false)
    })

    it('jadwal pada obat draft ikut nonaktif', async () => {
      const patient = await seedPatient()
      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      await createSchedule(prisma as any, {
        patientId: patient.id,
        input: {
          medicationId: medication.id,
          timeOfDay: '08:00',
          doseQty: '1 tablet',
          startDate: '2026-01-01',
        },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      const schedule = await prisma.schedule.findFirst({
        where: { medicationId: medication.id },
      })
      expect(schedule?.status).toBe('DRAFT')
      expect(schedule?.isActive).toBe(false)
    })

    it('dokter menyetujui -> obat dan jadwal aktif, dan dapat dibaca scheduler', async () => {
      const patient = await seedPatient()
      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })
      await createSchedule(prisma as any, {
        patientId: patient.id,
        input: {
          medicationId: medication.id,
          timeOfDay: '08:00',
          doseQty: '1 tablet',
          startDate: '2026-01-01',
        },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      await approveMedication(prisma as any, {
        medicationId: medication.id,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit,
      })

      const schedule = await prisma.schedule.findFirst({
        where: { medicationId: medication.id },
      })
      expect(schedule?.status).toBe('APPROVED')
      expect(schedule?.isActive).toBe(true)

      // Worker reminder memakai status ini; kalau APPROVED, jadwal terbaca dan siap diproses.
      const loaded = await loadReminderSchedule(prisma as any, schedule!.id)
      expect(loaded?.status).toBe('APPROVED')
      expect(loaded?.isActive).toBe(true)
    })

    it('dokter menolak -> jadwal dimatikan sehingga tidak ada reminder', async () => {
      const patient = await seedPatient()
      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })
      await createSchedule(prisma as any, {
        patientId: patient.id,
        input: {
          medicationId: medication.id,
          timeOfDay: '08:00',
          doseQty: '1 tablet',
          startDate: '2026-01-01',
        },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      await approveMedication(prisma as any, {
        medicationId: medication.id,
        input: { decision: 'REJECTED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit,
      })

      const schedule = await prisma.schedule.findFirst({
        where: { medicationId: medication.id },
      })
      expect(schedule?.isActive).toBe(false)
      expect(schedule?.status).toBe('REJECTED')
    })

    it('jadwal yang ditambahkan setelah obat disahkan langsung aktif', async () => {
      // Resep sudah disahkan dokter, jadi jadwal baru tidak butuh persetujuan
      // kedua — kalau tidak, jadwal ini akan menggantung selamanya tanpa reminder.
      const patient = await seedPatient()
      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })
      await approveMedication(prisma as any, {
        medicationId: medication.id,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit,
      })

      await createSchedule(prisma as any, {
        patientId: patient.id,
        input: {
          medicationId: medication.id,
          timeOfDay: '20:00',
          doseQty: '1 tablet',
          startDate: '2026-01-01',
        },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      const schedules = await prisma.schedule.findMany({
        where: { medicationId: medication.id },
      })
      expect(schedules).toHaveLength(1)
      expect(schedules[0].status).toBe('APPROVED')
      expect(schedules[0].isActive).toBe(true)

      const loaded = await loadReminderSchedule(prisma as any, schedules[0].id)
      expect(loaded?.isActive).toBe(true)
      expect(loaded?.status).toBe('APPROVED')
    })

    it('persetujuan dokter tercatat pada kolom approvedById & approvedAt', async () => {
      const patient = await seedPatient()
      const medication = await draftMedication(prisma as any, {
        patientId: patient.id,
        input: { name: 'Metformin 500 mg', startedAt: '2026-01-01' },
        claims: claimsFor('NAKES', 'PERAWAT', 'perawat-1'),
        audit,
      })

      await approveMedication(prisma as any, {
        medicationId: medication.id,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit,
      })

      const row = await prisma.medication.findUnique({ where: { id: medication.id } })
      expect(row?.approvedById).toBe('nakes-1')
      expect(row?.approvedAt).toBeInstanceOf(Date)
    })
  })

  describe('ambang detak jantung per pasien', () => {
    it('dokter menetapkan ambang dan tersimpan di kolom Patient', async () => {
      const patient = await seedPatient()

      const result = await setHrThresholds(prisma as any, {
        patientId: patient.id,
        input: { hrMinBpm: 45, hrMaxBpm: 130 },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit,
      })

      expect(result).toEqual({ hrMinBpm: 45, hrMaxBpm: 130 })

      const row = await prisma.patient.findUnique({
        where: { id: patient.id },
        select: { hrMinBpm: true, hrMaxBpm: true },
      })
      expect(row).toEqual({ hrMinBpm: 45, hrMaxBpm: 130 })
    })

    it('menolak ambang min >= max', async () => {
      const patient = await seedPatient()

      await expect(
        setHrThresholds(prisma as any, {
          patientId: patient.id,
          input: { hrMinBpm: 130, hrMaxBpm: 45 },
          claims: claimsFor('NAKES', 'DOKTER'),
          audit,
        }),
      ).rejects.toBeInstanceOf(Error)
    })

    it('pasien tetap punya ambang null setelah pendaftaran — default sistem dipakai', async () => {
      const patient = await seedPatient()
      expect(patient.hrMinBpm).toBeNull()
      expect(patient.hrMaxBpm).toBeNull()
    })
  })

  describe('daftar pasien dalam scope', () => {
    it('hanya menampilkan pasien milik wilayah sendiri', async () => {
      await seedPatient('Bu Ratna')
      await createPatient(prisma as any, {
        input: {
          fullName: 'Pak Haji',
          phone: '081200000002',
          districtCode: DISTRICT_CODE,
          puskesmasId: PUSKESMAS_ID,
        },
        claims: claimsFor('ADMIN'),
        audit,
      })

      const result = await listPatients(prisma as any, {
        claims: claimsFor('NAKES', 'DOKTER'),
        query: { limit: 50, offset: 0 },
      })

      expect(result.total).toBeGreaterThanOrEqual(1)
      expect(result.items.every((p) => p.districtCode === DISTRICT_CODE)).toBe(true)
    })
  })
})
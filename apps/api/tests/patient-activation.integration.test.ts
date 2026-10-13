// Integration test siklus hidup pasien (Fase A plan operasional).
//
// Mengunci tiga hal yang tidak boleh bocor ke logic lain:
//   1. Pasien baru selalu ONBOARDING dan tidak bisa diaktifkan lewat jalan pintas.
//   2. Aktivasi ditolak sampai checklist lengkap, dan alasannya dikembalikan.
//   3. Dispatcher reminder tidak menjadwalkan apa pun untuk pasien non-ACTIVE.
//
// Memakai DB test (TRUNCATE per suite), jadi tidak ada mock yang bisa menyembunyikan
// masalah filter query.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { AuthUserClaims } from '@careloop/shared'
import { createPatient } from '../src/modules/patients/patients.service'
import {
  activatePatient,
  changePatientStatus,
  getPatientActivation,
  type ActivationPrismaClient,
} from '../src/modules/patients/activation.service'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

function claims(role: AuthUserClaims['role'], nakesRole?: string): AuthUserClaims {
  return { sub: role === 'ADMIN' ? ADMIN_ID : nakesRole === 'DOKTER' ? DOKTER_ID : PERAWAT_ID, role, ...(nakesRole ? { nakesRole } : {}) } as AuthUserClaims
}

const audit = { actorUserId: '00000000-0000-4000-8000-0000000000d1', actorRole: 'NAKES' as const }

const PUSKESMA_ID = '00000000-0000-4000-8000-0000000000a1'
const DOKTER_ID = '00000000-0000-4000-8000-0000000000d1'
const PERAWAT_ID = '00000000-0000-4000-8000-0000000000d2'
const ADMIN_ID = '00000000-0000-4000-8000-0000000000d3'

describe.skipIf(!isTestDbConfigured())('Siklus hidup pasien (Fase A)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
    await resetTestDb(prisma)

  }, 120_000)

  afterAll(async () => {
    await teardownTestDb(prisma)
  })

  beforeEach(async () => {
    await resetTestDb(prisma)
    await seedOrganisasi()
  })

  /**
   * Data ajar dibuat ulang tiap test, bukan sekali di beforeAll: `resetTestDb` di
   * beforeEach akan menghapus semuanya, dan akun nakes tanpa assignment tidak punya
   * scope sehingga setiap permintaan akan 403/404.
   */
  async function seedOrganisasi() {
    await prisma.puskesmas.create({
      data: { id: PUSKESMA_ID, name: 'Puskesmas Contoh', isActive: true },
    })

    await prisma.user.createMany({
      data: [
        {
          id: DOKTER_ID,
          phone: '081100000101',
          fullName: 'Dokter Test',
          role: 'NAKES',
          nakesRole: 'DOKTER',
          isVerified: true,
        },
        {
          id: PERAWAT_ID,
          phone: '081100000102',
          fullName: 'Perawat Test',
          role: 'NAKES',
          nakesRole: 'PERAWAT',
          isVerified: true,
        },
        {
          id: ADMIN_ID,
          phone: '081100000103',
          fullName: 'Admin Test',
          role: 'ADMIN',
          isVerified: true,
        },
      ],
    })

    await prisma.nakesAssignment.createMany({
      data: [
        {
          nakesUserId: DOKTER_ID,
          puskesmasId: PUSKESMA_ID,
          scopeType: 'PUSKESMAS',
          isActive: true,
        },
        {
          nakesUserId: PERAWAT_ID,
          puskesmasId: PUSKESMA_ID,
          scopeType: 'PUSKESMAS',
          isActive: true,
        },
      ],
    })
  }

  const db = () => prisma as unknown as ActivationPrismaClient

  /** Pasien ONBOARDING yang datanya sudah cukup lengkap. */
  async function seedOnboardingPatient(overrides: Record<string, unknown> = {}) {
    const id = crypto.randomUUID()
    await prisma.user.create({
      data: {
        id,
        phone: `0812${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`,
        fullName: 'Bu Siti Test',
        role: 'PATIENT',
        isVerified: true,
        consentPdpAt: new Date(),
      },
    })
    await prisma.patient.create({
      data: {
        id,
        districtCode: '3471',
        gender: 'F',
        dateOfBirth: new Date('1980-05-05T00:00:00.000Z'),
        address: 'Jl. Merdeka No. 1',
        healthConditions: ['DIABETES'],
        emergencyPreference: 'FAMILY_FIRST',
        consentShareWithNakes: true,
        primaryPuskesmasId: PUSKESMA_ID,
        status: 'ONBOARDING',
        ...overrides,
      },
    })
    return id
  }

  it('pasien baru dibuat ONBOARDING dan terikat ke puskesmas utama', async () => {
    const created = await createPatient(db(), {
      input: {
        fullName: 'Pak Budi Test',
        phone: '081277700001',
        districtCode: '3471',
        puskesmasId: PUSKESMA_ID,
        healthConditions: ['HIPERTENSI'],
        consentShareWithNakes: true,
      },
      claims: claims('NAKES', 'DOKTER'),
      audit,
    })

    expect(created.status).toBe('ONBOARDING')
    expect(created.primaryPuskesmas?.id).toBe(PUSKESMA_ID)
    expect(created.primaryPuskesmasName).toBe('Puskesmas Contoh')
  })

  it('checklist aktivasi menampilkan blocker yang bisa ditindaklanjuti', async () => {
    const id = await seedOnboardingPatient()

    const checklist = await getPatientActivation(db(), claims('NAKES', 'DOKTER'), id)

    expect(checklist.ready).toBe(false)
    expect(checklist.blockers.map((b) => b.key)).toEqual(
      expect.arrayContaining(['ESCALATION_CONTACT', 'APPROVED_MEDICATION', 'ACTIVE_SCHEDULE']),
    )
  })

  it('menolak aktivasi dan mengembalikan daftar blocker', async () => {
    const id = await seedOnboardingPatient()

    await expect(
      activatePatient(db(), {
        patientId: id,
        to: 'ACTIVE',
        claims: claims('NAKES', 'DOKTER'),
        audit,
      }),
    ).rejects.toThrow(/belum memenuhi syarat aktivasi/)

    const after = await prisma.patient.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('ONBOARDING')
  })

  it('menolak perawat yang mencoba mengaktifkan pasien', async () => {
    const id = await seedOnboardingPatient()

    await expect(
      activatePatient(db(), {
        patientId: id,
        to: 'ACTIVE',
        claims: claims('NAKES', 'PERAWAT'),
        audit,
      }),
    ).rejects.toThrow(/Hanya dokter, bidan, atau admin/)

    const after = await prisma.patient.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('ONBOARDING')
  })

  it('menolak PATCH status menuju ACTIVE agar checklist tidak bisa dilewati', async () => {
    const id = await seedOnboardingPatient()

    await expect(
      changePatientStatus(db(), {
        patientId: id,
        to: 'ACTIVE',
        claims: claims('ADMIN'),
        audit,
      }),
    ).rejects.toThrow(/endpoint aktivasi/)
  })

  it('mengaktifkan pasien setelah seluruh prasyarat terpenuhi', async () => {
    const id = await seedOnboardingPatient()
    await prisma.familyContact.create({
      data: {
        patientId: id,
        name: 'Bapak Test',
        phone: '081277700099',
        relationship: 'SAUDARA',
        tier: 'TIER_1',
        priority: 1,
        isActive: true,
      },
    })
    const medication = await prisma.medication.create({
      data: {
        patientId: id,
        name: 'Metformin 500mg',
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
        doseQty: '1 tablet',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'APPROVED',
        isActive: true,
      },
    })

    const result = await activatePatient(db(), {
      patientId: id,
      to: 'ACTIVE',
      claims: claims('NAKES', 'DOKTER'),
      audit,
    })

    expect(result.status).toBe('ACTIVE')
    expect(result.checklist.ready).toBe(true)

    const after = await prisma.patient.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('ACTIVE')
    expect(after.activatedAt).not.toBeNull()
    expect(after.activatedById).toBe(DOKTER_ID)
  })

  it('resep DRAFT tidak memenuhi syarat APPROVED_MEDICATION', async () => {
    const id = await seedOnboardingPatient()
    await prisma.familyContact.create({
      data: {
        patientId: id,
        name: 'Bapak Test',
        phone: '081277700098',
        relationship: 'SAUDARA',
        tier: 'TIER_1',
        priority: 1,
        isActive: true,
      },
    })
    const medication = await prisma.medication.create({
      data: {
        patientId: id,
        name: 'Amlodipine 5mg',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'DRAFT',
      },
    })
    await prisma.schedule.create({
      data: {
        patientId: id,
        medicationId: medication.id,
        timeOfDay: '08:00',
        doseQty: '1 tablet',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'DRAFT',
      },
    })

    await expect(
      activatePatient(db(), {
        patientId: id,
        to: 'ACTIVE',
        claims: claims('NAKES', 'DOKTER'),
        audit,
      }),
    ).rejects.toThrow(/belum memenuhi syarat aktivasi/)

    const after = await prisma.patient.findUniqueOrThrow({ where: { id } })
    expect(after.status).toBe('ONBOARDING')
  })

  it('dispatcher reminder tidak menjadwalkan apa pun untuk pasien ONBOARDING', async () => {
    const id = await seedOnboardingPatient()
    const medication = await prisma.medication.create({
      data: {
        patientId: id,
        name: 'Metformin 500mg',
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
        doseQty: '1 tablet',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        status: 'APPROVED',
        isActive: true,
      },
    })

    const { dispatchDueReminders } = await import('../src/modules/reminders/reminder.scheduler')
    const calls: unknown[] = []
    const queue = {
      name: 'reminder',
      enqueue: async () => 'j',
      schedule: async (payload: unknown) => {
        calls.push(payload)
        return 'j'
      },
      cancel: async () => undefined,
      retry: async () => undefined,
      close: async () => undefined,
    } as any

    const result = await dispatchDueReminders(prisma as any, queue, {
      lookaheadMs: 24 * 60 * 60 * 1000,
    })

    expect(result.scanned).toBe(0)
    expect(result.enqueued).toBe(0)
    expect(calls).toHaveLength(0)

    await prisma.patient.update({ where: { id }, data: { status: 'ACTIVE' } })

    const setelahAktif = await dispatchDueReminders(prisma as any, queue, {
      lookaheadMs: 24 * 60 * 60 * 1000,
    })
    expect(setelahAktif.enqueued).toBe(1)
  })
})
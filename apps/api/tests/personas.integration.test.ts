// Integration smoke test (CL-003): migrate + seed fixture di DB test bersih.
// Dilewati otomatis bila TEST_DATABASE_URL tidak diset (mis. `npm run test` tanpa docker).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { DEMO_IDS, DEMO_PHONES, seedDemoPersonas } from '../prisma/personas'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe.skipIf(!isTestDbConfigured())('fixture persona sintetis di DB test', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
    await resetTestDb(prisma)
    await seedDemoPersonas(prisma)
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  it('memuat dua persona kontras', async () => {
    const patients = await prisma.patient.findMany({ orderBy: { createdAt: 'asc' } })
    expect(patients).toHaveLength(2)

    const buRatna = await prisma.patient.findUniqueOrThrow({
      where: { id: DEMO_IDS.userBuRatna },
      include: { user: true, familyContacts: true, nakesContacts: true },
    })
    expect(buRatna.livingSituation).toBe('ALONE')
    expect(buRatna.emergencyPreference).toBe('NAKES_FIRST')
    expect(buRatna.hasNearbyFamily).toBe(false)
    expect(buRatna.familyContacts.map((c) => c.tier)).toEqual(['TIER_2'])
    expect(buRatna.nakesContacts.some((c) => c.isPrimary)).toBe(true)

    const pakHaji = await prisma.patient.findUniqueOrThrow({
      where: { id: DEMO_IDS.userPakHaji },
      include: { familyContacts: true },
    })
    expect(pakHaji.livingSituation).toBe('WITH_FAMILY')
    expect(pakHaji.familyContacts.map((c) => c.tier)).toEqual(['TIER_1'])
  })

  it('patients.id sama dengan users.id dan berformat uuid', async () => {
    const patient = await prisma.patient.findUniqueOrThrow({
      where: { id: DEMO_IDS.userBuRatna },
      include: { user: true },
    })
    expect(patient.id).toBe(patient.user.id)
    expect(patient.id).toMatch(UUID_V4)
  })

  it('seed idempoten — dijalankan dua kali tidak menggandakan data', async () => {
    await seedDemoPersonas(prisma)
    expect(await prisma.patient.count()).toBe(2)
    expect(await prisma.schedule.count()).toBe(2)
    expect(await prisma.familyContact.count()).toBe(2)
  }, 60_000)

  it('guard idempotency menolak escalation run aktif kedua', async () => {
    const active = {
      patientId: DEMO_IDS.userBuRatna,
      context: 'SCHEDULE' as const,
      status: 'WAITING_PATIENT' as const,
    }
    await prisma.escalationRun.create({ data: active })
    await expect(prisma.escalationRun.create({ data: active })).rejects.toThrow()

    await prisma.escalationRun.updateMany({
      where: { patientId: active.patientId, context: 'SCHEDULE' },
      data: { status: 'RESOLVED' },
    })
    // Setelah run sebelumnya selesai, run baru boleh dibuat.
    await expect(prisma.escalationRun.create({ data: active })).resolves.toBeDefined()
  })

  it('tidak ada data pasien riil — semua nomor HP berasal dari daftar fiktif', async () => {
    const synthetic = new Set<string>(Object.values(DEMO_PHONES))
    const users = await prisma.user.findMany()
    expect(users.length).toBeGreaterThan(0)
    for (const user of users) {
      expect(synthetic).toContain(user.phone)
    }
  })
})

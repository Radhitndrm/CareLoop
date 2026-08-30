// Seed data sintetis untuk demo (data fiktif — UU PDP: tanpa data pasien riil).
// Jalankan: npm run db:seed -w @careloop/api
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// UUID v4 statis supaya seed idempoten dan tetap lolos validator z.string().uuid()
// (docs/DATABASE.md §1: semua id uuid). Nilai sengaja dibuat berpola agar jelas sintetis.
const ID = {
  puskesmasUmbulharjo: '00000000-0000-4000-8000-000000000001',
  userNakesDewi: '00000000-0000-4000-8000-000000000002',
  userBuRatna: '00000000-0000-4000-8000-000000000003',
  userAri: '00000000-0000-4000-8000-000000000004',
  userPakHaji: '00000000-0000-4000-8000-000000000005',
  userSari: '00000000-0000-4000-8000-000000000006',
  nakesContactKaderNuning: '00000000-0000-4000-8000-000000000101',
  medicationMetformin: '00000000-0000-4000-8000-000000000201',
  medicationAmlodipine: '00000000-0000-4000-8000-000000000202',
  scheduleMetforminPagi: '00000000-0000-4000-8000-000000000301',
  scheduleAmlodipinePagi: '00000000-0000-4000-8000-000000000302',
} as const

async function main(): Promise<void> {
  console.log('Seeding data sintetis CareLoop...')

  const puskesmas = await prisma.puskesmas.upsert({
    where: { id: ID.puskesmasUmbulharjo },
    update: {},
    create: {
      id: ID.puskesmasUmbulharjo,
      name: 'Puskesmas Umbulharjo',
      type: 'PUSKESMAS',
      districtCode: '3471',
      address: 'Jl. Parangtritis No.15, Yogyakarta',
      phone: '0274-370478',
      lat: -7.805,
      lng: 110.371,
    },
  })
  console.log('  puskesmas:', puskesmas.name)

  // Nakes (dr. Dewi)
  const nakes = await prisma.user.upsert({
    where: { phone: '081100000001' },
    update: {},
    create: {
      id: ID.userNakesDewi,
      phone: '081100000001',
      fullName: 'dr. Dewi Lestari',
      role: 'NAKES',
      isVerified: true,
      passwordHash: '$2b$12$dummyplaceholderforthepasswordhash000',
    },
  })
  await prisma.nakesAssignment.upsert({
    where: { nakesUserId_puskesmasId_districtCode: { nakesUserId: nakes.id, puskesmasId: puskesmas.id, districtCode: '3471' } },
    update: {},
    create: {
      nakesUserId: nakes.id,
      puskesmasId: puskesmas.id,
      districtCode: '3471',
      scopeType: 'PUSKESMAS',
    },
  })

  // Pasien 1: Bu Ratna — ALONE, keluarga jauh (demo eskalasi bertingkat)
  const buRatnaUser = await prisma.user.upsert({
    where: { phone: '081200000001' },
    update: {},
    create: {
      id: ID.userBuRatna,
      phone: '081200000001',
      fullName: 'Ratna Wijaya',
      role: 'PATIENT',
      isVerified: true,
      consentPdpAt: new Date(),
    },
  })

  // patients.id = users.id (relasi 1:1, docs/DATABASE.md §3.2)
  const buRatna = await prisma.patient.upsert({
    where: { id: buRatnaUser.id },
    update: {},
    create: {
      id: buRatnaUser.id,
      dateOfBirth: new Date('1954-03-12'),
      gender: 'F',
      districtCode: '3471',
      city: 'Yogyakarta',
      livingSituation: 'ALONE',
      hasNearbyFamily: false,
      emergencyPreference: 'NAKES_FIRST',
      healthConditions: ['DIABETES', 'HYPERTENSION'],
      smartwatchEnabled: true,
      voiceEnabled: true,
      riskLevel: 'HIGH',
      riskScore: 82,
      consentShareWithNakes: true,
    },
  })

  // Keluarga: Ari (anak, Tier 2 — jauh)
  const ariUser = await prisma.user.upsert({
    where: { phone: '081300000001' },
    update: {},
    create: {
      id: ID.userAri,
      phone: '081300000001',
      fullName: 'Ari Prasetyo',
      role: 'FAMILY',
      isVerified: true,
      consentPdpAt: new Date(),
    },
  })
  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: buRatna.id, phone: '081300000001' } },
    update: {},
    create: {
      patientId: buRatna.id,
      userId: ariUser.id,
      name: 'Ari Prasetyo',
      phone: '081300000001',
      relationship: 'ANAK',
      tier: 'TIER_2',
      priority: 1,
      isNearby: false,
      canViewHealth: true,
      canReceiveEmergency: true,
    },
  })

  // Nakes contact: kader Nuning (jalur cadangan untuk pasien ALONE)
  await prisma.nakesContact.upsert({
    where: { id: ID.nakesContactKaderNuning },
    update: {},
    create: {
      id: ID.nakesContactKaderNuning,
      patientId: buRatna.id,
      nakesUserId: nakes.id,
      nakesName: 'Nuning (Kader Posyandu)',
      nakesRole: 'KADER',
      phone: '081100000002',
      puskesmasId: puskesmas.id,
      isPrimary: true,
    },
  })

  // Obat & jadwal
  const metformin = await prisma.medication.upsert({
    where: { id: ID.medicationMetformin },
    update: {},
    create: {
      id: ID.medicationMetformin,
      patientId: buRatna.id,
      name: 'Metformin',
      dosage: '500 mg',
      form: 'TABLET',
      instructions: 'Sesudah makan',
      startedAt: new Date('2026-07-01'),
    },
  })

  await prisma.schedule.upsert({
    where: { id: ID.scheduleMetforminPagi },
    update: {},
    create: {
      id: ID.scheduleMetforminPagi,
      patientId: buRatna.id,
      medicationId: metformin.id,
      timeOfDay: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dailyFrequency: 1,
      doseQty: '1 tablet',
      startDate: new Date('2026-07-01'),
      timeWindowMinutes: 30,
    },
  })

  await prisma.medicationStock.upsert({
    where: { patientId_medicationId: { patientId: buRatna.id, medicationId: metformin.id } },
    update: {},
    create: {
      patientId: buRatna.id,
      medicationId: metformin.id,
      quantityRemaining: 7,
      lastRefillAt: new Date('2026-08-09'),
    },
  })

  // Pasien 2: Pak Haji — WITH_FAMILY, ada keluarga dekat (kontras demo)
  const pakHajiUser = await prisma.user.upsert({
    where: { phone: '081200000002' },
    update: {},
    create: {
      id: ID.userPakHaji,
      phone: '081200000002',
      fullName: 'H. Ahmad Subagio',
      role: 'PATIENT',
      isVerified: true,
    },
  })
  const pakHaji = await prisma.patient.upsert({
    where: { id: pakHajiUser.id },
    update: {},
    create: {
      id: pakHajiUser.id,
      dateOfBirth: new Date('1950-09-21'),
      gender: 'M',
      districtCode: '3471',
      city: 'Yogyakarta',
      livingSituation: 'WITH_FAMILY',
      hasNearbyFamily: true,
      healthConditions: ['HYPERTENSION'],
      riskLevel: 'MEDIUM',
      riskScore: 45,
    },
  })
  const sariUser = await prisma.user.upsert({
    where: { phone: '081300000002' },
    update: {},
    create: {
      id: ID.userSari,
      phone: '081300000002',
      fullName: 'Sari Rahmawati',
      role: 'FAMILY',
      isVerified: true,
    },
  })
  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: pakHaji.id, phone: '081300000002' } },
    update: {},
    create: {
      patientId: pakHaji.id,
      userId: sariUser.id,
      name: 'Sari Rahmawati',
      phone: '081300000002',
      relationship: 'KEPONAKAN',
      tier: 'TIER_1',
      priority: 1,
      isNearby: true,
      canViewHealth: true,
      canReceiveEmergency: true,
    },
  })

  const amlodipine = await prisma.medication.upsert({
    where: { id: ID.medicationAmlodipine },
    update: {},
    create: {
      id: ID.medicationAmlodipine,
      patientId: pakHaji.id,
      name: 'Amlodipine',
      dosage: '5 mg',
      form: 'TABLET',
      startedAt: new Date('2026-06-15'),
    },
  })
  await prisma.schedule.upsert({
    where: { id: ID.scheduleAmlodipinePagi },
    update: {},
    create: {
      id: ID.scheduleAmlodipinePagi,
      patientId: pakHaji.id,
      medicationId: amlodipine.id,
      timeOfDay: '07:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dailyFrequency: 1,
      doseQty: '1 tablet',
      startDate: new Date('2026-06-15'),
      timeWindowMinutes: 30,
    },
  })

  console.log('Seed selesai. Data demo: Bu Ratna (ALONE) & Pak Haji (WITH_FAMILY).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

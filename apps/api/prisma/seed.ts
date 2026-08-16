// Seed data sintetis untuk demo (data fiktif — UU PDP: tanpa data pasien riil).
// Jalankan: npm run db:seed -w @careloop/api
import { PrismaClient } from '@prisma/client'
import { fakerID_ID as faker } from '@faker-js/faker'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  console.log('Seeding data sintetis CareLoop...')

  const puskesmas = await prisma.puskesmas.upsert({
    where: { id: 'psk_umbulharjo' },
    update: {},
    create: {
      id: 'psk_umbulharjo',
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
      id: 'u_nakes_dewi',
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
      id: 'u_buratna',
      phone: '081200000001',
      fullName: 'Ratna Wijaya',
      role: 'PATIENT',
      isVerified: true,
      consentPdpAt: new Date(),
    },
  })

  await prisma.patient.upsert({
    where: { id: 'p_buratna' },
    update: {},
    create: {
      id: 'p_buratna',
      userId: buRatnaUser.id,
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
  await prisma.user.upsert({
    where: { phone: '081300000001' },
    update: {},
    create: {
      id: 'u_ari',
      phone: '081300000001',
      fullName: 'Ari Prasetyo',
      role: 'FAMILY',
      isVerified: true,
      consentPdpAt: new Date(),
    },
  })
  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: 'p_buratna', phone: '081300000001' } },
    update: {},
    create: {
      patientId: 'p_buratna',
      userId: 'u_ari',
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
    where: { id: 'nc_kader_nuning' },
    update: {},
    create: {
      id: 'nc_kader_nuning',
      patientId: 'p_buratna',
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
    where: { id: 'med_metformin' },
    update: {},
    create: {
      id: 'med_metformin',
      patientId: 'p_buratna',
      name: 'Metformin',
      dosage: '500 mg',
      form: 'TABLET',
      instructions: 'Sesudah makan',
      startedAt: new Date('2026-07-01'),
    },
  })

  await prisma.schedule.upsert({
    where: { id: 'sch_metformin_pagi' },
    update: {},
    create: {
      id: 'sch_metformin_pagi',
      patientId: 'p_buratna',
      medicationId: metformin.id,
      timeOfDay: '08:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      doseQty: '1 tablet',
      startDate: new Date('2026-07-01'),
      timeWindowMinutes: 30,
    },
  })

  await prisma.medicationStock.upsert({
    where: { patientId_medicationId: { patientId: 'p_buratna', medicationId: metformin.id } },
    update: {},
    create: {
      patientId: 'p_buratna',
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
      id: 'u_pakhaji',
      phone: '081200000002',
      fullName: 'H. Ahmad Subagio',
      role: 'PATIENT',
      isVerified: true,
    },
  })
  await prisma.patient.upsert({
    where: { id: 'p_pakhaji' },
    update: {},
    create: {
      id: 'p_pakhaji',
      userId: pakHajiUser.id,
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
  await prisma.user.upsert({
    where: { phone: '081300000002' },
    update: {},
    create: {
      id: 'u_sari',
      phone: '081300000002',
      fullName: 'Sari Rahmawati',
      role: 'FAMILY',
      isVerified: true,
    },
  })
  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: 'p_pakhaji', phone: '081300000002' } },
    update: {},
    create: {
      patientId: 'p_pakhaji',
      userId: 'u_sari',
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
    where: { id: 'med_amlodipine' },
    update: {},
    create: {
      id: 'med_amlodipine',
      patientId: 'p_pakhaji',
      name: 'Amlodipine',
      dosage: '5 mg',
      form: 'TABLET',
      startedAt: new Date('2026-06-15'),
    },
  })
  await prisma.schedule.upsert({
    where: { id: 'sch_amlodipine_pagi' },
    update: {},
    create: {
      id: 'sch_amlodipine_pagi',
      patientId: 'p_pakhaji',
      medicationId: amlodipine.id,
      timeOfDay: '07:00',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
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

// Persona sintetis CareLoop — dipakai bersama oleh seed demo (seed.ts) dan
// fixture integration test (tests/helpers/test-db.ts).
// UU PDP: seluruh nama, NIK, dan nomor HP di sini fiktif. Jangan pernah isi data pasien riil.
import type { PrismaClient } from '@prisma/client'

// UUID v4 statis supaya seed idempoten dan tetap lolos validator z.string().uuid()
// (docs/DATABASE.md §1). Nilai sengaja berpola agar jelas sintetis.
export const DEMO_IDS = {
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

// Nomor HP fiktif; prefix 0811/0812/0813 + blok nol agar tidak menyerupai nomor riil.
export const DEMO_PHONES = {
  nakesDewi: '081100000001',
  kaderNuning: '081100000002',
  buRatna: '081200000001',
  pakHaji: '081200000002',
  ari: '081300000001',
  sari: '081300000002',
} as const

/**
 * Menulis dua persona kontras untuk demo & test:
 * - Bu Ratna: ALONE + NAKES_FIRST (memicu jalur eskalasi langsung ke nakes)
 * - Pak Haji: WITH_FAMILY (jalur eskalasi keluarga tier 1 lebih dulu)
 * Idempoten (upsert), jadi aman dipanggil berulang.
 */
export async function seedDemoPersonas(prisma: PrismaClient): Promise<void> {
  const puskesmas = await prisma.puskesmas.upsert({
    where: { id: DEMO_IDS.puskesmasUmbulharjo },
    update: {},
    create: {
      id: DEMO_IDS.puskesmasUmbulharjo,
      name: 'Puskesmas Umbulharjo',
      type: 'PUSKESMAS',
      districtCode: '3471',
      address: 'Jl. Parangtritis No.15, Yogyakarta',
      phone: '0274-370478',
      lat: -7.805,
      lng: 110.371,
    },
  })

  const nakes = await prisma.user.upsert({
    where: { phone: DEMO_PHONES.nakesDewi },
    update: {},
    create: {
      id: DEMO_IDS.userNakesDewi,
      phone: DEMO_PHONES.nakesDewi,
      fullName: 'dr. Dewi Lestari',
      role: 'NAKES',
      isVerified: true,
      passwordHash: '$2b$12$dummyplaceholderforthepasswordhash000',
    },
  })

  await prisma.nakesAssignment.upsert({
    where: {
      nakesUserId_puskesmasId_districtCode: {
        nakesUserId: nakes.id,
        puskesmasId: puskesmas.id,
        districtCode: '3471',
      },
    },
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
    where: { phone: DEMO_PHONES.buRatna },
    update: {},
    create: {
      id: DEMO_IDS.userBuRatna,
      phone: DEMO_PHONES.buRatna,
      fullName: 'Ratna Wijaya',
      role: 'PATIENT',
      isVerified: true,
      consentPdpAt: new Date('2026-07-01T00:00:00Z'),
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
    where: { phone: DEMO_PHONES.ari },
    update: {},
    create: {
      id: DEMO_IDS.userAri,
      phone: DEMO_PHONES.ari,
      fullName: 'Ari Prasetyo',
      role: 'FAMILY',
      isVerified: true,
      consentPdpAt: new Date('2026-07-01T00:00:00Z'),
    },
  })

  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: buRatna.id, phone: DEMO_PHONES.ari } },
    update: {},
    create: {
      patientId: buRatna.id,
      userId: ariUser.id,
      name: 'Ari Prasetyo',
      phone: DEMO_PHONES.ari,
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
    where: { id: DEMO_IDS.nakesContactKaderNuning },
    update: {},
    create: {
      id: DEMO_IDS.nakesContactKaderNuning,
      patientId: buRatna.id,
      nakesUserId: nakes.id,
      nakesName: 'Nuning (Kader Posyandu)',
      nakesRole: 'KADER',
      phone: DEMO_PHONES.kaderNuning,
      puskesmasId: puskesmas.id,
      isPrimary: true,
    },
  })

  const metformin = await prisma.medication.upsert({
    where: { id: DEMO_IDS.medicationMetformin },
    update: {},
    create: {
      id: DEMO_IDS.medicationMetformin,
      patientId: buRatna.id,
      name: 'Metformin',
      dosage: '500 mg',
      form: 'TABLET',
      instructions: 'Sesudah makan',
      startedAt: new Date('2026-07-01'),
    },
  })

  await prisma.schedule.upsert({
    where: { id: DEMO_IDS.scheduleMetforminPagi },
    update: {},
    create: {
      id: DEMO_IDS.scheduleMetforminPagi,
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
      lastRefillAt: new Date('2026-08-09T00:00:00Z'),
    },
  })

  // Pasien 2: Pak Haji — WITH_FAMILY, ada keluarga dekat (kontras demo)
  const pakHajiUser = await prisma.user.upsert({
    where: { phone: DEMO_PHONES.pakHaji },
    update: {},
    create: {
      id: DEMO_IDS.userPakHaji,
      phone: DEMO_PHONES.pakHaji,
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
    where: { phone: DEMO_PHONES.sari },
    update: {},
    create: {
      id: DEMO_IDS.userSari,
      phone: DEMO_PHONES.sari,
      fullName: 'Sari Rahmawati',
      role: 'FAMILY',
      isVerified: true,
    },
  })

  await prisma.familyContact.upsert({
    where: { patientId_phone: { patientId: pakHaji.id, phone: DEMO_PHONES.sari } },
    update: {},
    create: {
      patientId: pakHaji.id,
      userId: sariUser.id,
      name: 'Sari Rahmawati',
      phone: DEMO_PHONES.sari,
      relationship: 'KEPONAKAN',
      tier: 'TIER_1',
      priority: 1,
      isNearby: true,
      canViewHealth: true,
      canReceiveEmergency: true,
    },
  })

  const amlodipine = await prisma.medication.upsert({
    where: { id: DEMO_IDS.medicationAmlodipine },
    update: {},
    create: {
      id: DEMO_IDS.medicationAmlodipine,
      patientId: pakHaji.id,
      name: 'Amlodipine',
      dosage: '5 mg',
      form: 'TABLET',
      startedAt: new Date('2026-06-15'),
    },
  })

  await prisma.schedule.upsert({
    where: { id: DEMO_IDS.scheduleAmlodipinePagi },
    update: {},
    create: {
      id: DEMO_IDS.scheduleAmlodipinePagi,
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
}

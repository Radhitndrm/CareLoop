// Persona sintetis CareLoop — dipakai bersama oleh seed demo (seed.ts) dan
// fixture integration test (tests/helpers/test-db.ts).
// UU PDP: seluruh nama, NIK, dan nomor HP di sini fiktif. Jangan pernah isi data pasien riil.
import type { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

// UUID v4 statis supaya seed idempoten dan tetap lolos validator z.string().uuid()
// (docs/DATABASE.md §1). Nilai sengaja berpola agar jelas sintetis.
export const DEMO_IDS = {
  puskesmasUmbulharjo: '00000000-0000-4000-8000-000000000001',
  userNakesDewi: '00000000-0000-4000-8000-000000000002',
  userBuRatna: '00000000-0000-4000-8000-000000000003',
  userAri: '00000000-0000-4000-8000-000000000004',
  userPakHaji: '00000000-0000-4000-8000-000000000005',
  userSari: '00000000-0000-4000-8000-000000000006',
  userAdminDinkes: '00000000-0000-4000-8000-000000000007',
  userPerawatNuning: '00000000-0000-4000-8000-000000000008',
  userApoteker: '00000000-0000-4000-8000-000000000009',
  nakesContactKaderNuning: '00000000-0000-4000-8000-000000000101',
  medicationMetformin: '00000000-0000-4000-8000-000000000201',
  medicationAmlodipine: '00000000-0000-4000-8000-000000000202',
  scheduleMetforminPagi: '00000000-0000-4000-8000-000000000301',
  scheduleAmlodipinePagi: '00000000-0000-4000-8000-000000000302',
  // Permintaan obat demo untuk antrean farmasi (docs/API.md §3.6).
  // Satu per status supaya semua tab antrean terisi saat demo dibuka.
  requestRatnaQueued: '00000000-0000-4000-8000-000000000401',
  requestHajiReady: '00000000-0000-4000-8000-000000000402',
  requestRatnaPendingDoctor: '00000000-0000-4000-8000-000000000403',
  requestHajiOverdue: '00000000-0000-4000-8000-000000000404',
  // Obat kedua Bu Ratna — dipakai supaya request PENDING_DOCTOR tidak
  // bertabrakan dengan request QUEUED-nya (satu request aktif per pasien+obat).
  medicationStatin: '00000000-0000-4000-8000-000000000203',
  medicationSecondHaji: '00000000-0000-4000-8000-000000000204',
} as const

// Nomor HP fiktif; prefix 0811/0812/0813 + blok nol agar tidak menyerupai nomor riil.
export const DEMO_PHONES = {
  nakesDewi: '081100000001',
  kaderNuning: '081100000002',
  adminDinkes: '081100000003',
  perawatNuning: '081100000004',
  apoteker: '081100000005',
  buRatna: '081200000001',
  pakHaji: '081200000002',
  ari: '081300000001',
  sari: '081300000002',
} as const

// Kata sandi akun nakes demo. Bukan secret produksi: seluruh isi file ini data
// sintetis untuk demo & test, dan hash-nya dibangkitkan saat seed berjalan.
// Dipakai juga di docs/API.md §2 sebagai contoh login.
export const DEMO_NAKES_PASSWORD = 'CareLoop#Demo2026'

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

  // Hash dibangkitkan saat seed agar akun demo benar-benar bisa login (CL-006).
  const nakesPasswordHash = await hashPassword(DEMO_NAKES_PASSWORD)

  const nakes = await prisma.user.upsert({
    where: { phone: DEMO_PHONES.nakesDewi },
    // nakesRole ikut di-update: peran klinis menentukan boleh/tidaknya menyetujui
    // resep, jadi seed lama harus ikut kalau persona berubah (docs/API.md §3.2).
    update: { passwordHash: nakesPasswordHash, nakesRole: 'DOKTER' },
    create: {
      id: DEMO_IDS.userNakesDewi,
      phone: DEMO_PHONES.nakesDewi,
      fullName: 'dr. Dewi Lestari',
      role: 'NAKES',
      staffStatus: 'ACTIVE',
      // dr. Dewi berwenang menyetujui resep & menetapkan ambang detak jantung.
      nakesRole: 'DOKTER',
      isVerified: true,
      passwordHash: nakesPasswordHash,
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

  // Admin Dinkes — sibling role di domain yang wajib terisi (Tahap 4 alur) dan
  // hanya admin yang boleh membuat akun nakes. Tidak punya wilayah: aksesnya global.
  await prisma.user.upsert({
    where: { phone: DEMO_PHONES.adminDinkes },
    update: { passwordHash: nakesPasswordHash },
    create: {
      id: DEMO_IDS.userAdminDinkes,
      phone: DEMO_PHONES.adminDinkes,
      fullName: 'Dinkes Kota (Admin)',
      role: 'ADMIN',
      isVerified: true,
      passwordHash: nakesPasswordHash,
    },
  })

  // Perawat — contoh peran yang BOLEH membuat draft resep tetapi tidak boleh
  // menyetakannya. Dipakai demo perbedaan kewenangan klinis (docs/API.md §3.2).
  const perawat = await prisma.user.upsert({
    where: { phone: DEMO_PHONES.perawatNuning },
    update: { passwordHash: nakesPasswordHash, nakesRole: 'PERAWAT' },
    create: {
      id: DEMO_IDS.userPerawatNuning,
      phone: DEMO_PHONES.perawatNuning,
      fullName: 'Nining Rahma (Perawat)',
      role: 'NAKES',
      staffStatus: 'ACTIVE',
      nakesRole: 'PERAWAT',
      isVerified: true,
      passwordHash: nakesPasswordHash,
    },
  })

  await prisma.nakesAssignment.upsert({
    where: {
      nakesUserId_puskesmasId_districtCode: {
        nakesUserId: perawat.id,
        puskesmasId: puskesmas.id,
        districtCode: '3471',
      },
    },
    update: {},
    create: {
      nakesUserId: perawat.id,
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
      // Persona demo harus bisa menjalankan reminder end-to-end saat di-seed, jadi
      // sudah dianggap selesai onboarding dan aktif (prasyarat aktivasi lengkap).
      status: 'ACTIVE',
      primaryPuskesmasId: DEMO_IDS.puskesmasUmbulharjo,
      activatedAt: new Date('2026-07-01T00:00:00Z'),
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
      // Demo ini merepresentasikan resep yang sudah disahkan dokter; tanpa ini
      // jadwalnya tetap DRAFT dan tidak pernah memicu reminder (docs/API.md §3.2).
      status: 'APPROVED',
      approvedById: nakes.id,
      isActive: true,
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
      status: 'APPROVED',
      isActive: true,
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
      status: 'ACTIVE',
      primaryPuskesmasId: DEMO_IDS.puskesmasUmbulharjo,
      activatedAt: new Date('2026-07-01T00:00:00Z'),
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
      status: 'APPROVED',
      approvedById: nakes.id,
      isActive: true,
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
      status: 'APPROVED',
      isActive: true,
    },
  })

  // Obat kedua tiap pasien demo. Partial unique index MedicationRequest_active_key
  // hanya mengizinkan SATU request aktif per pasangan pasien+obat, jadi mengisi
  // beberapa tab antrean untuk satu pasien butuh lebih dari satu obat.
  const statin = await prisma.medication.upsert({
    where: { id: DEMO_IDS.medicationStatin },
    update: {},
    create: {
      id: DEMO_IDS.medicationStatin,
      patientId: buRatna.id,
      name: 'Simvastatin',
      dosage: '10 mg',
      form: 'TABLET',
      instructions: 'Malam hari',
      startedAt: new Date('2026-07-01'),
      status: 'APPROVED',
      approvedById: nakes.id,
      isActive: true,
      daysSupply: 30,
    },
  })

  const amlodipineSecond = await prisma.medication.upsert({
    where: { id: DEMO_IDS.medicationSecondHaji },
    update: {},
    create: {
      id: DEMO_IDS.medicationSecondHaji,
      patientId: pakHaji.id,
      name: 'Telmisartan',
      dosage: '40 mg',
      form: 'TABLET',
      instructions: 'Pagi sebelum makan',
      startedAt: new Date('2026-06-15'),
      status: 'APPROVED',
      approvedById: nakes.id,
      isActive: true,
      daysSupply: 30,
    },
  })

  await seedPharmacyDemo(prisma, {
    puskesmasId: puskesmas.id,
    apotekerId: DEMO_IDS.userApoteker,
    dokterId: nakes.id,
    metforminId: metformin.id,
    statinId: statin.id,
    amlodipineId: amlodipine.id,
    amlodipineSecondId: amlodipineSecond.id,
    buRatnaId: buRatna.id,
    pakHajiId: pakHaji.id,
    /** Waktu relatif supaya demo tetap relevan kapan pun seed dijalankan. */
    now: new Date(),
  })
}

/**
 * Persona farmasi (docs/API.md §3.6).
 *
 * Satu akun apoteker + antrean yang isi setiap tab, supaya demo bisa langsung
 * dibuka tanpa harus menjalankan alur dari awal. Tanggal sengaja dihitung
 * relatif terhadap `now` supaya "terlambat" tetap terlihat Acoustic
 * berapa pun tanggal seed dijalankan.
 */
async function seedPharmacyDemo(
  prisma: PrismaClient,
  ctx: {
    puskesmasId: string
    apotekerId: string
    dokterId: string
    metforminId: string
    statinId: string
    amlodipineId: string
    amlodipineSecondId: string
    buRatnaId: string
    pakHajiId: string
    now: Date
  },
): Promise<void> {
  const { now } = ctx
  const day = (offset: number): Date => {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() + offset)
    d.setUTCHours(0, 0, 0, 0)
    return d
  }

  // Apoteker — satu-satunya peran yang boleh menyiapkan & menyerahkan obat.
  // NakesRole.FARMASI, bukan role baru: akun tetap punya scope puskesmas
  // dan tetap tidak bisa menyetujui permintaan obat.
  await prisma.user.upsert({
    where: { phone: DEMO_PHONES.apoteker },
    update: { passwordHash: await hashPassword(DEMO_NAKES_PASSWORD), nakesRole: 'FARMASI' },
    create: {
      id: DEMO_IDS.userApoteker,
      phone: DEMO_PHONES.apoteker,
      fullName: 'Rina Puspita (Apoteker)',
      role: 'NAKES',
      staffStatus: 'ACTIVE',
      nakesRole: 'FARMASI',
      isVerified: true,
      passwordHash: await hashPassword(DEMO_NAKES_PASSWORD),
    },
  })

  const puskesmas = await prisma.puskesmas.findUnique({ where: { id: ctx.puskesmasId } })
  if (!puskesmas) return

  await prisma.nakesAssignment.upsert({
    where: {
      nakesUserId_puskesmasId_districtCode: {
        nakesUserId: ctx.apotekerId,
        puskesmasId: ctx.puskesmasId,
        districtCode: '3471',
      },
    },
    update: {},
    create: {
      nakesUserId: ctx.apotekerId,
      puskesmasId: ctx.puskesmasId,
      districtCode: '3471',
      scopeType: 'PUSKESMAS',
    },
  })

  // daysSupply + nextPickupAt diisi supaya scheduler rutin punya bahan baku.
  await prisma.medication.updateMany({
    where: { id: { in: [ctx.metforminId, ctx.statinId, ctx.amlodipineId, ctx.amlodipineSecondId] } },
    data: { daysSupply: 30, nextPickupAt: day(21) },
  })

  const requests: Array<{
    id: string
    patientId: string
    medicationId: string
    source: 'ROUTINE' | 'PATIENT_REQUEST'
    status: 'QUEUED' | 'PREPARING' | 'READY' | 'PENDING_DOCTOR'
    dueOffset: number
    quantity: number
    reasonCode?: 'EARLY_PICKUP' | 'MEDICATION_LOST'
    reasonNotes?: string
  }> = [
    {
      id: DEMO_IDS.requestRatnaQueued,
      patientId: ctx.buRatnaId,
      medicationId: ctx.metforminId,
      source: 'ROUTINE',
      status: 'QUEUED',
      dueOffset: 2,
      quantity: 30,
    },
    {
      id: DEMO_IDS.requestHajiReady,
      patientId: ctx.pakHajiId,
      medicationId: ctx.amlodipineId,
      source: 'ROUTINE',
      status: 'READY',
      dueOffset: 1,
      quantity: 30,
    },
    {
      id: DEMO_IDS.requestHajiOverdue,
      patientId: ctx.pakHajiId,
      medicationId: ctx.amlodipineSecondId,
      source: 'PATIENT_REQUEST',
      status: 'PREPARING',
      dueOffset: -4,
      quantity: 10,
      reasonCode: 'EARLY_PICKUP',
      reasonNotes: 'Stok di rumah tinggal 2 hari',
    },
    {
      id: DEMO_IDS.requestRatnaPendingDoctor,
      patientId: ctx.buRatnaId,
      medicationId: ctx.statinId,
      source: 'PATIENT_REQUEST',
      status: 'PENDING_DOCTOR',
      dueOffset: 3,
      quantity: 30,
      reasonCode: 'MEDICATION_LOST',
      reasonNotes: 'Kotak obat basah terkena air',
    },
  ]

  for (const request of requests) {
    await prisma.medicationRequest.upsert({
      where: { id: request.id },
      update: {},
      create: {
        id: request.id,
        patientId: request.patientId,
        medicationId: request.medicationId,
        requestedQuantity: request.quantity,
        // Permintaan rutin sudah membawa persetujuan dokter lewat resepnya,
        // jadi approvedQuantity langsung terisi tanpa menunggu dokter.
        approvedQuantity: request.source === 'ROUTINE' ? request.quantity : null,
        source: request.source,
        status: request.status,
        reasonCode: request.reasonCode ?? null,
        reasonNotes: request.reasonNotes ?? null,
        dueAt: day(request.dueOffset),
        doctorId: request.source === 'ROUTINE' ? ctx.dokterId : null,
        decidedAt: request.source === 'ROUTINE' ? now : null,
      },
    })

    await prisma.medicationRequestEvent.upsert({
      where: { id: `event-${request.id}` },
      update: {},
      create: {
        id: `event-${request.id}`,
        requestId: request.id,
        fromStatus: null,
        toStatus: request.status,
        action: 'CREATED',
        actorUserId: request.source === 'ROUTINE' ? null : request.patientId,
        note: request.reasonNotes ?? 'Permintaan rutin otomatis dari jadwal pengambilan',
      },
    })
  }

  void puskesmas
}

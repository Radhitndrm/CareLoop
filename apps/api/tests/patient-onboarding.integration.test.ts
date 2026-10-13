// Integration test onboarding pasien (Fase C).
//
// Mengunci dua hal yang paling rawan:
//
// 1. **Duplikasi dicek sebelum create.** Pencarian mengembalikan kecocokan terbatas:
//    patients di luar scope nakes muncul sebagai konflik tanpa nama/id, supaya operator
//    tahu harus meng escalate ke admin tanpa mendapat akses ke record itu.
// 2. **Tidak ada fallback sukses palsu.** Kirim ulang instruksi OTP tidak pernah
//    menandai pasien sebagai terverifikasi, dan cooldown OTP ditegakkan.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createTestPrisma, isTestDbConfigured, migrateTestDb, resetTestDb, teardownTestDb } from './helpers/test-db'
import { createPatient } from '../src/modules/patients/patients.service'
import {
  linkClinic,
  lookupExisting,
  maskPhone,
  normalizePhone,
  phoneVariants,
  sendVerificationInstructions,
  type OnboardingPrismaClient,
} from '../src/modules/patients/onboarding.service'
import { setOtpStore, InMemoryOtpStore } from '../src/modules/auth/otp.service'

const CLINIC_A = '00000000-0000-4000-8000-0000000000e1'
const CLINIC_B = '00000000-0000-4000-8000-0000000000e2'
const NAKES_A = '00000000-0000-4000-8000-0000000000e3'
const NAKES_B = '00000000-0000-4000-8000-0000000000e4'
const ADMIN_ID = '00000000-0000-4000-8000-0000000000e5'
const FAMILY_PHONE = '081190000001'

const claimsA = { sub: NAKES_A, role: 'NAKES', nakesRole: 'PERAWAT' } as any
const claimsB = { sub: NAKES_B, role: 'NAKES', nakesRole: 'PERAWAT' } as any
const claimsAdmin = { sub: ADMIN_ID, role: 'ADMIN' } as any

describe.skipIf(!isTestDbConfigured())('Fase C — onboarding pasien', () => {
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
    setOtpStore(new InMemoryOtpStore())

    await prisma.puskesmas.createMany({
      data: [
        { id: CLINIC_A, name: 'Puskesmas Timur', districtCode: '3471' },
        { id: CLINIC_B, name: 'Puskesmas Barat', districtCode: '3472' },
      ],
    })

    await prisma.user.createMany({
      data: [
        { id: NAKES_A, phone: '081180000001', fullName: 'Perawat Timur', role: 'NAKES', nakesRole: 'PERAWAT', staffStatus: 'ACTIVE' },
        { id: NAKES_B, phone: '081180000002', fullName: 'Perawat Barat', role: 'NAKES', nakesRole: 'PERAWAT', staffStatus: 'ACTIVE' },
        { id: ADMIN_ID, phone: '081180000003', fullName: 'Admin', role: 'ADMIN', isVerified: true },
        // Akun keluarga, bukan pasien: dipakai untuk menguji konflik "bukan pasien".
        { id: '00000000-0000-4000-8000-0000000000e6', phone: '081177700007', fullName: 'Keluarga Test', role: 'FAMILY', isVerified: true },
      ],
    })

    await prisma.nakesAssignment.createMany({
      data: [
        { nakesUserId: NAKES_A, puskesmasId: CLINIC_A, scopeType: 'PUSKESMAS', isActive: true },
        { nakesUserId: NAKES_A, districtCode: '3471', scopeType: 'DISTRICT', isActive: true },
        { nakesUserId: NAKES_B, puskesmasId: CLINIC_B, scopeType: 'PUSKESMAS', isActive: true },
      ],
    })
  })

  const db = () => prisma as unknown as OnboardingPrismaClient

  async function seedPatient(phone: string, clinicId: string | null, nik?: string) {
    const id = crypto.randomUUID()
    await prisma.user.create({
      data: { id, phone, fullName: `Pasien ${phone.slice(-4)}`, role: 'PATIENT' },
    })
    await prisma.patient.create({
      data: {
        id,
        districtCode: clinicId === CLINIC_B ? '3472' : '3471',
        healthConditions: ['DIABETES'],
        primaryPuskesmasId: clinicId,
        ...(nik ? { nik } : {}),
      },
    })
    return id
  }

  // ------------------------------------------------------------ lookup

  describe('pencarian duplikasi', () => {
    it('melaporkan kecocokan lengkap untuk pasien dalam scope sendiri', async () => {
      const id = await seedPatient('081166600001', CLINIC_A)

      const result = await lookupExisting(db(), { claims: claimsA, phone: '081166600001' })

      expect(result.matches).toHaveLength(1)
      expect(result.matches[0]).toMatchObject({
        kind: 'IN_SCOPE',
        patientId: id,
        matchedOn: 'PHONE',
        status: 'ONBOARDING',
        primaryClinicName: 'Puskesmas Timur',
      })
      expect(result.hasConflict).toBe(false)
    })

    it('menyembunyikan nama & id pasien di luar scope tapi tetap menandai konflik', async () => {
      await seedPatient('081166600002', CLINIC_B)

      const result = await lookupExisting(db(), { claims: claimsA, phone: '081166600002' })

      expect(result.hasConflict).toBe(true)
      expect(result.matches[0]).toMatchObject({ kind: 'OUT_OF_SCOPE', patientId: null, fullName: null })
      expect(result.matches[0].hint).toMatch(/admin/i)
    })

    it('admin melihat semua patients tanpa dibatasi scope', async () => {
      const id = await seedPatient('081166600003', CLINIC_B)

      const result = await lookupExisting(db(), { claims: claimsAdmin, phone: '081166600003' })

      expect(result.matches[0]).toMatchObject({ kind: 'IN_SCOPE', patientId: id })
    })

    it('membedakan akun non-pasien agar operator tidak mengubah role sendiri', async () => {
      const result = await lookupExisting(db(), { claims: claimsA, phone: '081177700007' })

      expect(result.matches[0].kind).toBe('NOT_A_PATIENT')
      expect(result.hasConflict).toBe(true)
      expect(result.matches[0].hint).toMatch(/jangan mengubah peran/i)
    })

    it('cari berdasarkan NIK dan menandai kriteria yang cocok', async () => {
      await seedPatient('081166600004', CLINIC_A, '3401010101010001')

      const result = await lookupExisting(db(), {
        claims: claimsA,
        nik: '3401010101010001',
      })

      expect(result.matches[0]).toMatchObject({ kind: 'IN_SCOPE', matchedOn: 'NIK' })
    })

    it('satu akun yang cocok pada nomor dan NIK tetap menghasilkan satu entri', async () => {
      await seedPatient('081166600005', CLINIC_A, '3401010101010002')

      const result = await lookupExisting(db(), {
        claims: claimsA,
        phone: '081166600005',
        nik: '3401010101010002',
      })

      expect(result.matches).toHaveLength(1)
    })

    it('menandai NIK sebagai kriteria yang cocok bila hanya NIK yang sama', async () => {
      await seedPatient('081166600007', CLINIC_A, '3401010101010003')

      const result = await lookupExisting(db(), {
        claims: claimsA,
        phone: '081166600999',
        nik: '3401010101010003',
      })

      expect(result.matches[0]).toMatchObject({ kind: 'IN_SCOPE', matchedOn: 'NIK' })
    })

    it('menemukan akun yang tersimpan dengan format 62 saat operator mengetik 08', async () => {
      // Akun tersimpan sebagai "628166600010", operator mengetik "08166600010".
      await seedPatient('628166600010', CLINIC_A)

      const result = await lookupExisting(db(), { claims: claimsA, phone: '08166600010' })

      expect(result.matches[0]).toMatchObject({ kind: 'IN_SCOPE', matchedOn: 'PHONE' })
    })

    it('menemukan akun yang tersimpan dengan format 08 saat operator mengetik 62', async () => {
      await seedPatient('08166600011', CLINIC_A)

      const result = await lookupExisting(db(), { claims: claimsA, phone: '+628166600011' })

      expect(result.matches[0]).toMatchObject({ kind: 'IN_SCOPE', matchedOn: 'PHONE' })
    })

    it('tidak menampilkan nomor penuh di respons', async () => {
      await seedPatient('081166600006', CLINIC_A)

      const result = await lookupExisting(db(), { claims: claimsA, phone: '081166600006' })

      expect(result.matches[0].maskedPhone).toBe('********0006')
      expect(result.matches[0].maskedPhone).not.toContain('0811666')
    })

    it('nomor yang belum dipakai menghasilkan daftar kosong, bukan konflik', async () => {
      const result = await lookupExisting(db(), { claims: claimsA, phone: '081166699999' })

      expect(result).toEqual({ hasConflict: false, matches: [] })
    })

    it('permintaan tanpa phone maupun nik tidak melakukan apa-apa', async () => {
      const result = await lookupExisting(db(), { claims: claimsA })
      expect(result.matches).toEqual([])
    })
  })

  describe('normalisasi nomor', () => {
    it('menyamakan format 08, 62, dan +62 ke bentuk kanonik', () => {
      expect(normalizePhone('081234567890')).toBe('6281234567890')
      expect(normalizePhone('+6281234567890')).toBe('6281234567890')
      expect(normalizePhone('6281234567890')).toBe('6281234567890')
    })

    it('menghasilkan varian yang tried', () => {
      expect(phoneVariants('081234567890').sort()).toEqual(['081234567890', '6281234567890'])
    })

    it('mengembalikan array kosong untuk input kosong', () => {
      expect(phoneVariants('')).toEqual([])
    })
  })

  describe('maskPhone', () => {
    it('menyembunyikan semua digit kecuali empat terakhir', () => {
      expect(maskPhone('081234567890')).toBe('********7890')
    })

    it('menangani nomor pendek tanpa membocorkan isi', () => {
      expect(maskPhone('1234')).toBe('****')
    })
  })

  // --------------------------------------------------------- link clinic

  describe('menautkan puskesmas', () => {
    it('nakes menautkan pasien scope-nya ke puskesmas penugasannya', async () => {
      const id = await seedPatient('081166700001', null)

      const result = await linkClinic(db(), {
        patientId: id,
        clinicId: CLINIC_A,
        claims: claimsA,
        audit: {},
      })

      expect(result.primaryPuskesmasName).toBe('Puskesmas Timur')
      const stored = await prisma.patient.findUniqueOrThrow({ where: { id } })
      expect(stored.primaryPuskesmasId).toBe(CLINIC_A)
    })

    it('menolak puskesmas di luar penugasan', async () => {
      const id = await seedPatient('081166700002', null)

      await expect(
        linkClinic(db(), {
          patientId: id,
          clinicId: CLINIC_B,
          claims: claimsA,
          audit: {},
        }),
      ).rejects.toThrow(/di luar wilayah penugasan/i)
    })

    it('admin boleh menautkan ke puskesmas mana pun', async () => {
      const id = await seedPatient('081166700003', null)

      const result = await linkClinic(db(), {
        patientId: id,
        clinicId: CLINIC_B,
        claims: claimsAdmin,
        audit: {},
      })

      expect(result.primaryPuskesmasName).toBe('Puskesmas Barat')
    })

    it('menolak puskesmas yang sedang nonaktif', async () => {
      await prisma.puskesmas.update({ where: { id: CLINIC_B }, data: { isActive: false } })
      const id = await seedPatient('081166700004', null)

      await expect(
        linkClinic(db(), { patientId: id, clinicId: CLINIC_B, claims: claimsAdmin, audit: {} }),
      ).rejects.toThrow(/tidak aktif/i)
    })
  })

  // --------------------------------------------------- verifikasi OTP

  describe('instruksi verifikasi WhatsApp', () => {
    it('mengirim instruksi tanpa menandai pasien terverifikasi', async () => {
      const id = await seedPatient('081166800001', CLINIC_A)

      const result = await sendVerificationInstructions(db(), {
        patientId: id,
        claims: claimsA,
        audit: {},
        now: () => 1_000_000,
      })

      expect(result.instructionsSent).toBe(true)
      expect(result.maskedPhone).toBe('********0001')

      const stored = await prisma.user.findUniqueOrThrow({ where: { id } })
      expect(stored.isVerified).toBe(false)
    })

    it('patient tetap ONBOARDING setelah instruksi dikirim', async () => {
      const id = await seedPatient('081166800002', CLINIC_A)

      await sendVerificationInstructions(db(), {
        patientId: id,
        claims: claimsA,
        audit: {},
        now: () => 2_000_000,
      })

      const stored = await prisma.patient.findUniqueOrThrow({ where: { id } })
      expect(stored.status).toBe('ONBOARDING')
    })

    it('menegakkan cooldown, sama seperti login OTP', async () => {
      const id = await seedPatient('081166800003', CLINIC_A)

      await sendVerificationInstructions(db(), {
        patientId: id,
        claims: claimsA,
        audit: {},
        now: () => 3_000_000,
      })

      await expect(
        sendVerificationInstructions(db(), {
          patientId: id,
          claims: claimsA,
          audit: {},
          now: () => 3_005_000,
        }),
      ).rejects.toThrow(/Tunggu/i)
    })

    it('berhasil mengirim ulang setelah cooldown lewat', async () => {
      const id = await seedPatient('081166800004', CLINIC_A)

      await sendVerificationInstructions(db(), {
        patientId: id,
        claims: claimsA,
        audit: {},
        now: () => 4_000_000,
      })
      await sendVerificationInstructions(db(), {
        patientId: id,
        claims: claimsA,
        audit: {},
        now: () => 4_120_000,
      })

      const stored = await prisma.user.findUniqueOrThrow({ where: { id } })
      expect(stored.isVerified).toBe(false)
    })

    it('menolak nomor yang sudah terverifikasi', async () => {
      const id = await seedPatient('081166800005', CLINIC_A)
      await prisma.user.update({ where: { id }, data: { isVerified: true } })

      await expect(
        sendVerificationInstructions(db(), {
          patientId: id,
          claims: claimsA,
          audit: {},
          now: () => 5_000_000,
        }),
      ).rejects.toThrow(/sudah terverifikasi/i)
    })

    it('nakes lain tidak bisa mengirim instruksi untuk pasien luar scope-nya', async () => {
      const id = await seedPatient('081166800006', CLINIC_A)

      await expect(
        sendVerificationInstructions(db(), {
          patientId: id,
          claims: claimsB,
          audit: {},
          now: () => 6_000_000,
        }),
      ).rejects.toThrow()
    })
  })

  // --------------------------------------------- integrasi dengan create

  describe('create lalu lookup', () => {
    it('pasien yang baru dibuat langsung terdeteksi sebagai duplikasi', async () => {
      const created = await createPatient(db(), {
        input: {
          fullName: 'Bu Gigi Test',
          phone: '081166900001',
          districtCode: '3471',
          puskesmasId: CLINIC_A,
          healthConditions: ['DIABETES'],
          consentShareWithNakes: true,
        },
        claims: claimsA,
        audit: {},
      })

      expect(created.status).toBe('ONBOARDING')

      const lookup = await lookupExisting(db(), { claims: claimsA, phone: '081166900001' })
      expect(lookup.matches[0]).toMatchObject({ kind: 'IN_SCOPE', patientId: created.id })
    })
  })
})
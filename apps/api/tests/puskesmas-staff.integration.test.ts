// Integration test master data puskesmas & manajemen staf (Fase B).
//
// Yang dijaga:
//   1. NAKES hanya melihat pus œuvettes dalam penugasannya — inilah yang membuat form
//      pendaftaran pasien tidak bisa menunjuk ke puskesmas yang tak terlihat.
//   2. Akun + penugasan staf dibuat dalam satu transaksi, dan staf tanpa penugasan
//      tidak boleh pernah ada.
//   3. Siklus INVITED -> ACTIVE -> SUSPENDED hanya boleh lewat kode aktivasi yang benar.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { nakesAssignmentSchema } from '@careloop/shared'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'
import * as clinics from '../src/modules/puskesmas/puskesmas.service'
import * as staff from '../src/modules/admin/admin.service'

const CLINIC_A = '00000000-0000-4000-8000-0000000000b1'
const CLINIC_B = '00000000-0000-4000-8000-0000000000b2'
const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad'

const nakes = (id: string, nakesRole = 'PERAWAT') => ({ sub: id, role: 'NAKES', nakesRole }) as any
const admin = () => ({ sub: ADMIN_ID, role: 'ADMIN' }) as any

describe.skipIf(!isTestDbConfigured())('Fase B — puskesmas & staf', () => {
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
        { id: CLINIC_A, name: 'Puskesmas A', districtCode: '3471', isActive: true },
        { id: CLINIC_B, name: 'Puskesmas B', districtCode: '3472', isActive: true },
      ],
    })

    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        phone: '08110000901',
        fullName: 'Admin Test',
        role: 'ADMIN',
        isVerified: true,
      },
    })

    const nakesId = '00000000-0000-4000-8000-0000000000c1'
    await prisma.user.create({
      data: {
        id: nakesId,
        phone: '08110000902',
        fullName: 'Perawat Satu',
        role: 'NAKES',
        nakesRole: 'PERAWAT',
        staffStatus: 'ACTIVE',
        isVerified: true,
      },
    })
    await prisma.nakesAssignment.create({
      data: { nakesUserId: nakesId, puskesmasId: CLINIC_A, scopeType: 'PUSKESMAS', isActive: true },
    })
  })

  const clinicClient = () => prisma as unknown as clinics.ClinicClient
  const staffClient = () => prisma as unknown as staff.StaffClient

  // -------------------------------------------------------------- puskesmas

  describe('daftar puskesmas', () => {
    it('NAKES hanya melihat puskesmas dalam penugasannya', async () => {
      const result = await clinics.list(clinicClient(), {
        claims: nakes('00000000-0000-4000-8000-0000000000c1'),
      })

      expect(result.items.map((c: { id: string }) => c.id)).toEqual([CLINIC_A])
    })

    it('ADMIN melihat seluruh puskesmas', async () => {
      const result = await clinics.list(clinicClient(), { claims: admin() })

      expect(result.items.map((c: { id: string }) => c.id).sort()).toEqual([CLINIC_A, CLINIC_B].sort())
    })

    it('NAKES tanpa penugasan melihat daftar kosong, bukan semuanya', async () => {
      const tanpaTugas = '00000000-0000-4000-8000-0000000000c9'
      await prisma.user.create({
        data: {
          id: tanpaTugas,
          phone: '08110000909',
          fullName: 'Perawat Tanpa Tugas',
          role: 'NAKES',
          nakesRole: 'PERAWAT',
          staffStatus: 'ACTIVE',
        },
      })

      const result = await clinics.list(clinicClient(), { claims: nakes(tanpaTugas) })

      expect(result.items).toHaveLength(0)
    })

    it('puskesmas nonaktif disembunyikan kecuali diminta eksplisit', async () => {
      await prisma.puskesmas.update({ where: { id: CLINIC_B }, data: { isActive: false } })

      const visible = await clinics.list(clinicClient(), { claims: admin() })
      expect(visible.items.map((c: { id: string }) => c.id)).toEqual([CLINIC_A])

      const semua = await clinics.list(clinicClient(), {
        claims: admin(),
        includeInactive: true,
      })
      expect(semua.items.map((c: { id: string }) => c.id).sort()).toEqual([CLINIC_A, CLINIC_B].sort())
    })

    it('menghasilkan daftar wilayah dari puskesmas yang terlihat', async () => {
      const result = await clinics.listDistricts(clinicClient(), { claims: admin() })

      expect(result.items).toEqual([
        { code: '3471', clinicCount: 1 },
        { code: '3472', clinicCount: 1 },
      ])
    })
  })

  describe('CRUD puskesmas', () => {
    it('membuat puskesmas baru', async () => {
      const created = await clinics.create(clinicClient(), {
        input: { name: 'Puskesmas Baru', districtCode: '3473' },
        actorUserId: ADMIN_ID,
      })

      expect(created.name).toBe('Puskesmas Baru')
      expect(created.isActive).toBe(true)
    })

    it('menolak nama ganda dalam wilayah yang sama', async () => {
      await expect(
        clinics.create(clinicClient(), {
          input: { name: 'Puskesmas A', districtCode: '3471' },
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/sudah ada/i)
    })

    it('mengizinkan nama sama di wilayah berbeda', async () => {
      const created = await clinics.create(clinicClient(), {
        input: { name: 'Puskesmas A', districtCode: '3499' },
        actorUserId: ADMIN_ID,
      })

      expect(created.districtCode).toBe('3499')
    })

    it('menolak perubahan yang membuat nama ganda di satu wilayah', async () => {
      await expect(
        clinics.update(clinicClient(), {
          id: CLINIC_B,
          input: { districtCode: '3471', name: 'Puskesmas A' },
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/sudah ada/i)
    })

    it('mengizinkan memindahkan puskesma ke wilayah yang nama Beirut belum dipakai', async () => {
      const updated = await clinics.update(clinicClient(), {
        id: CLINIC_B,
        input: { districtCode: '3471' },
        actorUserId: ADMIN_ID,
      })

      expect(updated.districtCode).toBe('3471')
    })

    it('memperbarui nama tanpa bentrok dengan dirinya sendiri', async () => {
      const updated = await clinics.update(clinicClient(), {
        id: CLINIC_A,
        input: { name: 'Puskesmas A Baru' },
        actorUserId: ADMIN_ID,
      })

      expect(updated.name).toBe('Puskesmas A Baru')
    })

    it('detail di luar scope dijawab 404, bukan 403', async () => {
      await expect(
        clinics.getById(clinicClient(), {
          claims: nakes('00000000-0000-4000-8000-0000000000c1'),
          id: CLINIC_B,
        }),
      ).rejects.toThrow(/tidak ditemukan/i)
    })
  })

  // ------------------------------------------------------------------ staf

  describe('undang staf', () => {
    const payload = (overrides: Record<string, unknown> = {}) => ({
      fullName: 'Perawat Baru',
      phone: '08120000999',
      nakesRole: 'PERAWAT',
      assignments: [{ puskesmasId: CLINIC_A }],
      ...overrides,
    })

    it('tanpa password menghasilkan akun INVITED plus kode aktivasi', async () => {
      const result = await staff.inviteStaff(staffClient(), {
        input: payload(),
        actorUserId: ADMIN_ID,
      })

      expect(result.account.staffStatus).toBe('INVITED')
      expect(result.account.isActive).toBe(false)
      expect(result.activationCode).toMatch(/^\d{6}$/)
      expect(result.activationExpiresAt).not.toBeNull()

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: result.account.id } })
      // Kode disimpan sebagai hash, tidak pernah plaintext.
      expect(stored.activationCodeHash).not.toBe(result.activationCode)
      expect(stored.activationCodeHash).toBeTruthy()
    })

    it('dengan password menghasilkan akun ACTIVE tanpa kode', async () => {
      const result = await staff.inviteStaff(staffClient(), {
        input: payload({ password: 'RahasiaKuat123' }),
        actorUserId: ADMIN_ID,
      })

      expect(result.account.staffStatus).toBe('ACTIVE')
      expect(result.activationCode).toBeNull()
    })

    it('menolak priceyatan tanpa satu pun wilayah penugasan', async () => {
      await expect(
        staff.inviteStaff(staffClient(), {
          input: payload({ assignments: [] }),
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/wilayah penugasan/i)
    })

    it('menolak penugasan ke puskesmas yang tidak ada', async () => {
      await expect(
        staff.inviteStaff(staffClient(), {
          input: payload({
            assignments: [{ puskesmasId: '00000000-0000-4000-8000-0000000000ff' }],
          }),
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/tidak ditemukan/i)
    })

    it('menolak penugasan ke puskesmas nonaktif', async () => {
      await prisma.puskesmas.update({ where: { id: CLINIC_B }, data: { isActive: false } })

      await expect(
        staff.inviteStaff(staffClient(), {
          input: payload({ assignments: [{ puskesmasId: CLINIC_B }] }),
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/tidak aktif/i)
    })

    it('akun dan penugasan tertulis bersama', async () => {
      const result = await staff.inviteStaff(staffClient(), {
        input: payload(),
        actorUserId: ADMIN_ID,
      })

      expect(result.account.assignments).toHaveLength(1)
      expect(result.account.assignments[0]).toMatchObject({
        scopeType: 'PUSKESMAS',
        isActive: true,
      })
    })

    it('menolak nomor HP yang sudah dipakai', async () => {
      await expect(
        staff.inviteStaff(staffClient(), {
          input: payload({ phone: '08110000902' }),
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/sudah terdaftar/i)
    })
  })

  describe('aktivasi staf', () => {
    async function invited() {
      return staff.inviteStaff(staffClient(), {
        input: {
          fullName: 'Perawat Baru',
          phone: '08120000999',
          nakesRole: 'PERAWAT',
          assignments: [{ puskesmasId: CLINIC_A }],
        },
        actorUserId: ADMIN_ID,
      })
    }

    it('kode yang benar mengaktifkan akun dan mengosongkan kode', async () => {
      const created = await invited()

      const result = await staff.activateStaff(staffClient(), {
        phone: '08120000999',
        code: created.activationCode as string,
        password: 'SandiBaru123',
      })

      expect(result.staffId).toBe(created.account.id)

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: created.account.id },
      })
      expect(stored.staffStatus).toBe('ACTIVE')
      expect(stored.isActive).toBe(true)
      expect(stored.isVerified).toBe(true)
      // Sekali pakai: hash dihapus setelah ditukar.
      expect(stored.activationCodeHash).toBeNull()
      expect(stored.activatedAt).not.toBeNull()
    })

    it('menolak kode yang salah', async () => {
      await invited()

      await expect(
        staff.activateStaff(staffClient(), {
          phone: '08120000999',
          code: '000000',
          password: 'SandiBaru123',
        }),
      ).rejects.toThrow(/salah atau sudah kedaluwarsa/i)
    })

    it('kode yang sudah dipakai tidak bisa dipakai ulang', async () => {
      const created = await invited()
      const input = {
        phone: '08120000999',
        code: created.activationCode as string,
        password: 'SandiBaru123',
      }

      await staff.activateStaff(staffClient(), input)

      await expect(staff.activateStaff(staffClient(), input)).rejects.toThrow(
        /salah atau sudah kedaluwarsa/i,
      )
    })

    it('menolak kode yang sudah kedaluwarsa', async () => {
      const created = await invited()
      await prisma.user.update({
        where: { id: created.account.id },
        data: { activationCodeExpiresAt: new Date(Date.now() - 1000) },
      })

      await expect(
        staff.activateStaff(staffClient(), {
          phone: '08120000999',
          code: created.activationCode as string,
          password: 'SandiBaru123',
        }),
      ).rejects.toThrow(/salah atau sudah kedaluwarsa/i)
    })

    it('generate kode baru membatalkan kode lama', async () => {
      const created = await invited()
      const regenerated = await staff.regenerateActivationCode(staffClient(), {
        staffId: created.account.id,
        actorUserId: ADMIN_ID,
      })

      expect(regenerated.activationCode).not.toBe(created.activationCode)

      await expect(
        staff.activateStaff(staffClient(), {
          phone: '08120000999',
          code: created.activationCode as string,
          password: 'SandiBaru123',
        }),
      ).rejects.toThrow(/salah atau sudah kedaluwarsa/i)

      const ok = await staff.activateStaff(staffClient(), {
        phone: '08120000999',
        code: regenerated.activationCode,
        password: 'SandiBaru123',
      })
      expect(ok.staffId).toBe(created.account.id)
    })
  })

  describe('status & penugasan staf', () => {
    async function activeStaff() {
      const created = await staff.inviteStaff(staffClient(), {
        input: {
          fullName: 'Perawat Baru',
          phone: '08120000999',
          nakesRole: 'PERAWAT',
          password: 'SandiKuat12345',
          assignments: [{ puskesmasId: CLINIC_A }],
        },
        actorUserId: ADMIN_ID,
      })
      return created.account.id
    }

    it('SUSPENDED menutup akses login', async () => {
      const id = await activeStaff()

      const updated = await staff.updateStaff(staffClient(), {
        staffId: id,
        input: { staffStatus: 'SUSPENDED', reason: 'Cuti tahunan' },
        actorUserId: ADMIN_ID,
      })

      expect(updated.staffStatus).toBe('SUSPENDED')
      expect(updated.isActive).toBe(false)
      // Penugasan ikut ditutup supaya tetap punya akses lewat jalur lain.
      expect(updated.assignments.every((a) => a.isActive === false)).toBe(true)
    })

    it('DEACTIVATED bersifat final', async () => {
      const id = await activeStaff()
      await staff.updateStaff(staffClient(), {
        staffId: id,
        input: { staffStatus: 'DEACTIVATED' },
        actorUserId: ADMIN_ID,
      })

      await expect(
        staff.updateStaff(staffClient(), {
          staffId: id,
          input: { staffStatus: 'ACTIVE' },
          actorUserId: ADMIN_ID,
        }),
      ).rejects.toThrow(/permanen/i)
    })

    it('mengubah peran klinis tidak mengubah status', async () => {
      const id = await activeStaff()

      const updated = await staff.updateStaff(staffClient(), {
        staffId: id,
        input: { nakesRole: 'DOKTER' },
        actorUserId: ADMIN_ID,
      })

      expect(updated.nakesRole).toBe('DOKTER')
      expect(updated.staffStatus).toBe('ACTIVE')
    })

    it('menambah penugasan kedua dan menutup yang lama tanpa menghapus', async () => {
      const id = await activeStaff()

      const added = await staff.addAssignment(staffClient(), {
        staffId: id,
        input: { districtCode: '3472' },
        actorUserId: ADMIN_ID,
      })
      expect(added.assignment.scopeType).toBe('DISTRICT')
      expect(added.assignment.districtCode).toBe('3472')

      const first = added.staff.assignments.find((a) => a.id !== added.assignment.id)!
      const closed = await staff.endAssignment(staffClient(), {
        staffId: id,
        assignmentId: first.id,
        actorUserId: ADMIN_ID,
        reason: 'Pindah unit',
      })

      const record = closed.assignments.find((a) => a.id === first.id)!
      expect(record.isActive).toBe(false)
      expect(record.endedAt).not.toBeNull()
      // Baris tetap ada supaya riwayat penugasan bisa diaudit.
      expect(closed.assignments.length).toBe(2)
    })

    it('menolak penugasan dengan puskesmas dan wilayah sekaligus', () => {
      expect(() =>
        nakesAssignmentSchema.parse({ puskesmasId: CLINIC_A, districtCode: '3472' }),
      ).toThrow()
    })

    it('menolak penugasan tanpa tujuan sama sekali', () => {
      expect(() => nakesAssignmentSchema.parse({})).toThrow()
    })
  })
})
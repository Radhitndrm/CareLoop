// Unit test untuk gate persetujuan klinis (docs/API.md §3.2).
//
// Fokus:半个 prescription tidak boleh bocor ke pasien sebelum dokter menyetujuinya.
// Ini batas yang paling berbahaya kalau salah — pasien dapat reminder obat yang belum
// disahkan, atau konfirmasi palsu tercatat seolah-olah obat itu resmi.
import { describe, expect, it, vi } from 'vitest'
import { approveMedication, type MedicationsPrismaClient } from './medications.service'
import { ApiError } from '../../lib/errors'

const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const MEDICATION_ID = '22222222-2222-4222-8222-222222222222'

function claimsFor(role: 'NAKES' | 'ADMIN', nakesRole?: string) {
  return { sub: 'nakes-1', role, ...(nakesRole ? { nakesRole } : {}) } as any
}

/**
 * Klien minimal. `findFirst` pada patient dipakai assertPatientInScope; di sini
 * selalu mengembalikan pasien agar fokus test pada transisi status.
 */
function createClient(overrides?: { medicationStatus?: string }) {
  const medicationUpdate = vi.fn().mockResolvedValue({})
  const scheduleUpdateMany = vi.fn().mockResolvedValue({ count: 2 })

  const client = {
    patient: {
      findFirst: vi.fn().mockResolvedValue({ id: PATIENT_ID }),
    },
    medication: {
      // Panggilan pertama hanya butuh id/patientId/status; panggilan kedua
      // (loadMedicationOutput) butuh baris lengkap. Satu mock menutup keduanya.
      findUnique: vi.fn().mockResolvedValue({
        id: MEDICATION_ID,
        patientId: PATIENT_ID,
        name: 'Metformin 500 mg',
        genericName: null,
        dosage: '500 mg',
        form: 'TABLET',
        instructions: null,
        isActive: overrides?.medicationStatus === 'APPROVED',
        status: overrides?.medicationStatus ?? 'DRAFT',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: null,
        approvedAt: null,
        approvedBy: null,
        schedules: [],
      }),
      update: medicationUpdate,
    },
    schedule: {
      updateMany: scheduleUpdateMany,
      update: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
  }

  return {
    client: client as unknown as MedicationsPrismaClient,
    medicationUpdate,
    scheduleUpdateMany,
  }
}

describe('medications: persetujuan klinis dokter (Tahap 2 alur)', () => {
  it('menyetujui draft: obat & seluruh jadwal ikut APPROVED dan aktif', async () => {
    const { client, medicationUpdate, scheduleUpdateMany } = createClient({
      medicationStatus: 'DRAFT',
    })

    await approveMedication(client, {
      medicationId: MEDICATION_ID,
      input: { decision: 'APPROVED' },
      claims: claimsFor('NAKES', 'DOKTER'),
      audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
    })

    // Obat aktif — tanpa ini reminder tidak pernah jalan.
    expect(medicationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MEDICATION_ID },
        data: expect.objectContaining({ status: 'APPROVED', isActive: true, approvedById: 'nakes-1' }),
      }),
    )

    // Jadwal ikut, kalau tidak maka pasien tetap tidak mendapat reminder.
    expect(scheduleUpdateMany).toHaveBeenCalledWith({
      where: { medicationId: MEDICATION_ID },
      data: expect.objectContaining({ status: 'APPROVED', isActive: true }),
    })
  })

  it('menolak: obat dimatikan sehingga tidak ada reminder sama sekali', async () => {
    const { client, medicationUpdate } = createClient({ medicationStatus: 'DRAFT' })

    await approveMedication(client, {
      medicationId: MEDICATION_ID,
      input: { decision: 'REJECTED', note: 'Dosis perlu diturunkan' },
      claims: claimsFor('NAKES', 'DOKTER'),
      audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
    })

    expect(medicationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REJECTED', isActive: false }),
      }),
    )
  })

  it('menolak menyetujui obat yang sudah APPROVED (409)', async () => {
    const { client, medicationUpdate } = createClient({ medicationStatus: 'APPROVED' })

    await expect(
      approveMedication(client, {
        medicationId: MEDICATION_ID,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(medicationUpdate).not.toHaveBeenCalled()
  })

  it('menolak menyetujui ulang obat yang sudah REJECTED (422)', async () => {
    const { client, medicationUpdate } = createClient({ medicationStatus: 'REJECTED' })

    await expect(
      approveMedication(client, {
        medicationId: MEDICATION_ID,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
      }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(medicationUpdate).not.toHaveBeenCalled()
  })

  it('pasien di luar scope tidak bisa menyetujui resep pasien lain', async () => {
    const client = {
      patient: { findFirst: vi.fn().mockResolvedValue(null) },
      medication: { findUnique: vi.fn().mockResolvedValue({ id: MEDICATION_ID, patientId: 'lain', status: 'DRAFT' }) },
      schedule: { updateMany: vi.fn() },
      user: { findUnique: vi.fn() },
      auditLog: { create: vi.fn() },
    } as unknown as MedicationsPrismaClient

    await expect(
      approveMedication(client, {
        medicationId: MEDICATION_ID,
        input: { decision: 'APPROVED' },
        claims: claimsFor('NAKES', 'DOKTER'),
        audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('input keputusan tidak valid ditolak oleh zod', async () => {
    const { client } = createClient({ medicationStatus: 'DRAFT' })

    await expect(
      approveMedication(client, {
        medicationId: MEDICATION_ID,
        input: { decision: 'DISEMBLE' } as any,
        claims: claimsFor('NAKES', 'DOKTER'),
        audit: { actorUserId: 'dokter-1', actorRole: 'NAKES' },
      }),
    ).rejects.toBeInstanceOf(Error)
  })
})

describe('requireClinicalRole: perawat tidak boleh menyetujui resep', () => {
  // Gate ini diuji langsung karena merupakan batas tanggung jawab klinis yang
  // paling sering dilanggar secara tak sengaja: perawat yang sama yang membuat draft
  // akan merasa理所当然 menyetakannya sendiri.
  async function runGate(claims: any) {
    const { requireClinicalRole } = await import('../../lib/auth')
    const handler = requireClinicalRole('DOKTER', 'BIDAN')
    const req = { user: claims } as any
    // preHandler dipanggil Fastify dengan `this` terikat ke instance, dan
    // requireRole memanggil authenticate lewat `authenticate.call(req.server, ...)`.
    // Karena claims sudah terisi, authenticate tidak dijalankan di sini.
    return handler.call({} as any, req, {} as any)
  }

  it('DOKTER lolos', async () => {
    await expect(runGate(claimsFor('NAKES', 'DOKTER'))).resolves.toBeUndefined()
  })

  it('BIDAN lolos', async () => {
    await expect(runGate(claimsFor('NAKES', 'BIDAN'))).resolves.toBeUndefined()
  })

  it('PERAWAT ditolak 403 walau ia pembuat draft', async () => {
    await expect(runGate(claimsFor('NAKES', 'PERAWAT'))).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('KADER ditolak 403', async () => {
    await expect(runGate(claimsFor('NAKES', 'KADER'))).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('NAKES tanpa nakesRole (akun lama) ditolak, bukan lolos diam-diam', async () => {
    await expect(runGate(claimsFor('NAKES'))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('ADMIN tetap lolos walau tidak punya nakesRole', async () => {
    await expect(runGate({ sub: 'a', role: 'ADMIN' })).resolves.toBeUndefined()
  })

  it('pesan error tidak membocorkan data pasien', async () => {
    try {
      await runGate(claimsFor('NAKES', 'PERAWAT'))
      throw new Error('seharusnya menolak')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).message).not.toMatch(/nakes|pasien|nik/i)
    }
  })
})
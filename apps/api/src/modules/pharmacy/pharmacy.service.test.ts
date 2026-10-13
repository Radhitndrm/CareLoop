// Logika bisnis alur farmasi tanpa database (docs/API.md §3.6, test SR-6..SR-9, EX-*).
//
// Memakai client Prisma palsu yang mencatat panggilan, supaya yang diuji adalah
// keputusan service — bukan query SQL. Test integrasi DB ada di pharmacy.routes.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { MedicationRequestAction, MedicationRequestStatus, type AuthUserClaims } from '@careloop/shared'
import { ApiError } from '../../lib/errors'
import { InvalidPharmacyTransitionError } from './state-machine'
import {
  changeMedicationRequestStatus,
  createMedicationRequest,
  decideMedicationRequest,
  generateRoutineRequests,
  type PharmacyPrismaClient,
} from './pharmacy.service'

process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
process.env.PHARMACY_DEFAULT_DAYS_SUPPLY ??= '30'
process.env.PHARMACY_MAX_DAYS_SUPPLY ??= '90'

const PATIENT_ID = '00000000-0000-4000-8000-000000000101'
const MEDICATION_ID = '00000000-0000-4000-8000-000000000201'
const DOCTOR_ID = '00000000-0000-4000-8000-000000000002'
const PHARMACIST_ID = '00000000-0000-4000-8000-000000000009'
const REQUEST_ID = '00000000-0000-4000-8000-000000000301'

const NOW = new Date('2026-10-11T08:00:00.000Z')

const medication = {
  id: MEDICATION_ID,
  patientId: PATIENT_ID,
  name: 'Metformin 500 mg',
  dosage: '500 mg',
  form: 'TABLET',
  status: 'APPROVED',
  isActive: true,
  daysSupply: 30,
  nextPickupAt: new Date('2026-11-10T00:00:00.000Z'),
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  endedAt: null,
}

const patient = { id: PATIENT_ID, user: { fullName: 'Bu Ratna', phone: '081200000001' } }

function record(overrides: Record<string, any> = {}): any {
  return {
    id: REQUEST_ID,
    patientId: PATIENT_ID,
    medicationId: MEDICATION_ID,
    requestedQuantity: 30,
    approvedQuantity: null,
    source: 'PATIENT_REQUEST',
    status: MedicationRequestStatus.PENDING_DOCTOR,
    reasonCode: 'MEDICATION_LOST',
    reasonNotes: 'Botol bocor',
    dueAt: new Date('2026-10-14T00:00:00.000Z'),
    doctorDecisionNote: null,
    decidedAt: null,
    blockedReason: null,
    substituteName: null,
    isSubstituteApproved: false,
    createdAt: NOW,
    updatedAt: NOW,
    patient,
    medication,
    doctor: null,
    dispensingRecord: null,
    ...overrides,
  }
}

interface Harness {
  client: PharmacyPrismaClient
  state: {
    request: any
    stock: any
    events: any[]
    notifications: any[]
    dispensing: any[]
    medications: any[]
    updatedMedication: any
  }
}

function harness(overrides: Record<string, any> = {}): Harness {
  const state: any = {
    request: record(overrides),
    stock: { patientId: PATIENT_ID, medicationId: MEDICATION_ID, quantityRemaining: 3 },
    events: [],
    notifications: [],
    dispensing: [],
    medications: [{ ...medication }],
    updatedMedication: null,
  }

  const client: any = {
    patient: {
      findFirst: vi.fn(async () => ({ id: PATIENT_ID })),
      findMany: vi.fn(async () => [patient]),
    },
    user: { findUnique: vi.fn(async () => null) },
    medication: {
      findUnique: vi.fn(async () => state.medications[0]),
      findMany: vi.fn(async () => state.medications),
      update: vi.fn(async (args: any) => {
        state.updatedMedication = args.data
        state.medications[0] = { ...state.medications[0], ...args.data }
        return args.data
      }),
    },
    medicationStock: {
      findUnique: vi.fn(async () => state.stock),
      findMany: vi.fn(async () => [state.stock]),
      upsert: vi.fn(async (args: any) => {
        state.stock = { ...state.stock, quantityRemaining: args.create.quantityRemaining }
        return state.stock
      }),
      update: vi.fn(async () => state.stock),
    },
    medicationRequest: {
      findUnique: vi.fn(async () => state.request),
      // Default: pasien belum punya request aktif untuk obat ini.
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [state.request]),
      count: vi.fn(async () => 1),
      create: vi.fn(async (args: any) => {
        state.request = record({ ...args.data, id: REQUEST_ID, patient, medication })
        return state.request
      }),
      update: vi.fn(async (args: any) => {
        state.request = { ...state.request, ...args.data }
        return state.request
      }),
    },
    medicationRequestEvent: {
      create: vi.fn(async (args: any) => {
        state.events.push(args.data)
        return args.data
      }),
      findMany: vi.fn(async () => []),
    },
    dispensingRecord: {
      create: vi.fn(async (args: any) => {
        state.dispensing.push(args.data)
        return args.data
      }),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    notification: {
      create: vi.fn(async (args: any) => {
        state.notifications.push(args.data)
        return args.data
      }),
      createMany: vi.fn(async (args: any) => {
        state.notifications.push(...args.data)
        return { count: args.data.length }
      }),
    },
    familyContact: { findMany: vi.fn(async () => [{ phone: '081200000009' }]) },
    nakesContact: {
      findMany: vi.fn(async () => [{ nakesUserId: DOCTOR_ID }]),
      create: vi.fn(async () => ({})),
    },
    auditLog: { create: vi.fn(async (args: any) => ({ id: 'audit-1', ...args.data })) },
  }

  return { client: client as PharmacyPrismaClient, state }
}

const patientClaims: AuthUserClaims = { sub: PATIENT_ID, role: 'PATIENT' }
const doctorClaims: AuthUserClaims = { sub: DOCTOR_ID, role: 'NAKES', nakesRole: 'DOKTER' }
const pharmacistClaims: AuthUserClaims = {
  sub: PHARMACIST_ID,
  role: 'NAKES',
  nakesRole: 'FARMASI',
}
const nurseClaims: AuthUserClaims = { sub: DOCTOR_ID, role: 'NAKES', nakesRole: 'PERAWAT' }

const auditCtx = { actorUserId: null, actorRole: null, ip: null, userAgent: null }

/**
 * ZodError dibiarkan apa adanya oleh service — pemetaan ke 400 dilakukan error
 * handler terpusat (lib/errors.ts), sama seperti modul lain. Test service karena
 * itu memeriksa exception mentahnya, bukan HTTP status.
 */
async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('Diharapkan ApiError, tetapi promise berhasil')
}

async function expectPharmacyTransition(promise: Promise<unknown>): Promise<InvalidPharmacyTransitionError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidPharmacyTransitionError)
    return err as InvalidPharmacyTransitionError
  }
  throw new Error('Diharapkan InvalidPharmacyTransitionError, tetapi promise berhasil')
}

async function expectZodError(promise: Promise<unknown>): Promise<ZodError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ZodError)
    return err as ZodError
  }
  throw new Error('Diharapkan ZodError, tetapi promise berhasil')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createMedicationRequest', () => {
  it('pasien membuat permintaan dengan status PENDING_DOCTOR dan tercatat di audit trail', async () => {
    const { client, state } = harness()

    const result = await createMedicationRequest(
      client,
      {
        input: {
          medicationId: MEDICATION_ID,
          requestedQuantity: 30,
          reasonCode: 'MEDICATION_LOST',
          reasonNotes: 'Botol bocor',
        },
        claims: patientClaims,
        audit: { ...auditCtx, actorUserId: PATIENT_ID, actorRole: 'PATIENT' },
        now: NOW,
      },
    )

    expect(result.status).toBe(MedicationRequestStatus.PENDING_DOCTOR)
    expect(result.source).toBe('PATIENT_REQUEST')
    expect(result.isOverdue).toBe(false)
    expect(state.events[0].action).toBe(MedicationRequestAction.CREATED)
    expect(state.events[0].fromStatus).toBeNull()
  })

  it('obat milik pasien lain dijawab 404, bukan 403 (EX-3)', async () => {
    const { client } = harness()
    ;(client.medication as any).findUnique = vi.fn(async () => ({
      ...medication,
      patientId: '00000000-0000-4000-8000-000000000999',
    }))

    const err = await expectApiError(
      createMedicationRequest(
        client,
        {
          input: {
            medicationId: MEDICATION_ID,
            requestedQuantity: 30,
            reasonCode: 'EARLY_PICKUP',
          },
          claims: patientClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(404)
  })

  it('obat DRAFT tidak bisa diminta — resep belum disetujui dokter', async () => {
    const { client } = harness()
    ;(client.medication as any).findUnique = vi.fn(async () => ({ ...medication, status: 'DRAFT' }))

    const err = await expectApiError(
      createMedicationRequest(
        client,
        {
          input: {
            medicationId: MEDICATION_ID,
            requestedQuantity: 30,
            reasonCode: 'EARLY_PICKUP',
          },
          claims: patientClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(422)
  })

  it('permintaan melebihi batas env ditolak 400', async () => {
    const { client } = harness()

    const err = await expectApiError(
      createMedicationRequest(
        client,
        {
          input: { medicationId: MEDICATION_ID, requestedQuantity: 365, reasonCode: 'EXTRA' },
          claims: patientClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(400)
  })

  it('alasan "Lainnya" wajib disertai catatan', async () => {
    const { client } = harness()

    const err = await expectZodError(
      createMedicationRequest(
        client,
        {
          input: { medicationId: MEDICATION_ID, requestedQuantity: 30, reasonCode: 'OTHER' },
          claims: patientClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err).toBeInstanceOf(ZodError)
  })

  it('request kedua untuk obat yang sama ditolak — sudah ada yang aktif', async () => {
    const { client } = harness()
    ;(client.medicationRequest as any).findFirst = vi.fn(async () => ({
      id: REQUEST_ID,
      status: MedicationRequestStatus.PENDING_DOCTOR,
    }))

    const err = await expectApiError(
      createMedicationRequest(
        client,
        {
          input: {
            medicationId: MEDICATION_ID,
            requestedQuantity: 30,
            reasonCode: 'EARLY_PICKUP',
          },
          claims: patientClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(409)
  })

  it('hanya pasien & keluarga boleh membuat permintaan', async () => {
    const { client } = harness()

    const err = await expectApiError(
      createMedicationRequest(
        client,
        {
          input: {
            medicationId: MEDICATION_ID,
            requestedQuantity: 30,
            reasonCode: 'EARLY_PICKUP',
          },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(403)
  })
})

describe('decideMedicationRequest', () => {
  it('dokter menyetujui → QUEUED, jumlah tersimpan, event tercatat (SR-5)', async () => {
    const { client, state } = harness()

    const result = await decideMedicationRequest(
      client,
      {
        requestId: REQUEST_ID,
        input: { decision: 'APPROVED', approvedQuantity: 20 },
        claims: doctorClaims,
        audit: { ...auditCtx, actorUserId: DOCTOR_ID, actorRole: 'NAKES' },
        now: NOW,
      },
    )

    expect(result.status).toBe(MedicationRequestStatus.QUEUED)
    expect(result.approvedQuantity).toBe(20)
    expect(state.events.at(-1)?.action).toBe(MedicationRequestAction.APPROVED)
  })

  it('dokter boleh menyetujui jumlah berbeda dari yang diminta', async () => {
    const { client } = harness()

    const result = await decideMedicationRequest(
      client,
      {
        requestId: REQUEST_ID,
        input: { decision: 'APPROVED', approvedQuantity: 10 },
        claims: doctorClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.requestedQuantity).toBe(30)
    expect(result.effectiveQuantity).toBe(10)
  })

  it('ditolak tanpa alasan ditolak zod 400', async () => {
    const { client } = harness()

    const err = await expectZodError(
      decideMedicationRequest(
        client,
        {
          requestId: REQUEST_ID,
          input: { decision: 'REJECTED' },
          claims: doctorClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err).toBeInstanceOf(ZodError)
  })

  it('ditolak → REJECTED dan alasan tersimpan untuk dikirim ke pasien', async () => {
    const { client, state } = harness()

    const result = await decideMedicationRequest(
      client,
      {
        requestId: REQUEST_ID,
        input: { decision: 'REJECTED', note: 'Resep masih stok, ambil 10 hari lagi' },
        claims: doctorClaims,
        audit: auditCtx,
        now: NOW,
      },
    )

    expect(result.status).toBe(MedicationRequestStatus.REJECTED)
    expect(result.blockedReason).toBe('Resep masih stok, ambil 10 hari lagi')
    expect(state.events.at(-1)?.note).toBe('Resep masih stok, ambil 10 hari lagi')
  })

  it('request yang sudah diputuskan tidak bisa diputus dua kali (SR-4)', async () => {
    const { client } = harness({ status: MedicationRequestStatus.QUEUED })

    const err = await expectPharmacyTransition(
      decideMedicationRequest(
        client,
        {
          requestId: REQUEST_ID,
          input: { decision: 'APPROVED' },
          claims: doctorClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err).toBeInstanceOf(InvalidPharmacyTransitionError)
    expect((err as Error).message).toMatch(/tidak bisa diubah/)
  })
})

describe('changeMedicationRequestStatus — alur farmasi', () => {
  it('QUEUED → PREPARING', async () => {
    const { client, state } = harness({ status: MedicationRequestStatus.QUEUED })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: { action: MedicationRequestAction.START_PREPARING },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.status).toBe(MedicationRequestStatus.PREPARING)
    expect(state.events.at(-1)?.action).toBe(MedicationRequestAction.START_PREPARING)
  })

  it('PREPARING → READY', async () => {
    const { client } = harness({ status: MedicationRequestStatus.PREPARING })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: { action: MedicationRequestAction.MARK_READY },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.status).toBe(MedicationRequestStatus.READY)
  })

  it('stok kosong wajib ada alasan (SR-7)', async () => {
    const { client } = harness({ status: MedicationRequestStatus.QUEUED })

    const err = await expectZodError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.MARK_OUT_OF_STOCK },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err).toBeInstanceOf(ZodError)
  })

  it('stok kosong menyimpan alasan dan mengakhiri antrean', async () => {
    const { client, state } = harness({ status: MedicationRequestStatus.QUEUED })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: {
          action: MedicationRequestAction.MARK_OUT_OF_STOCK,
          reason: 'Stok metformin habis di gudang',
        },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.status).toBe(MedicationRequestStatus.OUT_OF_STOCK)
    expect(result.blockedReason).toBe('Stok metformin habis di gudang')
    expect(state.request.blockedReason).toBe('Stok metformin habis di gudang')
  })

  it('penggantian obat wajib nama obat pengganti', async () => {
    const { client } = harness({ status: MedicationRequestStatus.PREPARING })

    const err = await expectZodError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: {
            action: MedicationRequestAction.MARK_SUBSTITUTED,
            reason: 'Generik tidak tersedia',
          },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err).toBeInstanceOf(ZodError)
  })

  it('penggantian obat menunggu persetujuan dokter (isSubstituteApproved = false)', async () => {
    const { client, state } = harness({ status: MedicationRequestStatus.PREPARING })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: {
          action: MedicationRequestAction.MARK_SUBSTITUTED,
          reason: 'Merek generik habis',
          substituteName: 'Glucophage XR 500 mg',
        },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.status).toBe(MedicationRequestStatus.SUBSTITUTED)
    expect(result.substituteName).toBe('Glucophage XR 500 mg')
    expect(result.isSubstituteApproved).toBe(false)
    expect(state.request.isSubstituteApproved).toBe(false)
  })

  it('penyerahan tanpa quantityDays ditolak zod (SR-6)', async () => {
    const { client } = harness({ status: MedicationRequestStatus.READY })

    const err = await expectZodError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.DISPENSED },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.issues[0].path).toEqual(['quantityDays'])
  })

  it('penyerahan mencatat petugas, jatah hari, dan menggeser tanggal ambil (SR-8)', async () => {
    const { client, state } = harness({ status: MedicationRequestStatus.READY })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: { action: MedicationRequestAction.DISPENSED, quantityDays: 30 },
        claims: pharmacistClaims,
        audit: { ...auditCtx, actorUserId: PHARMACIST_ID, actorRole: 'NAKES' },
        now: NOW,
      },
    )

    expect(result.status).toBe(MedicationRequestStatus.DISPENSED)
    expect(state.dispensing[0]).toMatchObject({
      pharmacistId: PHARMACIST_ID,
      quantityDays: 30,
      nextPickupDate: new Date('2026-11-10T08:00:00.000Z'),
    })
    expect(state.stock.quantityRemaining).toBe(30)
    expect(state.updatedMedication.nextPickupAt).toEqual(new Date('2026-11-10T08:00:00.000Z'))
  })

  it('READY yang sudah terlambat jadi tidak terlambat setelah diserahkan', async () => {
    const { client } = harness({
      status: MedicationRequestStatus.READY,
      dueAt: new Date('2026-10-01T00:00:00.000Z'),
    })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: { action: MedicationRequestAction.DISPENSED, quantityDays: 30 },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.isOverdue).toBe(false)
  })

  it('READY yang terlambat tetap terdeteksi lewat isOverdue', async () => {
    const { client } = harness({
      status: MedicationRequestStatus.READY,
      dueAt: new Date('2026-10-01T00:00:00.000Z'),
    })

    const result = await changeMedicationRequestStatus(
      client,
      {
        requestId: REQUEST_ID,
        input: { action: MedicationRequestAction.RETURNED_TO_QUEUE },
        claims: pharmacistClaims,
        audit: auditCtx,
        now: NOW,
      },
    )
    expect(result.status).toBe(MedicationRequestStatus.QUEUED)
    expect(result.isOverdue).toBe(true)
  })

  it('apotek tidak bisa menyetujui permintaan obat', async () => {
    const { client } = harness()

    const err = await expectApiError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.APPROVED },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(403)
  })

  it('CREATED tidak bisa dipanggil sebagai aksi', async () => {
    const { client } = harness({ status: MedicationRequestStatus.QUEUED })

    const err = await expectApiError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.CREATED },
          claims: pharmacistClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(400)
  })

  it('perawat tidak bisa menjalankan aksi farmasi', async () => {
    const { client } = harness({ status: MedicationRequestStatus.QUEUED })

    const err = await expectApiError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.START_PREPARING },
          claims: nurseClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(403)
  })

  it('dokter tidak boleh menyiapkan obat — kewenangan terpisah dari apotek', async () => {
    const { client } = harness({ status: MedicationRequestStatus.QUEUED })

    const err = await expectApiError(
      changeMedicationRequestStatus(
        client,
        {
          requestId: REQUEST_ID,
          input: { action: MedicationRequestAction.START_PREPARING },
          claims: doctorClaims,
          audit: auditCtx,
          now: NOW,
        },
      ),
    )
    expect(err.statusCode).toBe(403)
  })
})

describe('generateRoutineRequests', () => {
  it('obat APPROVED dengan nextPickupAt mendekati dibuatkan request QUEUED tanpa gate dokter', async () => {
    const { client, state } = harness()

    const result = await generateRoutineRequests(client, { now: NOW })

    expect(result.created).toBe(1)
    expect(state.request.status).toBe(MedicationRequestStatus.QUEUED)
    expect(state.request.source).toBe('ROUTINE')
    expect(state.request.approvedQuantity).toBe(30)
  })

  it('horizon query hanya mengambil obat yang sudah APPROVED, aktif, dandueDate-nya masuk lead time', async () => {
    const { client } = harness()
    const findMany: any = vi.fn(async () => [])
    ;(client.medication as any).findMany = findMany

    await generateRoutineRequests(client, { now: NOW })

    // lead time default 3 hari → horizon = 14 Okt 2026.
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: 'APPROVED',
      isActive: true,
      nextPickupAt: { not: null, lte: new Date('2026-10-14T00:00:00.000Z') },
    })
  })

  it('obat DRAFT / nonaktif / nextPickupAt null tidak pernah dijadwalkan (EX-4)', async () => {
    const { client } = harness()
    const findMany: any = vi.fn(async () => [])
    ;(client.medication as any).findMany = findMany

    await generateRoutineRequests(client, { now: NOW })

    const where = findMany.mock.calls[0][0].where
    expect(where.status).toBe('APPROVED')
    expect(where.isActive).toBe(true)
    expect(where.nextPickupAt).toMatchObject({ not: null })
  })

  it('P2002 dari partial unique index dihitung skipped, bukan kegagalan (SR-9/EX-1)', async () => {
    const { client } = harness()
    ;(client.medicationRequest as any).create = vi.fn(async () => {
      throw Object.assign(new Error('duplicate'), { code: 'P2002' })
    })

    const result = await generateRoutineRequests(client, { now: NOW })
    expect(result.created).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
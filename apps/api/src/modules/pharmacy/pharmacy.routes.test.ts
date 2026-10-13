// Gerbang kewenangan routes alur farmasi (docs/API.md §3.6, test RB-1..RB-7).
//
// Fokus suite ini: siapa BOLEH dan siapa TIDAK BOLEH menyentuh tiap endpoint.
// Logika transisi sudah diuji terpisah di state-machine.test.ts &
// pharmacy.service.test.ts; di sini yang diverifikasi adalah lapis route.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims, UserRole } from '@careloop/shared'
import { MedicationRequestStatus } from '@careloop/shared'
import { prisma } from '../../lib/prisma'

const REQUEST_ID = '00000000-0000-4000-8000-000000000401'
const PATIENT_ID = '00000000-0000-4000-8000-000000000101'

describe('Pharmacy routes — RBAC (docs/API.md §3.6)', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../../app')
    // Scheduler dimatikan: suite ini hanya memeriksa gate, bukan scheduler.
    app = await buildApp({ logger: false, enableWs: false, enablePharmacyScheduler: false })
    await app.ready()

    vi.spyOn(prisma.auditLog, 'create').mockResolvedValue({ id: 'audit-1' } as any)
    vi.spyOn(prisma.notification, 'create').mockResolvedValue({ id: 'notif-1' } as any)
    vi.spyOn(prisma.notification, 'createMany').mockResolvedValue({ count: 0 } as any)
    vi.spyOn(prisma.familyContact, 'findMany').mockResolvedValue([] as any)
    vi.spyOn(prisma.nakesContact, 'findMany').mockResolvedValue([] as any)
    vi.spyOn(prisma.medicationStock, 'findUnique').mockResolvedValue(null as any)
  }, 60_000)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Token JWT dengan claim peran tertentu — melewati verifikasi signature. */
  async function tokenFor(claims: AuthUserClaims): Promise<string> {
    return app.jwt.sign(claims)
  }

  async function call(
    method: 'POST' | 'PATCH' | 'GET',
    url: string,
    claims: AuthUserClaims | null,
    payload?: Record<string, unknown>,
  ) {
    const headers: Record<string, string> = {}
    if (claims) headers.authorization = `Bearer ${await tokenFor(claims)}`
    return app.inject({ method, url, headers, ...(payload ? { payload } : {}) })
  }

  const patient: AuthUserClaims = { sub: PATIENT_ID, role: 'PATIENT' }
  const perawat: AuthUserClaims = {
    sub: '00000000-0000-4000-8000-000000000008',
    role: 'NAKES',
    nakesRole: 'PERAWAT',
  }
  const dokter: AuthUserClaims = {
    sub: '00000000-0000-4000-8000-000000000002',
    role: 'NAKES',
    nakesRole: 'DOKTER',
  }
  const bidan: AuthUserClaims = {
    sub: '00000000-0000-4000-8000-000000000006',
    role: 'NAKES',
    nakesRole: 'BIDAN',
  }
  const apoteker: AuthUserClaims = {
    sub: '00000000-0000-4000-8000-000000000009',
    role: 'NAKES',
    nakesRole: 'FARMASI',
  }
  const admin: AuthUserClaims = { sub: '00000000-0000-4000-8000-000000000007', role: 'ADMIN' }

  describe('RB-1/RB-2/RB-3 — hanya petugas farmasi boleh mengubah status penyiapan', () => {
    const payload = { action: 'START_PREPARING' }

    it('RB-1 — pasien ditolak 403', async () => {
      const res = await call('PATCH', `/v1/medication-requests/${REQUEST_ID}/status`, patient, payload)
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
    })

    it('RB-2 — perawat ditolak 403', async () => {
      const res = await call('PATCH', `/v1/medication-requests/${REQUEST_ID}/status`, perawat, payload)
      expect(res.statusCode).toBe(403)
    })

    it('RB-3 — dokter ditolak 403: concurred dengan apotek tidak boleh menyiapkan obat', async () => {
      const res = await call('PATCH', `/v1/medication-requests/${REQUEST_ID}/status`, dokter, payload)
      expect(res.statusCode).toBe(403)
      expect(res.json().error.message).toMatch(/petugas farmasi/i)
    })

    it('tanpa token ditolak 401', async () => {
      const res = await call('PATCH', `/v1/medication-requests/${REQUEST_ID}/status`, null, payload)
      expect(res.statusCode).toBe(401)
    })

    it('nakes tanpa nakesRole ditolak 403', async () => {
      const tanpaPeran: AuthUserClaims = { sub: apoteker.sub, role: 'NAKES' }
      const res = await call('PATCH', `/v1/medication-requests/${REQUEST_ID}/status`, tanpaPeran, payload)
      expect(res.statusCode).toBe(403)
    })
  })

  describe('RB-4/RB-5 — hanya dokter/bidan yang boleh memutuskan', () => {
    const payload = { decision: 'APPROVED' }

    it('RB-4 — apotek tidak boleh menyetujui permintaan obat', async () => {
      const res = await call(
        'PATCH',
        `/v1/medication-requests/${REQUEST_ID}/decision`,
        apoteker,
        payload,
      )
      expect(res.statusCode).toBe(403)
      expect(res.json().error.message).toMatch(/dokter atau bidan/i)
    })

    it('perawat yang membuat draft resep tetap tidak boleh menyetujui', async () => {
      const res = await call(
        'PATCH',
        `/v1/medication-requests/${REQUEST_ID}/decision`,
        perawat,
        payload,
      )
      expect(res.statusCode).toBe(403)
    })

    it('RB-5 — dokter boleh memutuskan', async () => {
      vi.spyOn(prisma.medicationRequest, 'findUnique').mockResolvedValue({
        id: REQUEST_ID,
        patientId: PATIENT_ID,
        medicationId: '00000000-0000-4000-8000-000000000201',
        requestedQuantity: 30,
        approvedQuantity: null,
        source: 'PATIENT_REQUEST',
        status: MedicationRequestStatus.PENDING_DOCTOR,
        reasonCode: 'MEDICATION_LOST',
        reasonNotes: 'Kotak obat basah',
        dueAt: new Date(),
        doctorDecisionNote: null,
        decidedAt: null,
        blockedReason: null,
        substituteName: null,
        isSubstituteApproved: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        patient: { id: PATIENT_ID, user: { fullName: 'Bu Ratna', phone: '081200000001' } },
        medication: { id: 'med-1', name: 'Metformin', dosage: '500 mg', form: 'TABLET', daysSupply: 30 },
        doctor: null,
        dispensingRecord: null,
      } as any)
      vi.spyOn(prisma.patient, 'findFirst').mockResolvedValue({ id: PATIENT_ID } as any)
      vi.spyOn(prisma.medicationRequest, 'update').mockResolvedValue({} as any)
      vi.spyOn(prisma.medicationRequestEvent, 'create').mockResolvedValue({} as any)

      const res = await call(
        'PATCH',
        `/v1/medication-requests/${REQUEST_ID}/decision`,
        dokter,
        payload,
      )
      expect(res.statusCode).toBe(200)
    })

    it('bidan juga boleh memutuskan — prescribing termasuk lingkup kebidanan', async () => {
      vi.spyOn(prisma.medicationRequest, 'findUnique').mockResolvedValue({
        id: REQUEST_ID,
        patientId: PATIENT_ID,
        medicationId: '00000000-0000-4000-8000-000000000201',
        requestedQuantity: 30,
        approvedQuantity: null,
        source: 'PATIENT_REQUEST',
        status: MedicationRequestStatus.PENDING_DOCTOR,
        reasonCode: 'MEDICATION_LOST',
        reasonNotes: null,
        dueAt: new Date(),
        doctorDecisionNote: null,
        decidedAt: null,
        blockedReason: null,
        substituteName: null,
        isSubstituteApproved: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        patient: { id: PATIENT_ID, user: { fullName: 'Bu Ratna', phone: '081200000001' } },
        medication: { id: 'med-1', name: 'Metformin', dosage: null, form: 'TABLET', daysSupply: 30 },
        doctor: null,
        dispensingRecord: null,
      } as any)
      vi.spyOn(prisma.patient, 'findFirst').mockResolvedValue({ id: PATIENT_ID } as any)
      vi.spyOn(prisma.medicationRequest, 'update').mockResolvedValue({} as any)
      vi.spyOn(prisma.medicationRequestEvent, 'create').mockResolvedValue({} as any)

      const res = await call(
        'PATCH',
        `/v1/medication-requests/${REQUEST_ID}/decision`,
        bidan,
        payload,
      )
      expect(res.statusCode).toBe(200)
    })
  })

  describe('RB-6 — apotek tidak boleh mengubah resep', () => {
    it('PATCH /v1/medications/:id ditolak 403 untuk apotek', async () => {
      const res = await call(
        'PATCH',
        '/v1/medications/00000000-0000-4000-8000-000000000201',
        apoteker,
        { substituteApproved: true },
      )
      expect(res.statusCode).toBe(403)
      expect(res.json().error.message).toMatch(/dokter atau bidan/i)
    })

    it('dokter boleh menyesuaikan resep setelah penggantian obat', async () => {
      vi.spyOn(prisma.medication, 'findUnique').mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000201',
        patientId: PATIENT_ID,
      } as any)
      // `update` ikut di-mock: tanpa ini Prisma unleash P2025 karena baris resep
      // hanya ada di mock findUnique, bukan di DB test.
      vi.spyOn(prisma.medication, 'update').mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000201',
        patientId: PATIENT_ID,
        instructions: 'Ganti ke generik',
      } as any)
      vi.spyOn(prisma.patient, 'findFirst').mockResolvedValue({ id: PATIENT_ID } as any)
      vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)

      const res = await call(
        'PATCH',
        '/v1/medications/00000000-0000-4000-8000-000000000201',
        dokter,
        { substituteApproved: true, instruction: 'Ganti ke generik' },
      )
      expect(res.statusCode).toBe(200)
    })
  })

  describe('RB-7 — pasien hanya boleh menyentuh datanya sendiri', () => {
    const otherPatientId = '00000000-0000-4000-8000-000000000999'

    it('pasien tidak bisa menyaring permintaan milik pasien lain', async () => {
      vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)
      vi.spyOn(prisma.medicationRequest, 'count').mockResolvedValue(0 as any)

      const res = await call(
        'GET',
        `/v1/medication-requests?patientId=${otherPatientId}`,
        patient,
      )
      expect(res.statusCode).toBe(403)
    })

    it('pasien melihat request miliknya tanpa patientId di query', async () => {
      const findMany: any = vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)
      vi.spyOn(prisma.medicationRequest, 'count').mockResolvedValue(0 as any)

      const res = await call('GET', '/v1/medication-requests', patient)
      expect(res.statusCode).toBe(200)
      // patientId di-pin dari claim, bukan dari query string.
      expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain(PATIENT_ID)
    })

    it('pasien tidak bisa membuat permintaan untuk pasien lain', async () => {
      vi.spyOn(prisma.medication, 'findUnique').mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000201',
        patientId: otherPatientId,
        name: 'Metformin',
        status: 'APPROVED',
        isActive: true,
        daysSupply: 30,
        startedAt: new Date(),
        endedAt: null,
      } as any)

      // Body menyertakan patientId orang lain — harus diabaikan, patientId
      const res = await call('POST', '/v1/medication-requests', patient, {
        medicationId: '00000000-0000-4000-8000-000000000201',
        requestedQuantity: 30,
        reasonCode: 'EARLY_PICKUP',
        patientId: otherPatientId,
      })
      expect(res.statusCode).toBe(404)
    })
  })

  describe('route-level: hanya pasien boleh membuat permintaan', () => {
    it('apoteker yang mencoba membuat permintaan ditolak 403', async () => {
      const res = await call('POST', '/v1/medication-requests', apoteker, {
        medicationId: '00000000-0000-4000-8000-000000000201',
        requestedQuantity: 30,
        reasonCode: 'EARLY_PICKUP',
      })
      expect(res.statusCode).toBe(403)
    })

    it('admin tidak bisa membuat permintaan pasien', async () => {
      const res = await call('POST', '/v1/medication-requests', admin, {
        medicationId: '00000000-0000-4000-8000-000000000201',
        requestedQuantity: 30,
        reasonCode: 'EARLY_PICKUP',
      })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('badge antrean', () => {
    it('queue-summary hanya untuk nakes & admin', async () => {
      const res = await call('GET', '/v1/medication-requests/queue-summary', patient)
      expect(res.statusCode).toBe(403)
    })

    it('apoteker boleh membaca ringkasan antrean', async () => {
      vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)
      vi.spyOn(prisma.medicationRequest, 'count').mockResolvedValue(0 as any)

      const res = await call('GET', '/v1/medication-requests/queue-summary', apoteker)
      expect(res.statusCode).toBe(200)
      expect(res.json().data).toMatchObject({
        queued: expect.any(Number),
        preparing: expect.any(Number),
        ready: expect.any(Number),
        overdue: expect.any(Number),
      })
    })
  })
})
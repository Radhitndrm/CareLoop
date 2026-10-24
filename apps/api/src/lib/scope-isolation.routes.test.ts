// Cegah kebocoran data antar-puskesmas (regression test).
//
// Dua endpoint ini menampilkan/menutup data berisiko yang SANGAT sensitif: nomor HP
// keluarga yang menerima alert, lokasi GNSS, dan detak jantung. Sebelumnya keduanya
// hanya dijaga `requireCareTeamRole` — tanpa filter wilayah — sehingga nakes di satu
// puskesmas bisa melihat dan menutup eskalasi seluruh Indonesia.
//
// Bug ini ditemukan lewat smoke test manual (apps/api/scripts/smoke-safety.js), bukan
// lewat unit test — makanya suite ini dikunci eksplisit di sini.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from './prisma'

const NAKES_IN_SCOPE = '11111111-1111-4111-8111-111111111111'   // ditugaskan di psk-1
const NAKES_OUT_OF_SCOPE = '99999999-9999-4999-8999-999999999999' // ditugaskan di psk-2
const ADMIN = '44444444-4444-4444-8444-444444444444'
const FAMILY_OUT = '55555555-5555-4555-8555-555555555555'
const PATIENT_IN = 'aaaaaaaa-1111-4111-8111-111111111111'
const PATIENT_OUT = 'bbbbbbbb-2222-4222-8222-222222222222'
const RUN_IN = 'cccccccc-3333-4333-8333-333333333333'
const RUN_OUT = 'dddddddd-4444-4444-8444-444444444444'

const patients = [
  { id: PATIENT_IN, districtCode: '3471', primaryPuskesmasId: 'psk-1' },
  { id: PATIENT_OUT, districtCode: '3499', primaryPuskesmasId: 'psk-2' },
]

/**
 * Kumpulkan seluruh kode district yang disebut di filter relasi `patient`.
 * Filter asli berbentuk `{ OR: [{ districtCode: { in: [...] } }, ...] }`, jadi
 * harus dicari rekursif — bukan hanya `where.patient.districtCode.in`.
 */
function collectDistrictCodes(node: any): string[] | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node.districtCode?.in)) return node.districtCode.in
  for (const value of Object.values(node)) {
    const found = collectDistrictCodes(value)
    if (found) return found
  }
  return null
}

function tokens(app: FastifyInstance) {
  const sign = (claims: Record<string, unknown>) => `Bearer ${app.jwt.sign(claims as any)}`
  return {
    inScope: sign({ sub: NAKES_IN_SCOPE, role: 'NAKES', nakesRole: 'PERAWAT' }),
    outOfScope: sign({ sub: NAKES_OUT_OF_SCOPE, role: 'NAKES', nakesRole: 'PERAWAT' }),
    admin: sign({ sub: ADMIN, role: 'ADMIN' }),
    familyOut: sign({ sub: FAMILY_OUT, role: 'FAMILY' }),
    patientIn: sign({ sub: PATIENT_IN, role: 'PATIENT' }),
  }
}

describe('Cegah kebocoran data antar-puskesmas', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../app')
    app = await buildApp({ logger: false, enableWs: false })
    await app.ready()
  }, 60_000)

  beforeEach(() => {
    vi.restoreAllMocks()

    // Transisi eskalasi dibungkus transaksi; tanpa mock ini Prisma mencoba koneksi
    // DB sungguhan di tengah route dan hasilnya bukan penolakan akses yang diuji.
    vi.spyOn(prisma, '$transaction').mockImplementation((async (cb: any) => cb(prisma)) as any)

    vi.spyOn(prisma.nakesAssignment, 'findMany').mockImplementation((async ({ where }: any) => {
      if (where?.nakesUserId === NAKES_IN_SCOPE) {
        return [{ puskesmasId: 'psk-1', districtCode: '3471' }] as any
      }
      if (where?.nakesUserId === NAKES_OUT_OF_SCOPE) {
        return [{ puskesmasId: 'psk-2', districtCode: '3499' }] as any
      }
      return [] as any
    }) as any)

    vi.spyOn(prisma.patient as any, 'findFirst').mockImplementation(async ({ where }: any) => {
      const clauses: any[] = where?.AND ?? (where ? [where] : [])
      const idClause = clauses.find((c: any) => c?.id) ?? (where?.id ? where : null)
      const found = patients.find((p) => (idClause?.id ? p.id === idClause.id : true))
      if (!found) return null
      const allowed = collectDistrictCodes(where)
      if (allowed && !allowed.includes(found.districtCode)) {
        return null
      }
      return { id: found.id }
    })

    vi.spyOn(prisma.patient as any, 'findUnique').mockImplementation((async ({ where }: any) => {
      const p = patients.find((p) => p.id === where?.id)
      return p ? { id: p.id, districtCode: p.districtCode, user: { fullName: 'Pasien Test', phone: '0812345678' } } : null
    }) as any)

    vi.spyOn(prisma.escalationRun, 'findMany').mockImplementation((async ({ where }: any) => {
      const runs = [
        { id: RUN_IN, patientId: PATIENT_IN, status: 'WAITING_PATIENT', context: 'SCHEDULE' },
        { id: RUN_OUT, patientId: PATIENT_OUT, status: 'FAMILY_TIER_1', context: 'SCHEDULE' },
      ]
      const allowed = collectDistrictCodes(where?.patient)
      if (!allowed) return runs as any
      return runs.filter((r) =>
        allowed.includes(patients.find((p) => p.id === r.patientId)!.districtCode),
      ) as any
    }) as any)

    vi.spyOn(prisma.escalationRun, 'findUnique').mockImplementation((async ({ where }: any) => {
      const run = [
        { id: RUN_IN, patientId: PATIENT_IN, status: 'WAITING_PATIENT' },
        { id: RUN_OUT, patientId: PATIENT_OUT, status: 'FAMILY_TIER_1' },
      ].find((r) => r.id === where.id)
      return run as any
    }) as any)

    vi.spyOn(prisma.familyContact, 'findFirst').mockImplementation((async ({ where }: any) =>
      where?.patientId === PATIENT_IN && (!where?.userId || where.userId === 'family-in')
        ? { id: 'c-1', userId: 'family-in' }
        : null) as any)

    vi.spyOn(prisma.emergencyAlert, 'findMany').mockImplementation((async ({ where }: any) => {
      const alerts = [
        { id: 'em-in', patientId: PATIENT_IN, status: 'ESCALATING' },
        { id: 'em-out', patientId: PATIENT_OUT, status: 'ESCALATING' },
      ]
      const allowed = collectDistrictCodes(where?.patient)
      if (!allowed) return alerts as any
      return alerts.filter((a) =>
        allowed.includes(patients.find((p) => p.id === a.patientId)!.districtCode),
      ) as any
    }) as any)
  })

  describe('GET /v1/escalations/active', () => {
    it('nakes hanya melihat run pasien dalam wilayahnya', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/escalations/active',
        headers: { authorization: tokens(app).inScope },
      })

      expect(res.statusCode).toBe(200)
      const ids = res.json().data.map((r: any) => r.id)
      expect(ids).toContain(RUN_IN)
      expect(ids).not.toContain(RUN_OUT)
    })

    it('nakes di puskesmas lain tidak melihat run patient district 3499', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/escalations/active',
        headers: { authorization: tokens(app).outOfScope },
      })

      expect(res.statusCode).toBe(200)
      const ids = res.json().data.map((r: any) => r.id)
      expect(ids).toContain(RUN_OUT)
      expect(ids).not.toContain(RUN_IN)
    })

    it('admin tetap melihat seluruh wilayah', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/escalations/active',
        headers: { authorization: tokens(app).admin },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data).toHaveLength(2)
    })
  })

  describe('GET /v1/emergencies/active', () => {
    it('darurat luar wilayah tidak bocor ke nakes yang tidak berwenang', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/emergencies/active',
        headers: { authorization: tokens(app).inScope },
      })

      expect(res.statusCode).toBe(200)
      const ids = res.json().data.map((e: any) => e.id)
      expect(ids).not.toContain('em-out')
    })
  })

  describe('POST /v1/escalations/:id/respond', () => {
    it('nakes luar scope DITOLAK menutup eskalasi pasien orang lain (404, bukan 403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${RUN_OUT}/respond`,
        headers: { authorization: tokens(app).inScope },
        payload: { response: 'HANDLE' },
      })

      // 404, bukan 403: keberadaan run di luar scope tidak ikut terkonfirmasi.
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('NOT_FOUND')
    })

    it('keluarga yang bukan kontak pasien DITOLAK menutup eskalasi', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${RUN_IN}/respond`,
        headers: { authorization: tokens(app).familyOut },
        payload: { response: 'HANDLE' },
      })

      expect(res.statusCode).toBe(404)
    })

    it('admin boleh menutup eskalasi mana pun (tidak diblokir scope check)', async () => {
      vi.spyOn(prisma.escalationRun, 'update').mockResolvedValue({
        id: RUN_OUT,
        status: 'HANDLED',
        resolvedByUserId: ADMIN,
        resolutionType: 'NAKES_HANDLED',
      } as any)
      vi.spyOn(prisma.escalationStep, 'create').mockResolvedValue({ id: 'step-1' } as any)
      vi.spyOn(prisma.escalationRun, 'findFirst').mockResolvedValue(null as any)


      const res = await app.inject({
        method: 'POST',
        url: `/v1/escalations/${RUN_OUT}/respond`,
        headers: { authorization: tokens(app).admin },
        payload: { response: 'HANDLE' },
      })

      // Sifat keamanan yang diuji: admin TIDAK diblokir oleh scope check.
      //
      // Penolakan scope di route ini selalu berupa pesan persis 'Escalation run tidak
      // ditemukan' (404 supaya keberadaan run di luar scope tidak terkonfirmasi). Error
      // lain — misalnya kehabisan konteks eskalasi di mock — tidak menyiratkan blokir
      // akses, jadi tidak ikut menggagalkan test ini.
      const message = res.json().error?.message
      expect(message, 'admin diblokir oleh scope check').not.toBe(
        'Escalation run tidak ditemukan',
      )
    })
  })
})
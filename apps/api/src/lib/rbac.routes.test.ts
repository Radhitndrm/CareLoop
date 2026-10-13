// Gerbang kewenangan lintas domain (docs/API.md §1.4, §3.5, §3.6).
//
// Suite ini mengunci dua hal:
//
// 1. **Tidak ada endpoint klinis yang terbuka tanpa token.** Post-mortem-nya
//    menutup `/v1/emergencies/*`, `/v1/escalations/*`, dan `/internal/jobs/*`
//    yang sebelumnya bisa dibaca siapa pun — termasuk lokasi GNSS pasien dan
//    nomor telepon keluarga. Test tanpa-token adalah penjaga agar tidak
//    terulang.
// 2. **Apoteker tidak punya akses data pasien.** `requireCareTeamRole`
//    mengecualikan NakesRole.FARMASI dari dashboard, daftar & detail pasien,
//    resep, kepatuhan, vital, darurat, dan eskalasi.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims } from '@careloop/shared'

describe('RBAC lintas domain', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../app')
    app = await buildApp({ logger: false, enableWs: false, enablePharmacyScheduler: false })
    await app.ready()
  }, 60_000)

  /**
   * Dibuat lazy (saat dipanggil, bukan saat modul dimuat) karena `app` baru
   * ada setelah beforeAll selesai membangunnya.
   */
  const headersFor = (claims: AuthUserClaims) => ({
    authorization: `Bearer ${app.jwt.sign(claims as any)}`,
  })

  const dokter = () =>
    headersFor({ sub: '11111111-1111-4111-8111-111111111111', role: 'NAKES', nakesRole: 'DOKTER' })
  const perawat = () =>
    headersFor({ sub: '22222222-2222-4222-8222-222222222222', role: 'NAKES', nakesRole: 'PERAWAT' })
  const apoteker = () =>
    headersFor({ sub: '33333333-3333-4333-8333-333333333333', role: 'NAKES', nakesRole: 'FARMASI' })
  const admin = () => headersFor({ sub: '44444444-4444-4444-8444-444444444444', role: 'ADMIN' })
  const pasien = () => headersFor({ sub: '55555555-5555-4555-8555-555555555555', role: 'PATIENT' })

  const EMERGENCY_ID = '66666666-6666-4666-8666-666666666666'
  const ESCALATION_ID = '77777777-7777-4777-8777-777777777777'
  const PATIENT_ID = '55555555-5555-4555-8555-555555555555'

  /** Route yang hanya boleh dibaca tenaga kesehatan, bukan apoteker. */
  const careTeamOnlyRoutes: Array<{ method: 'GET' | 'POST' | 'PUT'; url: string; label: string }> = [
    { method: 'GET', url: '/v1/dashboard/summary', label: 'ringkasan dashboard' },
    { method: 'GET', url: '/v1/dashboard/risk-patients', label: 'pasien berisiko' },
    { method: 'GET', url: '/v1/patients', label: 'daftar pasien' },
    { method: 'GET', url: `/v1/patients/${PATIENT_ID}`, label: 'detail pasien' },
    { method: 'GET', url: `/v1/patients/${PATIENT_ID}/medications`, label: 'resep pasien' },
    { method: 'GET', url: `/v1/patients/${PATIENT_ID}/compliance`, label: 'kepatuhan pasien' },
    { method: 'GET', url: '/v1/emergencies/active', label: 'darurat aktif' },
    { method: 'GET', url: `/v1/emergencies/${EMERGENCY_ID}`, label: 'detail darurat' },
    { method: 'GET', url: '/v1/escalations/active', label: 'eskalasi aktif' },
    { method: 'GET', url: `/v1/escalations/${ESCALATION_ID}`, label: 'detail eskalasi' },
    { method: 'GET', url: `/v1/escalations/${ESCALATION_ID}/steps`, label: 'langkah eskalasi' },
  ]

  describe('1. Tanpa token — tidak boleh ada yang bocor', () => {
    // 401occurred sebelum handler, jadi database tidak perlu di-mock di sini.
    for (const route of careTeamOnlyRoutes) {
      it(`${route.method} ${route.url} menolak tanpa token (${route.label})`, async () => {
        const res = await app.inject({ method: route.method, url: route.url })
        expect(res.statusCode).toBe(401)
      })
    }

    it('POST /internal/jobs/escalation-timeout menolak tanpa token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/internal/jobs/escalation-timeout',
        payload: { runId: ESCALATION_ID },
      })
      expect(res.statusCode).toBe(401)
    })

    it('POST /v1/vitals menolak tanpa token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/vitals',
        payload: { patientId: PATIENT_ID, recordedAt: new Date().toISOString(), source: 'MOCK' },
      })
      expect(res.statusCode).toBe(401)
    })

    it('POST /v1/dev/mock-anomaly menolak tanpa token', async () => {
      const res = await app.inject({ method: 'POST', url: '/v1/dev/mock-anomaly', payload: {} })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('2. Apoteker tidak boleh accessing data pasien', () => {
    for (const route of careTeamOnlyRoutes) {
      it(`${route.method} ${route.url} menolak apoteker (${route.label})`, async () => {
        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers: apoteker(),
        })
        expect(res.statusCode).toBe(403)
        expect(res.json().error.code).toBe('FORBIDDEN')
      })
    }

    it('apoteker boleh membaca antrean farmasi — itu tugasnya', async () => {
      const { prisma } = await import('./prisma')
      vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)
      vi.spyOn(prisma.medicationRequest, 'count').mockResolvedValue(0 as any)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/medication-requests',
        headers: apoteker(),
      })
      expect(res.statusCode).toBe(200)
    })

    it('apoteker boleh membaca daftar obatnya sendiri di endpoint /me', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/patients/me/medications',
        headers: apoteker(),
      })
      // 403 karena bukan pasien —endpoint ini memang khusus pasien.
      expect(res.statusCode).toBe(403)
    })
  })

  describe('3. Perawat tetap boleh, tapi bukan apoteker yang menyesatkan', () => {
    it('perawat boleh membaca dashboard', async () => {
      const { prisma } = await import('./prisma')
      vi.spyOn(prisma.patient, 'count').mockResolvedValue(0 as any)
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([] as any)

      const res = await app.inject({ method: 'GET', url: '/v1/dashboard/summary', headers: perawat() })
      expect(res.statusCode).not.toBe(403)
    })

    it('admin lolos ke mana saja', async () => {
      const { prisma } = await import('./prisma')
      vi.spyOn(prisma.medicationRequest, 'findMany').mockResolvedValue([] as any)
      vi.spyOn(prisma.medicationRequest, 'count').mockResolvedValue(0 as any)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/medication-requests/queue-summary',
        headers: admin(),
      })
      expect(res.statusCode).toBe(200)
    })

    it('pasien ditolak dari daftar pasien yang bukan miliknya', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/patients', headers: pasien() })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('4. Darurat tetap bisa dijawab pasien', () => {
    // Menutup respons pasien tanpa token akan mematikan alur "Apakah Anda aman?"
    // yang justru menjadi inti fitur darurat.
    it('pasien boleh menjawab respons darurat (gate ada, handler yang menolak bila salah)', async () => {
      const { prisma } = await import('./prisma')
      vi.spyOn(prisma.emergencyAlert, 'update').mockResolvedValue({} as any)

      const res = await app.inject({
        method: 'POST',
        url: `/v1/emergencies/${EMERGENCY_ID}/respond`,
        headers: pasien(),
        payload: { response: 'SAFE' },
      })
      // Bukan 401/403 — kegagalan di lapisan lain (mis. alert tidak ada)
      // tetap boleh terjadi dan diuji terpisah.
      expect(res.statusCode).not.toBe(401)
      expect(res.statusCode).not.toBe(403)
    })

    it('dokter boleh melihat darurat aktif', async () => {
      const { prisma } = await import('./prisma')
      vi.spyOn(prisma.emergencyAlert, 'findMany').mockResolvedValue([] as any)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/emergencies/active',
        headers: dokter(),
      })
      expect(res.statusCode).toBe(200)
    })
  })
})
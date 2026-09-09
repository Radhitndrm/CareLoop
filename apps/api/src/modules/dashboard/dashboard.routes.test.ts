// CL-209: Integration test suite untuk route dashboard nakes (docs/API.md §3.8, AC-5.1, AC-5.3).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { ComplianceStatus, EmergencyStatus, EscalationRunStatus, RiskLevel } from '@careloop/shared'

describe('CL-209: Dashboard Routes Integration (docs/API.md §3.8)', () => {
  let app: FastifyInstance
  let tokenNakes: string
  let tokenAdmin: string
  let tokenPatient: string

  const dummyNakesId = '11111111-1111-4111-8111-111111111111'
  const dummyAdminId = '22222222-2222-4222-8222-222222222222'
  const dummyPatientId = '33333333-3333-4333-8333-333333333333'

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-dashboard-minimal-32-chars-long'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })

    tokenNakes = app.jwt.sign({ sub: dummyNakesId, role: 'NAKES' })
    tokenAdmin = app.jwt.sign({ sub: dummyAdminId, role: 'ADMIN' })
    tokenPatient = app.jwt.sign({ sub: dummyPatientId, role: 'PATIENT' })

    // Default safe Prisma mocks untuk eksekusi offline
    vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma))
    if (prisma.nakesAssignment) {
      vi.spyOn(prisma.nakesAssignment, 'findMany').mockResolvedValue([
        { puskesmasId: 'psk-1', districtCode: '3471' },
      ] as any)
    }
  })

  describe('Autentikasi & Otorisasi Role (AC-5.3)', () => {
    it('401 — GET /v1/dashboard/summary ditolak jika tanpa token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('UNAUTHORIZED')
    })

    it('403 — GET /v1/dashboard/summary ditolak jika role bukan NAKES atau ADMIN (misal PATIENT)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
        headers: { Authorization: `Bearer ${tokenPatient}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
    })
  })

  describe('GET /v1/dashboard/summary', () => {
    it('200 — mengembalikan envelope data ringkasan KPI dan adherence rate nakes', async () => {
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([
        { id: dummyPatientId, riskLevel: RiskLevel.HIGH, riskScore: 82 },
      ] as any)

      vi.spyOn(prisma.complianceLog, 'findMany').mockResolvedValue([
        { status: ComplianceStatus.CONFIRMED, scheduledAt: new Date() },
        { status: ComplianceStatus.CONFIRMED, scheduledAt: new Date() },
        { status: ComplianceStatus.MISSED, scheduledAt: new Date() },
      ] as any)

      if (prisma.emergencyAlert) {
        vi.spyOn(prisma.emergencyAlert, 'count').mockResolvedValue(1)
      }
      if (prisma.escalationRun) {
        vi.spyOn(prisma.escalationRun, 'count').mockResolvedValue(0)
      }

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.totalPatients).toBe(1)
      expect(body.data.confirmedCount).toBe(2)
      expect(body.data.missedCount).toBe(1)
      // 2 / 3 = 0.67
      expect(body.data.adherenceRate).toBe(0.67)
      expect(body.data.activeEmergencies).toBe(1)
      expect(body.data.atRiskPatients).toBe(1)
      expect(body.data.trends).toBeDefined()
    })

    it('200 — admin dapat mengakses summary global', async () => {
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([])

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/summary',
        headers: { Authorization: `Bearer ${tokenAdmin}` },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json().data.totalPatients).toBe(0)
      expect(res.json().data.adherenceRate).toBe(0)
    })
  })

  describe('GET /v1/dashboard/adherence', () => {
    it('200 — mengembalikan grafik deret waktu kepatuhan dan breakdown penyakit', async () => {
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([
        { id: dummyPatientId, healthConditions: ['DIABETES'] },
      ] as any)

      vi.spyOn(prisma.complianceLog, 'findMany').mockResolvedValue([
        {
          patientId: dummyPatientId,
          status: ComplianceStatus.CONFIRMED,
          scheduledAt: new Date('2026-08-16T08:00:00Z'),
        },
      ] as any)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/adherence',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.period).toBeDefined()
      expect(body.data.series).toBeInstanceOf(Array)
      expect(body.data.byDisease).toBeInstanceOf(Array)
      expect(body.data.byDisease[0]).toMatchObject({
        disease: 'DIABETES',
        adherenceRate: 1,
      })
    })
  })

  describe('GET /v1/dashboard/risk-patients', () => {
    it('200 — mengembalikan daftar pasien berisiko tinggi dalam scope nakes', async () => {
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([
        {
          id: dummyPatientId,
          districtCode: '3471',
          livingSituation: 'ALONE',
          healthConditions: ['DIABETES'],
          riskScore: 85,
          riskLevel: RiskLevel.HIGH,
          user: { fullName: 'Bu Ratna', phone: '081234567890' },
          complianceLogs: [
            { status: ComplianceStatus.CONFIRMED },
            { status: ComplianceStatus.MISSED },
          ],
        },
      ] as any)

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/risk-patients',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeInstanceOf(Array)
      expect(body.data[0].id).toBe(dummyPatientId)
      expect(body.data[0].fullName).toBe('Bu Ratna')
      expect(body.data[0].riskLevel).toBe('HIGH')
    })
  })

  describe('GET /v1/dashboard/alerts', () => {
    it('200 — mengembalikan stream alert darurat dan eskalasi aktif', async () => {
      vi.spyOn(prisma.patient, 'findMany').mockResolvedValue([
        {
          id: dummyPatientId,
          districtCode: '3471',
          user: { fullName: 'Bu Ratna' },
          nakesContacts: [{ puskesmasId: 'psk-1' }],
        },
      ] as any)

      if (prisma.emergencyAlert) {
        vi.spyOn(prisma.emergencyAlert, 'findMany').mockResolvedValue([
          {
            id: 'em-01',
            patientId: dummyPatientId,
            triggerType: 'ANOMALY_HR',
            hrBpm: 142,
            status: EmergencyStatus.ESCALATING,
            triggeredAt: new Date('2026-08-16T02:00:00Z'),
            locationLat: -7.79,
            locationLng: 110.37,
          },
        ] as any)
      }

      if (prisma.escalationRun) {
        vi.spyOn(prisma.escalationRun, 'findMany').mockResolvedValue([
          {
            id: 'esc-01',
            patientId: dummyPatientId,
            context: 'SCHEDULE',
            status: EscalationRunStatus.FAMILY_TIER_1,
            currentTier: 'TIER_1',
            startedAt: new Date('2026-08-16T08:00:00Z'),
          },
        ] as any)
      }

      const res = await app.inject({
        method: 'GET',
        url: '/v1/dashboard/alerts',
        headers: { Authorization: `Bearer ${tokenNakes}` },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data.emergencies).toHaveLength(1)
      expect(body.data.emergencies[0].id).toBe('em-01')
      expect(body.data.emergencies[0].patientName).toBe('Bu Ratna')
      expect(body.data.escalations).toHaveLength(1)
      expect(body.data.totalActive).toBe(2)
    })
  })
})

// CL-209: Unit tests untuk service agregasi dashboard nakes (AC-5.1, AC-5.3).
import { describe, expect, it, vi } from 'vitest'
import {
  calculateAdherenceRate,
  resolveNakesScope,
  buildScopedPatientWhere,
  getDashboardSummary,
  getDashboardAdherence,
  getDashboardRiskPatients,
  getDashboardAlerts,
} from './dashboard.service'
import {
  ComplianceStatus,
  EmergencyStatus,
  EscalationRunStatus,
  RiskLevel,
} from '@careloop/shared'

describe('CL-209: Dashboard Aggregation Service', () => {
  describe('calculateAdherenceRate (AC-5.1)', () => {
    it('mengembalikan 0 saat total jadwal nol (pembagian nol aman)', () => {
      expect(calculateAdherenceRate(0, 0)).toBe(0)
      expect(calculateAdherenceRate(5, 0)).toBe(0)
      expect(calculateAdherenceRate(0, -1)).toBe(0)
    })

    it('menghitung rasio konfirmasi tepat waktu dengan tepat dan dibulatkan 2 desimal', () => {
      expect(calculateAdherenceRate(80, 100)).toBe(0.8)
      expect(calculateAdherenceRate(82, 90)).toBe(0.91)
      expect(calculateAdherenceRate(100, 100)).toBe(1)
      expect(calculateAdherenceRate(1, 3)).toBe(0.33)
    })
  })

  describe('resolveNakesScope & buildScopedPatientWhere (AC-5.3)', () => {
    it('role ADMIN memiliki akses global tanpa filter pasien terbatas', async () => {
      const scope = await resolveNakesScope({}, { sub: 'admin-1', role: 'ADMIN' })
      expect(scope.isAdmin).toBe(true)
      expect(scope.puskesmasIds).toEqual([])
      expect(scope.districtCodes).toEqual([])

      const where = buildScopedPatientWhere(scope)
      expect(where).toEqual({})
    })

    it('role NAKES di-scope ke puskesmas dan distrik penugasannya', async () => {
      const mockPrisma = {
        nakesAssignment: {
          findMany: vi.fn().mockResolvedValue([
            { puskesmasId: 'puskesmas-101', districtCode: '3471' },
          ]),
        },
      }

      const scope = await resolveNakesScope(mockPrisma, { sub: 'nakes-1', role: 'NAKES' })
      expect(scope.isAdmin).toBe(false)
      expect(scope.puskesmasIds).toEqual(['puskesmas-101'])
      expect(scope.districtCodes).toEqual(['3471'])

      const where = buildScopedPatientWhere(scope)
      expect(where).toHaveProperty('OR')
    })
  })

  describe('getDashboardSummary (AC-5.1, AC-5.3)', () => {
    it('mengembalikan metrik nol jika tidak ada pasien dalam scope', async () => {
      const mockPrisma = {
        nakesAssignment: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        patient: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      }

      const summary = await getDashboardSummary(mockPrisma, { sub: 'nakes-empty', role: 'NAKES' })
      expect(summary.totalPatients).toBe(0)
      expect(summary.adherenceRate).toBe(0)
      expect(summary.confirmedCount).toBe(0)
      expect(summary.activeEmergencies).toBe(0)
    })

    it('menghitung metrik KPI, kepatuhan, darurat, dan eskalasi aktif sesuai formula', async () => {
      const mockPrisma = {
        patient: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'p1', riskLevel: RiskLevel.HIGH, riskScore: 85 },
            { id: 'p2', riskLevel: RiskLevel.LOW, riskScore: 30 },
          ]),
        },
        complianceLog: {
          findMany: vi.fn().mockResolvedValue([
            { status: ComplianceStatus.CONFIRMED, scheduledAt: new Date() },
            { status: ComplianceStatus.CONFIRMED, scheduledAt: new Date() },
            { status: ComplianceStatus.CONFIRMED_LATE, scheduledAt: new Date() },
            { status: ComplianceStatus.MISSED, scheduledAt: new Date() },
            { status: ComplianceStatus.PENDING, scheduledAt: new Date() },
          ]),
        },
        emergencyAlert: {
          count: vi.fn().mockResolvedValue(2),
        },
        escalationRun: {
          count: vi.fn().mockResolvedValue(1),
        },
      }

      const summary = await getDashboardSummary(mockPrisma, { sub: 'admin-1', role: 'ADMIN' })

      expect(summary.totalPatients).toBe(2)
      expect(summary.confirmedCount).toBe(2)
      expect(summary.confirmedLateCount).toBe(1)
      expect(summary.missedCount).toBe(1)
      expect(summary.pendingCount).toBe(1)
      // total evaluated = 2 confirmed + 1 late + 1 missed = 4. adherence = 2 / 4 = 0.5
      expect(summary.adherenceRate).toBe(0.5)
      expect(summary.activeEmergencies).toBe(2)
      expect(summary.activeEscalations).toBe(1)
      expect(summary.atRiskPatients).toBe(1)
      expect(summary.trends).toBeDefined()
    })
  })

  describe('getDashboardAdherence (docs/API.md §3.8)', () => {
    it('mengelompokkan deret waktu per hari dan agregasi per jenis penyakit', async () => {
      const mockPrisma = {
        patient: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'p1', healthConditions: ['DIABETES', 'HYPERTENSION'] },
            { id: 'p2', healthConditions: ['DIABETES'] },
          ]),
        },
        complianceLog: {
          findMany: vi.fn().mockResolvedValue([
            { patientId: 'p1', status: ComplianceStatus.CONFIRMED, scheduledAt: new Date('2026-08-10T08:00:00Z') },
            { patientId: 'p2', status: ComplianceStatus.MISSED, scheduledAt: new Date('2026-08-10T08:00:00Z') },
            { patientId: 'p1', status: ComplianceStatus.CONFIRMED, scheduledAt: new Date('2026-08-11T08:00:00Z') },
          ]),
        },
      }

      const adherence = await getDashboardAdherence(mockPrisma, { sub: 'admin-1', role: 'ADMIN' })

      expect(adherence.period).toBeDefined()
      expect(adherence.series).toHaveLength(2)
      expect(adherence.series[0].date).toBe('2026-08-10')
      expect(adherence.series[0].confirmed).toBe(1)
      expect(adherence.series[0].missed).toBe(1)
      expect(adherence.series[0].adherenceRate).toBe(0.5)

      expect(adherence.byDisease).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ disease: 'DIABETES' }),
          expect.objectContaining({ disease: 'HYPERTENSION' }),
        ]),
      )
    })
  })

  describe('getDashboardRiskPatients (docs/API.md §3.8)', () => {
    it('mengembalikan daftar pasien berisiko tinggi dengan metrik kepatuhan', async () => {
      const mockPrisma = {
        patient: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'p1',
              districtCode: '3471',
              livingSituation: 'ALONE',
              healthConditions: ['DIABETES'],
              riskScore: 82,
              riskLevel: RiskLevel.HIGH,
              user: { fullName: 'Bu Ratna', phone: '081234567890' },
              complianceLogs: [
                { status: ComplianceStatus.CONFIRMED },
                { status: ComplianceStatus.MISSED },
              ],
            },
          ]),
        },
      }

      const result = await getDashboardRiskPatients(mockPrisma, { sub: 'admin-1', role: 'ADMIN' })
      expect(result).toHaveLength(1)
      expect(result[0].fullName).toBe('Bu Ratna')
      expect(result[0].riskLevel).toBe('HIGH')
      expect(result[0].adherenceRate).toBe(0.5)
      expect(result[0].missedDosesLastWeek).toBe(1)
    })
  })

  describe('getDashboardAlerts (docs/API.md §3.8)', () => {
    it('mengembalikan daftar alert darurat aktif dan eskalasi aktif', async () => {
      const mockPrisma = {
        patient: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'p1',
              districtCode: '3471',
              user: { fullName: 'Pak Budi' },
              nakesContacts: [{ puskesmasId: 'psk-1' }],
            },
          ]),
        },
        emergencyAlert: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'em-1',
              patientId: 'p1',
              triggerType: 'ANOMALY_HR',
              hrBpm: 140,
              status: EmergencyStatus.ESCALATING,
              triggeredAt: new Date('2026-08-16T02:00:00Z'),
              locationLat: -7.79,
              locationLng: 110.37,
            },
          ]),
        },
        escalationRun: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'esc-1',
              patientId: 'p1',
              context: 'SCHEDULE',
              status: EscalationRunStatus.FAMILY_TIER_1,
              currentTier: 'TIER_1',
              startedAt: new Date('2026-08-16T08:00:00Z'),
            },
          ]),
        },
      }

      const alerts = await getDashboardAlerts(mockPrisma, { sub: 'admin-1', role: 'ADMIN' })
      expect(alerts.emergencies).toHaveLength(1)
      expect(alerts.emergencies[0].patientName).toBe('Pak Budi')
      expect(alerts.emergencies[0].hrBpm).toBe(140)
      expect(alerts.escalations).toHaveLength(1)
      expect(alerts.escalations[0].status).toBe(EscalationRunStatus.FAMILY_TIER_1)
      expect(alerts.totalActive).toBe(2)
    })
  })
})

// CL-209: Service agregasi dashboard nakes (adherence, summary, trends, at-risk patients, active alerts).
// Memastikan perhitungan adherence rate sesuai formula (AC-5.1), penanganan pembagian nol (0/0 = 0),
// dan pembatasan data dalam wilayah/faskes binaan nakes (AC-5.3, FR-5.1, docs/API.md §3.8).
import type { PrismaClient } from '@prisma/client'
import type { AuthUserClaims } from '@careloop/shared'
import {
  ComplianceStatus,
  EmergencyStatus,
  EscalationRunStatus,
  RiskLevel,
} from '@careloop/shared'

export interface DashboardFilterOptions {
  district?: string
  disease?: string
  from?: string | Date
  to?: string | Date
  escalationStatus?: string
}

export interface NakesScope {
  isAdmin: boolean
  nakesUserId: string
  puskesmasIds: string[]
  districtCodes: string[]
  patientFilter: Record<string, unknown>
}

export interface AdherenceMetrics {
  adherenceRate: number
  confirmedCount: number
  confirmedLateCount: number
  missedCount: number
  pendingCount: number
  totalEvaluated: number
}

export interface DashboardSummaryData {
  totalPatients: number
  adherenceRate: number
  confirmedCount: number
  confirmedLateCount: number
  missedCount: number
  pendingCount: number
  activeEmergencies: number
  activeEscalations: number
  atRiskPatients: number
  trends: {
    dailyRate: number
    weeklyRate: number
    direction: 'UP' | 'DOWN' | 'STABLE'
  }
}

export interface DailyAdherenceSeries {
  date: string
  adherenceRate: number
  confirmed: number
  missed: number
  total: number
}

export interface DiseaseAdherence {
  disease: string
  adherenceRate: number
  total: number
}

export interface DashboardAdherenceData {
  period: {
    from: string
    to: string
  }
  series: DailyAdherenceSeries[]
  byDisease: DiseaseAdherence[]
}

export interface AtRiskPatientItem {
  id: string
  fullName: string
  phone: string
  districtCode: string | null
  livingSituation: string
  healthConditions: string[]
  riskScore: number
  riskLevel: string
  adherenceRate: number
  missedDosesLastWeek: number
}

export interface ActiveAlertsData {
  emergencies: Array<{
    id: string
    patientId: string
    patientName: string
    triggerType: string
    hrBpm: number | null
    status: string
    triggeredAt: string
    location: {
      lat: number | null
      lng: number | null
    } | null
    puskesmasId: string | null
    districtCode: string | null
  }>
  escalations: Array<{
    id: string
    patientId: string
    patientName: string
    context: string
    status: string
    currentTier: string | null
    startedAt: string
  }>
  totalActive: number
}

/**
 * Menghitung tingkat kepatuhan (adherence rate) sesuai formula AC-5.1:
 * adherence = konfirmasi_tepat_waktu / total_jadwal
 * Aman dari pembagian nol: jika total 0, mengembalikan 0 (bukan NaN atau error).
 */
export function calculateAdherenceRate(confirmedOnTime: number, totalSchedules: number): number {
  if (totalSchedules <= 0) return 0
  const rate = confirmedOnTime / totalSchedules
  return Math.round(rate * 100) / 100 // pembulatan 2 desimal (0.00 - 1.00)
}

/**
 * Menentukan batasan scope pasien untuk Nakes/Admin (AC-5.3).
 * Admin dapat mengakses seluruh pasien.
 * Nakes hanya dapat mengakses pasien di puskesmas atau distrik penugasannya.
 */
export async function resolveNakesScope(
  client: any,
  claims: AuthUserClaims,
): Promise<NakesScope> {
  if (claims.role === 'ADMIN') {
    return {
      isAdmin: true,
      nakesUserId: claims.sub,
      puskesmasIds: [],
      districtCodes: [],
      patientFilter: {},
    }
  }

  let assignments: Array<{ puskesmasId: string | null; districtCode: string | null }> = []

  if (client.nakesAssignment?.findMany) {
    assignments = await client.nakesAssignment.findMany({
      where: { nakesUserId: claims.sub, isActive: true },
      select: { puskesmasId: true, districtCode: true },
    })
  }

  const puskesmasIds = assignments
    .map((a) => a.puskesmasId)
    .filter((id): id is string => Boolean(id))

  const districtCodes = assignments
    .map((a) => a.districtCode)
    .filter((code): code is string => Boolean(code))

  const conditions: any[] = []

  if (districtCodes.length > 0) {
    conditions.push({ districtCode: { in: districtCodes } })
  }

  if (puskesmasIds.length > 0) {
    conditions.push({
      nakesContacts: {
        some: {
          puskesmasId: { in: puskesmasIds },
          isActive: true,
        },
      },
    })
  }

  // Nakes juga dapat melihat pasien yang langsung di-assign ke dirinya
  conditions.push({
    nakesContacts: {
      some: {
        nakesUserId: claims.sub,
        isActive: true,
      },
    },
  })

  return {
    isAdmin: false,
    nakesUserId: claims.sub,
    puskesmasIds,
    districtCodes,
    patientFilter: conditions.length > 0 ? { OR: conditions } : { id: 'impossible-no-scope' },
  }
}

/**
 * Membangun query WHERE pasien dengan mempertimbangkan scope nakes dan filter opsional.
 */
export function buildScopedPatientWhere(
  scope: NakesScope,
  filter?: DashboardFilterOptions,
): Record<string, unknown> {
  const andClauses: any[] = []

  if (!scope.isAdmin && Object.keys(scope.patientFilter).length > 0) {
    andClauses.push(scope.patientFilter)
  }

  if (filter?.district) {
    andClauses.push({ districtCode: filter.district.trim() })
  }

  if (filter?.disease) {
    const diseaseInput = filter.disease.trim()
    const diseaseUpper = diseaseInput.toUpperCase()
    if (diseaseInput === diseaseUpper) {
      andClauses.push({ healthConditions: { has: diseaseUpper } })
    } else {
      andClauses.push({
        OR: [
          { healthConditions: { has: diseaseUpper } },
          { healthConditions: { has: diseaseInput } },
        ],
      })
    }
  }

  if (filter?.escalationStatus) {
    andClauses.push({
      escalationRuns: {
        some: {
          status: filter.escalationStatus.trim(),
        },
      },
    })
  }

  if (andClauses.length === 0) return {}
  if (andClauses.length === 1) return andClauses[0]
  return { AND: andClauses }
}

/**
 * GET /v1/dashboard/summary: Metrik KPI kepatuhan, tren, pasien berisiko, dan darurat aktif (AC-5.1, AC-5.3).
 */
export async function getDashboardSummary(
  client: any,
  claims: AuthUserClaims,
  filter?: DashboardFilterOptions,
): Promise<DashboardSummaryData> {
  const scope = await resolveNakesScope(client, claims)
  const patientWhere = buildScopedPatientWhere(scope, filter)

  // 1. Ambil daftar pasien dalam scope
  const patients = client.patient?.findMany
    ? await client.patient.findMany({
        where: patientWhere,
        select: {
          id: true,
          riskLevel: true,
          riskScore: true,
        },
      })
    : []

  const totalPatients = patients.length
  const patientIds = patients.map((p: any) => p.id)

  if (totalPatients === 0 || patientIds.length === 0) {
    return {
      totalPatients: 0,
      adherenceRate: 0,
      confirmedCount: 0,
      confirmedLateCount: 0,
      missedCount: 0,
      pendingCount: 0,
      activeEmergencies: 0,
      activeEscalations: 0,
      atRiskPatients: 0,
      trends: {
        dailyRate: 0,
        weeklyRate: 0,
        direction: 'STABLE',
      },
    }
  }

  // 2. Ambil log kepatuhan pasien-pasien ini
  const complianceWhere: any = {
    patientId: { in: patientIds },
  }

  if (filter?.from || filter?.to) {
    complianceWhere.scheduledAt = {}
    if (filter.from) complianceWhere.scheduledAt.gte = new Date(filter.from)
    if (filter.to) complianceWhere.scheduledAt.lte = new Date(filter.to)
  }

  const complianceLogs = client.complianceLog?.findMany
    ? await client.complianceLog.findMany({
        where: complianceWhere,
        select: {
          status: true,
          scheduledAt: true,
        },
      })
    : []

  let confirmedCount = 0
  let confirmedLateCount = 0
  let missedCount = 0
  let pendingCount = 0

  for (const log of complianceLogs) {
    if (log.status === ComplianceStatus.CONFIRMED) confirmedCount++
    else if (log.status === ComplianceStatus.CONFIRMED_LATE) confirmedLateCount++
    else if (log.status === ComplianceStatus.MISSED) missedCount++
    else if (log.status === ComplianceStatus.PENDING) pendingCount++
  }

  const totalEvaluated = confirmedCount + confirmedLateCount + missedCount
  const adherenceRate = calculateAdherenceRate(confirmedCount, totalEvaluated)

  // 3. Hitung alert darurat aktif (PENDING_PATIENT_CONFIRM atau ESCALATING)
  const emergencyWhere: any = {
    patientId: { in: patientIds },
    status: { in: [EmergencyStatus.PENDING_PATIENT_CONFIRM, EmergencyStatus.ESCALATING] },
  }
  if (filter?.from || filter?.to) {
    emergencyWhere.triggeredAt = {}
    if (filter.from) emergencyWhere.triggeredAt.gte = new Date(filter.from)
    if (filter.to) emergencyWhere.triggeredAt.lte = new Date(filter.to)
  }

  const activeEmergencies = client.emergencyAlert?.count
    ? await client.emergencyAlert.count({
        where: emergencyWhere,
      })
    : 0

  // 4. Hitung eskalasi kepatuhan aktif
  const activeEscalationStatuses = [
    EscalationRunStatus.WAITING_PATIENT,
    EscalationRunStatus.FAMILY_TIER_1,
    EscalationRunStatus.FAMILY_TIER_2,
    EscalationRunStatus.NAKES,
  ]

  const escalationWhere: any = {
    patientId: { in: patientIds },
    status: filter?.escalationStatus
      ? filter.escalationStatus.trim()
      : { in: activeEscalationStatuses },
  }
  if (filter?.from || filter?.to) {
    escalationWhere.startedAt = {}
    if (filter.from) escalationWhere.startedAt.gte = new Date(filter.from)
    if (filter.to) escalationWhere.startedAt.lte = new Date(filter.to)
  }

  const activeEscalations = client.escalationRun?.count
    ? await client.escalationRun.count({
        where: escalationWhere,
      })
    : 0

  // 5. Hitung pasien berisiko (HIGH risk atau riskScore >= 70)
  const atRiskPatients = patients.filter(
    (p: any) => p.riskLevel === RiskLevel.HIGH || (p.riskScore !== null && p.riskScore >= 70),
  ).length

  // 6. Tren kepatuhan harian vs mingguan
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const dailyLogs = complianceLogs.filter((l: any) => new Date(l.scheduledAt) >= oneDayAgo)
  const weeklyLogs = complianceLogs.filter((l: any) => new Date(l.scheduledAt) >= sevenDaysAgo)

  const dailyConfirmed = dailyLogs.filter((l: any) => l.status === ComplianceStatus.CONFIRMED).length
  const dailyTotal = dailyLogs.filter((l: any) => l.status !== ComplianceStatus.PENDING).length
  const dailyRate = calculateAdherenceRate(dailyConfirmed, dailyTotal)

  const weeklyConfirmed = weeklyLogs.filter((l: any) => l.status === ComplianceStatus.CONFIRMED).length
  const weeklyTotal = weeklyLogs.filter((l: any) => l.status !== ComplianceStatus.PENDING).length
  const weeklyRate = calculateAdherenceRate(weeklyConfirmed, weeklyTotal)

  let direction: 'UP' | 'DOWN' | 'STABLE' = 'STABLE'
  if (dailyRate > weeklyRate + 0.03) direction = 'UP'
  else if (dailyRate < weeklyRate - 0.03) direction = 'DOWN'

  return {
    totalPatients,
    adherenceRate,
    confirmedCount,
    confirmedLateCount,
    missedCount,
    pendingCount,
    activeEmergencies,
    activeEscalations,
    atRiskPatients,
    trends: {
      dailyRate: dailyTotal > 0 ? dailyRate : adherenceRate,
      weeklyRate: weeklyTotal > 0 ? weeklyRate : adherenceRate,
      direction,
    },
  }
}

/**
 * GET /v1/dashboard/adherence: Deret waktu grafik kepatuhan per hari & per penyakit (docs/API.md §3.8).
 */
export async function getDashboardAdherence(
  client: any,
  claims: AuthUserClaims,
  filter?: DashboardFilterOptions,
): Promise<DashboardAdherenceData> {
  const scope = await resolveNakesScope(client, claims)
  const patientWhere = buildScopedPatientWhere(scope, filter)

  const patients = client.patient?.findMany
    ? await client.patient.findMany({
        where: patientWhere,
        select: {
          id: true,
          healthConditions: true,
        },
      })
    : []

  const patientMap = new Map<string, string[]>()
  for (const p of patients) {
    patientMap.set(p.id, p.healthConditions ?? [])
  }
  const patientIds = Array.from(patientMap.keys())

  const toDate = filter?.to ? new Date(filter.to) : new Date()
  const fromDate = filter?.from
    ? new Date(filter.from)
    : new Date(toDate.getTime() - 14 * 24 * 60 * 60 * 1000)

  const logs = client.complianceLog?.findMany && patientIds.length > 0
    ? await client.complianceLog.findMany({
        where: {
          patientId: { in: patientIds },
          scheduledAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        select: {
          patientId: true,
          status: true,
          scheduledAt: true,
        },
        orderBy: { scheduledAt: 'asc' },
      })
    : []

  // Agregasi harian (series)
  const dailyGroups = new Map<string, { confirmed: number; missed: number; total: number }>()

  for (const log of logs) {
    const day = new Date(log.scheduledAt).toISOString().split('T')[0]
    if (!dailyGroups.has(day)) {
      dailyGroups.set(day, { confirmed: 0, missed: 0, total: 0 })
    }
    const current = dailyGroups.get(day)!
    if (log.status === ComplianceStatus.CONFIRMED) {
      current.confirmed++
      current.total++
    } else if (log.status === ComplianceStatus.MISSED) {
      current.missed++
      current.total++
    } else if (log.status === ComplianceStatus.CONFIRMED_LATE) {
      current.total++
    }
  }

  const series: DailyAdherenceSeries[] = Array.from(dailyGroups.entries())
    .map(([date, counts]) => ({
      date,
      adherenceRate: calculateAdherenceRate(counts.confirmed, counts.total),
      confirmed: counts.confirmed,
      missed: counts.missed,
      total: counts.total,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Agregasi berdasarkan jenis penyakit (byDisease)
  const diseaseGroups = new Map<string, { confirmed: number; total: number }>()

  for (const log of logs) {
    const conditions = patientMap.get(log.patientId) ?? []
    for (const d of conditions) {
      const normalized = d.trim().toUpperCase()
      if (!diseaseGroups.has(normalized)) {
        diseaseGroups.set(normalized, { confirmed: 0, total: 0 })
      }
      const dg = diseaseGroups.get(normalized)!
      if (log.status === ComplianceStatus.CONFIRMED) {
        dg.confirmed++
        dg.total++
      } else if (log.status === ComplianceStatus.MISSED || log.status === ComplianceStatus.CONFIRMED_LATE) {
        dg.total++
      }
    }
  }

  const byDisease: DiseaseAdherence[] = Array.from(diseaseGroups.entries()).map(
    ([disease, counts]) => ({
      disease,
      adherenceRate: calculateAdherenceRate(counts.confirmed, counts.total),
      total: counts.total,
    }),
  )

  return {
    period: {
      from: fromDate.toISOString().split('T')[0],
      to: toDate.toISOString().split('T')[0],
    },
    series,
    byDisease,
  }
}

/**
 * GET /v1/dashboard/risk-patients: Pasien berisiko tinggi dalam scope nakes (docs/API.md §3.8).
 */
export async function getDashboardRiskPatients(
  client: any,
  claims: AuthUserClaims,
  filter?: DashboardFilterOptions,
): Promise<AtRiskPatientItem[]> {
  const scope = await resolveNakesScope(client, claims)
  const patientWhere = buildScopedPatientWhere(scope, filter)

  const riskCondition = {
    OR: [
      { riskLevel: RiskLevel.HIGH },
      { riskScore: { gte: 70 } },
    ],
  }

  const finalWhere = Object.keys(patientWhere).length > 0
    ? { AND: [patientWhere, riskCondition] }
    : riskCondition

  const complianceWhere: any = {}
  if (filter?.from || filter?.to) {
    complianceWhere.scheduledAt = {}
    if (filter.from) complianceWhere.scheduledAt.gte = new Date(filter.from)
    if (filter.to) complianceWhere.scheduledAt.lte = new Date(filter.to)
  } else {
    complianceWhere.scheduledAt = {
      gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    }
  }

  const patients = client.patient?.findMany
    ? await client.patient.findMany({
        where: finalWhere,
        include: {
          user: { select: { fullName: true, phone: true } },
          complianceLogs: {
            where: complianceWhere,
            select: { status: true },
          },
        },
        orderBy: [{ riskScore: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      })
    : []

  return patients.map((p: any) => {
    const logs = p.complianceLogs ?? []
    const confirmed = logs.filter((l: any) => l.status === ComplianceStatus.CONFIRMED).length
    const missedDoses = logs.filter((l: any) => l.status === ComplianceStatus.MISSED).length
    const total = logs.filter((l: any) => l.status !== ComplianceStatus.PENDING).length

    return {
      id: p.id,
      fullName: p.user?.fullName ?? 'Pasien',
      phone: p.user?.phone ?? '-',
      districtCode: p.districtCode,
      livingSituation: p.livingSituation,
      healthConditions: p.healthConditions ?? [],
      riskScore: p.riskScore ?? 0,
      riskLevel: p.riskLevel ?? 'LOW',
      adherenceRate: calculateAdherenceRate(confirmed, total),
      missedDosesLastWeek: missedDoses,
    }
  })
}

/**
 * GET /v1/dashboard/alerts: Stream/daftar alert darurat dan eskalasi aktif nakes (docs/API.md §3.8).
 */
export async function getDashboardAlerts(
  client: any,
  claims: AuthUserClaims,
  filter?: DashboardFilterOptions,
): Promise<ActiveAlertsData> {
  const scope = await resolveNakesScope(client, claims)
  const patientWhere = buildScopedPatientWhere(scope, filter)

  const patients = client.patient?.findMany
    ? await client.patient.findMany({
        where: patientWhere,
        select: {
          id: true,
          districtCode: true,
          user: { select: { fullName: true } },
          nakesContacts: {
            where: { isActive: true },
            select: { puskesmasId: true },
          },
        },
      })
    : []

  const patientMap = new Map<string, any>()
  for (const p of patients) {
    patientMap.set(p.id, p)
  }
  const patientIds = Array.from(patientMap.keys())

  if (patientIds.length === 0) {
    return { emergencies: [], escalations: [], totalActive: 0 }
  }

  // 1. Ambil EmergencyAlerts aktif
  const emergencyWhere: any = {
    patientId: { in: patientIds },
    status: { in: [EmergencyStatus.PENDING_PATIENT_CONFIRM, EmergencyStatus.ESCALATING] },
  }
  if (filter?.from || filter?.to) {
    emergencyWhere.triggeredAt = {}
    if (filter.from) emergencyWhere.triggeredAt.gte = new Date(filter.from)
    if (filter.to) emergencyWhere.triggeredAt.lte = new Date(filter.to)
  }

  const rawEmergencies = client.emergencyAlert?.findMany
    ? await client.emergencyAlert.findMany({
        where: emergencyWhere,
        orderBy: { triggeredAt: 'desc' },
      })
    : []

  const emergencies = rawEmergencies.map((e: any) => {
    const patient = patientMap.get(e.patientId)
    return {
      id: e.id,
      patientId: e.patientId,
      patientName: patient?.user?.fullName ?? 'Pasien',
      triggerType: e.triggerType,
      hrBpm: e.hrBpm,
      status: e.status,
      triggeredAt: new Date(e.triggeredAt).toISOString(),
      location:
        e.locationLat && e.locationLng
          ? { lat: Number(e.locationLat), lng: Number(e.locationLng) }
          : null,
      puskesmasId: patient?.nakesContacts?.[0]?.puskesmasId ?? null,
      districtCode: patient?.districtCode ?? null,
    }
  })

  // 2. Ambil EscalationRuns aktif
  const activeEscalationStatuses = [
    EscalationRunStatus.WAITING_PATIENT,
    EscalationRunStatus.FAMILY_TIER_1,
    EscalationRunStatus.FAMILY_TIER_2,
    EscalationRunStatus.NAKES,
  ]

  const escalationWhere: any = {
    patientId: { in: patientIds },
    status: filter?.escalationStatus
      ? filter.escalationStatus.trim()
      : { in: activeEscalationStatuses },
  }
  if (filter?.from || filter?.to) {
    escalationWhere.startedAt = {}
    if (filter.from) escalationWhere.startedAt.gte = new Date(filter.from)
    if (filter.to) escalationWhere.startedAt.lte = new Date(filter.to)
  }

  const rawEscalations = client.escalationRun?.findMany
    ? await client.escalationRun.findMany({
        where: escalationWhere,
        orderBy: { startedAt: 'desc' },
      })
    : []

  const escalations = rawEscalations.map((r: any) => {
    const patient = patientMap.get(r.patientId)
    return {
      id: r.id,
      patientId: r.patientId,
      patientName: patient?.user?.fullName ?? 'Pasien',
      context: r.context,
      status: r.status,
      currentTier: r.currentTier,
      startedAt: new Date(r.startedAt).toISOString(),
    }
  })

  return {
    emergencies,
    escalations,
    totalActive: emergencies.length + escalations.length,
  }
}

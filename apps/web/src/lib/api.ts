import type { DashboardFilterInput } from '@careloop/shared'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

export interface ApiUser {
  id: string
  fullName: string
  role: 'NAKES' | 'ADMIN' | 'PATIENT' | 'FAMILY'
  phone?: string
  email?: string
}

export interface LoginResponse {
  accessToken: string
  expiresIn: string
  user: ApiUser
}

export interface DashboardSummary {
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

export interface DailySeriesItem {
  date: string
  adherenceRate: number
  confirmed: number
  missed: number
  total: number
}

export interface DiseaseAdherenceItem {
  disease: string
  adherenceRate: number
  total: number
}

export interface DashboardAdherence {
  period: {
    from: string
    to: string
  }
  series: DailySeriesItem[]
  byDisease: DiseaseAdherenceItem[]
}

export interface AtRiskPatient {
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

export interface ActiveAlerts {
  emergencies: Array<{
    id: string
    patientId: string
    patientName: string
    livingSituation?: string | null
    triggerType: string
    hrBpm: number | null
    status: string
    triggeredAt: string
    location: { lat: number | null; lng: number | null } | null
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

export class ApiError extends Error {
  code: string
  details?: unknown

  constructor(message: string, code = 'API_ERROR', details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('careloop_token')
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return
  if (token) {
    localStorage.setItem('careloop_token', token)
  } else {
    localStorage.removeItem('careloop_token')
    localStorage.removeItem('careloop_user')
  }
}

export function getStoredUser(): ApiUser | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('careloop_user')
  if (!raw) return null
  try {
    return JSON.parse(raw) as ApiUser
  } catch {
    return null
  }
}

export function setStoredUser(user: ApiUser | null): void {
  if (typeof window === 'undefined') return
  if (user) {
    localStorage.setItem('careloop_user', JSON.stringify(user))
  } else {
    localStorage.removeItem('careloop_user')
  }
}

function buildQueryString(params?: Record<string, string | undefined>): string {
  if (!params) return ''
  const searchParams = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val.trim() !== '') {
      searchParams.set(key, val.trim())
    }
  }
  const str = searchParams.toString()
  return str ? `?${str}` : ''
}

async function fetchWithAuth<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken()
  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  const json = await response.json().catch(() => ({}))

  if (!response.ok) {
    const errorMsg = json?.error?.message || response.statusText || 'Terjadi kesalahan jaringan'
    const errorCode = json?.error?.code || `HTTP_${response.status}`
    throw new ApiError(errorMsg, errorCode, json?.error?.details)
  }

  return json.data as T
}

export async function loginApi(identifier: string, password: string): Promise<LoginResponse> {
  const isEmail = identifier.includes('@')
  const payload = isEmail
    ? { email: identifier.trim(), password }
    : { phone: identifier.trim(), password }

  const data = await fetchWithAuth<LoginResponse>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  setStoredToken(data.accessToken)
  setStoredUser(data.user)
  return data
}

export async function getDashboardSummary(filter?: DashboardFilterInput): Promise<DashboardSummary> {
  const query = buildQueryString(filter as Record<string, string | undefined>)
  return fetchWithAuth<DashboardSummary>(`/v1/dashboard/summary${query}`)
}

export async function getDashboardAdherence(filter?: DashboardFilterInput): Promise<DashboardAdherence> {
  const query = buildQueryString(filter as Record<string, string | undefined>)
  return fetchWithAuth<DashboardAdherence>(`/v1/dashboard/adherence${query}`)
}

export async function getDashboardRiskPatients(filter?: DashboardFilterInput): Promise<AtRiskPatient[]> {
  const query = buildQueryString(filter as Record<string, string | undefined>)
  return fetchWithAuth<AtRiskPatient[]>(`/v1/dashboard/risk-patients${query}`)
}

export async function getDashboardAlerts(filter?: DashboardFilterInput): Promise<ActiveAlerts> {
  const query = buildQueryString(filter as Record<string, string | undefined>)
  return fetchWithAuth<ActiveAlerts>(`/v1/dashboard/alerts${query}`)
}

export async function respondEscalation(
  escalationId: string,
  response: 'HANDLE' | 'LOOKING',
  note?: string,
): Promise<{ id: string; status: string; currentTier: string | null }> {
  return fetchWithAuth<{ id: string; status: string; currentTier: string | null }>(
    `/v1/escalations/${escalationId}/respond`,
    {
      method: 'POST',
      body: JSON.stringify({ response, note }),
    },
  )
}

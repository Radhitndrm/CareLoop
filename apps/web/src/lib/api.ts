import type { DashboardFilterInput } from '@careloop/shared'

/**
 * Base URL API publik. `NEXT_PUBLIC_API_URL` di-inline Next saat build, jadi satu-
 * satunya sumber kebenaran di produksi.
 *
 * Fallback `localhost` HANYA untuk development — di production URL yang salah
 * berarti dashboard diam-diam menembak API yang tidak ada (atau, lebih buruk, API
 * lain). Di situ build harus gagal lebih dulu daripada deploy diam-diam.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  if (process.env.NODE_ENV !== 'production') return 'http://localhost:4000'

  throw new Error(
    'NEXT_PUBLIC_API_URL wajib diisi saat build production (contoh: https://api-careloop.up.railway.app)',
  )
}

let cachedBaseUrl: string | undefined

export function apiBaseUrl(): string {
  cachedBaseUrl ??= resolveApiBaseUrl()
  return cachedBaseUrl
}

export interface ApiUser {
  id: string
  fullName: string
  role: 'NAKES' | 'ADMIN' | 'PATIENT' | 'FAMILY'
  nakesRole?: 'DOKTER' | 'PERAWAT' | 'BIDAN' | 'KADER' | 'FARMASI' | 'LAINNYA'
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

  const response = await fetch(`${apiBaseUrl()}${path}`, {
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

/** Versi fetchWithAuth yang juga mengembalikan `meta` (jumlah total, ringkasan). */
async function fetchWithMeta<T, M>(path: string): Promise<{ data: T; meta?: M }> {
  const token = getStoredToken()
  const headers = new Headers({ Accept: 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${apiBaseUrl()}${path}`, { headers })
  const json = await response.json().catch(() => ({}))

  if (!response.ok) {
    const errorMsg = json?.error?.message || response.statusText || 'Terjadi kesalahan jaringan'
    const errorCode = json?.error?.code || `HTTP_${response.status}`
    throw new ApiError(errorMsg, errorCode, json?.error?.details)
  }

  return { data: json.data as T, meta: json.meta as M | undefined }
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

// ---------------------------------------------------------------- pasien & klinis

export type PatientStatus = 'ONBOARDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED'

export interface PatientSummary {
  id: string
  fullName: string
  phone: string
  districtCode: string | null
  livingSituation: string
  healthConditions: string[]
  riskLevel: string | null
  consentShareWithNakes: boolean
  /** Hanya ACTIVE yang diproses scheduler reminder/eskalasi. */
  status: PatientStatus
  primaryPuskesmasName: string | null
  createdAt: string
}

export interface PatientDetail extends PatientSummary {
  nik: string | null
  gender: string | null
  dateOfBirth: string | null
  address: string | null
  city: string | null
  province: string | null
  bpjsNumber: string | null
  hasNearbyFamily: boolean
  emergencyPreference: string
  smartwatchEnabled: boolean
  voiceEnabled: boolean
  hrMinBpm: number | null
  hrMaxBpm: number | null
  isVerified: boolean
  consentPdpAt: string | null
  activatedAt: string | null
  primaryPuskesmasDetail: { id: string; name: string; isActive: boolean } | null
  nakesContacts: Array<{
    id: string
    nakesName: string
    nakesRole: string
    phone: string
    isPrimary: boolean
    isActive: boolean
  }>
}

export interface PatientListResponse {
  items: PatientSummary[]
  total: number
}

export interface CreatePatientPayload {
  fullName: string
  phone: string
  districtCode: string
  puskesmasId: string
  nik?: string
  gender?: 'M' | 'F'
  dateOfBirth?: string
  address?: string
  livingSituation?: string
  healthConditions?: string[]
  emergencyPreference?: string
  consentShareWithNakes?: boolean
}

export type MedicationStatus = 'DRAFT' | 'APPROVED' | 'REJECTED'

export interface Medication {
  id: string
  patientId: string
  name: string
  genericName: string | null
  dosage: string | null
  form: string
  instructions: string | null
  isActive: boolean
  status: MedicationStatus
  startedAt: string
  endedAt: string | null
  approvedAt: string | null
  approvedByName: string | null
  schedules: Array<{
    id: string
    timeOfDay: string
    daysOfWeek: number[]
    dailyFrequency: number
    doseQty: string
    status: MedicationStatus
    isActive: boolean
    nextFireAt: string | null
  }>
}

export interface ComplianceItem {
  id: string
  scheduledAt: string
  confirmedAt: string | null
  status: string
  channel: string
  medicationName: string
  scheduleId: string
  timeOfDay: string
  doseQty: string
}

export interface ComplianceListResponse {
  items: ComplianceItem[]
  summary: {
    confirmed: number
    confirmedLate: number
    missed: number
    pending: number
    adherenceRate: number
  }
}

export type StaffStatus = 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'

export interface StaffAssignment {
  id: string
  puskesmasId: string | null
  puskesmasName: string | null
  districtCode: string | null
  scopeType: 'PUSKESMAS' | 'DISTRICT' | 'ALL'
  isActive: boolean
  createdAt: string
  endedAt: string | null
  note: string | null
}

export interface NakesAccount {
  id: string
  fullName: string
  phone: string
  email: string | null
  role: string
  nakesRole: string
  staffStatus: StaffStatus
  isActive: boolean
  activatedAt: string | null
  createdAt: string
  assignments: StaffAssignment[]
}

/** Daftar pasien dalam scope nakes. */
export async function getPatients(params?: {
  search?: string
  disease?: string
  livingSituation?: string
  limit?: number
  offset?: number
}): Promise<PatientListResponse> {
  const query = buildQueryString({
    search: params?.search,
    disease: params?.disease,
    livingSituation: params?.livingSituation,
    limit: params?.limit?.toString(),
    offset: params?.offset?.toString(),
  })
  const json = await fetchWithAuth<PatientSummary[]>(`/v1/patients${query}`)
  return { items: json, total: json.length }
}

export async function getPatient(patientId: string): Promise<PatientDetail> {
  return fetchWithAuth<PatientDetail>(`/v1/patients/${patientId}`)
}

export async function createPatient(payload: CreatePatientPayload): Promise<PatientDetail> {
  return fetchWithAuth<PatientDetail>('/v1/patients', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getMedications(
  patientId: string,
  status?: MedicationStatus,
): Promise<Medication[]> {
  const query = buildQueryString({ status })
  return fetchWithAuth<Medication[]>(`/v1/patients/${patientId}/medications${query}`)
}

export async function draftMedication(
  patientId: string,
  payload: {
    name: string
    dosage?: string
    genericName?: string
    form?: string
    instructions?: string
    startedAt: string
  },
): Promise<Medication> {
  return fetchWithAuth<Medication>(`/v1/patients/${patientId}/medications`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function addSchedule(
  patientId: string,
  payload: {
    medicationId: string
    timeOfDay: string
    doseQty: string
    startDate: string
    daysOfWeek?: number[]
    timeWindowMinutes?: number
  },
): Promise<Medication> {
  return fetchWithAuth<Medication>(`/v1/patients/${patientId}/schedules`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Hanya dokter/bidan yang boleh memanggil ini — server menolak 403 bila bukan. */
export async function approveMedication(
  medicationId: string,
  decision: 'APPROVED' | 'REJECTED',
  note?: string,
): Promise<Medication> {
  return fetchWithAuth<Medication>(`/v1/medications/${medicationId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  })
}

export async function setHrThresholds(
  patientId: string,
  payload: { hrMinBpm: number | null; hrMaxBpm: number | null },
): Promise<{ hrMinBpm: number | null; hrMaxBpm: number | null }> {
  return fetchWithAuth(`/v1/patients/${patientId}/hr-thresholds`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

/** Timeline "sudah minum" — ini yang dilihat perawat & dokter. */
export async function getCompliance(
  patientId: string,
  params?: { from?: string; to?: string; status?: string; limit?: number },
): Promise<ComplianceListResponse> {
  const query = buildQueryString({
    from: params?.from,
    to: params?.to,
    status: params?.status,
    limit: params?.limit?.toString(),
  })
  const { data, meta } = await fetchWithMeta<ComplianceItem[], { summary: ComplianceListResponse['summary'] }>(
    `/v1/patients/${patientId}/compliance${query}`,
  )
  return { items: data, summary: meta?.summary ?? { confirmed: 0, confirmedLate: 0, missed: 0, pending: 0, adherenceRate: 0 } }
}

export async function getNakesAccounts(params?: {
  nakesRole?: string
  staffStatus?: string
  search?: string
}): Promise<NakesAccount[]> {
  const query = buildQueryString(params as Record<string, string | undefined>)
  return fetchWithAuth<NakesAccount[]>(`/v1/admin/nakes-accounts${query}`)
}

export interface InviteStaffPayload {
  fullName: string
  phone: string
  nakesRole: string
  email?: string
  /** Dikosongkan untuk membuat akun INVITED yang mengembalikan kode aktivasi. */
  password?: string
  assignments: Array<{ puskesmasId?: string; districtCode?: string; note?: string }>
}

export interface InviteStaffResult {
  account: NakesAccount
  /** Hanya ada kalau akun dibuat sebagai INVITED, dan hanya tampil sekali. */
  activationCode: string | null
  activationExpiresAt: string | null
}

export async function inviteNakesAccount(payload: InviteStaffPayload): Promise<InviteStaffResult> {
  return fetchWithAuth<InviteStaffResult>('/v1/admin/nakes-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getNakesAccount(id: string): Promise<NakesAccount> {
  return fetchWithAuth<NakesAccount>(`/v1/admin/nakes-accounts/${id}`)
}

export async function updateNakesAccount(
  id: string,
  payload: { nakesRole?: string; staffStatus?: StaffStatus; reason?: string },
): Promise<NakesAccount> {
  return fetchWithAuth<NakesAccount>(`/v1/admin/nakes-accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export async function regenerateActivationCode(
  id: string,
): Promise<{ activationCode: string; activationExpiresAt: string }> {
  return fetchWithAuth<{ activationCode: string; activationExpiresAt: string }>(
    `/v1/admin/nakes-accounts/${id}/activation-code`,
    { method: 'POST' },
  )
}

export async function addNakesAssignment(
  id: string,
  payload: { puskesmasId?: string; districtCode?: string; note?: string },
): Promise<{ staff: NakesAccount; assignment: StaffAssignment }> {
  return fetchWithAuth<{ staff: NakesAccount; assignment: StaffAssignment }>(
    `/v1/admin/nakes-accounts/${id}/assignments`,
    { method: 'POST', body: JSON.stringify(payload) },
  )
}

export async function endNakesAssignment(id: string, assignmentId: string): Promise<NakesAccount> {
  return fetchWithAuth<NakesAccount>(`/v1/admin/nakes-accounts/${id}/assignments/${assignmentId}`, {
    method: 'DELETE',
  })
}

// ---------------------------------------------------------------- puskesmas

export interface Clinic {
  id: string
  name: string
  type: string
  districtCode: string | null
  address: string | null
  phone: string | null
  lat: number | null
  lng: number | null
  isActive: boolean
  createdAt: string
}

/**
 * Daftar puskesmas untuk dipilih operator.
 *
 * NAKES hanya menerima puskesmas dalam penugasannya, jadi dropdown ini aman tanpa
 * penyaringan tambahan di UI. UUID tetap detail internal: yang tampil ke operator
 * selalu nama.
 */
export async function getClinics(params?: {
  search?: string
  district?: string
  includeInactive?: boolean
}): Promise<Clinic[]> {
  const query = buildQueryString({
    search: params?.search,
    district: params?.district,
    includeInactive: params?.includeInactive ? 'true' : undefined,
  })
  return fetchWithAuth<Clinic[]>(`/v1/puskesmas${query}`)
}

export async function getClinic(id: string): Promise<Clinic> {
  return fetchWithAuth<Clinic>(`/v1/puskesmas/${id}`)
}

export async function getClinicDistricts(): Promise<Array<{ code: string; clinicCount: number }>> {
  return fetchWithAuth<Array<{ code: string; clinicCount: number }>>(`/v1/puskesmas/districts`)
}

export async function createClinic(payload: {
  name: string
  type?: string
  districtCode?: string
  address?: string
  phone?: string
  isActive?: boolean
}): Promise<Clinic> {
  return fetchWithAuth<Clinic>(`/v1/admin/puskesmas`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateClinic(
  id: string,
  payload: Partial<{
    name: string
    type: string
    districtCode: string
    address: string
    phone: string
    isActive: boolean
  }>,
): Promise<Clinic> {
  return fetchWithAuth<Clinic>(`/v1/admin/puskesmas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

// ------------------------------------------------------ onboarding pasien

export interface LookupMatch {
  kind: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'NOT_A_PATIENT'
  patientId: string | null
  fullName: string | null
  maskedPhone: string | null
  status: PatientStatus | null
  puskesmasName: string | null
  matchedOn: 'PHONE' | 'NIK'
  hint: string
}

/**
 * Pengecekan duplikasi sebelum mendaftarkan pasien.
 *
 * Kecocokan di luar scope sengaja disembunyikan sebagian (tanpa nama & id): operator
 * cukup tahu ada konflik dan perlu meng escalate ke admin, tanpa mendapat akses ke
 * record yang bukan miliknya.
 */
export async function lookupPatients(params: {
  phone?: string
  nik?: string
}): Promise<{ hasConflict: boolean; matches: LookupMatch[] }> {
  const query = buildQueryString({ phone: params.phone, nik: params.nik })
  return fetchWithAuth<{ hasConflict: boolean; matches: LookupMatch[] }>(
    `/v1/patients/lookup${query}`,
  )
}

export async function linkPatientToClinic(
  patientId: string,
  clinicId: string,
): Promise<{ patientId: string; status: PatientStatus }> {
  return fetchWithAuth(`/v1/patients/${patientId}/link-clinic`, {
    method: 'POST',
    body: JSON.stringify({ clinicId }),
  })
}

export async function sendVerificationInstructions(
  patientId: string,
): Promise<{ patientId: string; maskedPhone: string; retryAfterSec: number }> {
  return fetchWithAuth(`/v1/patients/${patientId}/verification-instructions`, {
    method: 'POST',
  })
}

// ------------------------------------------------ checklist & aktivasi

export interface ActivationCheck {
  key: string
  label: string
  satisfied: boolean
  detail: string | null
  fixPath: string | null
}

export interface ActivationChecklist {
  ready: boolean
  checks: ActivationCheck[]
  blockers: ActivationCheck[]
}

export async function getPatientActivation(patientId: string): Promise<ActivationChecklist> {
  return fetchWithAuth<ActivationChecklist>(`/v1/patients/${patientId}/activation`)
}

export async function activatePatient(
  patientId: string,
): Promise<{ id: string; status: PatientStatus; checklist: ActivationChecklist }> {
  return fetchWithAuth(`/v1/patients/${patientId}/activate`, { method: 'POST' })
}

export async function changePatientStatus(
  patientId: string,
  status: PatientStatus,
  reason?: string,
): Promise<{ id: string; status: PatientStatus }> {
  return fetchWithAuth(`/v1/patients/${patientId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  })
}

// ---------------------------------------------------- kontak keluarga

export interface FamilyContact {
  id: string
  name: string
  phone: string
  relationship: string
  tier: 'TIER_1' | 'TIER_2'
  priority: number
  isNearby: boolean
  canViewHealth: boolean
  canReceiveEmergency: boolean
  isActive: boolean
}

export async function getFamilyContacts(patientId: string): Promise<FamilyContact[]> {
  return fetchWithAuth<FamilyContact[]>(`/v1/patients/${patientId}/family-contacts`)
}

export async function createFamilyContact(
  patientId: string,
  payload: {
    name: string
    phone: string
    relationship: string
    tier: 'TIER_1' | 'TIER_2'
    priority?: number
    isNearby?: boolean
    canViewHealth?: boolean
    canReceiveEmergency?: boolean
  },
): Promise<FamilyContact> {
  return fetchWithAuth<FamilyContact>(`/v1/patients/${patientId}/family-contacts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateFamilyContact(
  contactId: string,
  payload: Partial<FamilyContact> & { reason?: string },
): Promise<FamilyContact> {
  return fetchWithAuth<FamilyContact>(`/v1/family-contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteFamilyContact(contactId: string): Promise<void> {
  await fetchWithAuth(`/v1/family-contacts/${contactId}`, { method: 'DELETE' })
}

// ------------------------------------------------------- antrean kerja nakes

export interface WorkQueueItem {
  patientId: string
  fullName: string
  phone: string
  status: PatientStatus
  puskesmasName: string | null
  /** Alasan spesifik; bisa lebih dari satu kalau pasien punya beberapa masalah. */
  reasons: string[]
}

export interface WorkQueueBucket {
  key: string
  label: string
  description: string
  count: number
  items: WorkQueueItem[]
}

/**
 * Daftar pasien yang menunggu tindakan, bukan angka statistik.
 *
 * Item kosong pada kelompok keselamatan (eskalasi/darurat) itu disengaja: yang
 * dibutuhkan di sana adalah banyaknya insiden, dan penanganannya lewat layar
 * emergency/eskalasi — bukan daftar pasien.
 */
export async function getWorkQueue(filter?: {
  district?: string
  disease?: string
  clinicId?: string
  limit?: number
}): Promise<{ buckets: WorkQueueBucket[]; actionablePatients: number }> {
  const query = buildQueryString({
    district: filter?.district,
    disease: filter?.disease,
    clinicId: filter?.clinicId,
    limit: filter?.limit?.toString(),
  })
  const { data, meta } = await fetchWithMeta<WorkQueueBucket[], { actionablePatients: number }>(
    `/v1/dashboard/work-queue${query}`,
  )
  return { buckets: data, actionablePatients: meta?.actionablePatients ?? 0 }
}

// ------------------------------------------------- status ketersediaan fitur

export type FeatureStatus = 'AVAILABLE' | 'MOCK' | 'PENDING' | 'FORBIDDEN'

/**
 * Envelope yang dipakai endpoint yang belum selesai.
 *
 * UI wajib menampilkan `statusLabel` apa adanya. Menampilkan data kosong tanpa label
 * akan terbaca sebagai "memang tidak ada", bukan "belum diimplementasikan".
 */
export interface FeatureEnvelope<T> {
  status: FeatureStatus
  statusLabel: string
  statusDetail: string
  data: T
}

export async function getRiskScore(): Promise<FeatureEnvelope<{
  score: number | null
  level: string | null
  factors: Record<string, unknown>
}>> {
  return fetchWithAuth('/v1/patients/me/risk')
}

export async function getEducationTopics(): Promise<FeatureEnvelope<unknown[]>> {
  return fetchWithAuth('/v1/education/topics')
}

export async function getNearbyFacilities(params: {
  lat: number
  lng: number
  radiusKm: number
  type?: string
}): Promise<FeatureEnvelope<unknown[]>> {
  const query = buildQueryString({
    lat: String(params.lat),
    lng: String(params.lng),
    radiusKm: String(params.radiusKm),
    type: params.type,
  })
  return fetchWithAuth(`/v1/facilities/nearby${query}`)
}

export async function getExportJobs(): Promise<FeatureEnvelope<unknown[]>> {
  return fetchWithAuth('/v1/export/jobs')
}

// ---------------------------------------------------------------- farmasi

export type MedicationRequestStatus =
  | 'PENDING_DOCTOR'
  | 'QUEUED'
  | 'PREPARING'
  | 'READY'
  | 'DISPENSED'
  | 'REJECTED'
  | 'OUT_OF_STOCK'
  | 'SUBSTITUTED'

export type MedicationRequestAction =
  | 'APPROVED'
  | 'REJECTED'
  | 'START_PREPARING'
  | 'MARK_READY'
  | 'DISPENSED'
  | 'MARK_OUT_OF_STOCK'
  | 'MARK_SUBSTITUTED'
  | 'RETURNED_TO_QUEUE'

export interface PharmacyEvent {
  id: string
  fromStatus: MedicationRequestStatus | null
  toStatus: MedicationRequestStatus
  action: string
  actorName: string | null
  actorRole: string | null
  note: string | null
  createdAt: string
}

export interface MedicationRequestItem {
  id: string
  patientId: string
  patientName: string
  patientPhone: string
  medicationId: string
  medicationName: string
  dosage: string | null
  form: string
  requestedQuantity: number
  approvedQuantity: number | null
  /** Jumlah efektif yang dipakai antrean — mengikuti persetujuan dokter bila ada. */
  effectiveQuantity: number
  source: 'ROUTINE' | 'PATIENT_REQUEST'
  status: MedicationRequestStatus
  /** Turunan dari dueAt vs hari ini — bukan status tersimpan. */
  isOverdue: boolean
  reasonCode: string | null
  reasonLabel: string | null
  reasonNotes: string | null
  dueAt: string
  doctorName: string | null
  doctorDecisionNote: string | null
  decidedAt: string | null
  blockedReason: string | null
  substituteName: string | null
  isSubstituteApproved: boolean
  quantityRemaining: number | null
  createdAt: string
  updatedAt: string
  events?: PharmacyEvent[]
}

export interface MedicationRequestSummary {
  queued: number
  preparing: number
  ready: number
  overdue: number
  pendingDoctor: number
}

export interface MedicationRequestListResponse {
  items: MedicationRequestItem[]
  summary: MedicationRequestSummary
  total: number
}

export async function getMedicationRequests(params?: {
  status?: MedicationRequestStatus
  source?: 'ROUTINE' | 'PATIENT_REQUEST'
  patientId?: string
  search?: string
  overdue?: boolean
  limit?: number
  offset?: number
}): Promise<MedicationRequestListResponse> {
  const query = buildQueryString({
    status: params?.status,
    source: params?.source,
    patientId: params?.patientId,
    search: params?.search,
    overdue: params?.overdue === undefined ? undefined : String(params.overdue),
    limit: params?.limit?.toString(),
    offset: params?.offset?.toString(),
  })
  const { data, meta } = await fetchWithMeta<
    MedicationRequestItem[],
    { summary: MedicationRequestSummary; total: number }
  >(`/v1/medication-requests${query}`)
  return {
    items: data,
    total: meta?.total ?? data.length,
    summary:
      meta?.summary ?? { queued: 0, preparing: 0, ready: 0, overdue: 0, pendingDoctor: 0 },
  }
}

export async function getMedicationRequest(requestId: string): Promise<MedicationRequestItem> {
  return fetchWithAuth<MedicationRequestItem>(`/v1/medication-requests/${requestId}`)
}

/** Pasien mengajukan permintaan obat di luar jadwal rutin. */
export async function createMedicationRequest(payload: {
  medicationId: string
  requestedQuantity: number
  reasonCode: string
  reasonNotes?: string
}): Promise<MedicationRequestItem> {
  return fetchWithAuth<MedicationRequestItem>('/v1/medication-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** Dokter menyetujui (boleh ubah jumlah) atau menolak (wajib isi alasan). */
export async function decideMedicationRequest(
  requestId: string,
  payload: { decision: 'APPROVED' | 'REJECTED'; approvedQuantity?: number; note?: string },
): Promise<MedicationRequestItem> {
  return fetchWithAuth<MedicationRequestItem>(`/v1/medication-requests/${requestId}/decision`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/** Aksi farmasi: menyiapkan, menandai siap, menyerahkan, atau menandai terblokir. */
export async function changeMedicationRequestStatus(
  requestId: string,
  payload: {
    action: MedicationRequestAction
    reason?: string
    substituteName?: string
    quantityDays?: number
  },
): Promise<MedicationRequestItem> {
  return fetchWithAuth<MedicationRequestItem>(`/v1/medication-requests/${requestId}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/** Trigger manual generator permintaan rutin — untuk demo, bukan jalur produksi. */
export async function generateRoutineRequests(): Promise<{ created: number; skipped: number }> {
  return fetchWithAuth<{ created: number; skipped: number }>(
    '/v1/medication-requests/generate-routine',
    { method: 'POST' },
  )
}

export interface DispensingRecord {
  id: string
  requestId: string
  patientId: string
  patientName: string
  medicationName: string
  quantityDays: number
  dispensedAt: string
  nextPickupDate: string
  pharmacistName: string
}

export async function getDispensingRecords(params?: {
  patientId?: string
  search?: string
  from?: string
  to?: string
}): Promise<DispensingRecord[]> {
  const query = buildQueryString({
    patientId: params?.patientId,
    search: params?.search,
    from: params?.from,
    to: params?.to,
  })
  return fetchWithAuth<DispensingRecord[]>(`/v1/dispensing-records${query}`)
}

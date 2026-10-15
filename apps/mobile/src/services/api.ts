import { ComplianceChannel } from '@careloop/shared'
import { authHeaders, getStoredToken, setStoredToken } from './auth'

export interface ComplianceConfirmResponseData {
  scheduleId: string
  status: string
  confirmedAt: string
  escalationCancelled: boolean
}

export interface ComplianceConfirmResponse {
  data?: ComplianceConfirmResponseData
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export interface EmergencyResponseData {
  emergencyId: string
  status: string
  patientConfirmedSafe: boolean
  patientConfirmedAt: string
  escalationRunId: string | null
  escalationStatus?: string
  resolvedAt?: string | null
}

export interface EmergencyResponse {
  data?: EmergencyResponseData
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export interface EmergencyAlertDetail {
  id: string
  patientId: string
  triggerType: string
  hrBpm: number | null
  status: string
  triggeredAt: string
  locationLat: number | null
  locationLng: number | null
  notes?: string | null
  patient?: {
    fullName: string
    livingSituation: string
  }
}

/**
 * Base URL API publik. `EXPO_PUBLIC_API_URL` di-inline Expo saat build.
 *
 * Fallback `localhost` hanya untuk simulator/emulator saat development: di perangkat
 * fisik `localhost` berarti HP-nya sendiri, dan permintaan akan gagal dengan galat
 * jaringan yang membingungkan. Karena itu di luar development konfigurasi yang
 * hilang harus gagal cepat dengan pesan jelas, bukan diam-diam menembak lokal.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  if (__DEV__) return 'http://localhost:4000'

  throw new Error(
    'EXPO_PUBLIC_API_URL wajib diisi saat build production (mis. https://api-careloop.up.railway.app)',
  )
}

/**
 * Konfirmasi kepatuhan minum obat pasien (CL-113).
 */
export async function confirmCompliance(
  scheduleId: string,
  channel: ComplianceChannel = ComplianceChannel.IN_APP
): Promise<ComplianceConfirmResponseData> {
  if (!scheduleId || scheduleId.trim() === '') {
    throw new Error('ID jadwal obat tidak boleh kosong')
  }

  const baseUrl = getApiBaseUrl()
  const endpoint = `${baseUrl}/v1/compliance/confirm`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Semua endpoint pasien di balik `authenticate` (AGENTS.md §2): tanpa header
        // ini permintaan dijawab `401` dan tombol konfirmasi tidak akan pernah berhasil.
        ...(await authHeaders()),
      },
      body: JSON.stringify({
        scheduleId,
        channel,
      }),
    })

    const result: ComplianceConfirmResponse = await res.json()

    if (!res.ok || !result.data) {
      const errMsg = result.error?.message || `Gagal konfirmasi (HTTP ${res.status})`
      throw new Error(errMsg)
    }

    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error('Terjadi kesalahan jaringan saat konfirmasi obat')
  }
}

/**
 * Mengirim respons darurat pasien SAFE / NEED_HELP beserta koordinat GPS (CL-205, CL-213, AC-4.2).
 */
export async function respondEmergency(
  emergencyId: string,
  response: 'SAFE' | 'NEED_HELP',
  location?: { lat: number; lng: number } | null,
  notes?: string
): Promise<EmergencyResponseData> {
  if (!emergencyId || emergencyId.trim() === '') {
    throw new Error('ID peringatan darurat tidak boleh kosong')
  }

  const baseUrl = getApiBaseUrl()
  const endpoint = `${baseUrl}/v1/emergencies/${encodeURIComponent(emergencyId)}/respond`

  const payload: Record<string, unknown> = {
    response,
    notes,
  }
  if (location) {
    payload.locationLat = location.lat
    payload.locationLng = location.lng
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Semua endpoint pasien di balik `authenticate` (AGENTS.md §2): tanpa header
        // ini permintaan dijawab `401` dan tombol konfirmasi tidak akan pernah berhasil.
        ...(await authHeaders()),
      },
      body: JSON.stringify(payload),
    })

    const result: EmergencyResponse = await res.json()

    if (!res.ok || !result.data) {
      const errMsg = result.error?.message || `Gagal merespons darurat (HTTP ${res.status})`
      throw new Error(errMsg)
    }

    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error('Terjadi kesalahan jaringan saat merespons darurat')
  }
}

/**
 * Mengambil informasi detail alert darurat aktif (CL-204/CL-205).
 */
export async function getEmergencyAlert(emergencyId: string): Promise<EmergencyAlertDetail> {
  const baseUrl = getApiBaseUrl()
  const endpoint = `${baseUrl}/v1/emergencies/${encodeURIComponent(emergencyId)}`

  try {
    const res = await fetch(endpoint, { headers: await authHeaders() })
    const result = await res.json()

    if (!res.ok || !result.data) {
      throw new Error(result.error?.message || `Gagal mengambil data darurat (HTTP ${res.status})`)
    }

    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error('Terjadi kesalahan jaringan saat mengambil data darurat')
  }
}

/**
 * Memicu timeout darurat secara eksplisit dari klien mobile jika timer habis (CL-206).
 */
export async function triggerEmergencyTimeout(
  emergencyId: string,
  notes?: string
): Promise<{ emergencyId: string; status: string }> {
  const baseUrl = getApiBaseUrl()
  const endpoint = `${baseUrl}/v1/emergencies/${encodeURIComponent(emergencyId)}/timeout`

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Semua endpoint pasien di balik `authenticate` (AGENTS.md §2): tanpa header
        // ini permintaan dijawab `401` dan tombol konfirmasi tidak akan pernah berhasil.
        ...(await authHeaders()),
      },
      body: JSON.stringify({
        notes: notes || 'Timeout dari aplikasi mobile pasien',
      }),
    })

    const result = await res.json()
    if (!res.ok || !result.data) {
      throw new Error(result.error?.message || `Gagal memicu timeout (HTTP ${res.status})`)
    }

    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw err
    }
    throw new Error('Terjadi kesalahan jaringan saat memicu timeout darurat')
  }
}

// ---------------------------------------------------------------- farmasi (docs/API.md §3.6)

export interface MedicationOption {
  id: string
  name: string
  dosage: string | null
  daysSupply: number | null
  quantityRemaining: number | null
}

export interface MedicationRequestItem {
  id: string
  medicationId: string
  medicationName: string
  dosage: string | null
  requestedQuantity: number
  status: string
  source: string
  reasonLabel: string | null
  reasonNotes: string | null
  dueAt: string
  doctorDecisionNote: string | null
  blockedReason: string | null
  createdAt: string
}

/**
 * Seluruh request pasien memakai header auth dari `services/auth` (expo-secure-store).
 *
 * Sebelumnya token hanya hidup di memori modul dan tidak pernah diisi — sehingga
 * semua tab farmasi gagal dengan "Belum masuk", sementara request emergency dan
 * konfirmasi sama sekali tidak mengirim header apa pun dan dijawab `401`.
 */
async function authedRequest<T>(
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getStoredToken()
  if (!token) {
    throw new Error('Belum masuk. Silakan login terlebih dahulu.')
  }

  const baseUrl = getApiBaseUrl()
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    const result = (await res.json()) as {
      data?: T
      meta?: { summary?: MedicationRequestSummary }
      error?: { code: string; message: string }
    }

    if (!res.ok || result.data === undefined) {
      throw new Error(result.error?.message || `Gagal memuat data (HTTP ${res.status})`)
    }
    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) throw err
    throw new Error('Terjadi kesalahan jaringan saat menghubungi server')
  }
}

export interface MedicationRequestSummary {
  queued: number
  preparing: number
  ready: number
  overdue: number
  pendingDoctor: number
}

export async function getMyMedications(): Promise<MedicationOption[]> {
  return authedRequest<MedicationOption[]>('/v1/patients/me/medications')
}

export async function getMyMedicationRequests(): Promise<MedicationRequestItem[]> {
  return authedRequest<MedicationRequestItem[]>('/v1/medication-requests?limit=100')
}

export async function requestMedication(payload: {
  medicationId: string
  requestedQuantity: number
  reasonCode: string
  reasonNotes?: string
}): Promise<MedicationRequestItem> {
  return authedRequest<MedicationRequestItem>('/v1/medication-requests', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------- auth pasien

export interface OtpRequestResult {
  otpExpiresAt: string
  retryAfterSec: number
  /** Hanya terisi saat PROVIDER_MODE=mock, supaya demo bisa masuk tanpa inbox. */
  devCode?: string | null
}

export interface AuthSessionData {
  accessToken: string
  expiresIn: number
  user: { id: string; role: string; fullName: string; isVerified: boolean }
}

async function publicPost<T>(endpoint: string, payload: Record<string, unknown>): Promise<T> {
  const baseUrl = getApiBaseUrl()
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = (await res.json()) as { data?: T; error?: { message: string } }

    if (!res.ok || result.data === undefined) {
      throw new Error(result.error?.message || `Permintaan gagal (HTTP ${res.status})`)
    }
    return result.data
  } catch (err: unknown) {
    if (err instanceof Error) throw err
    throw new Error('Tidak dapat menghubungi server')
  }
}

/** Minta kode OTP. Tidak pernah menandai apa pun; hanya kode yang dikirim. */
export async function requestOtp(phone: string): Promise<OtpRequestResult> {
  return publicPost<OtpRequestResult>('/v1/auth/otp/request', { phone })
}

/**
 * Tukar OTP dengan sesi ber-token. Token langsung disimpan lewat secure store,
 * jadi refresh tidak perlu login ulang di tiap pembukaan aplikasi.
 */
export async function verifyOtp(phone: string, otp: string): Promise<AuthSessionData> {
  const session = await publicPost<AuthSessionData>('/v1/auth/otp/verify', { phone, otp })
  await setStoredToken(session.accessToken)
  return session
}

// ------------------------------------------------------------ jadwal pasien

export interface OwnSchedule {
  id: string
  medicationName: string
  dosage: string | null
  instructions: string | null
  doseQty: string
  timeOfDay: string
  daysOfWeek: number[]
  startDate: string | null
  endDate: string | null
  /** Waktu UTC jadwal berikutnya; null berarti jadwal sudah melewati rentangnya. */
  nextFireAt: string | null
}

/**
 * Jadwal obat milik pasien yang sedang login.
 *
 * `scheduleId` selalu dari server — aplikasi tidak pernah memakai UUID dummy, sehingga
 * konfirmasi tidak mungkin jatuh ke jadwal orang lain.
 */
export async function getMySchedules(): Promise<OwnSchedule[]> {
  return authedRequest<OwnSchedule[]>('/v1/patients/me/reminders')
}

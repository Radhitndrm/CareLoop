import { ComplianceChannel } from '@careloop/shared'

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

const DEFAULT_API_URL = 'http://localhost:4000'

export function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL
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
    const res = await fetch(endpoint)
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

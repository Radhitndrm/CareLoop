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

const DEFAULT_API_URL = 'http://localhost:4000'

export function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL
}

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

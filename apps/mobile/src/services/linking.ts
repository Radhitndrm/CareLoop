/**
 * Deep Link utility untuk CareLoop Mobile App (CL-113 & CL-213).
 * Mendukung skema internal careloop:// dan web fallback URL.
 */

export interface ParsedDeepLink {
  action: 'confirm' | 'emergency' | 'unknown'
  scheduleId?: string
  emergencyId?: string
}

export function parseConfirmationUrl(url: string | null): ParsedDeepLink | null {
  if (!url || typeof url !== 'string') {
    return null
  }

  const cleanUrl = url.trim()

  // 1. Periksa apakah URL mengarah ke rute konfirmasi darurat medis (CL-213)
  if (cleanUrl.includes('emergency')) {
    let extractedEmergencyId: string | undefined

    // Ekstrak dari query: ?emergencyId=... atau ?id=...
    const queryMatch = cleanUrl.match(/[?&](?:emergencyId|id)=([a-zA-Z0-9_-]+)/i)
    if (queryMatch && queryMatch[1]) {
      extractedEmergencyId = queryMatch[1]
    } else {
      // Ekstrak dari path: /emergency/<uuid>
      const pathMatch = cleanUrl.match(/emergency\/([a-zA-Z0-9_-]+)/i)
      if (pathMatch && pathMatch[1]) {
        extractedEmergencyId = pathMatch[1]
      }
    }

    return {
      action: 'emergency',
      emergencyId: extractedEmergencyId,
    }
  }

  // 2. Periksa apakah URL mengarah ke rute konfirmasi jadwal obat (CL-113)
  if (cleanUrl.includes('confirm')) {
    let extractedScheduleId: string | undefined

    // Ekstrak dari query parameter: ?scheduleId=... atau &scheduleId=...
    const queryMatch = cleanUrl.match(/[?&]scheduleId=([a-zA-Z0-9_-]+)/i)
    if (queryMatch && queryMatch[1]) {
      extractedScheduleId = queryMatch[1]
    } else {
      // Alternatif query parameter: ?id=...
      const idMatch = cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/i)
      if (idMatch && idMatch[1]) {
        extractedScheduleId = idMatch[1]
      } else {
        // Ekstrak dari path parameter: /confirm/<uuid>
        const pathMatch = cleanUrl.match(/confirm\/([a-zA-Z0-9_-]+)/i)
        if (pathMatch && pathMatch[1]) {
          extractedScheduleId = pathMatch[1]
        }
      }
    }

    return {
      action: 'confirm',
      scheduleId: extractedScheduleId,
    }
  }

  return {
    action: 'unknown',
  }
}

export function createConfirmationDeepLink(scheduleId: string): string {
  return `careloop://confirm?scheduleId=${encodeURIComponent(scheduleId)}`
}

export function createEmergencyDeepLink(emergencyId: string): string {
  return `careloop://emergency?id=${encodeURIComponent(emergencyId)}`
}

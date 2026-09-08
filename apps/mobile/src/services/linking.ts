/**
 * Deep Link utility untuk CareLoop Mobile App (CL-113).
 * Mendukung skema internal careloop:// dan web fallback URL.
 */

export interface ParsedDeepLink {
  action: 'confirm' | 'emergency' | 'unknown'
  scheduleId?: string
}

export function parseConfirmationUrl(url: string | null): ParsedDeepLink | null {
  if (!url || typeof url !== 'string') {
    return null
  }

  const cleanUrl = url.trim()

  // Periksa apakah URL mengarah ke rute konfirmasi obat
  if (cleanUrl.includes('confirm')) {
    let extractedScheduleId: string | undefined

    // 1. Ekstrak dari query parameter: ?scheduleId=... atau &scheduleId=...
    const queryMatch = cleanUrl.match(/[?&]scheduleId=([a-zA-Z0-9_-]+)/i)
    if (queryMatch && queryMatch[1]) {
      extractedScheduleId = queryMatch[1]
    } else {
      // 2. Alternatif query parameter: ?id=...
      const idMatch = cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/i)
      if (idMatch && idMatch[1]) {
        extractedScheduleId = idMatch[1]
      } else {
        // 3. Ekstrak dari path parameter: /confirm/<uuid>
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

  if (cleanUrl.includes('emergency')) {
    return {
      action: 'emergency',
    }
  }

  return {
    action: 'unknown',
  }
}

export function createConfirmationDeepLink(scheduleId: string): string {
  return `careloop://confirm?scheduleId=${encodeURIComponent(scheduleId)}`
}

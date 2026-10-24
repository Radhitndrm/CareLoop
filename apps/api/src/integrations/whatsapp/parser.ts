// Parser & builder button_reply.id WhatsApp (CL-102).
// Format id: `<INTENT>_<resourceId>` — contoh "CONFIRM_TAKEN_9c2e4d5a-…", "SAFE_e1", "HANDLE_r1".
// Webhook (CL-103) memakai parseButtonReply untuk memetakan reply ke intent + resource id.
import type { WaButton } from './types'

export const WaButtonIntent = {
  CONFIRM_TAKEN: 'CONFIRM_TAKEN',
  DEFER: 'DEFER',
  SAFE: 'SAFE',
  NEED_HELP: 'NEED_HELP',
  HANDLE: 'HANDLE',
} as const
export type WaButtonIntent = (typeof WaButtonIntent)[keyof typeof WaButtonIntent]

/**
 * Payload quick-reply pada message template.
 *
 * Payload di dalam template ditetapkan Meta saat template disetujui dan tidak bisa
 * diubah per pengiriman, jadi ia tidak boleh membawa `scheduleId`. Nilai ini konstan;
 * CareLoop memetakan balasannya ke jadwal lewat `interactive.context.id`.
 */
export const TemplateConfirmButtonId = 'KONFIRMS'

/** URL deep-link buttons (bukan reply) — tidak pernah di-parse sebagai intent. */
export const Call112ButtonId = 'CALL_112'
export const MapsButtonId = 'MAPS'

export interface ParsedButtonReply {
  intent: WaButtonIntent
  /** Resource id (scheduleId / emergencyId / escalationRunId). null bila id tanpa akhiran. */
  resourceId: string | null
  raw: string
}

const INTENT_VALUES: readonly string[] = Object.values(WaButtonIntent)

/** Membangun id tombol reply: `INTENT_resourceId`. */
export function buildButtonId(intent: WaButtonIntent, resourceId: string): string {
  return `${intent}_${resourceId}`
}

/** Urut dari terpanjang agar prefix intent yang mengandung underscore cocok lebih dulu. */
const INTENTS_BY_LENGTH: readonly string[] = [...INTENT_VALUES].sort((a, b) => b.length - a.length)

/**
 * Parse button_reply.id menjadi intent + resource id.
 * Mengembalikan null untuk id yang tidak dikenali (mis. URL button CALL_112/MAPS).
 */
export function parseButtonReply(id: string): ParsedButtonReply | null {
  for (const intent of INTENTS_BY_LENGTH) {
    if (id === intent) return { intent: intent as WaButtonIntent, resourceId: null, raw: id }
    if (id.startsWith(`${intent}_`)) {
      return { intent: intent as WaButtonIntent, resourceId: id.slice(intent.length + 1), raw: id }
    }
  }
  return null
}

/** Tombol URL deep-link one-tap call 112 — BUKAN auto-dial (ADR-008). */
export function call112Button(): WaButton {
  return { type: 'URL', id: Call112ButtonId, title: 'Hubungi 112', url: 'tel:112' }
}

/** Tombol URL maps link lokasi pasien. */
export function mapsButton(mapsUrl: string): WaButton {
  return { type: 'URL', id: MapsButtonId, title: 'Buka Peta', url: mapsUrl }
}

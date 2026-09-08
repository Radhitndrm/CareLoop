// Kontrak payload outbound WhatsApp (CL-101).
// Shape mengikuti WhatsApp Cloud API (Meta) tapi dibuat netral-provider — tiap provider
// (Meta/360dialog/Twilio) bertanggung jawab memetakan ke schema miliknya.
import { z } from 'zod'

/**
 * Nomor WA tujuan dalam E.164 tanpa '+', contoh "6281200000001".
 * Pengirim (service) wajib menormalkan angka 08… / +62… / 62… ke bentuk ini sebelum validasi.
 */
export const waRecipientSchema = z.string().regex(/^\d{10,15}$/, 'Nomor WA harus E.164 tanpa "+"')
export type WaRecipient = z.infer<typeof waRecipientSchema>

export const waButtonIdSchema = z
  .string()
  .regex(/^[\w.-]{1,256}$/, 'button id hanya huruf/angka/._-')
type WaButtonId = z.infer<typeof waButtonIdSchema>

/**
 * Tombol interaktif.
 * - REPLY: tombol balasan 1-tap (konfirmasi kepatuhan, alert darurat).
 * - URL: deep-link — one-tap call 112 / maps link (ADR-008: bukan auto-dial).
 * Meta membatasi 1–3 tombol per pesan; judul maksimal 25 karakter.
 */
export const waButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REPLY'), id: waButtonIdSchema, title: z.string().min(1).max(25) }),
  z.object({ type: z.literal('URL'), id: waButtonIdSchema, title: z.string().min(1).max(25), url: z.string().url() }),
])
export type WaButton = z.infer<typeof waButtonSchema>

/** Header (judul), body, footer pesan interaktif. */
export const waInteractiveBodySchema = z.object({
  body: z.string().min(1).max(1024),
  buttons: z.array(waButtonSchema).min(1).max(3),
  header: z.string().min(1).max(60).optional(),
  footer: z.string().min(1).max(60).optional(),
})
export type WaInteractiveBody = z.infer<typeof waInteractiveBodySchema>

/** Komponen template — parameter teks tersubstitusi ke placeholder {{1}}, {{2}}, dst. */
export const waTemplateComponentSchema = z.object({
  type: z.enum(['HEADER', 'BODY', 'FOOTER']),
  parameters: z.array(z.string().min(1)).max(4),
})
export type WaTemplateComponent = z.infer<typeof waTemplateComponentSchema>

/** Seluruh bentuk pesan keluar yang didukung service. */
export const outboundWhatsAppMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEXT'), to: waRecipientSchema, text: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal('TEMPLATE'),
    to: waRecipientSchema,
    templateName: z.string().min(1).max(64),
    parameters: z.array(waTemplateComponentSchema).max(3).optional(),
  }),
  z.object({ kind: z.literal('INTERACTIVE'), to: waRecipientSchema, interactive: waInteractiveBodySchema }),
  z.object({ kind: z.literal('AUDIO'), to: waRecipientSchema, audioUrl: z.string().url(), caption: z.string().max(1024).optional() }),
])
export type OutboundWhatsAppMessage = z.infer<typeof outboundWhatsAppMessageSchema>

export interface WhatsAppSendResult {
  /** id pesan dari provider (dipakai dedup callback status di CL-103). null = mock/tanpa dukungan. */
  providerMessageId: string | null
  sentAt: Date
}

export interface WhatsAppProvider {
  readonly name: string
  send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult>
}
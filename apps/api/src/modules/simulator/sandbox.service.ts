// Read model untuk WhatsApp Simulator: mengubah log in-memory sandbox menjadi bentuk
// yang enak dibaca panel (percakapan per penerima + pesan dengan label & status tombol).
//
// Label penerima tidak disimpan di sandbox: sandbox hanya tahu nomor. Nama pasien/keluarga/
// nakes dibaca dari database saat panel dibuka, sehingga label selalu ikut data terbaru dan
// tidak ada duplikasi sumber kebenaran.
import { parseButtonReply } from '../../integrations/whatsapp/parser'
import type { SandboxMessage, SandboxStatus } from '../../integrations/whatsapp/sandbox'

export type RecipientKind = 'PATIENT' | 'FAMILY' | 'NAKES' | 'UNKNOWN'

export interface RecipientRef {
  /** Nomor E.164 tanpa '+'. */
  phone: string
  /** Nomor lokal 08… untuk ditampilkan — lebih mudah dibaca audiens Indonesia. */
  displayPhone: string
  kind: RecipientKind
  label: string
  patientId: string | null
}

export interface SimulatorButtonView {
  id: string
  title: string
  type: 'REPLY' | 'URL'
  /** true untuk tombol balasan yang boleh diteken presenter. */
  actionable: boolean
  disabledReason: string | null
}

export interface SimulatorMessageView {
  messageId: string
  providerMessageId: string | null
  to: string
  from: string | null
  direction: 'OUTBOUND' | 'INBOUND'
  kind: string
  body: string
  buttons: SimulatorButtonView[]
  status: SandboxStatus
  createdAt: string
  statusLabel: string
  /** true kalau tombol di pesan ini masih bisa ditekan. */
  actionable: boolean
  answeredAt: string | null
  error: string | null
  relatedResource: { type: string; id: string; intent: string } | null
}

export interface SimulatorThreadView {
  recipient: RecipientRef
  messageCount: number
  lastMessageAt: string
  hasUnanswered: boolean
}

export const STATUS_LABEL: Record<SandboxStatus, string> = {
  SENT: 'Terkirim',
  DELIVERED: 'Diterima',
  READ: 'Dibaca',
  FAILED: 'Gagal',
}

/** 628120000001 -> 0812-0000-0001. Hanya untuk tampilan; tidak pernah dikirim. */
export function maskPhoneForDisplay(waId: string): string {
  const local = waId.startsWith('62') ? `0${waId.slice(2)}` : waId
  if (local.length < 10) return local
  return `${local.slice(0, 4)}-${local.slice(4, 8)}-${local.slice(8)}`
}

function isActionable(message: SandboxMessage): boolean {
  if (message.direction !== 'OUTBOUND') return false
  if (message.status === 'FAILED') return false
  if (message.answeredAt !== null) return false
  return message.buttons.some((b) => parseButtonReply(b.id) !== null)
}

export function toMessageView(message: SandboxMessage): SimulatorMessageView {
  const actionable = isActionable(message)

  const buttons = message.buttons.map((button) => {
    const parsed = parseButtonReply(button.id)
    const isReplyIntent = parsed !== null

    let disabledReason: string | null = null
    if (message.status === 'FAILED') disabledReason = 'Pesan gagal dikirim'
    else if (message.answeredAt !== null) disabledReason = 'Sudah dibalas'
    else if (!isReplyIntent) disabledReason = 'Tautan, bukan tombol balasan'

    return {
      id: button.id,
      title: button.title,
      type: button.type,
      actionable: isReplyIntent && disabledReason === null,
      disabledReason,
    }
  })

  return {
    messageId: message.messageId,
    providerMessageId: message.providerMessageId,
    to: message.to,
    from: message.from,
    direction: message.direction,
    kind: message.kind,
    body: message.body,
    buttons,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    statusLabel: STATUS_LABEL[message.status],
    actionable,
    answeredAt: message.answeredAt ? message.answeredAt.toISOString() : null,
    error: message.error,
    relatedResource: message.relatedResource,
  }
}

/**
 * Index penerima yang bisa dibaca dari database: pasien, kontak keluarga, kontak nakes.
 * Satu lookup untuk semua nomor di panel supaya label tidak ikut hilang tanpa sengaja.
 */
export type RecipientDirectory = Map<string, RecipientRef>

export async function loadRecipientDirectory(
  client: any,
  waIds: readonly string[],
): Promise<RecipientDirectory> {
  const directory: RecipientDirectory = new Map()
  if (waIds.length === 0) return directory

  const localForms = waIds.map((id) => `0${id.slice(2)}`)

  const [patients, family, nakes] = await Promise.all([
    client.user.findMany({
      where: { phone: { in: [...localForms, ...waIds] } },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        patient: { select: { id: true } },
      },
    }),
    client.familyContact.findMany({
      where: { phone: { in: [...localForms, ...waIds] } },
      select: {
        name: true,
        phone: true,
        // Nama pasien ada di User, bukan Patient (docs/DATABASE.md §3.2).
        patient: { select: { id: true, user: { select: { fullName: true } } } },
      },
    }),
    client.nakesContact.findMany({
      where: { phone: { in: [...localForms, ...waIds] } },
      select: { nakesName: true, nakesRole: true, phone: true, patient: { select: { id: true } } },
    }),
  ])

  for (const user of patients) {
    const waId = waIdOf(user.phone)
    if (!waId) continue
    directory.set(waId, {
      phone: waId,
      displayPhone: maskPhoneForDisplay(waId),
      kind: 'PATIENT',
      label: user.fullName,
      patientId: user.patient?.id ?? null,
    })
  }

  for (const contact of family) {
    const waId = waIdOf(contact.phone)
    if (!waId) continue
    directory.set(waId, {
      phone: waId,
      displayPhone: maskPhoneForDisplay(waId),
      kind: 'FAMILY',
      label: `${contact.name} (keluarga ${contact.patient.user.fullName})`,
      patientId: contact.patient.id,
    })
  }

  for (const contact of nakes) {
    const waId = waIdOf(contact.phone)
    if (!waId) continue
    directory.set(waId, {
      phone: waId,
      displayPhone: maskPhoneForDisplay(waId),
      kind: 'NAKES',
      label: `${contact.nakesName} · ${contact.nakesRole}`,
      patientId: contact.patient.id,
    })
  }

  return directory
}

function waIdOf(phone: string): string | null {
  const cleaned = phone.trim().replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+')) return cleaned.slice(1)
  if (cleaned.startsWith('0')) return `62${cleaned.slice(1)}`
  if (/^\d{10,15}$/.test(cleaned)) return cleaned
  return null
}
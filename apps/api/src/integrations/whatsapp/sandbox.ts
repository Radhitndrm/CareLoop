// Log pesan in-memory untuk WhatsApp Simulator (plan tasks/plan-whatsapp-mockup-demo.md Fase 1).
//
// Hanya diisi oleh MockWhatsAppProvider saat PROVIDER_MODE=mock, jadi isinya tidak pernah
// menyentuh nomor riil dan hilang saat proses restart. Setelah presentasi tidak ada jejak
// pesan yang bisa disalahpahami sebagai data produksi.
//
// Yang TIDAK boleh storing di sini: hasil bisnis. Reply dari simulator tetap lewat
// dispatcher intent yang sama dengan webhook produksi, jadi compliance/emergency/escalation
// tetap ditulis ke Postgres lewat service domain. Sandbox hanya catatan tampilan.
import { parseButtonReply, WaButtonIntent } from './parser'
import type { OutboundWhatsAppMessage, WaButton } from './types'

export type SandboxDirection = 'OUTBOUND' | 'INBOUND'
export type SandboxStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export type SandboxResourceType = 'schedule' | 'emergency' | 'escalation'

export interface SandboxRelatedResource {
  type: SandboxResourceType
  id: string
  intent: string
}

export interface SandboxButton {
  id: string
  title: string
  type: 'REPLY' | 'URL'
}

export interface SandboxMessage {
  /** Stabil & unik dalam proses — dipakai simulator sebagai kunci tombol. */
  messageId: string
  providerMessageId: string | null
  /** E.164 tanpa '+', selalu ada (untuk INBOUND ini tujuan reply-nya). */
  to: string
  /** Pengirim pada pesan INBOUND; null untuk OUTBOUND. */
  from: string | null
  direction: SandboxDirection
  kind: OutboundWhatsAppMessage['kind']
  body: string
  buttons: SandboxButton[]
  templateName: string | null
  status: SandboxStatus
  createdAt: Date
  /** Diisi saat reply diproses — dasar untuk menonaktifkan tombol setelah dipakai. */
  answeredAt: Date | null
  /** id pesan inbound yang menjawab pesan ini. */
  answeredByMessageId: string | null
  error: string | null
  relatedResource: SandboxRelatedResource | null
}

const RESOURCE_TYPE_BY_INTENT: Record<string, SandboxResourceType> = {
  [WaButtonIntent.CONFIRM_TAKEN]: 'schedule',
  [WaButtonIntent.DEFER]: 'schedule',
  [WaButtonIntent.SAFE]: 'emergency',
  [WaButtonIntent.NEED_HELP]: 'emergency',
  [WaButtonIntent.HANDLE]: 'escalation',
}

function mapButton(button: WaButton): SandboxButton {
  return { id: button.id, title: button.title, type: button.type }
}

/**
 * Resource yang dikaitkan pesan, diturunkan dari id tombol interaktif
 * (button id = `<INTENT>_<resourceId>`, lihat parser.ts) — bukan disimpan terpisah supaya
 * tidak mungkin differ antara tombol yang tampil dan resource yang dirujuk.
 */
export function deriveRelatedResource(buttons: readonly SandboxButton[]): SandboxRelatedResource | null {
  for (const button of buttons) {
    const parsed = parseButtonReply(button.id)
    if (!parsed?.resourceId) continue
    const type = RESOURCE_TYPE_BY_INTENT[parsed.intent]
    if (type) return { type, id: parsed.resourceId, intent: parsed.intent }
  }
  return null
}

function bodyOf(message: OutboundWhatsAppMessage): string {
  switch (message.kind) {
    case 'TEXT':
      return message.text
    case 'TEMPLATE':
      return message.parameters?.flatMap((p) => p.parameters).join(' ') ?? ''
    case 'INTERACTIVE':
      return message.interactive.body
    case 'AUDIO':
      return message.caption ?? ''
  }
}

function buttonsOf(message: OutboundWhatsAppMessage): SandboxButton[] {
  return message.kind === 'INTERACTIVE' ? message.interactive.buttons.map(mapButton) : []
}

/**
 * Batas jumlah pesan yang disimpan. Simulator tidak butuh riwayat tak terbatas, dan store
 * ini tidak boleh tumbuh tanpa batas hanya karena ada yang membiarkan panel terbuka seharian.
 */
const MAX_MESSAGES = 500

/**
 * Store pesan mock. process-wide singleton supaya semua modul (reminder, eskalasi,
 * darurat, farmasi) yang lewat `getWhatsAppService()` masuk ke log yang sama.
 */
class WhatsAppSandbox {
  private readonly messages: SandboxMessage[] = []
  private sequence = 0

  private push(message: SandboxMessage): SandboxMessage {
    this.messages.push(message)
    while (this.messages.length > MAX_MESSAGES) this.messages.shift()
    return message
  }

  private nextId(): string {
    this.sequence += 1
    return `sbx_${String(this.sequence).padStart(6, '0')}`
  }

  /** Pesan yang benar-benar keluar lewat mock provider. Status `DELIVERED`: mock selalu "terkirim". */
  recordOutbound(
    message: OutboundWhatsAppMessage,
    meta: { providerMessageId: string; sentAt: Date },
  ): SandboxMessage {
    const buttons = buttonsOf(message)
    return this.push({
      messageId: this.nextId(),
      providerMessageId: meta.providerMessageId,
      to: message.to,
      from: null,
      direction: 'OUTBOUND',
      kind: message.kind,
      body: bodyOf(message),
      buttons,
      templateName: message.kind === 'TEMPLATE' ? message.templateName : null,
      status: 'DELIVERED',
      createdAt: meta.sentAt,
      answeredAt: null,
      answeredByMessageId: null,
      error: null,
      relatedResource: deriveRelatedResource(buttons),
    })
  }

  /**
   * Percobaan kirim yang gagal. Dicatat supaya panel bisa menampilkan badge FAILED
   * dan scenario "provider failure" terlihat benar — bukan pesan yang hilang begitu saja.
   */
  recordFailedOutbound(message: OutboundWhatsAppMessage, error: string): SandboxMessage {
    const buttons = buttonsOf(message)
    return this.push({
      messageId: this.nextId(),
      providerMessageId: null,
      to: message.to,
      from: null,
      direction: 'OUTBOUND',
      kind: message.kind,
      body: bodyOf(message),
      buttons,
      templateName: message.kind === 'TEMPLATE' ? message.templateName : null,
      status: 'FAILED',
      createdAt: new Date(),
      answeredAt: null,
      answeredByMessageId: null,
      error,
      relatedResource: deriveRelatedResource(buttons),
    })
  }

  /** Balasan simulasi dari penerima. */
  recordInbound(input: {
    to: string
    from: string
    body: string
    providerMessageId?: string | null
  }): SandboxMessage {
    return this.push({
      messageId: this.nextId(),
      providerMessageId: input.providerMessageId ?? null,
      to: input.to,
      from: input.from,
      direction: 'INBOUND',
      kind: 'TEXT',
      body: input.body,
      buttons: [],
      templateName: null,
      status: 'READ',
      createdAt: new Date(),
      answeredAt: null,
      answeredByMessageId: null,
      error: null,
      relatedResource: null,
    })
  }

  /**
   * Tandai pesan outbound sudah dibuka (READ) dan sambungkan ke balasan yang menutupnya.
   * Semua pesan outbound sebelumnya di percakapan yang sama ikut READ — itulah yang
   * terjadi di WA sungguhan, dan itulah yang membuat badge di panel berarti.
   */
  markThreadReadBefore(to: string, before: Date, answeredByMessageId: string): number {
    let updated = 0
    for (const message of this.messages) {
      if (message.to !== to) continue
      if (message.direction !== 'OUTBOUND') continue
      if (message.createdAt.getTime() >= before.getTime()) continue
      if (message.status === 'FAILED') continue
      message.status = 'READ'
      message.answeredAt ??= before
      message.answeredByMessageId ??= answeredByMessageId
      updated += 1
    }
    return updated
  }

  /** Semua pesan, terbaru lebih dulu. */
  list(options: { to?: string; limit?: number } = {}): SandboxMessage[] {
    const filtered = options.to ? this.messages.filter((m) => m.to === options.to) : this.messages
    const ordered = [...filtered].reverse()
    return options.limit ? ordered.slice(0, options.limit) : ordered
  }

  get(messageId: string): SandboxMessage | null {
    return this.messages.find((m) => m.messageId === messageId) ?? null
  }

  /** Nomor yang punya percakapan, beserta jumlah pesan — untuk daftar thread di panel. */
  threads(): Array<{ to: string; messageCount: number; lastMessageAt: string; hasUnanswered: boolean }> {
    const grouped = new Map<string, SandboxMessage[]>()
    for (const message of this.messages) {
      const list = grouped.get(message.to) ?? []
      list.push(message)
      grouped.set(message.to, list)
    }
    return [...grouped.entries()]
      .map(([to, list]) => ({
        to,
        messageCount: list.length,
        lastMessageAt: new Date(Math.max(...list.map((m) => m.createdAt.getTime()))).toISOString(),
        hasUnanswered: list.some((m) => m.direction === 'OUTBOUND' && m.answeredAt === null && m.status !== 'FAILED'),
      }))
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
  }

  clear(): void {
    this.messages.length = 0
  }
}

let sandbox: WhatsAppSandbox | undefined

export function getWhatsAppSandbox(): WhatsAppSandbox {
  sandbox ??= new WhatsAppSandbox()
  return sandbox
}

export function resetWhatsAppSandbox(): void {
  sandbox = undefined
}
// Meta WhatsApp Cloud API — provider produksi (pengganti stub CL-101).
//
// Bentuk pesan dipetakan ke Graph API `POST /{phone-number-id}/messages`:
//
//   TEXT        → type: text
//   INTERACTIVE → type: interactive (tipe "button"; REPLY → reply.id, URL → url)
//   TEMPLATE    → type: template
//   AUDIO       → type: audio lewat `link` publik
//
// Dua hal yang tidak bisa diabaikan (lihat docs/WHATSAPP-SETUP.md):
//
//  1. **Jendela layanan 24 jam.** Meta hanya mengizinkan pesan free-form dalam 24 jam
//     sejak pengguna terakhir menghubungi bot. Reminder obat CareLoop bersifat proaktif,
//     jadi SELALU di luar jendela → wajib `TEMPLATE` yang sudah disetujui Meta. Kalau
//     tidak, pengiriman ditolak `131047` dan tidak akan pernah sampai ke pasien.
//  2. `send*` bisa mengembalikan HTTP 200 dengan `messages[0].status === 'failed'`.
//     Status di body wajib diperiksa;ACs只看 HTTP code akan salah optimistis.
import { WhatsAppSendError } from '../errors'
import type {
  OutboundWhatsAppMessage,
  WaButton,
  WaInteractiveBody,
  WaTemplateComponent,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../types'

export interface MetaCloudApiOptions {
  /** Access token permanen (System User) atau token sementara untuk coba-coba. */
  token: string
  /** Phone Number ID, bukan nomor telepon. */
  phoneId: string
  /** Versi Graph API. Default v21.0. */
  apiVersion?: string
  /** Host Graph API; diganti di test agar tidak menyentuh jaringan. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Timeout per request (ms). Default 10 000. */
  timeoutMs?: number
  /** Kode bahasa template. Default `id`. */
  languageCode?: string
}

/** Bentuk `error` yang dikembalikan Graph API. */
interface GraphError {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
    error_data?: { details?: string }
  }
}

interface GraphSendResponse {
  messaging_product?: string
  messages?: Array<{ id?: string; message_status?: string; status?: string }>
}

const DEFAULT_API_VERSION = 'v26.0'
/** Bahasa default template — seluruh UI CareLoop berbahasa Indonesia. */
const DEFAULT_TEMPLATE_LANGUAGE = 'id'
const DEFAULT_BASE_URL = 'https://graph.facebook.com'

/**
 * Kode error Meta yang tidak akan membaik dengan mencoba lagi. Dipisah dari HTTP status
 * karena Meta sering balas HTTP 400 dengan semantik yang sangat spesifik.
 */
const NON_RETRYABLE_CODES: Record<number, string> = {
  // --- Pesan / penerima ---
  131047: 'Jendela layanan 24 jam tertutup — perlu message template yang disetujui Meta',
  131026: 'Pesan tidak dapat dikirim ke nomor ini',
  131009: 'Nomor tidak terdaftar di WhatsApp',
  131051: 'Tipe pesan tidak didukung WhatsApp',
  131030: 'Nomor tujuan belum masuk daftar penerima yang diizinkan (khusus test number Meta)',
  100: 'Nomor tujuan tidak valid',
  // Diterima API (HTTP 200) tapi ditolak saat pengiriman. Tidak terlihat dari respons
  // POST /messages — hanya muncul lewat webhook `statuses`.
  130497:
    'Akun bisnis dibatasi untuk mengirim ke negara penerima — nomor uji Meta berawal +1 dan tidak bisa menjangkau penerima Indonesia. Butuh nomor bisnis sendiri.',

  // --- Token & izin ---
  190: 'Access token tidak valid atau kedaluwarsa',
  10: 'Izin (scope) token tidak mencukupi — butuh whatsapp_business_messaging',

  // --- Template ---
  // Catatan: Meta memakai beberapa kode untuk hal berbeda. Labelnya dibuat spesifik
  // supaya pesan error tidak menyesatkan — 132001 sama sekali bukan "jumlah parameter salah",
  // melainkan template dengan nama itu memang tidak ada untuk bahasa tersebut.
  132000: 'Format parameter template tidak sesuai',
  132001: 'Nama template tidak tersedia untuk bahasa itu — cek nama & kode bahasa template',
  132005: 'Bahasa template tidak tersedia — kode language yang dikirim tidak dikenal Meta',
  132012: 'Format parameter template tidak sesuai',
  132015: 'Template sedang dijeda (PAUSED) — ajukan ulang di WhatsApp Manager',
  133000: 'Template tidak ada sama sekali — buat dulu di WhatsApp Manager',
  133009: 'Isi parameter template terlalu panjang',
  133010: 'Isi parameter template tidak diizinkan',

  // --- Registrasi nomor ---
  133016: 'Terlalu sering mendaftarkan nomor (batas 10x / 72 jam) — tunggu 72 jam',
}


/** Bentuk payload Graph per jenis pesan. Diekspor supaya bisa diuji tanpa jaringan. */
export function buildGraphPayload(
  message: OutboundWhatsAppMessage,
  languageCode = DEFAULT_TEMPLATE_LANGUAGE,
): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', to: message.to }

  switch (message.kind) {
    case 'TEXT':
      return { ...base, type: 'text', text: { body: message.text, preview_url: false } }

    case 'INTERACTIVE':
      return { ...base, ...buildInteractive(message.interactive) }

    case 'TEMPLATE':
      return {
      ...base,
      type: 'template',
      template: buildTemplate(message.templateName, message.parameters, languageCode),
    }

    case 'AUDIO':
      return {
        ...base,
        type: 'audio',
        audio: { link: message.audioUrl },
        // Cloud API tidak menerima caption pada media. `caption` sengaja diabaikan:
        // mengirimnya sebagai pesan kedua akan menggandakan biaya per konfirmasi.
      }
  }
}

function buildInteractive(interactive: WaInteractiveBody): Record<string, unknown> {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      ...(interactive.header ? { header: { type: 'text', text: interactive.header } } : {}),
      body: { text: interactive.body },
      ...(interactive.footer ? { footer: { text: interactive.footer } } : {}),
      action: { buttons: interactive.buttons.map(mapButton) },
    },
  }
}

function mapButton(button: WaButton): Record<string, unknown> {
  return button.type === 'REPLY'
    ? { type: 'reply', reply: { id: button.id, title: button.title } }
    : { type: 'url', url: button.url, title: button.title }
}

function buildTemplate(
  templateName: string,
  parameters: WaTemplateComponent[] | undefined,
  languageCode: string,
): Record<string, unknown> {
  return {
    name: templateName,
    language: { code: languageCode },
    components: (parameters ?? []).map((component) =>
      component.type === 'BUTTON'
        ? {
            type: 'button',
            sub_type: component.subType ?? 'quick_reply',
            index: String(component.index ?? 0),
            // Untuk quick_reply, payload-nya adalah id tombol yang dibaca parser
            // (`CONFIRM_TAKEN_<scheduleId>`), bukan teks yang dilihat pengguna.
            parameters: component.parameters.map((value: string) => ({
              type: 'payload',
              payload: value,
            })),
          }
        : {
            type: component.type.toLowerCase(),
            parameters: component.parameters.map((text: string) => ({ type: 'text', text })),
          },
    ),
  }
}

/** Ubah kegagalan HTTP/Graph menjadi `WhatsAppSendError` dengan flag retry yang benar. */
export function toSendError(status: number, payload: GraphError, providerName: string): WhatsAppSendError {
  const graphCode = payload?.error?.code
  const explanation = typeof graphCode === 'number' ? NON_RETRYABLE_CODES[graphCode] : undefined

  // 5xx dan 429 murni sementara: jaringan Meta yang padat, bukan kesalahan konfigurasi.
  const retryable = status >= 500 || status === 429

  const detail = payload?.error?.message ?? `HTTP ${status}`
  const parts = [`Kirim WhatsApp gagal (${providerName}): ${detail}`]
  if (graphCode !== undefined) parts.push(`[kode Meta ${graphCode}]`)
  if (explanation) parts.push(`— ${explanation}`)
  if (payload?.error?.fbtrace_id) parts.push(`(fbtrace ${payload.error.fbtrace_id})`)

  return new WhatsAppSendError(parts.join(' '), {
    provider: providerName,
    retryable,
    providerCode: typeof graphCode === 'number' ? graphCode : undefined,
    cause: payload,
  })
}

export class MetaCloudApiProvider implements WhatsAppProvider {
  readonly name = 'meta-cloud-api'

  private readonly token: string
  private readonly phoneId: string
  private readonly apiVersion: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly languageCode: string

  constructor(options: MetaCloudApiOptions) {
    if (!options.token) {
      throw new WhatsAppSendError('WHATSAPP_TOKEN wajib diisi saat PROVIDER_MODE=live', {
        provider: this.name,
        retryable: false,
      })
    }
    if (!options.phoneId) {
      throw new WhatsAppSendError('WHATSAPP_PHONE_ID wajib diisi saat PROVIDER_MODE=live', {
        provider: this.name,
        retryable: false,
      })
    }

    this.token = options.token
    this.phoneId = options.phoneId
    this.apiVersion = options.apiVersion ?? DEFAULT_API_VERSION
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.languageCode = options.languageCode ?? DEFAULT_TEMPLATE_LANGUAGE
  }

  private get endpoint(): string {
    return `${this.baseUrl}/${this.apiVersion}/${this.phoneId}/messages`
  }

  async send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGraphPayload(message, this.languageCode)),
        signal: controller.signal,
      })
    } catch (err) {
      // DNS gagal, koneksi putus, timeout — semua layak dicoba lagi.
      throw new WhatsAppSendError(
        `Tidak bisa menghubungi Graph API: ${err instanceof Error ? err.message : String(err)}`,
        { provider: this.name, retryable: true, cause: err },
      )
    } finally {
      clearTimeout(timer)
    }

    const payload = (await response.json().catch(() => ({}))) as GraphSendResponse & GraphError

    if (!response.ok) {
      throw toSendError(response.status, payload, this.name)
    }

    // Meta balas 200 walau gagal di level pesan. Kalau status diabaikan, reminder
    // dianggap terkirim padahal tidak pernah sampai ke pasien.
    const sent = payload.messages?.[0]
    if (sent?.status === 'failed') {
      throw new WhatsAppSendError(
        `Graph API menerima permintaan tetapi menandai pesan gagal: ${sent.message_status ?? 'tanpa alasan'}`,
        { provider: this.name, retryable: false, cause: payload },
      )
    }

    if (!sent?.id) {
      throw new WhatsAppSendError('Graph API tidak mengembalikan id pesan', {
        provider: this.name,
        retryable: true,
        cause: payload,
      })
    }

    return { providerMessageId: sent.id, sentAt: new Date() }
  }
}
// WhatsAppService (CL-101) — satu-satunya jalur keluar pesan WhatsApp.
// Memisahkan pemanggil (modul reminder/escalation/emergency/auth) dari provider
// (mock/Meta/360dialog/Twilio) supaya provider bisa di-swap tanpa mengubah pemanggil.
// Semua pengiriman lewat service ini; handler tidak boleh memanggil provider langsung.
import { getEnv, type Env } from '../../lib/env'
import { WhatsAppSendError } from './errors'
import { outboundWhatsAppMessageSchema } from './types'
import type {
  OutboundWhatsAppMessage,
  WaInteractiveBody,
  WaRecipient,
  WaTemplateComponent,
  WhatsAppProvider,
  WhatsAppSendResult,
} from './types'
import { MockWhatsAppProvider } from './providers/mock.provider'
import { MetaCloudApiProvider } from './providers/meta.provider'

export { WhatsAppSendError }

/** Interface publik yang dipakai seluruh pemanggil. */
export interface WhatsAppService {
  /** Kirim pesan bentuk apa pun (sudah dinormalkan & divalidasi). */
  send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult>
  sendText(to: string, text: string): Promise<WhatsAppSendResult>
  sendTemplate(to: string, templateName: string, parameters?: WaTemplateComponent[]): Promise<WhatsAppSendResult>
  sendInteractive(to: string, interactive: WaInteractiveBody): Promise<WhatsAppSendResult>
  sendAudio(to: string, audioUrl: string, caption?: string): Promise<WhatsAppSendResult>
  /** Provider aktif — dibaca test/observer untuk memeriksa pesan tercatat. */
  readonly provider: WhatsAppProvider
}

export interface WhatsAppServiceOptions {
  provider: WhatsAppProvider
  /** Total percobaan kirim termasuk percobaan pertama. Default 3 (FR-1.3: retry maksimal 2x). */
  maxAttempts?: number
  /** Jeda dasar backoff eksponensial (ms); menjadi 2x lipat tiap retry. Default 1000. */
  baseDelayMs?: number
  /** Hook ketika gagal dan akan di-retry (untuk log). */
  onRetry?: (attempt: number, error: WhatsAppSendError) => void
  now?: () => Date
}

/**
 * Menormalkan nomor HP Indonesia menjadi E.164 tanpa '+':
 * "0812…" -> "62812…", "+62812…" -> "62812…", "62812…" tetap.
 */
export function toWaId(phone: string): WaRecipient {
  const cleaned = phone.trim().replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+')) return cleaned.slice(1)
  if (cleaned.startsWith('0')) return `62${cleaned.slice(1)}`
  return cleaned
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function asSendError(err: unknown, providerName: string): WhatsAppSendError {
  if (err instanceof WhatsAppSendError) return err
  return new WhatsAppSendError(`Kirim WhatsApp gagal (${providerName}): ${err instanceof Error ? err.message : String(err)}`, {
    provider: providerName,
    retryable: true,
    cause: err,
  })
}

export function createWhatsAppService(options: WhatsAppServiceOptions): WhatsAppService {
  const { provider } = options
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3))
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 1_000))
  const now = options.now ?? (() => new Date())

  async function sendWithRetry(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    let attempt = 0
    for (;;) {
      attempt += 1
      try {
        return await provider.send(message)
      } catch (err) {
        const sendError = asSendError(err, provider.name)
        const shouldRetry = sendError.options.retryable === true && attempt < maxAttempts
        if (!shouldRetry) throw sendError
        options.onRetry?.(attempt, sendError)
        await sleep(baseDelayMs * 2 ** (attempt - 1))
      }
    }
  }

  async function send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    const normalized = { ...message, to: toWaId(message.to) }
    const validated = outboundWhatsAppMessageSchema.parse(normalized)
    return sendWithRetry(validated)
  }

  return {
    send,
    sendText: (to, text) => send({ kind: 'TEXT', to, text }),
    sendTemplate: (to, templateName, parameters) => send({ kind: 'TEMPLATE', to, templateName, parameters }),
    sendInteractive: (to, interactive) => send({ kind: 'INTERACTIVE', to, interactive }),
    sendAudio: (to, audioUrl, caption) => send({ kind: 'AUDIO', to, audioUrl, caption }),
    provider,
  }
}

/** Memilih provider berdasarkan PROVIDER_MODE (CL-005). */
export function createWhatsAppServiceFromEnv(
  env: Pick<
    Env,
    'PROVIDER_MODE' | 'WHATSAPP_TOKEN' | 'WHATSAPP_PHONE_ID' | 'WHATSAPP_API_VERSION'
  > = getEnv(),
): WhatsAppService {
  const provider: WhatsAppProvider =
    env.PROVIDER_MODE === 'mock'
      ? new MockWhatsAppProvider()
      : new MetaCloudApiProvider({
          token: env.WHATSAPP_TOKEN ?? '',
          phoneId: env.WHATSAPP_PHONE_ID ?? '',
          apiVersion: env.WHATSAPP_API_VERSION,
        })
  return createWhatsAppService({ provider })
}

let cached: WhatsAppService | undefined

/** Singleton untuk wiring di app. Menyimpan riwayat kirim saat mode mock. */
export function getWhatsAppService(): WhatsAppService {
  cached ??= createWhatsAppServiceFromEnv()
  return cached
}

export function resetWhatsAppServiceCache(): void {
  cached = undefined
}
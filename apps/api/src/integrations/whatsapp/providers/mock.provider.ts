// Mock provider WhatsApp (CL-101) — mode default PROVIDER_MODE=mock.
// Tidak pernah mengirim ke nomor riil: hanya mencatat payload ke memori (dry-run).
// Dipakai sebagai default service dan sebagai recordable fake di unit test.
import { WhatsAppSendError } from '../errors'
import { getWhatsAppSandbox } from '../sandbox'
import type {
  OutboundWhatsAppMessage,
  WaRecipient,
  WhatsAppProvider,
  WhatsAppSendResult,
} from '../types'

export interface RecordedWhatsAppMessage {
  id: string
  to: WaRecipient
  payload: OutboundWhatsAppMessage
  sentAt: Date
}

export interface MockWhatsAppProviderOptions {
  /** Simulasi kegagalan retryable pada N kiriman berikutnya (uji retry). Default 0. */
  failNext?: number
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock-whatsapp'
  private readonly records: RecordedWhatsAppMessage[] = []
  private failRemaining: number

  constructor(options: MockWhatsAppProviderOptions = {}) {
    this.failRemaining = Math.max(0, Math.floor(options.failNext ?? 0))
  }

  /** Seluruh pesan yang "dikirim" — untuk asersi test. */
  get sent(): readonly RecordedWhatsAppMessage[] {
    return this.records
  }

  /** Mengaktifkan simulasi kegagalan retryable pada `count` kiriman berikutnya. */
  simulateFailures(count: number): void {
    this.failRemaining = Math.max(0, Math.floor(count))
  }

  async send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    if (this.failRemaining > 0) {
      this.failRemaining -= 1
      const error = new WhatsAppSendError('Simulasi kegagalan pengiriman (mock dry-run)', {
        provider: this.name,
        retryable: true,
      })
      getWhatsAppSandbox().recordFailedOutbound(message, error.message)
      throw error
    }

    const record: RecordedWhatsAppMessage = {
      id: `mock_${this.records.length + 1}`,
      to: message.to,
      payload: message,
      sentAt: new Date(),
    }
    this.records.push(record)
    getWhatsAppSandbox().recordOutbound(message, {
      providerMessageId: record.id,
      sentAt: record.sentAt,
    })
    return { providerMessageId: record.id, sentAt: record.sentAt }
  }
}
// TtsService — voice reminder (CL-106 stub; implementasi TTS sungguhan menyusul di CL-305).
//
// Scope CL-106 hanya butuh kontrak + stub agar:
//   - pasien `voice_enabled` tetap mendapat reminder audio (RM-3), dan
//   - kegagalan TTS bisa diuji tanpa depending ke vendor TTS (RM-4).
//
// Stub TIDAK pernah memanggil layanan eksternal: dia hanya mengembalikan URL audio
// dummy yang bisa di-resolve provider WhatsApp. Pindahkan ke vendor asli (Google TTS,
// ElevenLabs, dst.) dengan mengimplementasikan interface yang sama.
import { randomUUID } from 'node:crypto'

export interface TtsSynthesisOptions {
  /** Kode bahasa BCP-47; default id-ID (Bahasa Indonesia) sesuai PRD FR-11.1. */
  locale?: string
  /** Tag untuk melacak hasil sintesis pada log reminder. */
  cacheKey?: string
}

export interface TtsSynthesisResult {
  /** URL audio yang bisa dikirim sebagai pesan WhatsApp AUDIO. */
  audioUrl: string
  /** Durasi dalam detik; null bila stub tidak menghitungnya. */
  durationSec: number | null
  locale: string
}

export interface TtsService {
  readonly name: string
  synthesize(text: string, options?: TtsSynthesisOptions): Promise<TtsSynthesisResult>
}

export class TtsError extends Error {
  readonly retryable: boolean

  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message)
    this.name = 'TtsError'
    this.retryable = options.retryable ?? false
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export interface MockTtsServiceOptions {
  /** Simulasi kegagalan pada N sintesis berikutnya (uji fallback RM-4). Default 0. */
  failNext?: number
  /** Basis URL audio dummy. */
  baseUrl?: string
}

export class MockTtsService implements TtsService {
  readonly name = 'mock-tts'
  private failRemaining: number
  private readonly baseUrl: string

  constructor(options: MockTtsServiceOptions = {}) {
    this.failRemaining = Math.max(0, Math.floor(options.failNext ?? 0))
    this.baseUrl = (options.baseUrl ?? 'https://tts.mock.careloop.dev/audio').replace(/\/+$/, '')
  }

  simulateFailures(count: number): void {
    this.failRemaining = Math.max(0, Math.floor(count))
  }

  async synthesize(text: string, options: TtsSynthesisOptions = {}): Promise<TtsSynthesisResult> {
    if (this.failRemaining > 0) {
      this.failRemaining -= 1
      throw new TtsError('Simulasi kegagalan TTS (mock)', { retryable: false })
    }

    if (text.trim().length === 0) {
      throw new TtsError('Teks kosong tidak bisa disintesis', { retryable: false })
    }

    const locale = options.locale ?? 'id-ID'
    const slug = options.cacheKey ?? randomUUID()

    return {
      audioUrl: `${this.baseUrl}/${locale}/${encodeURIComponent(slug)}.mp3`,
      durationSec: null,
      locale,
    }
  }
}

let cached: TtsService | undefined

export function getTtsService(): TtsService {
  cached ??= new MockTtsService()
  return cached
}

export function resetTtsServiceCache(): void {
  cached = undefined
}

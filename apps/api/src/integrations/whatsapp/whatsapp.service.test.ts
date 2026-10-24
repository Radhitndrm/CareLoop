// Unit test WhatsAppService (CL-101): normalisasi nomor, pencatatan payload mock,
// retry hook, validasi input. Ref: docs/TESTING.md §10.
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  createWhatsAppService,
  createWhatsAppServiceFromEnv,
  toWaId,
  WhatsAppSendError,
} from './whatsapp.service'
import { MockWhatsAppProvider } from './providers/mock.provider'
import type { WhatsAppProvider, WhatsAppSendResult } from './types'

function makeService(maxAttempts = 3, baseDelayMs = 0) {
  const provider = new MockWhatsAppProvider()
  const onRetry = vi.fn()
  const service = createWhatsAppService({ provider, maxAttempts, baseDelayMs, onRetry })
  return { provider, service, onRetry }
}

describe('toWaId — normalisasi nomor HP ke E.164 tanpa "+"', () => {
  it('08… menjadi 62…', () => {
    expect(toWaId('081200000001')).toBe('6281200000001')
  })
  it('+62… tetap tanpa "+"', () => {
    expect(toWaId('+6281200000001')).toBe('6281200000001')
  })
  it('62… tetap', () => {
    expect(toWaId('6281200000001')).toBe('6281200000001')
  })
  it('karakter asing dibuang', () => {
    expect(toWaId('(0812) 000-0001')).toBe('628120000001')
  })
})

describe('createWhatsAppService — payload ke provider dinormalkan & valid', () => {
  it('sendText: nomor 08… dinormalkan, teks tercatat', async () => {
    const { provider, service } = makeService()
    await service.sendText('081200000001', 'halo')
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0].to).toBe('6281200000001')
    expect(provider.sent[0].payload).toEqual({ kind: 'TEXT', to: '6281200000001', text: 'halo' })
  })

  it('sendInteractive: button ids tercatat apa adanya (konfirmasi 1-tap + deep-link 112)', async () => {
    const { provider, service } = makeService()
    await service.sendInteractive('6281200000002', {
      body: 'Deteksi detak jantung tinggi. Apakah Anda aman?',
      buttons: [
        { type: 'REPLY', id: 'SAFE', title: 'Saya aman' },
        { type: 'URL', id: 'CALL_112', title: 'Telepon 112', url: 'tel:112' },
      ],
    })
    const payload = provider.sent[0].payload
    if (payload.kind !== 'INTERACTIVE') throw new Error('seharusnya INTERACTIVE')
    expect(payload.interactive.buttons.map((b) => b.id)).toEqual(['SAFE', 'CALL_112'])
    expect(payload.interactive.buttons[1]).toMatchObject({ type: 'URL', url: 'tel:112' })
  })

  it('sendTemplate: nama template + parameter tercatat', async () => {
    const { provider, service } = makeService()
    await service.sendTemplate('6281200000003', 'reminder_obat', [
      { type: 'BODY', parameters: ['Metformin 500mg', '1 tablet'] },
    ])
    const payload = provider.sent[0].payload
    if (payload.kind !== 'TEMPLATE') throw new Error('seharusnya TEMPLATE')
    expect(payload.templateName).toBe('reminder_obat')
    expect(payload.parameters).toEqual([{ type: 'BODY', parameters: ['Metformin 500mg', '1 tablet'] }])
  })

  it('sendAudio: audioUrl + caption tercatat (voice reminder lansia)', async () => {
    const { provider, service } = makeService()
    await service.sendAudio('6281200000004', 'https://cdn.example/audio/reminder.mp3', 'Minum obat sekarang')
    const payload = provider.sent[0].payload
    if (payload.kind !== 'AUDIO') throw new Error('seharusnya AUDIO')
    expect(payload).toEqual({
      kind: 'AUDIO',
      to: '6281200000004',
      audioUrl: 'https://cdn.example/audio/reminder.mp3',
      caption: 'Minum obat sekarang',
    })
  })

  it('input interaktif invalid (0 tombol) → ZodError, provider tidak dipanggil', async () => {
    const { provider, service, onRetry } = makeService()
    await expect(
      service.sendInteractive('6281200000005', { body: 'tanpa tombol', buttons: [] }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(provider.sent).toHaveLength(0)
    expect(onRetry).not.toHaveBeenCalled()
  })
})

describe('retry hook', () => {
  it('gagal sekali lalu berhasil: 1 kiriman tercatat, onRetry dipanggil sekali', async () => {
    const { provider, service, onRetry } = makeService()
    provider.simulateFailures(1)
    await expect(service.sendText('6281200000006', 'lagi')).resolves.toEqual(
      expect.objectContaining({ providerMessageId: 'mock_1' }),
    )
    expect(provider.sent).toHaveLength(1)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(WhatsAppSendError))
  })

  it('selalu gagal hingga batas: throw setelah percobaan terakhir, tidak ada kiriman', async () => {
    const { provider, service, onRetry } = makeService(3, 0)
    provider.simulateFailures(3)
    await expect(service.sendText('6281200000007', 'gagal terus')).rejects.toBeInstanceOf(
      WhatsAppSendError,
    )
    expect(provider.sent).toHaveLength(0)
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  it('error non-retryable tidak di-retry', async () => {
    const onRetry = vi.fn()
    const provider: WhatsAppProvider = {
      name: 'failing',
      async send(): Promise<WhatsAppSendResult> {
        throw new WhatsAppSendError('token mati', { provider: this.name, retryable: false })
      },
    }
    const service = createWhatsAppService({ provider, onRetry })
    await expect(service.sendText('6281200000008', 'x')).rejects.toBeInstanceOf(WhatsAppSendError)
    expect(onRetry).not.toHaveBeenCalled()
  })
})

describe('createWhatsAppServiceFromEnv — pemilihan provider (CL-005)', () => {
  it('PROVIDER_MODE=mock → MockWhatsAppProvider (dry-run)', () => {
    const service = createWhatsAppServiceFromEnv({
      PROVIDER_MODE: 'mock',
      WHATSAPP_TOKEN: undefined,
      WHATSAPP_PHONE_ID: undefined,
      WHATSAPP_API_VERSION: 'v26.0',
    })
    expect(service.provider.name).toBe('mock-whatsapp')
  })

  it('PROVIDER_MODE=live → MetaCloudApiProvider, dan konfigurasi kosong ditolak', () => {
    const service = createWhatsAppServiceFromEnv({
      PROVIDER_MODE: 'live',
      WHATSAPP_TOKEN: 'token',
      WHATSAPP_PHONE_ID: '123456',
      WHATSAPP_API_VERSION: 'v26.0',
    })
    expect(service.provider.name).toBe('meta-cloud-api')

    // Token/phone id kosong harus meledak saat pembuatan service — bukan diam-diam
    // mengirim request tanpa autentikasi ke Graph API.
    expect(() =>
      createWhatsAppServiceFromEnv({
        PROVIDER_MODE: 'live',
        WHATSAPP_TOKEN: '',
        WHATSAPP_PHONE_ID: '123456',
        WHATSAPP_API_VERSION: 'v26.0',
      }),
    ).toThrow(WhatsAppSendError)
  })
})
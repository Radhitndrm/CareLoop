// MetaCloudApiProvider — pemetaan payload ke Graph API dan klasifikasi retry.
//
// Semua test memakai `fetchImpl` palsu: tidak ada test di suite ini yang menyentuh
// jaringan, sehingga suite tetap bisa jalan offline maupun di CI tanpa token Meta.
import { describe, expect, it, vi } from 'vitest'
import { buildGraphPayload, MetaCloudApiProvider, toSendError } from './meta.provider'
import { WhatsAppSendError } from '../errors'
import type { OutboundWhatsAppMessage } from '../types'

const PHONE_ID = '109876543210'
const TOKEN = 'EAAG-test-token'
const SCHEDULE_ID = '00000000-0000-4000-8000-000000000302'
const EMERGENCY_ID = 'cccccccc-3333-4333-8333-333333333333'

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function providerWith(
  response: Response | (() => Promise<Response>),
  options: Partial<ConstructorParameters<typeof MetaCloudApiProvider>[0]> = {},
) {
  const fetchImpl = vi.fn(async () =>
    typeof response === 'function' ? response() : response,
  ) as unknown as typeof fetch

  const provider = new MetaCloudApiProvider({
    token: TOKEN,
    phoneId: PHONE_ID,
    baseUrl: 'https://graph.test',
    fetchImpl,
    ...options,
  })

  return { provider, fetchImpl }
}

function bodyOf(fetchImpl: typeof fetch, callIndex = 0): any {
  return JSON.parse((fetchImpl as any).mock.calls[callIndex][1].body)
}

describe('buildGraphPayload', () => {
  it('TEXT → type text dengan preview dimatikan', () => {
    const payload = buildGraphPayload({ kind: 'TEXT', to: '628120000001', text: 'Halo' })
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '628120000001',
      type: 'text',
      text: { body: 'Halo', preview_url: false },
    })
  })

  it('INTERACTIVE → tombol reply & url dipetakan ke action.buttons', () => {
    const payload = buildGraphPayload({
      kind: 'INTERACTIVE',
      to: '628120000001',
      interactive: {
        body: 'Sudah diminum?',
        header: 'Minum Obat',
        footer: 'Tekan tombol',
        buttons: [
          { type: 'REPLY', id: `CONFIRM_TAKEN_${SCHEDULE_ID}`, title: 'Sudah Minum' },
          { type: 'URL', id: 'CALL_112', title: 'Hubungi 112', url: 'tel:112' },
        ],
      },
    })

    expect(payload.type).toBe('interactive')
    const interactive = (payload as any).interactive
    expect(interactive.type).toBe('button')
    expect(interactive.body.text).toBe('Sudah diminum?')
    expect(interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: `CONFIRM_TAKEN_${SCHEDULE_ID}`, title: 'Sudah Minum' } },
      { type: 'url', url: 'tel:112', title: 'Hubungi 112' },
    ])
  })

  it('TEMPLATE → komponen body lowercase dengan parameter teks', () => {
    const payload = buildGraphPayload({
      kind: 'TEMPLATE',
      to: '628120000001',
      templateName: 'pengingat_obat',
      parameters: [{ type: 'BODY', parameters: ['Amlodipine', '07:00'] }],
    })

    expect(payload.type).toBe('template')
    expect((payload as any).template).toEqual({
      name: 'pengingat_obat',
      language: { code: 'id' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Amlodipine' }, { type: 'text', text: '07:00' }] },
      ],
    })
  })

  it('AUDIO → link media publik; caption tidak dikirim (Cloud API tak menerima caption)', () => {
    const payload = buildGraphPayload({
      kind: 'AUDIO',
      to: '628120000001',
      audioUrl: 'https://cdn.test/voice.ogg',
      caption: 'Pengingat obat',
    })
    expect(payload).toMatchObject({ type: 'audio', audio: { link: 'https://cdn.test/voice.ogg' } })
    expect(JSON.stringify(payload)).not.toContain('Pengingat obat')
  })
})

describe('MetaCloudApiProvider.send', () => {
  it('mengirim ke endpoint Graph yang benar dengan token & versi API', async () => {
    const { provider, fetchImpl } = providerWith(
      jsonResponse(200, { messages: [{ id: 'wamid.OK1' }] }),
    )

    const result = await provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })

    expect(result.providerMessageId).toBe('wamid.OK1')
    expect(result.sentAt).toBeInstanceOf(Date)

    const [url, init] = (fetchImpl as any).mock.calls[0]
    expect(url).toBe(`https://graph.test/v26.0/${PHONE_ID}/messages`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('versi Graph API bisa diganti lewat opsi', async () => {
    const { provider, fetchImpl } = providerWith(
      jsonResponse(200, { messages: [{ id: 'wamid.OK2' }] }),
      { apiVersion: 'v18.0' },
    )

    await provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })
    expect((fetchImpl as any).mock.calls[0][0]).toContain('/v18.0/')
  })

  it('menolak konfigurasi kosong sejak konstruktor, bukan saat pengiriman', () => {
    expect(() => new MetaCloudApiProvider({ token: '', phoneId: PHONE_ID })).toThrow(
      WhatsAppSendError,
    )
    expect(() => new MetaCloudApiProvider({ token: TOKEN, phoneId: '' })).toThrow(
      /WHATSAPP_PHONE_ID/,
    )
  })
})

describe('Klasifikasi retry (Meta error codes)', () => {
  it('429 dan 5xx dianggap sementara → retryable', () => {
    expect(toSendError(429, {}, 'meta').options.retryable).toBe(true)
    expect(toSendError(500, {}, 'meta').options.retryable).toBe(true)
    expect(toSendError(503, {}, 'meta').options.retryable).toBe(true)
  })

  it('jendela 24 jam tertutup (131047) → permanen, dengan penjelasan', () => {
    const err = toSendError(400, { error: { code: 131047, message: '(#131047) Re-engagement message' } }, 'meta')
    expect(err.options.retryable).toBe(false)
    expect(err.message).toContain('131047')
    expect(err.message).toContain('template')
  })

  it('token mati (190) & nomor tidak valid (100) → permanen', () => {
    expect(toSendError(401, { error: { code: 190 } }, 'meta').options.retryable).toBe(false)
    expect(toSendError(400, { error: { code: 100 } }, 'meta').options.retryable).toBe(false)
  })

  it('kode template diberi label akurat, bukan menyesatkan', () => {
    // 132001 = nama template tidak ada untuk bahasa itu. Tidak boleh dikasih label
    // "jumlah parameter salah" — itu menyesatkan orang yang sedang membuat template.
    expect(toSendError(400, { error: { code: 132001 } }, 'meta').message).toContain('tidak tersedia')
    expect(toSendError(400, { error: { code: 132001 } }, 'meta').message).not.toContain('parameter')

    expect(toSendError(400, { error: { code: 133000 } }, 'meta').message).toContain('WhatsApp Manager')
    expect(toSendError(400, { error: { code: 133016 } }, 'meta').message).toContain('72 jam')
    expect(toSendError(400, { error: { code: 131030 } }, 'meta').message).toContain('daftar penerima')
    // 130497 hanya muncul lewat webhook `statuses`, bukan respons POST /messages.
    expect(toSendError(400, { error: { code: 130497 } }, 'meta').message).toContain('dibatasi')
  })

  it('error jaringan dibungkus retryable', async () => {
    const { provider } = providerWith(() => Promise.reject(new Error('ECONNRESET')))
    await expect(provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })).rejects.toMatchObject({
      options: { retryable: true },
    })
  })

  it('HTTP 200 dengan status "failed" tetap dianggap gagal (jangan sampai optimistis)', async () => {
    const { provider } = providerWith(
      jsonResponse(200, { messages: [{ id: 'wamid.X', status: 'failed', message_status: 're-engagement' }] }),
    )

    await expect(provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })).rejects.toThrow(
      /menandai pesan gagal/,
    )
  })

  it('respons tanpa id pesan dianggap sementara — mungkin terpotong di tengah jalan', async () => {
    const { provider } = providerWith(jsonResponse(200, { messages: [{}] }))
    await expect(provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })).rejects.toMatchObject({
      options: { retryable: true },
    })
  })

  it('body non-JSON tidak membuat provider crash', async () => {
    const badJson = {
      ok: false,
      status: 400,
      json: async () => {
        throw new Error('Unexpected token')
      },
    } as unknown as Response

    const { provider } = providerWith(badJson)
    await expect(provider.send({ kind: 'TEXT', to: '628120000001', text: 'Halo' })).rejects.toThrow(
      /HTTP 400/,
    )
  })
})

describe('Integrasi service: retry memakai klasifikasi provider', () => {
  it('service tidak mencoba ulang saat Meta menolak permanen (131047)', async () => {
    const { createWhatsAppService } = await import('../whatsapp.service')
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { error: { code: 131047, message: 're-engagement' } }),
    ) as unknown as typeof fetch

    const service = createWhatsAppService({
      provider: new MetaCloudApiProvider({
        token: TOKEN,
        phoneId: PHONE_ID,
        baseUrl: 'https://graph.test',
        fetchImpl,
      }),
      maxAttempts: 3,
      baseDelayMs: 0,
    })

    await expect(service.sendText('628120000001', 'Halo')).rejects.toThrow(/131047/)
    // Satu percobaan saja: retry pada penolakan permanen hanya menambah biaya & delay.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('service mencoba ulang saat Meta sedang rate-limit, lalu berhasil', async () => {
    const { createWhatsAppService } = await import('../whatsapp.service')
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      return calls === 1
        ? jsonResponse(429, { error: { message: '(#4) Rate limit' } })
        : jsonResponse(200, { messages: [{ id: 'wamid.RETRY' }] })
    }) as unknown as typeof fetch

    const service = createWhatsAppService({
      provider: new MetaCloudApiProvider({
        token: TOKEN,
        phoneId: PHONE_ID,
        baseUrl: 'https://graph.test',
        fetchImpl,
      }),
      maxAttempts: 3,
      baseDelayMs: 0,
    })

    const result = await service.sendText('628120000001', 'Halo')
    expect(result.providerMessageId).toBe('wamid.RETRY')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('payload yang dikirim service sudah ternormalisasi ke E.164', async () => {
    const { createWhatsAppService } = await import('../whatsapp.service')
    const { provider, fetchImpl } = providerWith(jsonResponse(200, { messages: [{ id: 'wamid.N' }] }))
    const service = createWhatsAppService({ provider, maxAttempts: 1 })

    await service.sendText('081200000001', 'Halo')
    // Nomor lokal "0…" dinormalkan jadi E.164 tanpa "+", seperti yang diminta Graph API.
    expect(bodyOf(fetchImpl).to).toBe('6281200000001')
    // Normalisasi harus idempoten: E.164 tidak berubah saat dikirim lagi.
    await service.sendText('6281200000001', 'Halo')
    expect(bodyOf(fetchImpl, 1).to).toBe('6281200000001')
  })
})

describe('Bentuk pesan yang dipakai produksi tetap didukung', () => {
  it('konfirmasi darurat & alert eskalasi bisa dipetakan ke payload Graph', () => {
    const messages: OutboundWhatsAppMessage[] = [
      {
        kind: 'INTERACTIVE',
        to: '628120000001',
        interactive: {
          body: 'Apakah Anda aman?',
          buttons: [
            { type: 'REPLY', id: `SAFE_${EMERGENCY_ID}`, title: 'Saya Aman' },
            { type: 'REPLY', id: `NEED_HELP_${EMERGENCY_ID}`, title: 'Saya Butuh Bantuan' },
          ],
        },
      },
      {
        kind: 'INTERACTIVE',
        to: '628130000002',
        interactive: {
          body: 'Belum konfirmasi obat.',
          buttons: [{ type: 'REPLY', id: 'HANDLE_run-1', title: 'Saya Tangani' }],
        },
      },
    ]

    for (const message of messages) {
      const payload = buildGraphPayload(message) as any
      expect(payload.interactive.action.buttons).toHaveLength(message.kind === 'INTERACTIVE' ? message.interactive.buttons.length : 0)
      // callback_data Telegram 64-byte tidak relevan di sini, tapi id tombol WA
      // tetap harus pendek & tanpa spasi agar aman di URL-safe.
      for (const button of payload.interactive.action.buttons) {
        expect(button.reply?.id ?? button.url).toBeTruthy()
      }
    }
  })
})
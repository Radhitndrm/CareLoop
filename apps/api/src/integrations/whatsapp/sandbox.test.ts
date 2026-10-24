// Kontrak pesan mock (Fase 1 plan whatsapp mockup): apa yang masuk ke log simulator,
// apa yang diturunkan dari tombol, dan bagaimana status percakapan berubah saat dibalas.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deriveRelatedResource,
  getWhatsAppSandbox,
  resetWhatsAppSandbox,
  type SandboxMessage,
} from './sandbox'
import { MockWhatsAppProvider } from './providers/mock.provider'
import { buildEscalationBody, buildReminderBody } from './templates'
import { WaButtonIntent } from './parser'

const SCHEDULE_ID = 'aaaaaaaa-1111-4111-8111-111111111111'
const RUN_ID = 'bbbbbbbb-2222-4222-8222-222222222222'

function sendInteractive(to: string, interactive: ReturnType<typeof buildReminderBody>) {
  const provider = new MockWhatsAppProvider()
  return provider.send({ kind: 'INTERACTIVE', to, interactive })
}

describe('sandbox WhatsApp (log pesan mock)', () => {
  beforeEach(() => resetWhatsAppSandbox())

  it('menyimpan pesan interaktif lengkap: body, tombol, dan resource terkait', async () => {
    await sendInteractive(
      '628120000002',
      buildReminderBody({ medicationName: 'Amlodipine', doseQty: '1 tablet', timeOfDay: '07:00' }, SCHEDULE_ID),
    )

    const [message] = getWhatsAppSandbox().list()
    expect(message.direction).toBe('OUTBOUND')
    expect(message.to).toBe('628120000002')
    expect(message.body).toContain('Amlodipine')
    expect(message.buttons.map((b) => b.id)).toEqual([
      `${WaButtonIntent.CONFIRM_TAKEN}_${SCHEDULE_ID}`,
      `${WaButtonIntent.DEFER}_${SCHEDULE_ID}`,
    ])
    expect(message.status).toBe('DELIVERED')
    expect(message.providerMessageId).toBeTruthy()
    expect(message.relatedResource).toEqual({
      type: 'schedule',
      id: SCHEDULE_ID,
      intent: WaButtonIntent.CONFIRM_TAKEN,
    })
  })

  it('menandai pesan gagal saat provider disimulasikan error, dan tidak mengirim apa pun', async () => {
    const provider = new MockWhatsAppProvider({ failNext: 1 })
    await expect(
      provider.send({
        kind: 'TEXT',
        to: '628120000002',
        text: 'Amlodipine 07:00',
      }),
    ).rejects.toThrow()

    const sandbox = getWhatsAppSandbox()
    const [failed] = sandbox.list()
    expect(failed.status).toBe('FAILED')
    expect(failed.providerMessageId).toBeNull()
    expect(failed.error).toContain('Simulasi kegagalan')
    // Gagal berarti gagal: tidak boleh ikut terhitung sebagai pesan terkirim.
    expect(provider.sent).toHaveLength(0)
  })

  it('reply menandai pesan outbound sebelumnya sebagai READ dan mengaitkan ke balasan', () => {
    const sandbox = getWhatsAppSandbox()
    const outbound: SandboxMessage = {
      messageId: 'sbx_manual',
      providerMessageId: 'mock_1',
      to: '628120000002',
      from: null,
      direction: 'OUTBOUND',
      kind: 'INTERACTIVE',
      body: 'Waktunya minum Amlodipine',
      buttons: [
        { id: `${WaButtonIntent.CONFIRM_TAKEN}_${SCHEDULE_ID}`, title: 'Sudah Minum', type: 'REPLY' },
      ],
      templateName: null,
      status: 'DELIVERED',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      answeredAt: null,
      answeredByMessageId: null,
      error: null,
      relatedResource: null,
    }
    sandbox.recordInbound({ to: outbound.to, from: outbound.to, body: 'x' })
    ;(sandbox as unknown as { messages: SandboxMessage[] }).messages.push(outbound)

    const inbound = sandbox.recordInbound({
      to: '628120000002',
      from: '628120000002',
      body: 'Sudah Minum',
    })
    const updated = sandbox.markThreadReadBefore('628120000002', inbound.createdAt, inbound.messageId)

    expect(updated).toBe(1)
    expect(sandbox.get('sbx_manual')?.status).toBe('READ')
    expect(sandbox.get('sbx_manual')?.answeredByMessageId).toBe(inbound.messageId)
  })

  it('mengelompokkan percakapan per penerima dan menandai yang belum dibalas', () => {
    const sandbox = getWhatsAppSandbox()
    sandbox.recordInbound({ to: '628120000002', from: '628120000002', body: 'a' })
    sandbox.recordInbound({ to: '628120000002', from: '628120000002', body: 'b' })
    sandbox.recordInbound({ to: '628120000003', from: '628120000003', body: 'c' })

    const threads = sandbox.threads()
    expect(threads).toHaveLength(2)
    expect(threads[0].to).toBe('628120000003')
    expect(threads.find((t) => t.to === '628120000002')?.messageCount).toBe(2)
  })

  it('menurunkan resource dari tombol HANDLE, bukan dari tombol URL', () => {
    const resource = deriveRelatedResource([
      { id: 'MAPS', title: 'Buka Peta', type: 'URL' },
      { id: `${WaButtonIntent.HANDLE}_${RUN_ID}`, title: 'Saya Tangani', type: 'REPLY' },
    ])
    expect(resource).toEqual({ type: 'escalation', id: RUN_ID, intent: WaButtonIntent.HANDLE })
  })

  it('pesan tanpa tombol balasan tidak punya resource terkait', () => {
    expect(
      deriveRelatedResource([{ id: 'CALL_112', title: 'Hubungi 112', type: 'URL' }]),
    ).toBeNull()
  })

  it('alert eskalasi tetap memuat tombol 112 dan tidak pernah auto-dial', () => {
    const body = buildEscalationBody(
      { patientName: 'Pak Haji', context: 'Belum konfirmasi', instruction: 'Telepon dia' },
      RUN_ID,
      'Alert Keluarga',
    )
    const call112 = body.buttons.find((b) => b.id === 'CALL_112')
    expect(call112).toBeDefined()
    expect(call112?.type).toBe('URL')
    expect((call112 as { url: string }).url).toBe('tel:112')
  })
})
// Balasan quick-reply template (`KONFIRMS`) → mengirim tombol interaktif yang sesungguhnya.
//
// Ini bagian yang membuat opsi produksi bekerja: payload template tidak bisa membawa
// scheduleId, jadi CareLoop memetakannya lewat `interactive.context.id` →
// `reminder_logs.provider_message_id`. Tanpa handler ini, pasien menekan tombol di
// dalam template dan tidak terjadi apa-apa.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendReminderConfirmButtons,
  confirmButtonsMessageKey,
} from './reminder.buttons'
import { MockWhatsAppProvider } from '../../integrations/whatsapp/providers/mock.provider'
import { createWhatsAppService, type WhatsAppService } from '../../integrations/whatsapp/whatsapp.service'

const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const TEMPLATE_MESSAGE_ID = 'wamid.TEMPLATE-1'
const FROM = '6281234567890'

function createClient(overrides: Record<string, any> = {}) {
  const steps: any[] = []
  const client = {
    reminderLog: {
      findFirst: vi.fn().mockResolvedValue({ scheduleId: SCHEDULE_ID }),
    },
    schedule: {
      findUnique: vi.fn().mockResolvedValue({
        id: SCHEDULE_ID,
        patientId: PATIENT_ID,
        timeOfDay: '09:00',
        doseQty: '1 tablet',
        medication: { name: 'Metformin 500mg' },
      }),
    },
    escalationRun: {
      findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }),
    },
    escalationStep: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `step-${steps.length + 1}`, ...data }
        steps.push(row)
        return row
      }),
    },
    ...overrides,
  }
  return { client: client as any, steps }
}

function createWhatsapp(): { service: WhatsAppService; provider: MockWhatsAppProvider } {
  const provider = new MockWhatsAppProvider()
  return { service: createWhatsAppService({ provider, maxAttempts: 1 }), provider }
}

describe('sendReminderConfirmButtons', () => {
  beforeEach(() => vi.clearAllMocks())

  it('memetakan context.id ke jadwal lalu mengirim tombol interaktif', async () => {
    const { client, steps } = createClient()
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: TEMPLATE_MESSAGE_ID,
      from: FROM,
    })

    expect(result).toMatchObject({ sent: true, scheduleId: SCHEDULE_ID, alreadySent: false })
    expect(client.reminderLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerMessageId: TEMPLATE_MESSAGE_ID } }),
    )

    expect(provider.sent).toHaveLength(1)
    const payload = provider.sent[0].payload
    expect(payload.kind).toBe('INTERACTIVE')
    if (payload.kind !== 'INTERACTIVE') throw new Error('expected INTERACTIVE')
    // Tombol inilah yang akan dibaca parser jadi CONFIRM_TAKEN_<scheduleId>.
    expect(payload.interactive.buttons.map((b) => b.id)).toEqual([
      `CONFIRM_TAKEN_${SCHEDULE_ID}`,
      `DEFER_${SCHEDULE_ID}`,
    ])

    // Jejak di escalation_steps supaya pengiriman ulang bisa dideteksi.
    expect(steps[0]).toMatchObject({
      runId: 'run-1',
      messageKey: confirmButtonsMessageKey(TEMPLATE_MESSAGE_ID),
    })
  })

  it('idempoten: tidak mengirim ulang bila tombol untuk jadwal itu sudah dikirim', async () => {
    const { client, steps } = createClient({
      escalationStep: {
        findFirst: vi.fn().mockResolvedValue({ id: 'step-existing' }),
        create: vi.fn(),
      },
    })
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: TEMPLATE_MESSAGE_ID,
      from: FROM,
    })

    expect(result).toMatchObject({ sent: false, alreadySent: true })
    expect(provider.sent).toHaveLength(0)
    expect(steps).toHaveLength(0)
  })

  it('tidak fatal saat tidak ada reminder_log yang cocok — dilewati tanpa melempar', async () => {
    const { client } = createClient({
      reminderLog: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: 'wamid.TIDAK-DIKETAHUI',
      from: FROM,
    })

    expect(result.sent).toBe(false)
    expect(result.scheduleId).toBeNull()
    expect(result.reason).toContain('reminder_log')
    expect(provider.sent).toHaveLength(0)
  })

  it('context.id kosong tetap ditolak (bukan nebak jadwal terakhir)', async () => {
    const { client } = createClient()
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: null,
      from: FROM,
    })

    expect(result.sent).toBe(false)
    expect(provider.sent).toHaveLength(0)
  })

  it('jadwal yang hilang dilaporkan, bukan crash', async () => {
    const { client } = createClient({
      schedule: { findUnique: vi.fn().mockResolvedValue(null) },
    })
    const { service } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: TEMPLATE_MESSAGE_ID,
      from: FROM,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('tidak ada')
  })

  it('tombol untuk slot harian berikutnya tidak tertahan oleh slot sebelumnya', async () => {
    const { client } = createClient({
      // Step key disimpan apa adanya; slot ke-2 harus tetap lolos karena key-nya berbeda.
      escalationStep: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    })
    const { service, provider } = createWhatsapp()

    const first = await sendReminderConfirmButtons(client, service, {
      contextMessageId: 'wamid.SLOT-1',
      from: FROM,
    })
    const second = await sendReminderConfirmButtons(client, service, {
      contextMessageId: 'wamid.SLOT-2',
      from: FROM,
    })

    expect(first.sent).toBe(true)
    expect(second.sent).toBe(true)
    expect(provider.sent).toHaveLength(2)
    expect(client.escalationStep.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ messageKey: 'reminder.confirm_buttons:wamid.SLOT-2' }) }),
    )
  })

  it('replay setelah eskalasi ditutup tetap tidak mengirim ulang', async () => {
    const { client } = createClient({
      // Run sudah terminal — tidak lagi aktif, tapi step-nya masih ada.
      escalationRun: { findFirst: vi.fn().mockResolvedValue({ id: 'run-closed' }) },
      escalationStep: {
        findFirst: vi.fn().mockResolvedValue({ id: 'step-existing' }),
        create: vi.fn(),
      },
    })
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: TEMPLATE_MESSAGE_ID,
      from: FROM,
    })

    expect(result).toMatchObject({ sent: false, alreadySent: true })
    expect(provider.sent).toHaveLength(0)
  })

  it('tetap mengirim tombol walau belum ada run eskalasi (mis. eskalasi sudah ditutup)', async () => {
    const { client } = createClient({
      escalationRun: { findFirst: vi.fn().mockResolvedValue(null) },
    })
    const { service, provider } = createWhatsapp()

    const result = await sendReminderConfirmButtons(client, service, {
      contextMessageId: TEMPLATE_MESSAGE_ID,
      from: FROM,
    })

    expect(result.sent).toBe(true)
    expect(provider.sent).toHaveLength(1)
    // Tanpa run, tidak ada tempat mencatat langkah — itu wajar.
    expect(client.escalationStep.create).not.toHaveBeenCalled()
  })
})
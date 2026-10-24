// Fallback template untuk pengingat proaktif (docs/WHATSAPP-SETUP.md §0.1 & §4).
//
// Meta menolak pesan interaktif di luar jendela layanan 24 jam dengan kode `131047`.
// Karena reminder obat bersifat proaktif, itu kondisi yang AKAN terjadi pada nomor yang
// belum pernah menyapa bot. Test ini mengunci perilaku yang diharapkan: bukan gagal, tapi
// turun ke template yang tetap membawa tombol quick-reply.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildReminderTemplate } from '../../integrations/whatsapp/templates'
import {
  TemplateConfirmButtonId,
  WaButtonIntent,
  parseButtonReply,
} from '../../integrations/whatsapp/parser'
import { WhatsAppSendError, WA_ERROR_WINDOW_CLOSED } from '../../integrations/whatsapp/errors'
import { handleReminderJob, type ReminderPrismaClient } from './reminder.worker'
import { buildGraphPayload } from '../../integrations/whatsapp/providers/meta.provider'
import type { WhatsAppProvider, WhatsAppSendResult } from '../../integrations/whatsapp/types'
import { createWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import type { OutboundWhatsAppMessage } from '../../integrations/whatsapp/types'

const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const DUE_AT = '2026-08-16T02:00:00.000Z'
const PHONE = '081234567890'

const SCHEDULE_ROW = {
  id: SCHEDULE_ID,
  patientId: PATIENT_ID,
  timeOfDay: '09:00',
  isActive: true,
  status: 'APPROVED',
  doseQty: '1 tablet',
  medication: { name: 'Metformin 500mg' },
  patient: {
    voiceEnabled: false,
    status: 'ACTIVE',
    user: { phone: PHONE, fullName: 'Bu Siti Test' },
  },
}

interface Sent {
  message: OutboundWhatsAppMessage
}

/**
 * Provider tiruan yang meniru Meta: menolak pesan interaktif dengan 131047 (jendela
 * tertutup), lalu menerima template.
 */
class WindowClosedProvider implements WhatsAppProvider {
  readonly name = 'meta-cloud-api'
  readonly sent: Sent[] = []
  rejectInteractive = true
  rejectTemplate = false

  async send(message: OutboundWhatsAppMessage): Promise<WhatsAppSendResult> {
    this.sent.push({ message })
    if (message.kind === 'INTERACTIVE' && this.rejectInteractive) {
      throw new WhatsAppSendError('(#131047) Re-engagement message', {
        provider: this.name,
        retryable: false,
        providerCode: WA_ERROR_WINDOW_CLOSED,
      })
    }
    if (message.kind === 'TEMPLATE' && this.rejectTemplate) {
      throw new WhatsAppSendError('(#132000) Template does not exist', {
        provider: this.name,
        retryable: false,
        providerCode: 132000,
      })
    }
    return { providerMessageId: `wamid.${this.sent.length}`, sentAt: new Date() }
  }
}

function createPrisma(): { prisma: ReminderPrismaClient; reminderRows: any[] } {
  const reminderRows: any[] = []
  const prisma = {
    schedule: { findUnique: vi.fn().mockResolvedValue(SCHEDULE_ROW) },
    reminderLog: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `log-${reminderRows.length + 1}`, ...data }
        reminderRows.push(row)
        return { id: row.id }
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    escalationRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'run-1' }),
      update: vi.fn().mockResolvedValue({ id: 'run-1' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    escalationStep: { create: vi.fn().mockResolvedValue({ id: 'step-1' }) },
    familyContact: { findMany: vi.fn().mockResolvedValue([]) },
    nakesContact: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue({ emergencyPreference: 'FAMILY_FIRST' }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  return { prisma: prisma as unknown as ReminderPrismaClient, reminderRows }
}

function deps(
  provider: WhatsAppProvider,
  reminderTemplateName = 'pengingat_obat',
  templateButton: 'KONFIRMS' | 'CONFIRM_TAKEN' = 'KONFIRMS',
) {
  const { prisma, reminderRows } = createPrisma()
  return {
    prisma,
    reminderRows,
    provider,
    result: handleReminderJob(
      {
        prisma,
        whatsapp: createWhatsAppService({ provider, maxAttempts: 1 }),
        reminderTemplateName,
        templateButton,
        retryDelayMs: 0,
      },
      { scheduleId: SCHEDULE_ID, dueAt: DUE_AT },
    ),
  }
}

describe('Pengingat proaktif di luar jendela 24 jam', () => {
  beforeEach(() => vi.clearAllMocks())

  it('jatuh ke template dengan tombol quick-reply, bukan gagal', async () => {
    const provider = new WindowClosedProvider()
    const { result, reminderRows } = deps(provider)

    const outcome = await result

    expect(outcome.outcome).toBe('SENT')
    expect(provider.sent.map((s) => s.message.kind)).toEqual(['INTERACTIVE', 'TEMPLATE'])

    const template = provider.sent[1].message
    expect(template.kind).toBe('TEMPLATE')
    if (template.kind !== 'TEMPLATE') throw new Error('expected TEMPLATE')
    expect(template.templateName).toBe('pengingat_obat')
    expect(template.to).toBe('6281234567890')

    // Jejak di log harus jujur: terkirim, tapi lewat template.
    expect(reminderRows[0]).toMatchObject({ status: 'SENT' })
    expect(String(reminderRows[0].error)).toContain('template')
  })

  it('payload quick-reply template berupa KONFIRMS (bukan id jadwal)', async () => {
    const provider = new WindowClosedProvider()
    const { result } = deps(provider)
    await result

    const template = provider.sent[1].message
    if (template.kind !== 'TEMPLATE') throw new Error('expected TEMPLATE')

    const button = template.parameters?.find((c) => c.type === 'BUTTON')
    expect(button?.subType).toBe('quick_reply')
    // Payload template tidak bisa membawa scheduleId — nilainya tetap di Meta.
    expect(button!.parameters[0]).toBe(TemplateConfirmButtonId)
  })

  it('mode CONFIRM_TAKEN tetap didukung untuk jadwal tunggal', async () => {
    const provider = new WindowClosedProvider()
    const { result } = deps(provider, 'pengingat_obat', 'CONFIRM_TAKEN')
    await result

    const template = provider.sent[1].message
    if (template.kind !== 'TEMPLATE') throw new Error('expected TEMPLATE')

    const parsed = parseButtonReply(template.parameters!.find((c) => c.type === 'BUTTON')!.parameters[0])
    expect(parsed).toMatchObject({ intent: WaButtonIntent.CONFIRM_TAKEN, resourceId: SCHEDULE_ID })
  })

  it('isi template: nama, obat, dan waktu terisi berurutan', () => {
    const components = buildReminderTemplate(
      'pengingat_obat',
      { medicationName: 'Metformin 500mg', doseQty: '1 tablet', timeOfDay: '09:00', patientName: 'Bu Siti Test' },
      TemplateConfirmButtonId,
    )

    expect(components[0]).toEqual({
      type: 'BODY',
      parameters: ['Bu Siti Test', 'Metformin 500mg', '09:00'],
    })
  })

  it('payload template yang dihasilkan valid untuk Graph API', () => {
    const components = buildReminderTemplate(
      'pengingat_obat',
      { medicationName: 'Metformin 500mg', doseQty: '1 tablet', timeOfDay: '09:00', patientName: 'Bu Siti Test' },
      TemplateConfirmButtonId,
    )

    const payload = buildGraphPayload({
      kind: 'TEMPLATE',
      to: '6281234567890',
      templateName: 'pengingat_obat',
      parameters: components,
    }) as any

    expect(payload.template.language).toEqual({ code: 'id' })
    expect(payload.template.components[1]).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: TemplateConfirmButtonId }],
    })
  })

  it('nama template dari env dipakai, bukan hardcode', async () => {
    const provider = new WindowClosedProvider()
    const { result } = deps(provider, 'pengingat_obat_v2')
    await result

    const template = provider.sent[1].message
    if (template.kind !== 'TEMPLATE') throw new Error('expected TEMPLATE')
    expect(template.templateName).toBe('pengingat_obat_v2')
  })

  it('jika template tidak disetujui Meta, error yang dilaporkan adalah error template', async () => {
    const provider = new WindowClosedProvider()
    provider.rejectTemplate = true
    const { result, reminderRows } = deps(provider)

    const outcome = await result

    expect(outcome.outcome).toBe('FAILED')
    // Bukan "131047" — pesan pertama sudah benar, yang salah adalah template-nya.
    expect(outcome.error).toContain('132000')
    expect(reminderRows.at(-1)).toMatchObject({ status: 'FAILED' })
  })

  it('error lain (bukan jendela tertutup) tidak dialihkan ke template', async () => {
    const badTokenSent: Sent[] = []
    const providerWithBadToken: WhatsAppProvider = {
      name: 'meta-cloud-api',
      async send(message: OutboundWhatsAppMessage) {
        badTokenSent.push({ message })
        throw new WhatsAppSendError('Invalid OAuth access token', {
          provider: 'meta-cloud-api',
          retryable: false,
          providerCode: 190,
        })
      },
    }

    const { result } = deps(providerWithBadToken)
    const outcome = await result

    expect(outcome.outcome).toBe('FAILED')
    // Tidak ada percobaan template: token salah tidak akan membaik dengan template lain.
    expect(badTokenSent.every((s) => s.message.kind === 'INTERACTIVE')).toBe(true)
  })

  it('mode mock tetap memakai interaktif — fallback template tidak mengganggu demo', async () => {
    const { MockWhatsAppProvider } = await import('../../integrations/whatsapp/providers/mock.provider')
    const provider = new MockWhatsAppProvider()
    const { result } = deps(provider)

    const outcome = await result
    expect(outcome.outcome).toBe('SENT')
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0].payload.kind).toBe('INTERACTIVE')
  })
})
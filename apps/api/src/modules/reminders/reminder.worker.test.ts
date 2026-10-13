// Unit test worker reminder (CL-106).
// ReminderLog di-mock; WhatsApp & TTS memakai provider/service mock sungguhan dari CL-101
// supaya percobaan kirim yang terhitung benar-benar sama dengan yang dipanggil.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, ReminderChannel, ReminderStatus } from '@careloop/shared'
import { MockWhatsAppProvider } from '../../integrations/whatsapp/providers/mock.provider'
import {
  createWhatsAppService,
  type WhatsAppService,
} from '../../integrations/whatsapp/whatsapp.service'
import { MockTtsService } from '../../integrations/tts'
import {
  handleReminderJob,
  parseDueAt,
  REMINDER_MAX_SEND_ATTEMPTS,
  type ReminderJobPayload,
  type ReminderPrismaClient,
} from './reminder.worker'

const SCHEDULE_ID = '9c2e4d5a-0b17-4c8e-9a3f-1d6b8e2f4c30'
const PATIENT_ID = '11111111-1111-4111-8111-111111111111'
const DUE_AT = '2026-08-16T02:00:00.000Z'

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
    user: { phone: '081234567890', fullName: 'Bu Siti Test' },
  },
}

interface Harness {
  prisma: ReminderPrismaClient
  provider: MockWhatsAppProvider
  whatsapp: WhatsAppService
  tts: MockTtsService
  reminderRows: Array<Record<string, unknown>>
  auditRows: Array<Record<string, unknown>>
  escalationRuns: Array<Record<string, unknown>>
  escalationSteps: Array<Record<string, unknown>>
}

function createHarness(overrides: { schedule?: Record<string, unknown> | null } = {}): Harness {
  const schedule = overrides.schedule === undefined ? SCHEDULE_ROW : overrides.schedule
  const reminderRows: Array<Record<string, unknown>> = []
  const auditRows: Array<Record<string, unknown>> = []
  const escalationRuns: Array<Record<string, unknown>> = []
  const escalationSteps: Array<Record<string, unknown>> = []

  const prisma = {
    schedule: {
      findUnique: vi.fn().mockResolvedValue(schedule),
    },
    reminderLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `log-${reminderRows.length + 1}`, ...data }
        reminderRows.push(row)
        return { id: row.id as string }
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    escalationRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          escalationRuns.find((r) => r.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${escalationRuns.length + 1}`, ...data }
        escalationRuns.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = escalationRuns.find((r) => r.id === where.id)
        if (row) Object.assign(row, data)
        return row
      }),
    },
    escalationStep: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        escalationSteps.push(data)
        return { id: `step-${escalationSteps.length}` }
      }),
    },
    patient: {
      findUnique: vi.fn().mockResolvedValue({
        emergencyPreference: 'FAMILY_FIRST',
        livingSituation: 'WITH_FAMILY',
        familyContacts: [{ tier: 'TIER_1', isActive: true }],
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditRows.push(data)
        return { id: `audit-${auditRows.length}` }
      }),
    },
  } as unknown as ReminderPrismaClient

  const provider = new MockWhatsAppProvider()
  const whatsapp = createWhatsAppService({ provider, maxAttempts: 1 })

  return {
    prisma,
    provider,
    whatsapp,
    tts: new MockTtsService(),
    reminderRows,
    auditRows,
    escalationRuns,
    escalationSteps,
  }
}

function deps(h: Harness) {
  return {
    prisma: h.prisma,
    whatsapp: h.whatsapp,
    tts: h.tts,
    retryDelayMs: 0,
    logger: { error: vi.fn() },
  }
}

function payload(overrides: Partial<ReminderJobPayload> = {}): ReminderJobPayload {
  return { scheduleId: SCHEDULE_ID, dueAt: DUE_AT, ...overrides }
}

describe('parseDueAt', () => {
  it('menerima string ISO dan Date', () => {
    expect(parseDueAt(DUE_AT).toISOString()).toBe(DUE_AT)
    expect(parseDueAt(new Date(DUE_AT)).toISOString()).toBe(DUE_AT)
  })

  it('menolak nilai tidak valid', () => {
    expect(() => parseDueAt('bukan tanggal')).toThrow(RangeError)
  })
})

describe('handleReminderJob — sukses', () => {
  let h: Harness

  beforeEach(() => {
    h = createHarness()
  })

  it('mengirim reminder interaktif dengan obat/dosis/waktu dan tombol konfirmasi', async () => {
    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('SENT')
    expect(h.provider.sent).toHaveLength(1)
    const message = h.provider.sent[0].payload
    expect(message.kind).toBe('INTERACTIVE')
    if (message.kind !== 'INTERACTIVE') throw new Error('kind tidak sesuai')
    expect(message.to).toBe('6281234567890')
    expect(message.interactive.body).toContain('Metformin 500mg')
    expect(message.interactive.body).toContain('1 tablet')
    expect(message.interactive.body).toContain('09:00')
    expect(message.interactive.buttons.map((b) => b.id)).toEqual([
      `CONFIRM_TAKEN_${SCHEDULE_ID}`,
      `DEFER_${SCHEDULE_ID}`,
    ])
  })

  it('menulis ReminderLog SENT beserta providerMessageId dan attempt', async () => {
    const result = await handleReminderJob(deps(h), payload())

    expect(result.reminderLogId).not.toBeNull()
    expect(h.reminderRows).toHaveLength(1)
    expect(h.reminderRows[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      patientId: PATIENT_ID,
      scheduledFireAt: new Date(DUE_AT),
      channel: ReminderChannel.WHATSAPP,
      status: ReminderStatus.SENT,
      attempt: 1,
      providerMessageId: 'mock_1',
    })
  })

  it('membuat escalation run WAITING_PATIENT dengan step reminder (AC-4)', async () => {
    const result = await handleReminderJob(deps(h), payload())

    expect(result.escalationRunId).toBe('run-1')
    expect(h.escalationRuns[0]).toMatchObject({
      patientId: PATIENT_ID,
      context: 'SCHEDULE',
      sourceScheduleId: SCHEDULE_ID,
      status: 'WAITING_PATIENT',
    })
    expect(h.escalationSteps[0]).toMatchObject({
      runId: 'run-1',
      contactPhone: '081234567890',
      channel: 'WHATSAPP',
      messageKey: 'reminder.sent',
      providerMessageId: 'mock_1',
    })
  })

  it('mencatat audit reminder.sent tanpa bocorin data sensitif', async () => {
    await handleReminderJob(deps(h), payload())

    // Baris kedua milik CL-109 (ESCALATION_STEP) saat run dibuat.
    const reminderAudit = h.auditRows.filter((r) => r.action === AuditAction.REMINDER_SENT)
    expect(reminderAudit).toHaveLength(1)
    expect(reminderAudit[0]).toMatchObject({
      action: AuditAction.REMINDER_SENT,
      resourceType: 'reminder_log',
      patientId: PATIENT_ID,
    })
    expect(JSON.stringify(reminderAudit[0])).not.toContain('081234567890')
  })

  it('mengecek jadwal sebelum mengirim', async () => {
    await handleReminderJob(deps(h), payload())
    expect(h.prisma.schedule.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCHEDULE_ID } }),
    )
  })
})

describe('handleReminderJob — retry (RM-5)', () => {
  it('mencoba 3x lalu log RETRYING, RETRYING, FAILED tanpa escalation run', async () => {
    const h = createHarness()
    h.provider.simulateFailures(99)

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('FAILED')
    expect(result.sendAttempts).toBe(REMINDER_MAX_SEND_ATTEMPTS)
    expect(h.reminderRows.map((r) => r.status)).toEqual([
      ReminderStatus.RETRYING,
      ReminderStatus.RETRYING,
      ReminderStatus.FAILED,
    ])
    expect(h.reminderRows.map((r) => r.attempt)).toEqual([1, 2, 3])
    expect(h.reminderRows.every((r) => typeof r.error === 'string' && r.error.length > 0)).toBe(
      true,
    )
    expect(h.escalationRuns).toHaveLength(0)
    expect(result.error).toContain('Simulasi kegagalan')
  })

  it('berhenti dan mencatat SENT saat percobaan kedua berhasil', async () => {
    const h = createHarness()
    h.provider.simulateFailures(1)

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('SENT')
    expect(result.sendAttempts).toBe(2)
    expect(h.reminderRows.map((r) => r.status)).toEqual([
      ReminderStatus.RETRYING,
      ReminderStatus.SENT,
    ])
    expect(result.escalationRunId).toBe('run-1')
  })

  it('tidak mengirim lebih dari 3 kali walau provider selalu gagal (retry tidak berlipat)', async () => {
    const h = createHarness()
    h.provider.simulateFailures(99)
    const sendSpy = vi.spyOn(h.provider, 'send')

    await handleReminderJob(deps(h), payload())

    expect(sendSpy).toHaveBeenCalledTimes(REMINDER_MAX_SEND_ATTEMPTS)
  })

  it('mencatat audit reminder.failed saat seluruh percobaan gagal', async () => {
    const h = createHarness()
    h.provider.simulateFailures(99)

    await handleReminderJob(deps(h), payload())

    expect(h.auditRows[0]).toMatchObject({ action: AuditAction.REMINDER_FAILED })
  })
})

describe('handleReminderJob — idempotensi & guard', () => {
  it('melewati slot waktu yang sudah punya ReminderLog SENT (RM-5)', async () => {
    const h = createHarness()
    ;(h.prisma.reminderLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'log-sebelumnya',
      providerMessageId: 'mock_ earlier',
    })

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('DUPLICATE')
    expect(result.reminderLogId).toBe('log-sebelumnya')
    expect(h.provider.sent).toHaveLength(0)
    expect(h.reminderRows).toHaveLength(0)
    expect(h.escalationRuns).toHaveLength(0)
  })

  it('melewati schedule yang tidak ada tanpa menulis log', async () => {
    const h = createHarness({ schedule: null })

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('SKIPPED')
    expect(result.reminderLogId).toBeNull()
    expect(h.provider.sent).toHaveLength(0)
    expect(h.reminderRows).toHaveLength(0)
  })

  it('melewati schedule non-aktif tanpa mengirim', async () => {
    const h = createHarness({ schedule: { ...SCHEDULE_ROW, isActive: false } })

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('SKIPPED')
    expect(result.error).toBe('Schedule tidak aktif')
    expect(h.provider.sent).toHaveLength(0)
    expect(h.reminderRows).toHaveLength(0)
  })

  // Guardrail flow §2: pasien yang belum diaktivasi tidak boleh menerima pesan,
  // sama halnya dengan gate resep DRAFT dan jadwal non-aktif.
  it.each(['ONBOARDING', 'INACTIVE', 'BLOCKED'])(
    'melewati pasien berstatus %s walau resep dan jadwalnya sah',
    async (patientStatus) => {
      const h = createHarness({
        schedule: { ...SCHEDULE_ROW, patient: { ...SCHEDULE_ROW.patient, status: patientStatus } },
      })

      const result = await handleReminderJob(deps(h), payload())

      expect(result.outcome).toBe('SKIPPED')
      expect(result.error).toContain('belum berstatus ACTIVE')
      expect(result.error).toContain(patientStatus)
      expect(h.provider.sent).toHaveLength(0)
      expect(h.reminderRows).toHaveLength(0)
      // Tidak boleh ada eskalasi — tidak ada yang perlu dikejar.
      expect(h.escalationRuns).toHaveLength(0)
    },
  )
})

describe('handleReminderJob — voice reminder (RM-3, RM-4)', () => {
  it('mengirim audio TTS dan menulis baris VOICE SENT untuk pasien voice_enabled', async () => {
    const h = createHarness({
      schedule: { ...SCHEDULE_ROW, patient: { ...SCHEDULE_ROW.patient, voiceEnabled: true } },
    })

    const result = await handleReminderJob(deps(h), payload())

    expect(result.voice).toBe('SENT')
    const kinds = h.provider.sent.map((m) => m.payload.kind)
    expect(kinds).toEqual(['INTERACTIVE', 'AUDIO'])
    expect(h.reminderRows.map((r) => [r.channel, r.status])).toEqual([
      [ReminderChannel.WHATSAPP, ReminderStatus.SENT],
      [ReminderChannel.VOICE, ReminderStatus.SENT],
    ])
  })

  it('TTS gagal → teks tetap terkirim, baris VOICE berstatus FAILED (RM-4)', async () => {
    const h = createHarness({
      schedule: { ...SCHEDULE_ROW, patient: { ...SCHEDULE_ROW.patient, voiceEnabled: true } },
    })
    h.tts.simulateFailures(1)

    const result = await handleReminderJob(deps(h), payload())

    expect(result.outcome).toBe('SENT')
    expect(result.voice).toBe('FAILED')
    expect(h.provider.sent.map((m) => m.payload.kind)).toEqual(['INTERACTIVE'])
    expect(h.reminderRows[1]).toMatchObject({
      channel: ReminderChannel.VOICE,
      status: ReminderStatus.FAILED,
    })
    expect(result.escalationRunId).toBe('run-1')
  })

  it('tidak mengirim audio untuk pasien yang voice_enabled=false', async () => {
    const h = createHarness()

    const result = await handleReminderJob(deps(h), payload())

    expect(result.voice).toBe('SKIPPED')
    expect(h.provider.sent.map((m) => m.payload.kind)).toEqual(['INTERACTIVE'])
  })
})

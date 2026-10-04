// Integration test worker reminder (CL-106): fire job lewat queue sungguhan →
// WhatsAppService mock dipanggil → reminder_logs terisi → escalation run WAITING_PATIENT.
//
// Dilewati otomatis bila TEST_DATABASE_URL tidak diset (mis. `npm run test` tanpa docker).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { ReminderChannel, ReminderStatus } from '@careloop/shared'
import { MockWhatsAppProvider } from '../src/integrations/whatsapp/providers/mock.provider'
import { createWhatsAppService } from '../src/integrations/whatsapp/whatsapp.service'
import { MockTtsService } from '../src/integrations/tts'
import type { JobQueue } from '../src/lib/queue'
import {
  createReminderJobQueue,
  REMINDER_QUEUE_NAME,
  type ReminderJobPayload,
  type ReminderPrismaClient,
} from '../src/modules/reminders/reminder.worker'
import {
  createTestPrisma,
  isTestDbConfigured,
  migrateTestDb,
  resetTestDb,
  teardownTestDb,
} from './helpers/test-db'

const PHONE = '081234567890'
const TIME_OF_DAY = '09:00'
const DUE_AT = new Date('2026-08-16T02:00:00.000Z')

interface Fixture {
  patientId: string
  scheduleId: string
}

async function seedFixture(prisma: PrismaClient, voiceEnabled = false): Promise<Fixture> {
  const userId = crypto.randomUUID()

  await prisma.user.create({
    data: {
      id: userId,
      phone: PHONE,
      fullName: 'Bu Siti Test',
      role: 'PATIENT',
      timezone: 'Asia/Jakarta',
      isVerified: true,
    },
  })
  await prisma.patient.create({
    data: { id: userId, voiceEnabled, emergencyPreference: 'FAMILY_FIRST' },
  })
  const medication = await prisma.medication.create({
    data: {
      patientId: userId,
      name: 'Metformin 500mg',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  })
  const schedule = await prisma.schedule.create({
    data: {
      patientId: userId,
      medicationId: medication.id,
      timeOfDay: TIME_OF_DAY,
      doseQty: '1 tablet',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      timeWindowMinutes: 30,
    },
  })

  return { patientId: userId, scheduleId: schedule.id }
}

/** Tunggu job InProcessQueue selesai (completed/failed/cancelled). */
async function waitForJob(
  queue: JobQueue<ReminderJobPayload>,
  jobId: string,
): Promise<string | undefined> {
  for (let i = 0; i < 200; i++) {
    const state = (queue as unknown as { stateOf(id: string): string | undefined }).stateOf(jobId)
    if (state === 'completed' || state === 'failed' || state === 'cancelled') return state
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`job ${jobId} tidak selesai dalam 5 detik`)
}

describe.skipIf(!isTestDbConfigured())('CL-106 worker reminder (integration)', () => {
  let prisma: PrismaClient
  let provider: MockWhatsAppProvider
  let queue: JobQueue<ReminderJobPayload>

  beforeAll(async () => {
    migrateTestDb()
    prisma = createTestPrisma()
  }, 180_000)

  afterAll(async () => {
    if (prisma) {
      await resetTestDb(prisma)
      await teardownTestDb(prisma)
    }
  })

  beforeEach(async () => {
    await resetTestDb(prisma)
    provider = new MockWhatsAppProvider()
    queue = createReminderJobQueue(
      {
        prisma: prisma as unknown as ReminderPrismaClient,
        whatsapp: createWhatsAppService({ provider, maxAttempts: 1 }),
        tts: new MockTtsService(),
        retryDelayMs: 0,
      },
      { mode: 'in-process' },
    )
  })

  async function fire(scheduleId: string, dueAt: Date = DUE_AT): Promise<void> {
    const jobId = await queue.enqueue({ scheduleId, dueAt: dueAt.toISOString() })
    const state = await waitForJob(queue, jobId)
    expect(state).toBe('completed')
  }

  it('memakai nama queue yang konsisten', () => {
    expect(REMINDER_QUEUE_NAME).toBe('reminder')
  })

  it('fire job → mock WA dipanggil dengan isi pesan benar → reminder_logs + escalation run', async () => {
    const { patientId, scheduleId } = await seedFixture(prisma)

    await fire(scheduleId)

    expect(provider.sent).toHaveLength(1)
    const message = provider.sent[0].payload
    expect(message.kind).toBe('INTERACTIVE')
    if (message.kind !== 'INTERACTIVE') throw new Error('kind tidak sesuai')
    expect(message.to).toBe('6281234567890')
    expect(message.interactive.body).toContain('Metformin 500mg')
    expect(message.interactive.body).toContain('1 tablet')
    expect(message.interactive.body).toContain(TIME_OF_DAY)
    expect(message.interactive.buttons.map((b) => b.id)).toEqual([
      `CONFIRM_TAKEN_${scheduleId}`,
      `DEFER_${scheduleId}`,
    ])

    const logs = await prisma.reminderLog.findMany({ where: { scheduleId } })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      patientId,
      scheduledFireAt: DUE_AT,
      channel: ReminderChannel.WHATSAPP,
      status: ReminderStatus.SENT,
      attempt: 1,
      providerMessageId: 'mock_1',
    })

    const runs = await prisma.escalationRun.findMany({
      where: { patientId },
      include: { steps: true },
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      context: 'SCHEDULE',
      sourceScheduleId: scheduleId,
      status: 'WAITING_PATIENT',
    })
    expect(runs[0].steps).toHaveLength(1)
    expect(runs[0].steps[0]).toMatchObject({
      messageKey: 'reminder.sent',
      channel: 'WHATSAPP',
      providerMessageId: 'mock_1',
    })
  })

  it('fire job untuk jadwal yang sama dua kali → hanya satu kiriman (RM-5)', async () => {
    const { scheduleId } = await seedFixture(prisma)

    await fire(scheduleId)
    await fire(scheduleId)

    expect(provider.sent).toHaveLength(1)
    expect(await prisma.reminderLog.count({ where: { scheduleId } })).toBe(1)
    expect(await prisma.escalationRun.count({ where: { sourceScheduleId: scheduleId } })).toBe(1)
  })

  it('WhatsApp gagal → 3 percobaan tercatat RETRYING/RETRYING/FAILED, tanpa escalation run', async () => {
    const { patientId, scheduleId } = await seedFixture(prisma)
    provider.simulateFailures(99)

    await fire(scheduleId)

    expect(provider.sent).toHaveLength(0)
    const logs = await prisma.reminderLog.findMany({
      where: { scheduleId },
      orderBy: { attempt: 'asc' },
    })
    expect(logs.map((l) => l.status)).toEqual([
      ReminderStatus.RETRYING,
      ReminderStatus.RETRYING,
      ReminderStatus.FAILED,
    ])
    expect(logs.map((l) => l.attempt)).toEqual([1, 2, 3])
    expect(logs.every((l) => l.error !== null)).toBe(true)
    expect(await prisma.escalationRun.count({ where: { patientId } })).toBe(0)
  })

  it('voice_enabled → baris VOICE SENT ikut tercatat', async () => {
    const { scheduleId } = await seedFixture(prisma, true)

    await fire(scheduleId)

    expect(provider.sent.map((m) => m.payload.kind)).toEqual(['INTERACTIVE', 'AUDIO'])
    const logs = await prisma.reminderLog.findMany({
      where: { scheduleId },
      orderBy: { channel: 'asc' },
    })
    expect(logs.map((l) => l.channel).sort()).toEqual([
      ReminderChannel.VOICE,
      ReminderChannel.WHATSAPP,
    ])
    expect(logs.every((l) => l.status === ReminderStatus.SENT)).toBe(true)
  })

  it('schedule non-aktif dilewati tanpa mengirim dan tanpa menulis log', async () => {
    const { scheduleId } = await seedFixture(prisma)
    await prisma.schedule.update({ where: { id: scheduleId }, data: { isActive: false } })

    await fire(scheduleId)

    expect(provider.sent).toHaveLength(0)
    expect(await prisma.reminderLog.count({ where: { scheduleId } })).toBe(0)
  })
})

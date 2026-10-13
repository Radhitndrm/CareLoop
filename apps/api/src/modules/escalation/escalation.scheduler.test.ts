// Unit test scheduler timeout eskalasi (CL-110).
// Fokus: penentuan deadline per tier, idempotensi jobId, dan notifier produksi
// yang benar-benar mengirim lewat WhatsAppService (bukan Mock).
import { describe, expect, it, vi } from 'vitest'
import { EscalationContext, EscalationRunStatus } from '@careloop/shared'
import {
  MockWhatsAppProvider,
  type RecordedWhatsAppMessage,
} from '../../integrations/whatsapp/providers/mock.provider'
import { createWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import type { JobQueue } from '../../lib/queue'
import {
  ACTIVE_ESCALATION_STATUSES,
  escalationDeadlineAt,
  escalationTimeoutJobId,
  reconcileEscalationTimeouts,
  WhatsAppEscalationNotifier,
  type EscalationTimeoutClient,
} from './escalation.scheduler'
import type { EscalationTimeoutJobPayload } from './timeout.service'

const RUN_ID = '44444444-4444-4444-8444-444444444444'

const CREATED_AT = new Date('2026-08-16T00:00:00.000Z')
const NOW = new Date('2026-08-16T00:05:00.000Z')

interface ScheduledCall {
  payload: EscalationTimeoutJobPayload
  delayMs: number
  jobId: string | undefined
}

function recordingQueue(): { queue: JobQueue<EscalationTimeoutJobPayload>; calls: ScheduledCall[] } {
  const calls: ScheduledCall[] = []
  const queue: JobQueue<EscalationTimeoutJobPayload> = {
    name: 'escalation-timeout',
    enqueue: vi.fn(async () => 'j'),
    schedule: vi.fn(async (payload, delayMs, opts) => {
      calls.push({ payload, delayMs, jobId: opts?.jobId })
      return opts?.jobId ?? `j-${calls.length}`
    }),
    cancel: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
  return { queue, calls }
}

function runRow(
  status: string,
  overrides: {
    steps?: Array<{ messageKey: string | null; sentAt: Date | null }>
    configSnapshot?: unknown
    context?: EscalationContext
    createdAt?: Date
  } = {},
) {
  return {
    id: RUN_ID,
    patientId: '11111111-1111-4111-8111-111111111111',
    status,
    context: overrides.context ?? EscalationContext.SCHEDULE,
    createdAt: overrides.createdAt ?? CREATED_AT,
    configSnapshot: overrides.configSnapshot ?? null,
    steps: overrides.steps ?? [],
  }
}

function clientReturning(rows: unknown[]): EscalationTimeoutClient {
  return {
    escalationRun: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as EscalationTimeoutClient
}

describe('escalationDeadlineAt', () => {
  it('menghitung deadline WAITING_PATIENT dari createdAt + ESCALATION_PATIENT_WAIT_SEC', () => {
    const deadline = escalationDeadlineAt(runRow(EscalationRunStatus.WAITING_PATIENT))

    // Default env ESCALATION_PATIENT_WAIT_SEC = 1800 detik.
    expect(deadline?.toISOString()).toBe('2026-08-16T00:30:00.000Z')
  })

  it('menghitung deadline tier dari langkah alert, bukan dari createdAt run', () => {
    const alertSentAt = new Date('2026-08-16T00:05:00.000Z')
    const deadline = escalationDeadlineAt(
      runRow(EscalationRunStatus.FAMILY_TIER_1, {
        steps: [{ messageKey: 'alert.family.tier_1', sentAt: alertSentAt }],
      }),
    )

    // Default ESCALATION_FAMILY_TIER1_WAIT_SEC = 900 detik sejak alert dikirim.
    expect(deadline?.toISOString()).toBe('2026-08-16T00:20:00.000Z')
  })

  it('menghormati configSnapshot per-pasien (AC-7.5)', () => {
    const deadline = escalationDeadlineAt(
      runRow(EscalationRunStatus.WAITING_PATIENT, {
        configSnapshot: { patientWaitSec: 60 },
      }),
    )

    expect(deadline?.toISOString()).toBe('2026-08-16T00:01:00.000Z')
  })

  it('jatuh ke createdAt bila langkah alert tidak ditemukan', () => {
    const deadline = escalationDeadlineAt(
      runRow(EscalationRunStatus.FAMILY_TIER_2, { steps: [] }),
    )

    // Tanpa langkah, timeout dihitung dari awal run — lebih baik terlalu cepat
    // daripada eskalasi yang tidak pernah terjadwal.
    expect(deadline?.toISOString()).toBe('2026-08-16T00:15:00.000Z')
  })
})

describe('escalationTimeoutJobId', () => {
  // Lihat catatan di reminder.scheduler.test.ts: BullMQ menolak ':' pada jobId dan
  // InProcessQueue tidak memvalidasinya, jadi bug ini hanya terlihat saat Redis aktif.
  it('tidak mengandung ":" karena BullMQ menolaknya', () => {
    expect(escalationTimeoutJobId(RUN_ID, EscalationRunStatus.WAITING_PATIENT)).not.toContain(':')
  })
})

describe('reconcileEscalationTimeouts', () => {
  it('menjadwalkan timeout untuk setiap run aktif', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([runRow(EscalationRunStatus.WAITING_PATIENT)])

    const result = await reconcileEscalationTimeouts(client, queue, { now: NOW })

    expect(result).toMatchObject({ scanned: 1, scheduled: 1, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload.runId).toBe(RUN_ID)
    expect(calls[0].payload.expectedStatus).toBe(EscalationRunStatus.WAITING_PATIENT)
    // Deadline 00:30Z, NOW 00:05Z -> delay 25 menit.
    expect(calls[0].delayMs).toBe(25 * 60 * 1000)
  })

  it('memakai jobId deterministik sehingga tick berulang tidak menumpuk job', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([runRow(EscalationRunStatus.WAITING_PATIENT)])

    await reconcileEscalationTimeouts(client, queue, { now: NOW })
    await reconcileEscalationTimeouts(client, queue, { now: NOW })

    expect(calls[0].jobId).toBe(calls[1].jobId)
    expect(calls[0].jobId).toBe(escalationTimeoutJobId(RUN_ID, EscalationRunStatus.WAITING_PATIENT))
  })

  it('menjadwalkan dengan delay 0 bila deadline sudah lewat, dan menandainya overdue', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([runRow(EscalationRunStatus.WAITING_PATIENT)])

    const result = await reconcileEscalationTimeouts(client, queue, {
      now: new Date('2026-08-16T02:00:00.000Z'),
    })

    expect(result.overdue).toBe(1)
    expect(calls[0].delayMs).toBe(0)
  })

  it('hanya memindai run yang belum selesai', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = { escalationRun: { findMany } } as unknown as EscalationTimeoutClient
    const { queue } = recordingQueue()

    await reconcileEscalationTimeouts(client, queue, { now: NOW })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: [...ACTIVE_ESCALATION_STATUSES] } },
      }),
    )
    // Status terminal tidak boleh masuk daftar — kalau iya, eskalasi yang sudah
    // RESOLVED akan dibangkitkan ulang.
    for (const terminal of ['HANDLED', 'RESOLVED', 'TIMED_OUT']) {
      expect(ACTIVE_ESCALATION_STATUSES).not.toContain(terminal)
    }
  })

  it('mencatat kegagalan enqueue tanpa menggagalkan run lain', async () => {
    const calls: ScheduledCall[] = []
    let attempt = 0
    const queue: JobQueue<EscalationTimeoutJobPayload> = {
      name: 'escalation-timeout',
      enqueue: vi.fn(async () => 'j'),
      schedule: vi.fn(async (payload, delayMs, opts) => {
        attempt += 1
        if (attempt === 1) throw new Error('redis down')
        calls.push({ payload, delayMs, jobId: opts?.jobId })
        return 'ok'
      }),
      cancel: vi.fn(async () => undefined),
      retry: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    }
    const client = clientReturning([
      runRow(EscalationRunStatus.WAITING_PATIENT),
      { ...runRow(EscalationRunStatus.NAKES), id: 'other-run' },
    ])

    const result = await reconcileEscalationTimeouts(client, queue, { now: NOW })

    expect(result.failed).toBe(1)
    expect(result.scheduled).toBe(1)
    expect(calls.map((c) => c.payload.runId)).toEqual(['other-run'])
  })
})

function textOf(record: RecordedWhatsAppMessage): string {
  const payload = record.payload as { text?: string }
  return payload.text ?? JSON.stringify(payload)
}

describe('WhatsAppEscalationNotifier', () => {
  it('mengirim alert keluarga lewat WhatsAppService', async () => {
    const provider = new MockWhatsAppProvider()
    const notifier = new WhatsAppEscalationNotifier(
      createWhatsAppService({ provider, maxAttempts: 1 }),
    )

    const result = await notifier.sendFamilyAlert({
      contactPhone: '081234567890',
      contactName: 'Bapak Test',
      patientName: 'Bu Siti Test',
      patientPhone: '081298765432',
      tier: 'TIER_1',
      instructions: 'Mohon segera hubungi beliau.',
    })

    expect(result.providerMessageId).toBeTruthy()
    expect(provider.sent).toHaveLength(1)
    expect(textOf(provider.sent[0])).toContain('PERINGATAN KELUARGA')
  })

  it('mengirim alert nakes lewat WhatsAppService', async () => {
    const provider = new MockWhatsAppProvider()
    const notifier = new WhatsAppEscalationNotifier(
      createWhatsAppService({ provider, maxAttempts: 1 }),
    )

    const result = await notifier.sendNakesAlert({
      contactPhone: '081200000001',
      nakesName: 'Dokter Test',
      patientName: 'Bu Siti Test',
      patientPhone: '081298765432',
      instructions: 'Mohon periksa kondisi pasien.',
    })

    expect(result.providerMessageId).toBeTruthy()
    expect(provider.sent).toHaveLength(1)
    expect(textOf(provider.sent[0])).toContain('PERINGATAN NAKES')
  })

  it('memakai provider mock dan tidak pernah menutup telepon otomatis', async () => {
    const provider = new MockWhatsAppProvider()
    const notifier = new WhatsAppEscalationNotifier(
      createWhatsAppService({ provider, maxAttempts: 1 }),
    )

    await notifier.sendFamilyAlert({
      contactPhone: '081234567890',
      contactName: 'Bapak Test',
      patientName: 'Bu Siti Test',
      tier: 'TIER_1',
      instructions: 'Hubungi beliau.',
    })

    const raw = JSON.stringify(provider.sent)
    expect(raw).not.toContain('tel:')
    expect(raw).not.toContain('dial')
  })
})
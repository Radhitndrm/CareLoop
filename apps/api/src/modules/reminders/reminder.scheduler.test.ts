// Unit test dispatcher reminder (CL-105).
// Yang diuji: perhitungan slot, horizon, dan idempotensi jobId. Queue direkam lewat
// stub supaya test tidak bergantung pada Redis maupun timer sungguhan.
import { describe, expect, it, vi } from 'vitest'
import { InProcessQueue } from '../../lib/queue'
import type { JobQueue } from '../../lib/queue'
import {
  dispatchDueReminders,
  reminderJobId,
  REMINDER_DISPATCHER_QUEUE_NAME,
  type ReminderDispatchClient,
} from './reminder.scheduler'
import type { ReminderJobPayload } from './reminder.worker'

const SCHEDULE_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const SCHEDULE_B = 'bbbbbbbb-2222-4222-8222-222222222222'
const SCHEDULE_C = 'cccccccc-3333-4333-8333-333333333333'

// 08:55 WIB (UTC+7). Slot 09:00 WIB berada 5 menit ke depan, jadi masih di dalam
// horizon default 10 menit.
const NOW = new Date('2026-08-16T01:55:00.000Z')

interface ScheduledCall {
  payload: ReminderJobPayload
  delayMs: number
  jobId: string | undefined
}

function recordingQueue(): { queue: JobQueue<ReminderJobPayload>; calls: ScheduledCall[] } {
  const calls: ScheduledCall[] = []
  const queue: JobQueue<ReminderJobPayload> = {
    name: 'reminder',
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

function scheduleRow(
  id: string,
  timeOfDay: string,
  overrides: Partial<{ daysOfWeek: number[]; timezone: string; startDate: Date; endDate: Date }> = {},
) {
  return {
    id,
    timeOfDay,
    daysOfWeek: overrides.daysOfWeek ?? [],
    startDate: overrides.startDate ?? null,
    endDate: overrides.endDate ?? null,
    patient: { user: { timezone: overrides.timezone ?? 'Asia/Jakarta' } },
  }
}

function clientReturning(rows: Array<ReturnType<typeof scheduleRow>>): ReminderDispatchClient {
  return {
    schedule: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as ReminderDispatchClient
}

describe('dispatchDueReminders', () => {
  it('menjadwalkan job pada slot berikutnya yang berada di dalam horizon', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([scheduleRow(SCHEDULE_A, '09:00')])

    const result = await dispatchDueReminders(client, queue, { now: NOW })

    expect(result).toEqual({ scanned: 1, enqueued: 1, skippedNotDue: 0, failed: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].payload.scheduleId).toBe(SCHEDULE_A)
    // 09:00 WIB = 02:00 UTC; NOW = 01:55 UTC -> delay 5 menit.
    expect(calls[0].payload.dueAt).toBe('2026-08-16T02:00:00.000Z')
    expect(calls[0].delayMs).toBe(5 * 60 * 1000)
  })

  it('menggunakan jobId deterministik sehingga pemindaian ulang tidak menggandakan job', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([scheduleRow(SCHEDULE_A, '09:00')])

    await dispatchDueReminders(client, queue, { now: NOW })
    await dispatchDueReminders(client, queue, { now: NOW })

    expect(calls).toHaveLength(2)
    expect(calls[0].jobId).toBe(calls[1].jobId)
    expect(calls[0].jobId).toBe(reminderJobId(SCHEDULE_A, new Date('2026-08-16T02:00:00.000Z')))
    expect(calls[0].jobId).toContain(String(new Date('2026-08-16T02:00:00.000Z').getTime()))
  })

  it('membuang slot yang terlalu jauh ke depan dan membiarkannya untuk tick berikutnya', async () => {
    const { queue, calls } = recordingQueue()
    // Jadwal 23:00 WIB = 16:00 UTC; horizon default 10 menit dari 01:00 UTC tidak mencakupnya.
    const client = clientReturning([scheduleRow(SCHEDULE_A, '23:00')])

    const result = await dispatchDueReminders(client, queue, { now: NOW })

    expect(result.enqueued).toBe(0)
    expect(result.skippedNotDue).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('memperhitungkan hari dalam seminggu sesuai daysOfWeek', async () => {
    const { queue, calls } = recordingQueue()
    // NOW = Sabtu 2026-08-16. Dengan daysOfWeek [1] (Senin) slot berikutnya adalah Senin.
    const client = clientReturning([scheduleRow(SCHEDULE_A, '09:00', { daysOfWeek: [1] })])

    await dispatchDueReminders(client, queue, {
      now: NOW,
      lookaheadMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(calls).toHaveLength(1)
    expect(new Date(calls[0].payload.dueAt).getTime()).toBeGreaterThan(NOW.getTime())
    expect(calls[0].payload.dueAt).toBe('2026-08-17T02:00:00.000Z')
  })

  it('menghormati batas akhir jadwal (endDate)', async () => {
    const { queue, calls } = recordingQueue()
    // Jadwal harian 09:00 dengan endDate 2026-08-16 (hari yang sama dengan NOW).
    const client = clientReturning([
      scheduleRow(SCHEDULE_A, '09:00', { endDate: new Date('2026-08-16T00:00:00.000Z') }),
    ])

    const result = await dispatchDueReminders(client, queue, { now: NOW })

    expect(result.enqueued).toBe(1)
    expect(calls[0].payload.dueAt).toBe('2026-08-16T02:00:00.000Z')
  })

  it('menghormati batas awal jadwal (startDate di masa depan)', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([
      scheduleRow(SCHEDULE_A, '09:00', { startDate: new Date('2026-08-20T00:00:00.000Z') }),
    ])

    const result = await dispatchDueReminders(client, queue, {
      now: NOW,
      lookaheadMs: 7 * 24 * 60 * 60 * 1000,
    })

    expect(result.enqueued).toBe(1)
    expect(calls[0].payload.dueAt).toBe('2026-08-20T02:00:00.000Z')
  })

  it('memakai zona waktu pasien, bukan asumsi WIB', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([scheduleRow(SCHEDULE_A, '09:00', { timezone: 'Asia/Makassar' })])

    const result = await dispatchDueReminders(client, queue, { now: NOW })

    // WITA (UTC+8): 09:00 lokal = 01:00 UTC, sedangkan NOW = 01:55 UTC, jadi slot hari ini
    // sudah lewat. Slot berikutnya besok berada di luar horizon -> belum deserves enqueue.
    expect(result.enqueued).toBe(0)
    expect(result.skippedNotDue).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('menangani timeOfDay tidak valid tanpa menjatuhkan seluruh tick', async () => {
    const { queue, calls } = recordingQueue()
    const client = clientReturning([
      { ...scheduleRow(SCHEDULE_A, '09:00'), timeOfDay: 'bukan-jam' },
      scheduleRow(SCHEDULE_B, '10:00'),
    ])

    const result = await dispatchDueReminders(client, queue, {
      now: NOW,
      lookaheadMs: 24 * 60 * 60 * 1000,
    })

    expect(result.failed).toBe(1)
    expect(result.enqueued).toBe(1)
    expect(calls.map((c) => c.payload.scheduleId)).toEqual([SCHEDULE_B])
  })

  it('mencatat kegagalan enqueue tanpa menggagalkan jadwal lain', async () => {
    const calls: ScheduledCall[] = []
    let attempt = 0
    const queue: JobQueue<ReminderJobPayload> = {
      name: 'reminder',
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
      scheduleRow(SCHEDULE_A, '09:00'),
      scheduleRow(SCHEDULE_B, '10:00'),
    ])

    const result = await dispatchDueReminders(client, queue, {
      now: NOW,
      lookaheadMs: 24 * 60 * 60 * 1000,
    })

    expect(result.failed).toBe(1)
    expect(result.enqueued).toBe(1)
    expect(calls.map((c) => c.payload.scheduleId)).toEqual([SCHEDULE_B])
  })

  // BullMQ melempar `Custom Id cannot contain :` saat server start. Karena
  // InProcessQueue tidak memvalidasi jobId, bug ini hanya muncul saat Redis aktif —
  // test ini menjaganya supaya tidak pernah kembali.
  it('jobId tidak mengandung ":" karena BullMQ menolaknya', () => {
    expect(reminderJobId(SCHEDULE_A, new Date(NOW))).not.toContain(':')
  })

  it('hanya memindai jadwal aktif, sudah disetujui dokter, dan milik pasien ACTIVE', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const client = { schedule: { findMany } } as unknown as ReminderDispatchClient
    const { queue } = recordingQueue()

    await dispatchDueReminders(client, queue, { now: NOW })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          status: 'APPROVED',
          patient: { status: 'ACTIVE' },
        },
      }),
    )
  })
})

describe('InProcessQueue sebagai dispatcher', () => {
  it('menjalankan tick handler dan memperpanjang dirinya sendiri', async () => {
    vi.useFakeTimers()
    try {
      let ticks = 0
      const queue = new InProcessQueue<{ tickAt: string }>(
        REMINDER_DISPATCHER_QUEUE_NAME,
        async () => {
          ticks += 1
        },
        { defaultAttempts: 1 },
      )

      await queue.enqueue({ tickAt: 'now' })
      await vi.advanceTimersByTimeAsync(0)

      expect(ticks).toBe(1)
      await queue.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
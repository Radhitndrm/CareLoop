// CL-105: Dispatcher reminder — producer yang membuat worker reminder berjalan.
//
// Worker (`handleReminderJob`) sudah ada lengkap, tetapi tidak ada yang pernah
// memanggilnya: tidak ada pemindaian `schedules` yang mengubah jadwal menjadi job.
// Dispatcher ini menutup celah itu. Satu tick memindai seluruh jadwal aktif yang
// sudah disetujui dokter, menghitung slot berikutnya lewat `nextFireAt`, lalu
// menjadwalkan job `reminder` tepat pada instannya.
//
// Sifat penting:
//   - Job di-enqueue dengan `schedule` (delayed), bukan `enqueue`, supaya pesan
//     dikirim pada jam jadwal, bukan jam pemindaian.
//   - `jobId` diturunkan dari schedule + waktu slot, sehingga pemindaian berulang
//     pada slot yang sama tidak membuat job ganda (BullMQ menolak jobId duplikat).
//   - Jaring kedua: `handleReminderJob` menolak slot yang sudah punya baris
//     ReminderLog SENT, jadi tetap aman bila jobId sudah tersingkir dari Redis.
//   - Eskalasi tetap punya timeout sendiri; dispatcher ini hanya mengirim pengingat.
//
// Scheduler memakai job queue persisten (BullMQ + Redis), bukan setTimeout dalam
// proses: restart server tidak boleh membuat pengingat hilang (AGENTS.md §8).
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { getWhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { createJobQueue, registerQueueLifecycle, type JobQueue, type QueueMode } from '../../lib/queue'
import { nextFireAt } from './next-fire-at'
import { getReminderJobQueue } from './reminder.queue'
import {
  REMINDER_QUEUE_NAME,
  type ReminderJobPayload,
  type ReminderPrismaClient,
  type ReminderWorkerDeps,
} from './reminder.worker'

export const REMINDER_DISPATCHER_QUEUE_NAME = 'reminder-dispatcher'

/** Jarak antar pemindaian. Reminderslot paling rapat 1 menit, jadi 60 detik cukup rapat. */
export const REMINDER_DISPATCH_INTERVAL_MS = 60_000

/**
 * Seberapa jauh ke depan slot di-enqueue. Nilai lebih besar berarti pengingat lebih
 * dulu "diparkir" di queue, lebih kecil berarti lebih banyak slot ditemukan lambat
 * oleh tick. 10 menit memberi toleransi restart bila server mati sebentar.
 */
export const REMINDER_DISPATCH_LOOKAHEAD_MS = 10 * 60_000

export type ReminderDispatchClient = Pick<PrismaClient, 'schedule'>

export interface ReminderDispatchResult {
  scanned: number
  enqueued: number
  skippedNotDue: number
  failed: number
}

export interface DispatchRemindersOptions {
  now?: Date
  lookaheadMs?: number
  logger?: { error(obj: unknown, msg: string): void }
}

/**
 * JobId deterministik per slot: pemindaian berulang pada slot sama tidak menggandakan job.
 *
 * JobId tidak boleh mengandung `:` — BullMQ melempar `Custom Id cannot contain :` saat
 * server start. Karena itu timestamp pun ditulis sebagai epoch ms, bukan ISO string
 * (yang warnanya `2026-08-16T01:55:00.000Z`). `InProcessQueue` tidak memvalidasi jobId
 * sama sekali, jadi bug ini hanya muncul saat Redis aktif.
 */
export function reminderJobId(scheduleId: string, fireAt: Date): string {
  return `${REMINDER_QUEUE_NAME}-${scheduleId}-${fireAt.getTime()}`
}

/**
 * Pindai jadwal aktif dan enqueue job reminder untuk slot yang jatuh di dalam
 * horizon. Fungsi murni terhadap IO database + queue sehingga bisa diuji tanpa server.
 */
export async function dispatchDueReminders(
  client: ReminderDispatchClient,
  queue: JobQueue<ReminderJobPayload>,
  options: DispatchRemindersOptions = {},
): Promise<ReminderDispatchResult> {
  const now = options.now ?? new Date()
  const deadline = now.getTime() + (options.lookaheadMs ?? REMINDER_DISPATCH_LOOKAHEAD_MS)

  const schedules = await client.schedule.findMany({
    where: {
      isActive: true,
      status: 'APPROVED',
      // Guardrail flow §2: hanya pasien ACTIVE yang boleh dijadwalkan pengingatnya.
      patient: { status: 'ACTIVE' },
    },
    select: {
      id: true,
      timeOfDay: true,
      daysOfWeek: true,
      startDate: true,
      endDate: true,
      patient: { select: { user: { select: { timezone: true } } } },
    },
  })

  const result: ReminderDispatchResult = {
    scanned: schedules.length,
    enqueued: 0,
    skippedNotDue: 0,
    failed: 0,
  }

  for (const schedule of schedules) {
    let fireAt: Date | null
    try {
      fireAt = nextFireAt(
        {
          timeOfDay: schedule.timeOfDay,
          daysOfWeek: schedule.daysOfWeek,
          timezone: schedule.patient?.user?.timezone ?? 'Asia/Jakarta',
          startDate: schedule.startDate,
          endDate: schedule.endDate,
        },
        { after: now },
      )
    } catch (error) {
      result.failed += 1
      options.logger?.error(
        { err: error, scheduleId: schedule.id },
        'gagal menghitung waktu reminder',
      )
      continue
    }

    // `nextFireAt` dijamin lebih besar dari `after`, jadi satu-satunya penolakan yang
    // tersisa adalah "slot terlalu jauh ke depan" — biarkan tick berikutnya yang ambil.
    if (!fireAt || fireAt.getTime() > deadline) {
      result.skippedNotDue += 1
      continue
    }

    try {
      await queue.schedule(
        { scheduleId: schedule.id, dueAt: fireAt.toISOString() },
        fireAt.getTime() - now.getTime(),
        { jobId: reminderJobId(schedule.id, fireAt) },
      )
      result.enqueued += 1
    } catch (error) {
      result.failed += 1
      options.logger?.error(
        { err: error, scheduleId: schedule.id },
        'gagal menjadwalkan reminder',
      )
    }
  }

  return result
}

export interface ReminderDispatcherJobPayload {
  tickAt: string
}

/**
 * Antrean dispatcher bersifat self-perpanjang: setiap tick menjadwalkan tick
 * berikutnya setelah selesai. BullMQ repeatable job tidak dipakai karena tidak
 * tersedia pada fallback in-process (ADR-010).
 */
export function scheduleNextDispatchTick(
  queue: JobQueue<ReminderDispatcherJobPayload>,
  intervalMs: number,
  now: Date = new Date(),
): void {
  const nextAt = now.getTime() + intervalMs
  void queue.schedule(
    { tickAt: new Date(nextAt).toISOString() },
    intervalMs,
    { jobId: `${REMINDER_DISPATCHER_QUEUE_NAME}-${nextAt}` },
  )
}

export interface ReminderDispatcherOptions {
  mode?: QueueMode
  client?: ReminderDispatchClient
  reminderQueue: JobQueue<ReminderJobPayload>
  now?: () => Date
  intervalMs?: number
  lookaheadMs?: number
}

export function createReminderDispatcherQueue(
  options: ReminderDispatcherOptions,
): JobQueue<ReminderDispatcherJobPayload> {
  const intervalMs = options.intervalMs ?? REMINDER_DISPATCH_INTERVAL_MS
  const now = options.now ?? (() => new Date())

  const queue = createJobQueue<ReminderDispatcherJobPayload>({
    name: REMINDER_DISPATCHER_QUEUE_NAME,
    mode: options.mode,
    defaultAttempts: 1,
    handler: async (payload) => {
      const client = options.client ?? (prisma as unknown as ReminderDispatchClient)
      const result = await dispatchDueReminders(client, options.reminderQueue, {
        now: now(),
        lookaheadMs: options.lookaheadMs,
        logger: { error: (obj, msg) => console.error(msg, obj) },
      })
      // eslint-disable-next-line no-console -- ringkasan tick untuk log server
      console.log(
        `[reminder-dispatcher] ${payload.tickAt}: ${result.enqueued} dijadwalkan, ${result.skippedNotDue} di luar horizon, ${result.failed} gagal`,
      )
      scheduleNextDispatchTick(queue, intervalMs, now())
    },
  })

  return queue
}

/** Daftarkan dispatcher + worker reminder ke lifecycle app (queue ditutup saat stop). */
export function registerReminderScheduler(app: FastifyInstance, mode?: QueueMode): void {
  const reminderQueue = getReminderJobQueue({ mode })
  const dispatcherQueue = createReminderDispatcherQueue({ mode, reminderQueue })

  registerQueueLifecycle(app, [
    reminderQueue as unknown as JobQueue<unknown>,
    dispatcherQueue as unknown as JobQueue<unknown>,
  ])

  app.addHook('onReady', async () => {
    void dispatcherQueue.enqueue({ tickAt: new Date().toISOString() })
    app.log.info(
      { queues: [reminderQueue.name, dispatcherQueue.name] },
      'scheduler reminder aktif',
    )
  })

  // Env dibaca supaya konfigurasi tidak hilang diam-diam: interval yang tidak valid
  // akan ketahuan saat start, bukan setelah pengingat tidak pernah terkirim.
  getEnv()
}
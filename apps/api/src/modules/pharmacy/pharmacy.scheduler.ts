// Worker penjadwalan permintaan rutin farmasi (docs/API.md §3.6).
//
// Setiap hari, obat yang APPROVED dan `nextPickupAt`-nya sudah masuk lead time
// dibuatkan permintaan ROUTINE. Persetujuan dokter sudah melekat pada resepnya,
// jadi request ini langsung QUEUED tanpa melewati gate dokter.
//
// Timeout memakai job queue persisten (BullMQ + Redis), bukan setTimeout di
// dalam proses — restart server tidak boleh menyebabkan permintaan rutin
// terlewat atau dibuat dua kali (partial unique index sebagai jaring kedua).
import type { FastifyInstance } from 'fastify'
import { createJobQueue, registerQueueLifecycle, type JobQueue, type QueueMode } from '../../lib/queue'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { generateRoutineRequests, type PharmacyPrismaClient } from './pharmacy.service'

export const PHARMACY_SCHEDULER_QUEUE_NAME = 'pharmacy-routine-scheduler'

export interface PharmacySchedulerJobPayload {
  /** Tanggal acuan YYYY-MM-DD — dipakai sebagai jobId supaya idempoten per hari. */
  runFor: string
}

export interface PharmacySchedulerResult {
  runFor: string
  created: number
  skipped: number
}

/**
 * Handler satu tick. `runFor` ikut jadi bagian jobId BullMQ: menjalankan
 * scheduler dua kali untuk tanggal yang sama tidak menggandakan permintaan.
 * Lapisan kedua adalah partial unique index MedicationRequest_active_key.
 */
export async function runPharmacyScheduler(
  payload: PharmacySchedulerJobPayload,
  deps: { client?: PharmacyPrismaClient; logger?: { warn(obj: unknown, msg: string): void } } = {},
): Promise<PharmacySchedulerResult> {
  const client = deps.client ?? (prisma as unknown as PharmacyPrismaClient)
  const result = await generateRoutineRequests(client, { logger: deps.logger })
  return { runFor: payload.runFor, ...result }
}

export function createPharmacySchedulerQueue(
  options: { mode?: QueueMode; client?: PharmacyPrismaClient } = {},
): JobQueue<PharmacySchedulerJobPayload> {
  return createJobQueue<PharmacySchedulerJobPayload>({
    name: PHARMACY_SCHEDULER_QUEUE_NAME,
    mode: options.mode,
    defaultAttempts: 2,
    defaultBackoffMs: 5_000,
    handler: async (payload) => {
      const result = await runPharmacyScheduler(payload, { client: options.client })
      // eslint-disable-next-line no-console -- ringkasan harian untuk log server
      console.log(
        `[pharmacy-scheduler] ${result.runFor}: ${result.created} request dibuat, ${result.skipped} dilewati`,
      )
    },
  })
}

/**
 * Jadwalkan tick harian. Tick pertama berjalan 60 detik setelah start supaya
 * antrean demo langsung terisi tanpa menunggu tengah malam; setelah itu diulang
 * setiap `intervalMs` pada interval tetap.
 */
export function scheduleRecurringPharmacyJobs(
  queue: JobQueue<PharmacySchedulerJobPayload>,
  options: { now?: Date; intervalMs?: number; initialDelayMs?: number } = {},
): void {
  const now = options.now ?? new Date()
  const intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000
  const initialDelayMs = options.initialDelayMs ?? 60_000

  const runFor = now.toISOString().slice(0, 10)
  void queue.enqueue({ runFor }, { jobId: `pharmacy-routine-${runFor}-boot` })
  void queue.schedule({ runFor }, initialDelayMs, { jobId: `pharmacy-routine-${runFor}-boot-delayed` })

  // Tick berikutnya memakai hari berjalan; jobId per tanggal tetap unik.
  const nextRunFor = new Date(now.getTime() + intervalMs).toISOString().slice(0, 10)
  void queue.schedule({ runFor: nextRunFor }, intervalMs, {
    jobId: `pharmacy-routine-${nextRunFor}`,
  })
}

/** Daftarkan scheduler ke lifecycle app supaya queue ditutup saat server stop. */
export function registerPharmacyScheduler(app: FastifyInstance, mode?: QueueMode): void {
  const queue = createPharmacySchedulerQueue({ mode })
  registerQueueLifecycle(app, [queue as unknown as JobQueue<unknown>])

  app.addHook('onReady', async () => {
    const intervalMs = Number(process.env.PHARMACY_SCHEDULER_INTERVAL_MS ?? 24 * 60 * 60 * 1000)
    scheduleRecurringPharmacyJobs(queue, { intervalMs })
    app.log.info({ queue: queue.name }, 'scheduler permintaan rutin farmasi aktif')
  })

  // Env dibaca supaya konfigurasi tidak hilang diam-diam: interval yang tidak
  // valid akan ketahuan saat start, bukan setelah job tidak pernah jalan.
  getEnv()
}
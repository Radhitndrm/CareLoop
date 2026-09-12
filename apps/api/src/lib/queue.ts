// Job queue persisten (CL-104).
// Abstraksi `JobQueue` dengan 2 implementasi:
//   - `BullMqQueue` (default): BullMQ + Redis — restart-safe, delayed job persisten,
//     retry & backoff bawaan (ADR-003).
//   - `InProcessQueue`: fallback demo offline tanpa Redis (ADR-010); `setTimeout` dalam
//     proses — TIDAK restart-safe, hanya untuk demo/unit test.
// Factory `createJobQueue` memilih berdasarkan REDIS_URL (ADA → bullmq, tidak ada → in-process).
// Lifecycle server dijamin via `registerQueueLifecycle` (tutup worker+queue saat app close).
import { Queue as BullQueue, Worker, type ConnectionOptions, type Job } from 'bullmq'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'

export interface QueueJobMeta {
  name: string
  jobId: string
  attemptsMade: number
  failedReason?: string | null
}

export type QueueJobHandler<TPayload> = (
  payload: TPayload,
  meta: QueueJobMeta,
) => Promise<void> | void

export interface ScheduleQueueJobOptions {
  /** Jumlah percobaan (termasuk percobaan pertama), default 3. */
  attempts?: number
  /** Backoff antar percobaan dalam ms, default 1000. */
  backoffMs?: number
  /** Id unik — di BullMQ mencegah duplikat (idempotent enqueue). */
  jobId?: string
}

export interface JobQueue<TPayload> {
  readonly name: string
  /** Panggil handler sesegera mungkin. */
  enqueue(payload: TPayload, opts?: ScheduleQueueJobOptions): Promise<string>
  /** Jadwalkan handler setelah `delayMs`. `delayMs` wajib >= 0. */
  schedule(payload: TPayload, delayMs: number, opts?: ScheduleQueueJobOptions): Promise<string>
  /** Batalkan job yang belum diproses (idempoten). */
  cancel(jobId: string): Promise<void>
  /** Ulangi job (mis. job gagal). Tidak berlaku untuk job yang masih delay. */
  retry(jobId: string): Promise<void>
  /** Tutup worker + queue; job yang masih delay di BullMQ tetap dipulihkan saat restart. */
  close(): Promise<void>
}

export type QueueMode = 'bullmq' | 'in-process'

// ---------------------------------------------------------------- in-process

type InProcessJobState = 'delayed' | 'processing' | 'completed' | 'failed' | 'cancelled'

interface InProcessJob {
  jobId: string
  payload: unknown
  attempts: number
  attemptsMade: number
  backoffMs: number
  timer?: ReturnType<typeof setTimeout>
  state: InProcessJobState
}

/**
 * Fallback tanpa Redis untuk demo & unit test (ADR-010).
 * Menggunakan setTimeout: state hilang saat proses mati — dimaklumi untuk demo.
 */
export class InProcessQueue<TPayload> implements JobQueue<TPayload> {
  readonly name: string
  private readonly jobs = new Map<string, InProcessJob>()
  private readonly handler: QueueJobHandler<TPayload>
  private closed = false

  constructor(name: string, handler: QueueJobHandler<TPayload>) {
    this.name = name
    this.handler = handler
  }

  async enqueue(payload: TPayload, opts: ScheduleQueueJobOptions = {}): Promise<string> {
    return this.add(payload, 0, opts)
  }

  async schedule(
    payload: TPayload,
    delayMs: number,
    opts: ScheduleQueueJobOptions = {},
  ): Promise<string> {
    return this.add(payload, Math.max(0, delayMs), opts)
  }

  private add(payload: TPayload, delayMs: number, opts: ScheduleQueueJobOptions): string {
    if (this.closed) {
      throw new Error(`queue "${this.name}" sudah ditutup`)
    }

    const jobId = opts.jobId ?? randomUUID()
    const job: InProcessJob = {
      jobId,
      payload,
      attempts: opts.attempts ?? 3,
      attemptsMade: 0,
      backoffMs: opts.backoffMs ?? 1000,
      state: 'delayed',
    }
    this.jobs.set(jobId, job)
    this.arm(job, delayMs)
    return jobId
  }

  private arm(job: InProcessJob, delayMs: number): void {
    job.timer = setTimeout(() => {
      job.timer = undefined
      void this.run(job)
    }, delayMs)
  }

  private async run(job: InProcessJob): Promise<void> {
    job.state = 'processing'

    try {
      await this.handler(job.payload as TPayload, {
        name: this.name,
        jobId: job.jobId,
        attemptsMade: job.attemptsMade,
      })
      job.attemptsMade += 1
      job.state = 'completed'
    } catch (error) {
      // Semantik attemptsMade mengikuti BullMQ: 0 saat percobaan pertama, bertambah
      // setelah tiap percobaan selesai. Maksimal `attempts` kali dijalankan.
      job.attemptsMade += 1
      if (job.attemptsMade < job.attempts) {
        job.state = 'delayed'
        this.arm(job, job.backoffMs)
      } else {
        job.state = 'failed'
      }
    }
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.timer) clearTimeout(job.timer)
    job.state = 'cancelled'
    this.jobs.delete(jobId)
  }

  async retry(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job || job.timer !== undefined) return
    job.attemptsMade = 0
    job.state = 'delayed'
    this.arm(job, 0)
  }

  async close(): Promise<void> {
    this.closed = true
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer)
    }
    this.jobs.clear()
  }

  /** Pemantauan untuk test: jumlah job yang belum selesai (delayed/processing). */
  get activeJobCount(): number {
    return [...this.jobs.values()].filter((job) => job.state !== 'cancelled').length
  }

  /** Pemantauan untuk test: status job tertentu. */
  stateOf(jobId: string): InProcessJobState | undefined {
    return this.jobs.get(jobId)?.state
  }
}

// ---------------------------------------------------------------- bullmq

export interface BullMqQueueOptions {
  /** Opsi koneksi ioredis/valkey; default redis://127.0.0.1:6379 (dari `parseRedisUrl`). */
  connection?: ConnectionOptions
  concurrency?: number
  defaultAttempts?: number
  defaultBackoffMs?: number
  /** Berapa banyak job selesai/gagal yang disimpan di Redis (hindari tumbuh tanpa batas). */
  keepCompletedCount?: number
  keepFailedCount?: number
}

/**
 * Implementasi production: BullMQ + Redis. Delayed job persisten, restart-safe,
 * retry/backoff otomatis oleh BullMQ bila handler melempar. Bisa dipakai dengan
 * REDIS_URL (default localhost:6379).
 */
export class BullMqQueue<TPayload> implements JobQueue<TPayload> {
  readonly name: string
  // Generic `Queue` dikunci penuh: DataType/ResultType/NameType masing-masing diisi
  // eksplisit supaya `NameType = string` ter-resolve (BullMQ v6 menurunkan tipe-tipe ini
  // via conditional yang tidak bisa dievaluasi untuk generic kelas).
  private readonly queue: BullQueue<TPayload, unknown, string, TPayload, unknown, string>
  private readonly worker: Worker<TPayload>
  private readonly handler: QueueJobHandler<TPayload>
  private readonly defaultAttempts: number
  private readonly defaultBackoffMs: number
  private closed = false

  constructor(name: string, handler: QueueJobHandler<TPayload>, opts: BullMqQueueOptions = {}) {
    this.name = name
    this.handler = handler
    this.defaultAttempts = opts.defaultAttempts ?? 3
    this.defaultBackoffMs = opts.defaultBackoffMs ?? 1000

    const connection = opts.connection ?? {}
    this.queue = new BullQueue<TPayload, unknown, string, TPayload, unknown, string>(name, {
      connection,
      defaultJobOptions: {
        attempts: this.defaultAttempts,
        backoff: { type: 'fixed', delay: this.defaultBackoffMs },
        removeOnComplete: { count: opts.keepCompletedCount ?? 100 },
        removeOnFail: { count: opts.keepFailedCount ?? 500 },
      },
    })

    this.worker = new Worker<TPayload>(
      name,
      async (job) => {
        await this.handler(job.data, {
          name: job.name,
          jobId: job.id ?? '',
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
        })
      },
      { connection, concurrency: opts.concurrency ?? 1 },
    )
  }

  async enqueue(payload: TPayload, opts: ScheduleQueueJobOptions = {}): Promise<string> {
    return this.add(payload, 0, opts)
  }

  async schedule(
    payload: TPayload,
    delayMs: number,
    opts: ScheduleQueueJobOptions = {},
  ): Promise<string> {
    return this.add(payload, Math.max(0, delayMs), opts)
  }

  private async add(
    payload: TPayload,
    delayMs: number,
    opts: ScheduleQueueJobOptions,
  ): Promise<string> {
    const job = await this.queue.add('default', payload, {
      delay: delayMs,
      jobId: opts.jobId,
      ...(opts.attempts !== undefined ? { attempts: opts.attempts } : {}),
      ...(opts.backoffMs !== undefined
        ? { backoff: { type: 'fixed' as const, delay: opts.backoffMs } }
        : {}),
    })
    return job.id ?? ''
  }

  async cancel(jobId: string): Promise<void> {
    await this.queue.remove(jobId)
  }

  async retry(jobId: string): Promise<void> {
    // getJob mengembalikan JobBase (conditional type) — di runtime selalu Job; sematkan
    // tipe Job yang ter-resolve supaya bisa memanggil .retry(), tanpa `any`.
    const job = (await this.queue.getJob(jobId)) as Job<TPayload, unknown, string> | undefined
    if (!job) return
    await job.retry()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.worker.close()
    await this.queue.close()
  }
}

// ---------------------------------------------------------------- factory & util

/** Parse `redis://user:pass@host:port/db` (atau `rediss://`) menjadi opsi koneksi BullMQ. */
export function parseRedisUrl(url?: string): ConnectionOptions {
  if (!url) return { host: '127.0.0.1', port: 6379 }

  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port ? Number(parsed.port) : 6379,
      ...(parsed.username ? { username: parsed.username } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
      ...(parsed.pathname.length > 1 ? { db: Number(parsed.pathname.slice(1)) } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    }
  } catch {
    return { host: '127.0.0.1', port: 6379 }
  }
}

/** `bullmq` bila REDIS_URL terisi, selain itu `in-process` (ADR-010: demo offline). */
export function defaultQueueMode(): QueueMode {
  return process.env.REDIS_URL ? 'bullmq' : 'in-process'
}

export interface CreateJobQueueOptions<TPayload> extends BullMqQueueOptions {
  name: string
  handler: QueueJobHandler<TPayload>
  /** Default: `defaultQueueMode()`. Pilih 'in-process' untuk demo/test deterministik. */
  mode?: QueueMode
}

export function createJobQueue<TPayload>(
  opts: CreateJobQueueOptions<TPayload>,
): JobQueue<TPayload> {
  const mode = opts.mode ?? defaultQueueMode()
  if (mode === 'bullmq') {
    const connection = opts.connection ?? parseRedisUrl(process.env.REDIS_URL)
    return new BullMqQueue(opts.name, opts.handler, { ...opts, connection })
  }
  return new InProcessQueue(opts.name, opts.handler)
}

/** Tutup semua queue saat server ditutup (Fastify onClose) — restart/stop aman. */
export function registerQueueLifecycle(
  app: FastifyInstance,
  queues: Array<JobQueue<unknown>>,
): void {
  app.addHook('onClose', async () => {
    await Promise.all(queues.map((queue) => queue.close()))
  })
}

export async function closeAllQueues(queues: Array<JobQueue<unknown>>): Promise<void> {
  await Promise.all(queues.map((queue) => queue.close()))
}

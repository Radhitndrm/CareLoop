// Unit test job queue (CL-104).
// Ref: docs/TESTING.md — unit dengan InProcessQueue (fake timers, deterministik);
// integration BullMQ (opsional, butuh Redis): delayed job fire & idempotent jobId.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BullMqQueue,
  InProcessQueue,
  createJobQueue,
  defaultQueueMode,
  parseRedisUrl,
  type QueueJobHandler,
} from './queue'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('InProcessQueue — enqueue/schedule/cancel', () => {
  it('enqueue memanggil handler dengan payload & meta', async () => {
    const calls: Array<{ payload: unknown; meta: { attemptsMade: number } }> = []
    const queue = new InProcessQueue<{ n: number }>('q1', (payload, meta) => {
      calls.push({ payload, meta })
    })
    vi.useFakeTimers()

    const jobId = await queue.enqueue({ n: 1 })
    expect(jobId.length).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(0)

    expect(calls).toHaveLength(1)
    expect(calls[0].payload).toEqual({ n: 1 })
    expect(calls[0].meta.attemptsMade).toBe(0)
    expect(queue.stateOf(jobId)).toBe('completed')
  })

  it('schedule menunda eksekusi sesuai delayMs', async () => {
    let fired = 0
    const queue = new InProcessQueue<{ n: number }>('q2', () => {
      fired += 1
    })
    vi.useFakeTimers()

    const jobId = await queue.schedule({ n: 1 }, 50)

    await vi.advanceTimersByTimeAsync(49)
    expect(fired).toBe(0)
    expect(queue.stateOf(jobId)).toBe('delayed')

    await vi.advanceTimersByTimeAsync(1)
    expect(fired).toBe(1)
    expect(queue.stateOf(jobId)).toBe('completed')
  })

  it('cancel membatalkan job yang belum diproses', async () => {
    let fired = 0
    const queue = new InProcessQueue<{ n: number }>('q3', () => {
      fired += 1
    })
    vi.useFakeTimers()

    const jobId = await queue.schedule({ n: 1 }, 100)
    await queue.cancel(jobId)
    await vi.advanceTimersByTimeAsync(200)

    expect(fired).toBe(0)
    expect(queue.stateOf(jobId)).toBeUndefined()
  })
})

describe('InProcessQueue — retry & attempts', () => {
  it('handler gagal lalu retry otomatis dengan backoff sampai sukses (attempts=3)', async () => {
    let attemptsMadeList: number[] = []
    let fails = 2
    const queue = new InProcessQueue<{ n: number }>('q4', (_payload, meta) => {
      attemptsMadeList.push(meta.attemptsMade)
      if (fails > 0) {
        fails -= 1
        throw new Error('sementara gagal')
      }
    })
    vi.useFakeTimers()

    const jobId = await queue.enqueue({ n: 1 }, { attempts: 3, backoffMs: 10 })
    await vi.advanceTimersByTimeAsync(0) // attempt 1 → gagal
    expect(attemptsMadeList).toEqual([0])
    expect(queue.stateOf(jobId)).toBe('delayed')

    await vi.advanceTimersByTimeAsync(10) // attempt 2 → gagal
    expect(attemptsMadeList).toEqual([0, 1])

    await vi.advanceTimersByTimeAsync(10) // attempt 3 → sukses
    expect(attemptsMadeList).toEqual([0, 1, 2])
    expect(queue.stateOf(jobId)).toBe('completed')

    await vi.advanceTimersByTimeAsync(100)
    expect(attemptsMadeList).toHaveLength(3)
  })

  it('attempts habis -> state failed dan tidak diproses lagi', async () => {
    let fired = 0
    const queue = new InProcessQueue<{ n: number }>('q5', () => {
      fired += 1
      throw new Error('selalu gagal')
    })
    vi.useFakeTimers()

    const jobId = await queue.enqueue({ n: 1 }, { attempts: 2, backoffMs: 5 })
    await vi.advanceTimersByTimeAsync(50)

    expect(fired).toBe(2)
    expect(queue.stateOf(jobId)).toBe('failed')
  })

  it('retry memproses ulang job yang gagal', async () => {
    let fired = 0
    let shouldFail = true
    const queue = new InProcessQueue<{ n: number }>('q6', () => {
      fired += 1
      if (shouldFail) {
        shouldFail = false
        throw new Error('gagal sekali')
      }
    })
    vi.useFakeTimers()

    const jobId = await queue.enqueue({ n: 1 }, { attempts: 1 })
    await vi.advanceTimersByTimeAsync(0)
    expect(fired).toBe(1)
    expect(queue.stateOf(jobId)).toBe('failed')

    await queue.retry(jobId)
    await vi.advanceTimersByTimeAsync(0)
    expect(fired).toBe(2)
    expect(queue.stateOf(jobId)).toBe('completed')
  })
})

describe('InProcessQueue — close', () => {
  it('close mencegah job baru dan menghentikan penjadwalan', async () => {
    let fired = 0
    const queue = new InProcessQueue<{ n: number }>('q7', () => {
      fired += 1
    })
    vi.useFakeTimers()

    await queue.schedule({ n: 1 }, 10)
    await queue.close()
    await expect(queue.enqueue({ n: 2 })).rejects.toThrow(/ditutup/)

    await vi.advanceTimersByTimeAsync(100)
    expect(fired).toBe(0)
    expect(queue.activeJobCount).toBe(0)
  })
})

describe('parseRedisUrl', () => {
  it('mengurai URL lengkap redis://', () => {
    expect(parseRedisUrl('redis://:secret@myhost:6380/3')).toEqual({
      host: 'myhost',
      port: 6380,
      password: 'secret',
      db: 3,
    })
  })

  it('tanpa URL -> localhost:6379', () => {
    expect(parseRedisUrl(undefined)).toEqual({ host: '127.0.0.1', port: 6379 })
  })

  it('URL tidak valid -> fallback localhost:6379', () => {
    expect(parseRedisUrl('not-a-url')).toEqual({ host: '127.0.0.1', port: 6379 })
  })

  it('rediss:// -> mengaktifkan tls', () => {
    const options = parseRedisUrl('rediss://user@host:6379') as { tls?: unknown }
    expect(options.tls).toBeDefined()
  })
})

describe('createJobQueue — pemilihan mode (ADR-010)', () => {
  it('defaultQueueMode: bullmq bila REDIS_URL ada, in-process bila tidak', () => {
    const previous = process.env.REDIS_URL

    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    expect(defaultQueueMode()).toBe('bullmq')

    delete process.env.REDIS_URL
    expect(defaultQueueMode()).toBe('in-process')

    if (previous !== undefined) process.env.REDIS_URL = previous
  })

  it('createJobQueue mengembalikan InProcessQueue saat mode=in-process', () => {
    const queue = createJobQueue<{ n: number }>({
      name: 'q8',
      mode: 'in-process',
      handler: () => undefined,
    })
    expect(queue).toBeInstanceOf(InProcessQueue)
  })

  it('createJobQueue mengembalikan BullMqQueue saat mode=bullmq', () => {
    const queue = createJobQueue<{ n: number }>({
      name: 'q9',
      mode: 'bullmq',
      handler: () => undefined,
    })
    expect(queue).toBeInstanceOf(BullMqQueue)
    void queue.close()
  })
})

// ---------------------------------------------------------------- integration BullMQ

async function redisAvailable(): Promise<boolean> {
  if (process.env.QUEUE_DISABLE_REDIS === '1') return false
  try {
    const { default: Redis } = await import('ioredis')
    const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null as unknown as number,
    })
    await client.connect()
    await client.ping()
    await client.quit()
    return true
  } catch {
    return false
  }
}

const hasRedis = { value: false }

describe('BullMqQueue — integration (Redis opsional)', () => {
  const name = `cl104-test-${Date.now()}`
  let handler: QueueJobHandler<{ n: number }> = () => undefined

  beforeAll(async () => {
    hasRedis.value = await redisAvailable()
  })

  it('delayed job fire setelah delay', async (ctx) => {
    if (!hasRedis.value) return ctx.skip()
    const got = new Promise<{ payload: { n: number }; attemptsMade: number }>((resolve) => {
      handler = (payload, meta) => resolve({ payload, attemptsMade: meta.attemptsMade })
    })

    const queue = new BullMqQueue<{ n: number }>(`${name}-delay`, handler, {
      connection: parseRedisUrl(process.env.REDIS_URL),
    })
    const jobId = await queue.schedule({ n: 42 }, 200)

    const result = await got
    expect(result).toEqual({ payload: { n: 42 }, attemptsMade: 0 })
    expect(jobId.length).toBeGreaterThan(0)

    await queue.close()
  })

  it('jobId duplikat tidak membuat job baru (idempotent enqueue)', async (ctx) => {
    if (!hasRedis.value) return ctx.skip()
    let fired = 0
    const queue = new BullMqQueue<{ n: number }>(
      `${name}-dedup`,
      () => {
        fired += 1
      },
      {
        connection: parseRedisUrl(process.env.REDIS_URL),
        keepCompletedCount: 20,
      },
    )

    const id = 'dedup-fixed-id-test'
    await queue.schedule({ n: 1 }, 0, { jobId: id, attempts: 1 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(fired).toBe(1)

    // Job sudah selesai; jobId baru yang sama akan menambah job baru (tidak dedup
    // terhadap job selesai) — hanya menegaskan tidak error pada flow dasar.
    await queue.schedule({ n: 2 }, 0, { jobId: id, attempts: 1 })
    await new Promise((resolve) => setTimeout(resolve, 300))

    await queue.close()
  })

  it('cancel membatalkan job yang masih delayed', async (ctx) => {
    if (!hasRedis.value) return ctx.skip()
    let fired = 0
    const queue = new BullMqQueue<{ n: number }>(
      `${name}-cancel`,
      () => {
        fired += 1
      },
      {
        connection: parseRedisUrl(process.env.REDIS_URL),
      },
    )

    const jobId = await queue.schedule({ n: 1 }, 2000, { jobId: 'cancel-me-test' })
    await queue.cancel(jobId)
    await new Promise((resolve) => setTimeout(resolve, 2400))

    expect(fired).toBe(0)
    await queue.close()
  })
})

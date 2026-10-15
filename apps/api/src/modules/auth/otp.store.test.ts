// CL-401: store OTP persisten.
// Suite kontrak selalu memakai InMemoryOtpStore; Redis hanya ikut diuji kalau ada
// Redis yang bisa dihubungi, mengikuti pola lib/queue.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type Redis from 'ioredis'
import {
  InMemoryOtpStore,
  RedisOtpStore,
  createOtpStore,
  type OtpRecord,
  type OtpStore,
} from './otp.store'
import { requestOtp, verifyOtp, type OtpConfig, type OtpDeps } from './otp.service'
import type { AuthUserRecord } from './auth.service'

const PHONE = '081200000001'
const CONFIG: OtpConfig = { ttlSec: 300, cooldownSec: 30, maxAttempts: 5, mockCode: '123456' }

function record(overrides: Partial<OtpRecord> = {}): OtpRecord {
  return {
    code: '123456',
    expiresAtMs: Date.now() + 300_000,
    issuedAtMs: Date.now(),
    attemptsLeft: 3,
    ...overrides,
  }
}

function harness(store: OtpStore, user: Partial<AuthUserRecord> = {}): OtpDeps {
  return {
    store,
    now: () => Date.now(),
    findUser: async () => ({
      id: '00000000-0000-4000-8000-000000000003',
      fullName: 'Bu Ratna',
      role: 'PATIENT',
      passwordHash: null,
      isActive: true,
      isVerified: true,
      ...user,
    }),
    signToken: () => 'signed.jwt.token',
    randomCode: () => '999999',
  }
}

async function connectRedis(): Promise<Redis | null> {
  if (process.env.QUEUE_DISABLE_REDIS === '1') return null
  try {
    const { default: RedisCtor } = await import('ioredis')
    const client = new RedisCtor(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      // Redis tidak ada → gagal sekali dan menyerah, tanpa mencoba ulang /
      // tanpa error event yang memenuhi terminal test.
      retryStrategy: () => null as unknown as number,
      lazyConnect: true,
    })
    client.on('error', () => undefined)
    await client.connect()
    await client.ping()
    return client
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- InMemoryOtpStore

describe('InMemoryOtpStore', () => {
  const store = new InMemoryOtpStore()

  it('menyimpan dan membaca kembali record utuh', async () => {
    await store.set(PHONE, record({ code: '424242' }))
    expect((await store.get(PHONE))?.code).toBe('424242')
  })

  it('consumeAttempt mengurangi sisa percobaan', async () => {
    await store.set(PHONE, record({ attemptsLeft: 2 }))

    expect((await store.consumeAttempt(PHONE))?.attemptsLeft).toBe(1)
    expect((await store.get(PHONE))?.attemptsLeft).toBe(1)
  })

  it('consumeAttempt menghapus record dan mengembalikan undefined setelahnya', async () => {
    await store.set(PHONE, record({ attemptsLeft: 1 }))

    expect((await store.consumeAttempt(PHONE))?.attemptsLeft).toBe(0)
    expect(await store.get(PHONE)).toBeUndefined()
    expect(await store.consumeAttempt(PHONE)).toBeUndefined()
  })

  it('consume ambil-lepas: hanya pemanggil pertama yang mendapat record', async () => {
    await store.set(PHONE, record())

    const [a, b] = await Promise.all([store.consume(PHONE), store.consume(PHONE)])
    expect([a?.code, b?.code].filter(Boolean)).toHaveLength(1)
    expect(await store.get(PHONE)).toBeUndefined()
  })
})

// ---------------------------------------------------------------- factory

describe('createOtpStore', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('pakai memory saat NODE_ENV=test supaya test tidak bergantung Redis', () => {
    process.env = { ...saved, NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379' }
    expect(createOtpStore()).toBeInstanceOf(InMemoryOtpStore)
  })

  it('pakai memory saat REDIS_URL kosong (demo offline)', () => {
    process.env = { ...saved, NODE_ENV: 'production' }
    delete process.env.REDIS_URL
    expect(createOtpStore()).toBeInstanceOf(InMemoryOtpStore)
  })

  it('pakai Redis saat REDIS_URL terisi', () => {
    process.env = { ...saved, NODE_ENV: 'production', REDIS_URL: 'redis://127.0.0.1:6379' }
    expect(createOtpStore()).toBeInstanceOf(RedisOtpStore)
  })
})

// ---------------------------------------------------------------- integrasi Redis

describe('RedisOtpStore — integrasi (Redis opsional)', () => {
  const PREFIX = 'careloop:test:otp:'
  let redis: Redis | null = null

  const store = (): RedisOtpStore => new RedisOtpStore({ redis: redis as Redis, keyPrefix: PREFIX })

  beforeAll(async () => {
    redis = await connectRedis()
  })

  afterAll(async () => {
    await redis?.quit()
    redis = null
  })

  afterEach(async () => {
    if (redis) await redis.del(`${PREFIX}${PHONE}`)
  })

  it('menyimpan record dengan TTL dan membacanya kembali', async (ctx) => {
    if (!redis) return ctx.skip()
    await store().set(PHONE, record({ code: '424242', expiresAtMs: Date.now() + 120_000 }))

    expect((await store().get(PHONE))?.code).toBe('424242')
    const ttl = await redis.pttl(`${PREFIX}${PHONE}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(120_000)
  })

  it('challenge bertahan di instance baru — setara survive restart', async (ctx) => {
    if (!redis) return ctx.skip()
    await requestOtp(harness(store()), CONFIG, PHONE)

    const session = await verifyOtp(harness(store()), { phone: PHONE, otp: '123456' }, 3600)

    expect(session.accessToken).toBe('signed.jwt.token')
    expect(await store().get(PHONE)).toBeUndefined()
  })

  it('cooldown berlaku lintas instance (store kedua)', async (ctx) => {
    if (!redis) return ctx.skip()
    await requestOtp(harness(store()), CONFIG, PHONE)

    await expect(requestOtp(harness(store()), CONFIG, PHONE)).rejects.toMatchObject({
      statusCode: 429,
    })
  })

  it('jatah percobaan tidak bisa ditembus dua instance sekaligus', async (ctx) => {
    if (!redis) return ctx.skip()
    const a = store()
    const b = store()
    await a.set(PHONE, record({ attemptsLeft: 1 }))

    const hasil = await Promise.all([a.consumeAttempt(PHONE), b.consumeAttempt(PHONE)])

    expect(hasil.filter((r) => r !== undefined)).toHaveLength(1)
  })

  it('kode OTP tidak pernah ditulis ke log aplikasi', async (ctx) => {
    if (!redis) return ctx.skip()
    const spy = vi.spyOn(console, 'log')
    const errorSpy = vi.spyOn(console, 'error')

    await store().set(PHONE, record({ code: '999999' }))
    await store().get(PHONE)

    const output = [...spy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')
    expect(output).not.toContain('999999')
    spy.mockRestore()
    errorSpy.mockRestore()
  })
})
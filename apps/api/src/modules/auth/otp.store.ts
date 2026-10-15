// CL-401: store OTP — kontrak, implementasi memory, dan implementasi Redis.
//
// `RedisOtpStore` adalah implementasi produksi:
//  - TTL mengikuti sisa masa berlaku challenge (`expiresAtMs`), jadi Redis sendiri
//    yang membersihkan kode basi — tidak ada gc yang harus dijalankan.
//  - Pengurangan sisa percobaan (brute force guard) dan kode sekali pakai dijalankan
//    sebagai skrip Lua agar atomik lintas replika: dua verifikasi paralel tidak bisa
//    memakai jatah percobaan yang sama.
//  - Kode OTP tidak pernah ditulis ke log.
import type Redis from 'ioredis'
import { getRedis } from '../../lib/redis'

const KEY_PREFIX = 'careloop:otp:'

export interface OtpRecord {
  /** null = nomor tidak terdaftar; challenge tetap dibuat agar respons tak bisa dibedakan. */
  code: string | null
  expiresAtMs: number
  issuedAtMs: number
  attemptsLeft: number
}

export interface OtpStore {
  get(phone: string): Promise<OtpRecord | undefined>
  set(phone: string, record: OtpRecord): Promise<void>
  delete(phone: string): Promise<void>
  /**
   * Kurangi sisa percobaan secara atomik dan kembalikan record terbaru.
   * WAJIB atomik: tanpa itu dua verifikasi paralel dari dua replika bisa sama-sama
   * membaca sisa percobaan yang sama dan melampaui batas.
   * Kembalikan `undefined` bila record sudah hilang/expired.
   */
  consumeAttempt(phone: string): Promise<OtpRecord | undefined>
  /**
   * Ambil lalu hapus dalam satu operasi atomik (kode sekali pakai). Hanya satu
   * pemanggil yang menerima record; pemanggil lain mendapat `undefined`.
   */
  consume(phone: string): Promise<OtpRecord | undefined>
}

/** Development & unit test saja — state hilang saat restart (lihat factory di bawah). */
export class InMemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>()

  async get(phone: string): Promise<OtpRecord | undefined> {
    return this.records.get(phone)
  }

  async set(phone: string, record: OtpRecord): Promise<void> {
    this.evictExpired(record.issuedAtMs)
    this.records.set(phone, record)
  }

  async delete(phone: string): Promise<void> {
    this.records.delete(phone)
  }

  async consumeAttempt(phone: string): Promise<OtpRecord | undefined> {
    const record = this.records.get(phone)
    if (!record) return undefined
    const next: OtpRecord = { ...record, attemptsLeft: record.attemptsLeft - 1 }
    if (next.attemptsLeft <= 0) {
      this.records.delete(phone)
      return next
    }
    this.records.set(phone, next)
    return next
  }

  async consume(phone: string): Promise<OtpRecord | undefined> {
    const record = this.records.get(phone)
    if (!record) return undefined
    this.records.delete(phone)
    return record
  }

  /** Dibersihkan saat ada penulisan baru agar Map tidak tumbuh tanpa batas. */
  private evictExpired(nowMs: number): void {
    for (const [phone, record] of this.records) {
      if (record.expiresAtMs <= nowMs) this.records.delete(phone)
    }
  }
}

/**
 * Ambil record, potong 1 dari sisa percobaan, kembalikan JSON terbaru.
 * Mengembalikan string kosong kalau key tidak ada. `attemptsLeft` turun di dalam
 * skrip supaya tidak ada celah TOCTOU antar replika.
 */
const CONSUME_ATTEMPT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local record = cjson.decode(raw)
record['attemptsLeft'] = (tonumber(record['attemptsLeft']) or 0) - 1
if record['attemptsLeft'] <= 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], cjson.encode(record), 'PX', tonumber(ARGV[1]))
end
return cjson.encode(record)
`

/** Ambil lalu hapus dalam satu operasi (kode sekali pakai). */
const CONSUME_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if raw then redis.call('DEL', KEYS[1]) end
return raw or ''
`

export interface RedisOtpStoreOptions {
  /** Klien yang dipakai. Default: klien bersama dari `lib/redis` (dari REDIS_URL). */
  redis?: Redis
  keyPrefix?: string
}

export class RedisOtpStore implements OtpStore {
  private readonly redis: Redis
  private readonly keyPrefix: string

  constructor(opts: RedisOtpStoreOptions = {}) {
    this.redis = opts.redis ?? getRedis({ name: 'otp' })
    this.keyPrefix = opts.keyPrefix ?? KEY_PREFIX
  }

  async get(phone: string): Promise<OtpRecord | undefined> {
    const raw = await this.redis.get(this.key(phone))
    return raw ? parseRecord(raw) : undefined
  }

  async set(phone: string, record: OtpRecord): Promise<void> {
    const ttlMs = record.expiresAtMs - Date.now()
    if (ttlMs <= 0) return
    await this.redis.set(this.key(phone), JSON.stringify(record), 'PX', ttlMs)
  }

  async delete(phone: string): Promise<void> {
    await this.redis.del(this.key(phone))
  }

  async consumeAttempt(phone: string): Promise<OtpRecord | undefined> {
    const key = this.key(phone)
    const ttlMs = await this.remainingTtlMs(key)
    if (ttlMs <= 0) return undefined
    const raw = (await this.redis.eval(
      CONSUME_ATTEMPT_SCRIPT,
      1,
      key,
      String(ttlMs),
    )) as string | null
    return raw ? parseRecord(raw) : undefined
  }

  async consume(phone: string): Promise<OtpRecord | undefined> {
    const raw = (await this.redis.eval(CONSUME_SCRIPT, 1, this.key(phone))) as string | null
    return raw ? parseRecord(raw) : undefined
  }

  /** Sisa TTL key dalam ms; 0 atau negatif berarti key sudah hilang/expired. */
  private async remainingTtlMs(key: string): Promise<number> {
    const ttl = await this.redis.pttl(key)
    return ttl > 0 ? ttl : 0
  }

  private key(phone: string): string {
    return `${this.keyPrefix}${phone}`
  }
}

function parseRecord(raw: string): OtpRecord | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<OtpRecord>
    if (
      typeof parsed.expiresAtMs !== 'number' ||
      typeof parsed.issuedAtMs !== 'number' ||
      typeof parsed.attemptsLeft !== 'number'
    ) {
      return undefined
    }
    return {
      code: typeof parsed.code === 'string' ? parsed.code : null,
      expiresAtMs: parsed.expiresAtMs,
      issuedAtMs: parsed.issuedAtMs,
      attemptsLeft: parsed.attemptsLeft,
    }
  } catch {
    return undefined
  }
}

/**
 * Store default untuk proses ini.
 *
 * Redis dipilih otomatis saat `REDIS_URL` terisi (staging/production) — restart
 * atau load balancer tidak boleh menghapus challenge OTP yang baru diterbitkan.
 * Tanpa Redis (dev offline) jatuh ke memory; `lib/env.ts` mewajibkan REDIS_URL di
 * production, jadi konfigurasi cloud tidak bisa diam-diam memakai memory.
 *
 * `NODE_ENV=test` sengaja dikunci ke memory: unit & integration test harus
 * deterministik dan tidak bergantung Redis yang mungkin mati.
 */
export function createOtpStore(): OtpStore {
  if (process.env.NODE_ENV === 'test') return new InMemoryOtpStore()
  if (process.env.REDIS_URL) return new RedisOtpStore()
  return new InMemoryOtpStore()
}
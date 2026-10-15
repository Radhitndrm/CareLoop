// Klien Redis bersama untuk backend (OTP store dan health check).
//
// Hanya dipakai di cloud: dev/test boleh jalan tanpa Redis (`REDIS_URL` kosong).
// Modul ini menyimpan satu koneksi ioredis per proses, dibuat secara lazy supaya
// unit test yang tidak menyentuh Redis tidak pernah membuka socket.
import Redis from 'ioredis'

let client: Redis | undefined

export interface RedisClientOptions {
  /** Label koneksi (tampil di `CLIENT LIST` Redis), bukan untuk log aplikasi. */
  name?: string
}

/**
 * Klien ioredis tunggal per proses, dibuat dari `REDIS_URL`.
 * Melempar Error jelas (tanpa URL-nya) kalau `REDIS_URL` kosong atau tidak valid,
 * supaya kegagalan tidak pernah terasa "berhasil".
 */
export function getRedis(opts: RedisClientOptions = {}): Redis {
  if (client) return client

  const url = process.env.REDIS_URL
  if (!url) {
    throw new Error('REDIS_URL belum diisi — operasi yang butuh Redis tidak bisa dijalankan')
  }

  client = new Redis(url, {
    connectionName: opts.name ?? 'careloop-api',
    maxRetriesPerRequest: 3,
    // Backoff dibatasi supaya proses tidak diamkan try-connect ke host mati.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  })

  // Tanpa listener, ioredis melempar event 'error' yang bisa menggagalkan proses.
  client.on('error', () => undefined)

  return client
}

export function hasRedis(): boolean {
  return Boolean(process.env.REDIS_URL)
}

/** Ping singkat untuk health check — tidak pernah membocorkan host/kredensial. */
export async function pingRedis(): Promise<boolean> {
  if (!hasRedis()) return false
  try {
    const reply = await getRedis({ name: 'healthcheck' }).ping()
    return reply === 'PONG'
  } catch {
    return false
  }
}

/** Tutup koneksi saat shutdown supaya proses tidak menggantung. */
export async function closeRedis(): Promise<void> {
  if (!client) return
  const closing = client
  client = undefined
  try {
    await closing.quit()
  } catch {
    closing.disconnect()
  }
}

/** Hanya untuk test: lepas klien tersimpan tanpa menunggu koneksi selesai. */
export function resetRedisForTest(): void {
  client?.disconnect()
  client = undefined
}
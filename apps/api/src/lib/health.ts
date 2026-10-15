// Health & readiness check untuk deployment cloud.
//
// Perbedaan sengaja:
//  - `/healthz` (liveness): proses hidup. Tidak menyentuh dependency, supaya
//    platform tidak me-restart API hanya karena database lambat.
//  - `/readyz` (readiness): API siap menerima traffic — database, Redis, dan versi
//    migration harus benar. Fail di sini membuat load balancer menurunkan replica
//    dari rotasi tanpa perlu restart.
//
// Tidak ada credential, host, atau connection string di respons maupun log;
// hanya status dan pesan umum.
import type { FastifyInstance } from 'fastify'
import { prisma } from './prisma'
import { defaultQueueMode, type QueueMode } from './queue'
import { hasRedis, pingRedis } from './redis'

export type DependencyStatus = 'ok' | 'degraded' | 'disabled'

export interface ReadinessReport {
  status: 'ok' | 'not_ready'
  /** Versi migration terakhir yang benar-benar terpasang di database. */
  migration: string | null
  queue: QueueMode
  checks: {
    database: DependencyStatus
    migrations: DependencyStatus
    redis: DependencyStatus
  }
  timestamp: string
}

/**
 * Migration terakhir yang terpasang. `finished_at IS NULL` berarti migrasi gagal
 * di tengah jalan dan dianggap tidak sehat.
 */
async function readAppliedMigration(): Promise<{ name: string } | null> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `
  const name = rows[0]?.migration_name
  return name ? { name } : null
}

/**
 * Laporan readiness. Mode Redis: `ok` kalau ping berhasil, `degraded` kalau
 * `REDIS_URL` terisi tetapi tidak bisa dihubungi, `disabled` kalau tidak
 * dikonfigurasi (hanya sah di development).
 */
export async function collectReadiness(): Promise<ReadinessReport> {
  const queue = defaultQueueMode()

  let database: DependencyStatus = 'ok'
  let migrations: DependencyStatus = 'ok'
  let migration: string | null = null

  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    database = 'degraded'
  }

  if (database === 'ok') {
    try {
      const applied = await readAppliedMigration()
      if (applied) {
        migration = applied.name
      } else {
        // Database terjangkau tapi belum ada migration sama sekali: kemungkinan
        // `prisma migrate deploy` belum dijalankan di environment ini.
        migrations = 'degraded'
      }
    } catch {
      migrations = 'degraded'
    }
  } else {
    migrations = 'degraded'
  }

  let redis: DependencyStatus
  if (!hasRedis()) {
    redis = queue === 'in-process' ? 'disabled' : 'degraded'
  } else {
    redis = (await pingRedis()) ? 'ok' : 'degraded'
  }

  const failed =
    database === 'degraded' || migrations === 'degraded' || redis === 'degraded'

  return {
    status: failed ? 'not_ready' : 'ok',
    migration,
    queue,
    checks: { database, migrations, redis },
    timestamp: new Date().toISOString(),
  }
}

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }))

  app.get('/readyz', async (_req, reply) => {
    const report = await collectReadiness()
    return reply.code(report.status === 'ok' ? 200 : 503).send({ data: report })
  })
}
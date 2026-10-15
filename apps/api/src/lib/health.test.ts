// Health & readiness check untuk deployment cloud (docs/DEPLOYMENT.md).
// Prisma di-mock supaya hasil readiness bisa ditentukan tanpa database nyata.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const queryRaw = vi.fn()
vi.mock('./prisma', () => ({ prisma: { $queryRaw: queryRaw } }))

const savedEnv = { ...process.env }

function migrationRow(name: string) {
  return [{ migration_name: name }]
}

async function callReady(app: FastifyInstance) {
  const res = await app.inject({ method: 'GET', url: '/readyz' })
  return { status: res.statusCode, body: res.json() as { data: Record<string, never> } }
}

describe('registerHealthRoutes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    queryRaw.mockReset()
    process.env = { ...savedEnv }
    delete process.env.REDIS_URL

    const { buildApp } = await import('../app')
    app = await buildApp({ logger: false })
    await app.ready()
  })

  afterEach(async () => {
    await app?.close()
  })

  it('/healthz tetap hidup walau database tidak terjangkau', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'))

    const res = await app.inject({ method: 'GET', url: '/healthz' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })

  it('/readyz 200 dan melaporkan versi migration terakhir', async () => {
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join('').includes('_prisma_migrations')) {
        return migrationRow('20261013012414_staff_lifecycle_and_puskesma_crud')
      }
      return [{ '?column?': 1 }]
    })

    const { status, body } = await callReady(app)
    const report = body.data as unknown as {
      status: string
      migration: string | null
      queue: string
      checks: Record<string, string>
    }

    expect(status).toBe(200)
    expect(report.status).toBe('ok')
    expect(report.migration).toBe('20261013012414_staff_lifecycle_and_puskesma_crud')
    expect(report.checks).toEqual({ database: 'ok', migrations: 'ok', redis: 'disabled' })
    expect(report.queue).toBe('in-process')
  })

  it('/readyz 503 saat database tidak terjangkau', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'))

    const { status, body } = await callReady(app)
    const report = body.data as unknown as { checks: Record<string, string> }

    expect(status).toBe(503)
    expect(report.checks.database).toBe('degraded')
    expect(report.checks.migrations).toBe('degraded')
  })

  it('/readyz 503 saat tabel migration belum ada sama sekali', async () => {
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join('').includes('_prisma_migrations')) return []
      return [{ '?column?': 1 }]
    })

    const { status, body } = await callReady(app)
    const report = body.data as unknown as { status: string; migration: string | null }

    expect(status).toBe(503)
    expect(report.status).toBe('not_ready')
    expect(report.migration).toBeNull()
  })

  it('respons readiness tidak pernah memuat credential', async () => {
    process.env.REDIS_URL = 'rediss://user:rahasia@cache.example:6379'
    queryRaw.mockRejectedValue(new Error('rediss://user:rahasia@cache.example:6379 refused'))

    const res = await app.inject({ method: 'GET', url: '/readyz' })

    expect(res.statusCode).toBe(503)
    expect(res.body).not.toContain('rahasia')
  })
})
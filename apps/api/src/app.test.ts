// CL-004: memastikan setiap kelas error keluar sebagai { error: { code, message, details? } }.
import { beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import {
  alreadyProcessed,
  forbidden,
  invalidTransition,
  notFound,
  unauthorized,
} from './lib/errors'

let app: FastifyInstance

beforeAll(async () => {
  // env.ts memvalidasi process.env saat import — isi nilai minimal sebelum app dimuat.
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
  process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

  const { buildApp } = await import('./app')
  app = await buildApp({ logger: false })

  app.post('/test/zod', async (req) => {
    z.object({ scheduleId: z.string().uuid() }).parse(req.body)
    return { data: null }
  })
  app.get('/test/prisma-unique', async () => {
    throw new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['sourceMessageId'] },
    })
  })
  app.get('/test/prisma-missing', async () => {
    throw new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'test',
    })
  })
  app.get('/test/unauthorized', async () => {
    throw unauthorized()
  })
  app.get('/test/forbidden', async () => {
    throw forbidden()
  })
  app.get('/test/not-found', async () => {
    throw notFound('Schedule tidak ditemukan', { field: 'scheduleId' })
  })
  app.get('/test/conflict', async () => {
    throw alreadyProcessed()
  })
  app.get('/test/invalid-transition', async () => {
    throw invalidTransition('Eskalasi sudah selesai')
  })
  app.get('/test/state-machine', async () => {
    const err = new Error('Invalid escalation transition: RESOLVED + TIMEOUT')
    err.name = 'InvalidTransitionError'
    throw err
  })
  app.get('/test/boom', async () => {
    throw new Error('koneksi database gagal: password=rahasia')
  })

  await app.ready()
}, 60_000)

async function call(method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
  const res = await app.inject({ method, url, ...(payload ? { payload } : {}) })
  return { status: res.statusCode, body: res.json() as { error: { code: string; message: string; details?: unknown } } }
}

describe('error handler terpusat', () => {
  it('400 — Zod menjadi VALIDATION_ERROR dengan details per field', async () => {
    const { status, body } = await call('POST', '/test/zod', { scheduleId: 'bukan-uuid' })
    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details).toEqual([{ field: 'scheduleId', reason: expect.any(String) }])
  })

  it('401 dan 403 memakai kode yang stabil', async () => {
    expect(await call('GET', '/test/unauthorized')).toMatchObject({
      status: 401,
      body: { error: { code: 'UNAUTHORIZED' } },
    })
    expect(await call('GET', '/test/forbidden')).toMatchObject({
      status: 403,
      body: { error: { code: 'FORBIDDEN' } },
    })
  })

  it('404 — domain error dan route tak dikenal sama-sama NOT_FOUND', async () => {
    const domain = await call('GET', '/test/not-found')
    expect(domain.status).toBe(404)
    expect(domain.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Schedule tidak ditemukan',
      details: { field: 'scheduleId' },
    })

    const unknownRoute = await call('GET', '/tidak/ada')
    expect(unknownRoute.status).toBe(404)
    expect(unknownRoute.body.error.code).toBe('NOT_FOUND')
  })

  it('409 — duplikat domain maupun Prisma P2002 menjadi ALREADY_PROCESSED', async () => {
    expect(await call('GET', '/test/conflict')).toMatchObject({
      status: 409,
      body: { error: { code: 'ALREADY_PROCESSED' } },
    })

    const prismaDup = await call('GET', '/test/prisma-unique')
    expect(prismaDup.status).toBe(409)
    expect(prismaDup.body.error.code).toBe('ALREADY_PROCESSED')
    expect(prismaDup.body.error.details).toEqual({ target: ['sourceMessageId'] })
  })

  it('404 — Prisma P2025 menjadi NOT_FOUND', async () => {
    expect(await call('GET', '/test/prisma-missing')).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    })
  })

  it('422 — transisi state ilegal menjadi INVALID_TRANSITION', async () => {
    expect(await call('GET', '/test/invalid-transition')).toMatchObject({
      status: 422,
      body: { error: { code: 'INVALID_TRANSITION' } },
    })
    expect(await call('GET', '/test/state-machine')).toMatchObject({
      status: 422,
      body: { error: { code: 'INVALID_TRANSITION' } },
    })
  })

  it('500 — error tak terduga tidak membocorkan detail internal', async () => {
    const { status, body } = await call('GET', '/test/boom')
    expect(status).toBe(500)
    expect(body.error.code).toBe('INTERNAL_ERROR')
    expect(body.error.message).toBe('Terjadi kesalahan pada server')
    expect(JSON.stringify(body)).not.toContain('rahasia')
    expect(body.error.details).toBeUndefined()
  })

  it('route sehat tetap mengembalikan bentuk sukses', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })
})

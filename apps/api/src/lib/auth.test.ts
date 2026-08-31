// CL-008: preHandler authenticate + requireRole.
// Diuji lewat route sementara pada instance app sungguhan agar perilaku 401/403
// yang dilihat klien ikut terverifikasi lewat error handler terpusat.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims } from '@careloop/shared'
import { assertOwnPatientData, authenticate, getAuthUser, requireRole } from './auth'
import { ApiError } from './errors'

vi.mock('./prisma', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}))

let app: FastifyInstance

function token(claims: AuthUserClaims, expiresIn = 3600): string {
  return app.jwt.sign(claims, { expiresIn })
}

function auth(value: string): Record<string, string> {
  return { authorization: value }
}

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
  process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

  const { buildApp } = await import('../app')
  app = await buildApp({ logger: false })

  app.get('/test/me', { preHandler: authenticate }, async (req) => ({
    data: getAuthUser(req),
  }))
  app.get('/test/nakes', { preHandler: requireRole('NAKES', 'ADMIN') }, async () => ({
    data: { ok: true },
  }))
  app.get('/test/pasien', { preHandler: requireRole('PATIENT') }, async () => ({
    data: { ok: true },
  }))
  app.get(
    '/test/berlapis',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async () => ({ data: { ok: true } }),
  )

  await app.ready()
}, 60_000)

describe('authenticate', () => {
  it('token sah mengisi req.user dengan claim yang ditandatangani', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth(`Bearer ${token({ sub: 'u1', role: 'NAKES' })}`),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ sub: 'u1', role: 'NAKES' })
  })

  it('401 — tanpa header, skema salah, atau token sampah', async () => {
    const tanpaHeader = await app.inject({ method: 'GET', url: '/test/me' })
    expect(tanpaHeader.statusCode).toBe(401)
    expect(tanpaHeader.json().error.code).toBe('UNAUTHORIZED')

    const skemaSalah = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth(token({ sub: 'u1', role: 'NAKES' })),
    })
    expect(skemaSalah.statusCode).toBe(401)

    const sampah = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth('Bearer bukan.token.jwt'),
    })
    expect(sampah.statusCode).toBe(401)
  })

  it('401 — token yang ditandatangani secret lain ditolak', async () => {
    const { buildApp } = await import('../app')
    const lain = await buildApp({ logger: false, jwtSecret: 'secret-lain-minimal-32-karakter-xyz' })
    await lain.ready()
    const asing = lain.jwt.sign({ sub: 'u1', role: 'ADMIN' })

    const res = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth(`Bearer ${asing}`),
    })

    expect(res.statusCode).toBe(401)
    await lain.close()
  })

  it('401 — token kedaluwarsa ditolak', async () => {
    // exp diisi manual ke masa lalu: jsonwebtoken menolak expiresIn negatif.
    const payload = { sub: 'u1', role: 'NAKES', exp: Math.floor(Date.now() / 1000) - 10 }
    const kedaluwarsa = app.jwt.sign(payload as unknown as AuthUserClaims)

    const res = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth(`Bearer ${kedaluwarsa}`),
    })

    expect(res.statusCode).toBe(401)
  })

  it('pesan 401 tidak membocorkan alasan teknis kegagalan', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: auth('Bearer bukan.token.jwt'),
    })

    expect(res.json().error.message).toBe('Token tidak valid atau kedaluwarsa')
    expect(res.body.toLowerCase()).not.toContain('jwt malformed')
    expect(res.body.toLowerCase()).not.toContain('signature')
  })
})

describe('requireRole', () => {
  it('role yang diizinkan diteruskan', async () => {
    for (const role of ['NAKES', 'ADMIN'] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/test/nakes',
        headers: auth(`Bearer ${token({ sub: 'u1', role })}`),
      })
      expect(res.statusCode).toBe(200)
    }
  })

  it('403 — role di luar daftar ditolak walau tokennya sah', async () => {
    for (const role of ['PATIENT', 'FAMILY'] as const) {
      const res = await app.inject({
        method: 'GET',
        url: '/test/nakes',
        headers: auth(`Bearer ${token({ sub: 'u1', role })}`),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe('FORBIDDEN')
    }
  })

  it('401 mendahului 403 — tanpa token, role tidak sempat diperiksa', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/nakes' })

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })

  it('cukup satu preHandler — requireRole ikut memverifikasi token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/pasien',
      headers: auth(`Bearer ${token({ sub: 'u1', role: 'PATIENT' })}`),
    })

    expect(res.statusCode).toBe(200)
  })

  it('dipasang berlapis bersama authenticate tetap berperilaku sama', async () => {
    const admin = await app.inject({
      method: 'GET',
      url: '/test/berlapis',
      headers: auth(`Bearer ${token({ sub: 'u1', role: 'ADMIN' })}`),
    })
    expect(admin.statusCode).toBe(200)

    const nakes = await app.inject({
      method: 'GET',
      url: '/test/berlapis',
      headers: auth(`Bearer ${token({ sub: 'u1', role: 'NAKES' })}`),
    })
    expect(nakes.statusCode).toBe(403)
  })
})

describe('assertOwnPatientData', () => {
  it('pasien boleh mengakses datanya sendiri', () => {
    expect(() => assertOwnPatientData({ sub: 'u1', role: 'PATIENT' }, 'u1')).not.toThrow()
  })

  it('pasien lain ditolak 403', () => {
    try {
      assertOwnPatientData({ sub: 'u1', role: 'PATIENT' }, 'u2')
      throw new Error('Diharapkan ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(403)
    }
  })

  it('nakes, keluarga, dan admin diteruskan ke pengecekan scope domain', () => {
    for (const role of ['NAKES', 'FAMILY', 'ADMIN'] as const) {
      expect(() => assertOwnPatientData({ sub: 'u1', role }, 'u2')).not.toThrow()
    }
  })
})

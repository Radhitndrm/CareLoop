// CL-006: login nakes/admin — kata sandi bcrypt + JWT.
// Logika diuji lewat dependency palsu; route diuji dengan Prisma di-mock agar
// suite tetap jalan tanpa database (docs/TESTING.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims } from '@careloop/shared'
import { ApiError } from '../../lib/errors'
import { hashPassword, verifyPassword } from '../../lib/password'
import {
  expiresInSeconds,
  loginWithPassword,
  type AuthUserRecord,
  type LoginDeps,
} from './auth.service'

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}))

const PASSWORD = 'RahasiaNakes123'
let passwordHash: string

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD)
}, 30_000)

function nakes(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    fullName: 'dr. Dewi Lestari',
    role: 'NAKES',
    passwordHash,
    isActive: true,
    isVerified: true,
    ...overrides,
  }
}

function depsFor(user: AuthUserRecord | null): LoginDeps & { signed: AuthUserClaims[] } {
  const signed: AuthUserClaims[] = []
  return {
    signed,
    findUser: async () => user,
    signToken: (claims) => {
      signed.push(claims)
      return 'signed.jwt.token'
    },
  }
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('Diharapkan ApiError, tetapi promise berhasil')
}

describe('hashing kata sandi', () => {
  it('hash memakai bcrypt cost 12 dan bisa diverifikasi ulang', async () => {
    expect(passwordHash).toMatch(/^\$2[aby]\$12\$/)
    await expect(verifyPassword(PASSWORD, passwordHash)).resolves.toBe(true)
  })

  it('kata sandi salah dan akun tanpa hash sama-sama false', async () => {
    await expect(verifyPassword('SalahSemua123', passwordHash)).resolves.toBe(false)
    await expect(verifyPassword(PASSWORD, null)).resolves.toBe(false)
    await expect(verifyPassword(PASSWORD, '')).resolves.toBe(false)
  })
})

describe('expiresInSeconds', () => {
  it('menerima angka polos dan satuan s/m/h/d', () => {
    expect(expiresInSeconds('900')).toBe(900)
    expect(expiresInSeconds('30s')).toBe(30)
    expect(expiresInSeconds('15m')).toBe(900)
    expect(expiresInSeconds('24h')).toBe(86_400)
    expect(expiresInSeconds('7d')).toBe(604_800)
  })

  it('menolak format yang tidak dikenal supaya startup gagal cepat', () => {
    expect(() => expiresInSeconds('24 jam')).toThrow(/JWT_EXPIRES_IN tidak valid/)
    expect(() => expiresInSeconds('1w')).toThrow(/JWT_EXPIRES_IN tidak valid/)
    expect(() => expiresInSeconds('')).toThrow(/JWT_EXPIRES_IN tidak valid/)
  })
})

describe('loginWithPassword', () => {
  it('kredensial benar mengembalikan token, masa berlaku, dan profil ringkas', async () => {
    const deps = depsFor(nakes())
    const session = await loginWithPassword(
      deps,
      { phone: '081100000001', password: PASSWORD },
      86_400,
    )

    expect(session).toEqual({
      accessToken: 'signed.jwt.token',
      expiresIn: 86_400,
      user: {
        id: '00000000-0000-4000-8000-000000000002',
        role: 'NAKES',
        fullName: 'dr. Dewi Lestari',
        isVerified: true,
      },
    })
  })

  it('claim JWT hanya berisi sub dan role — tanpa data pribadi', async () => {
    const deps = depsFor(nakes())
    await loginWithPassword(deps, { phone: '081100000001', password: PASSWORD }, 3600)

    expect(deps.signed).toEqual([{ sub: '00000000-0000-4000-8000-000000000002', role: 'NAKES' }])
  })

  it('kata sandi salah dan akun tidak ada memberi pesan 401 yang identik', async () => {
    const salah = await expectApiError(
      loginWithPassword(
        depsFor(nakes()),
        { phone: '081100000001', password: 'SalahSemua123' },
        3600,
      ),
    )
    const tidakAda = await expectApiError(
      loginWithPassword(depsFor(null), { phone: '081999999999', password: PASSWORD }, 3600),
    )

    expect(salah.statusCode).toBe(401)
    expect(salah.code).toBe('UNAUTHORIZED')
    // Pesan wajib sama persis: beda sedikit pun membocorkan nomor mana yang terdaftar.
    expect(tidakAda.message).toBe(salah.message)
    expect(salah.message).toBe('Nomor/email atau kata sandi salah')
  })

  it('pasien dengan kata sandi benar tetap ditolak 401 tanpa membocorkan role', async () => {
    const err = await expectApiError(
      loginWithPassword(
        depsFor(nakes({ role: 'PATIENT' })),
        { phone: '081200000001', password: PASSWORD },
        3600,
      ),
    )

    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Nomor/email atau kata sandi salah')
  })

  it('admin boleh login lewat jalur yang sama', async () => {
    const deps = depsFor(nakes({ role: 'ADMIN' }))
    const session = await loginWithPassword(
      deps,
      { email: 'admin@careloop.id', password: PASSWORD },
      3600,
    )

    expect(session.user.role).toBe('ADMIN')
  })

  it('akun tanpa passwordHash (pengguna OTP) ditolak 401', async () => {
    const err = await expectApiError(
      loginWithPassword(
        depsFor(nakes({ passwordHash: null })),
        { phone: '081100000001', password: PASSWORD },
        3600,
      ),
    )

    expect(err.statusCode).toBe(401)
  })

  it('akun nonaktif ditolak 403 setelah kata sandinya terbukti benar', async () => {
    const err = await expectApiError(
      loginWithPassword(
        depsFor(nakes({ isActive: false })),
        { phone: '081100000001', password: PASSWORD },
        3600,
      ),
    )

    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('FORBIDDEN')
  })
})

describe('POST /v1/auth/login', () => {
  let app: FastifyInstance
  let findFirst: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { prisma } = await import('../../lib/prisma')
    findFirst = prisma.user.findFirst as unknown as ReturnType<typeof vi.fn>

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })
    await app.ready()
  }, 60_000)

  beforeEach(() => {
    findFirst.mockReset()
  })

  it('200 — mengembalikan envelope { data } dan token yang bisa diverifikasi', async () => {
    findFirst.mockResolvedValue(nakes())

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081100000001', password: PASSWORD },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      data: { accessToken: string; expiresIn: number; user: { role: string } }
    }
    expect(body.data.user.role).toBe('NAKES')
    expect(body.data.expiresIn).toBeGreaterThan(0)

    const claims = app.jwt.verify<AuthUserClaims & { exp: number }>(body.data.accessToken)
    expect(claims.sub).toBe('00000000-0000-4000-8000-000000000002')
    expect(claims.role).toBe('NAKES')
  })

  it('mencari user via kolom yang sesuai — phone atau email', async () => {
    findFirst.mockResolvedValue(nakes())
    await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081100000001', password: PASSWORD },
    })
    expect(findFirst.mock.calls[0][0].where).toEqual({ phone: '081100000001' })

    findFirst.mockResolvedValue(nakes({ role: 'ADMIN' }))
    await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'dewi@puskesmas.id', password: PASSWORD },
    })
    expect(findFirst.mock.calls[1][0].where).toEqual({ email: 'dewi@puskesmas.id' })
  })

  it('401 — kredensial salah memakai envelope error terpusat', async () => {
    findFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081999999999', password: PASSWORD },
    })

    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Nomor/email atau kata sandi salah' },
    })
  })

  it('400 — body tidak valid ditolak zod sebelum menyentuh database', async () => {
    const kosong = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {} })
    expect(kosong.statusCode).toBe(400)
    expect(kosong.json().error.code).toBe('VALIDATION_ERROR')

    const pendek = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081100000001', password: 'pendek' },
    })
    expect(pendek.statusCode).toBe(400)

    const keduanya = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081100000001', email: 'dewi@puskesmas.id', password: PASSWORD },
    })
    expect(keduanya.statusCode).toBe(400)

    expect(findFirst).not.toHaveBeenCalled()
  })

  it('tidak pernah membocorkan hash kata sandi ke respons', async () => {
    findFirst.mockResolvedValue(nakes())

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { phone: '081100000001', password: PASSWORD },
    })

    expect(res.body).not.toContain('$2')
    expect(res.body).not.toContain(PASSWORD)
  })
})

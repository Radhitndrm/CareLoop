// CL-007: OTP mock untuk login pasien & keluarga.
// Waktu dikendalikan lewat deps.now() sehingga kedaluwarsa dan cooldown bisa diuji
// tanpa timer nyata (docs/TESTING.md).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AuthUserClaims } from '@careloop/shared'
import { ApiError } from '../../lib/errors'
import type { AuthUserRecord } from './auth.service'
import {
  InMemoryOtpStore,
  generateOtpCode,
  requestOtp,
  verifyOtp,
  type OtpConfig,
  type OtpDeps,
} from './otp.service'

vi.mock('../../lib/prisma', () => ({
  prisma: { user: { findFirst: vi.fn() } },
}))

const PHONE = '081200000001'
const MOCK_CODE = '123456'

const CONFIG: OtpConfig = { ttlSec: 300, cooldownSec: 30, maxAttempts: 5, mockCode: MOCK_CODE }

function patient(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    fullName: 'Bu Ratna',
    role: 'PATIENT',
    passwordHash: null,
    isActive: true,
    isVerified: true,
    ...overrides,
  }
}

interface Harness extends OtpDeps {
  signed: AuthUserClaims[]
  advance(seconds: number): void
}

function harness(user: AuthUserRecord | null = patient()): Harness {
  let clock = 1_700_000_000_000
  const signed: AuthUserClaims[] = []

  return {
    store: new InMemoryOtpStore(),
    signed,
    now: () => clock,
    advance: (seconds) => {
      clock += seconds * 1000
    },
    findUser: async () => user,
    signToken: (claims) => {
      signed.push(claims)
      return 'signed.jwt.token'
    },
    randomCode: () => '999999',
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

describe('generateOtpCode', () => {
  it('selalu 6 digit termasuk saat angkanya kecil', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/)
    }
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(generateOtpCode()).toBe('000000')
    vi.spyOn(Math, 'random').mockReturnValue(0.999999)
    expect(generateOtpCode()).toMatch(/^\d{6}$/)
    vi.restoreAllMocks()
  })
})

describe('requestOtp', () => {
  it('mengembalikan masa berlaku dan jeda kirim ulang tanpa membocorkan kode', async () => {
    const deps = harness()
    const challenge = await requestOtp(deps, CONFIG, PHONE)

    expect(challenge.retryAfterSec).toBe(30)
    expect(new Date(challenge.otpExpiresAt).getTime()).toBe(deps.now() + 300_000)
    expect(JSON.stringify(challenge)).not.toContain(MOCK_CODE)
  })

  it('permintaan kedua dalam masa cooldown ditolak 429 beserta sisa detik', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)
    deps.advance(10)

    const err = await expectApiError(requestOtp(deps, CONFIG, PHONE))
    expect(err.statusCode).toBe(429)
    expect(err.code).toBe('RATE_LIMITED')
    expect(err.details).toEqual({ retryAfterSec: 20 })
  })

  it('setelah cooldown lewat, kode baru boleh diminta', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)
    deps.advance(30)

    await expect(requestOtp(deps, CONFIG, PHONE)).resolves.toMatchObject({ retryAfterSec: 30 })
  })

  it('nomor tak terdaftar memberi respons yang tidak bisa dibedakan', async () => {
    const terdaftar = await requestOtp(harness(), CONFIG, PHONE)
    const asing = await requestOtp(harness(null), CONFIG, '081299999999')

    expect(Object.keys(asing)).toEqual(Object.keys(terdaftar))
    expect(asing.retryAfterSec).toBe(terdaftar.retryAfterSec)
  })

  it('memakai kode acak saat mockCode tidak disetel (PROVIDER_MODE=live)', async () => {
    const deps = harness()
    await requestOtp(deps, { ...CONFIG, mockCode: null }, PHONE)

    await expect(verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600)).rejects.toThrow()
    await expect(verifyOtp(deps, { phone: PHONE, otp: '999999' }, 3600)).resolves.toMatchObject({
      expiresIn: 3600,
    })
  })
})

describe('verifyOtp — penandaan verifikasi', () => {
  it('menandai nomor sebagai terverifikasi setelah kode cocok', async () => {
    const marked: string[] = []
    const deps = {
      store: new InMemoryOtpStore(),
      now: () => 1_000,
      findUser: async () => ({
        id: 'user-1',
        fullName: 'Bu Ratna',
        role: 'PATIENT' as const,
        passwordHash: null,
        isActive: true,
        isVerified: false,
      }),
      signToken: () => 'token',
      randomCode: () => '123456',
      markVerified: async (id: string) => {
        marked.push(id)
      },
    }

    await deps.store.set('081200000001', {
      code: '123456',
      expiresAtMs: 10_000,
      issuedAtMs: 1_000,
      attemptsLeft: 3,
    })

    const session = await verifyOtp(deps, { phone: '081200000001', otp: '123456' }, 3600)

    expect(marked).toEqual(['user-1'])
    expect(session.user.isVerified).toBe(true)
  })

  it('TIDAK menandai terverifikasi saat kode salah', async () => {
    const marked: string[] = []
    const deps = {
      store: new InMemoryOtpStore(),
      now: () => 1_000,
      findUser: async () => ({
        id: 'user-1',
        fullName: 'Bu Ratna',
        role: 'PATIENT' as const,
        passwordHash: null,
        isActive: true,
        isVerified: false,
      }),
      signToken: () => 'token',
      randomCode: () => '123456',
      markVerified: async (id: string) => {
        marked.push(id)
      },
    }

    await deps.store.set('081200000001', {
      code: '123456',
      expiresAtMs: 10_000,
      issuedAtMs: 1_000,
      attemptsLeft: 3,
    })

    await expect(verifyOtp(deps, { phone: '081200000001', otp: '000000' }, 3600)).rejects.toThrow()
    expect(marked).toEqual([])
  })
})

describe('verifyOtp', () => {
  it('kode benar mengembalikan token dan profil pasien', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)

    const session = await verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 86_400)

    expect(session).toEqual({
      accessToken: 'signed.jwt.token',
      expiresIn: 86_400,
      user: {
        id: '00000000-0000-4000-8000-000000000003',
        role: 'PATIENT',
        fullName: 'Bu Ratna',
        isVerified: true,
      },
    })
    expect(deps.signed).toEqual([{ sub: '00000000-0000-4000-8000-000000000003', role: 'PATIENT' }])
  })

  it('kode sekali pakai — verifikasi kedua dengan kode sama ditolak', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)
    await verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600)

    const err = await expectApiError(verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600))
    expect(err.statusCode).toBe(401)
  })

  it('kode kedaluwarsa setelah TTL lewat', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)
    deps.advance(301)

    const err = await expectApiError(verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600))
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Kode OTP salah atau sudah kedaluwarsa')
  })

  it('percobaan dibatasi maxAttempts — kode benar pun ditolak setelah jatah habis', async () => {
    const deps = harness()
    await requestOtp(deps, CONFIG, PHONE)

    for (let i = 0; i < CONFIG.maxAttempts; i += 1) {
      await expectApiError(verifyOtp(deps, { phone: PHONE, otp: '000000' }, 3600))
    }

    const err = await expectApiError(verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600))
    expect(err.statusCode).toBe(401)
  })

  it('verifikasi tanpa permintaan OTP lebih dulu ditolak', async () => {
    const err = await expectApiError(verifyOtp(harness(), { phone: PHONE, otp: MOCK_CODE }, 3600))
    expect(err.statusCode).toBe(401)
  })

  it('nomor tak terdaftar tidak pernah cocok walau menebak kode mock', async () => {
    const deps = harness(null)
    await requestOtp(deps, CONFIG, '081299999999')

    const err = await expectApiError(
      verifyOtp(deps, { phone: '081299999999', otp: MOCK_CODE }, 3600),
    )
    expect(err.statusCode).toBe(401)
  })

  it('nakes ditolak lewat jalur OTP — mereka memakai kata sandi', async () => {
    const deps = harness(patient({ role: 'NAKES' }))
    await requestOtp(deps, CONFIG, '081100000001')

    const err = await expectApiError(
      verifyOtp(deps, { phone: '081100000001', otp: MOCK_CODE }, 3600),
    )
    expect(err.statusCode).toBe(401)
  })

  it('keluarga boleh login lewat OTP', async () => {
    const deps = harness(patient({ role: 'FAMILY', fullName: 'Ari' }))
    await requestOtp(deps, CONFIG, '081300000001')

    const session = await verifyOtp(deps, { phone: '081300000001', otp: MOCK_CODE }, 3600)
    expect(session.user.role).toBe('FAMILY')
  })

  it('akun nonaktif ditolak', async () => {
    const deps = harness(patient({ isActive: false }))
    await requestOtp(deps, CONFIG, PHONE)

    const err = await expectApiError(verifyOtp(deps, { phone: PHONE, otp: MOCK_CODE }, 3600))
    expect(err.statusCode).toBe(401)
  })
})

describe('route OTP', () => {
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

  it('alur penuh: request lalu verify menghasilkan token yang sah', async () => {
    findFirst.mockResolvedValue(patient())

    const minta = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: PHONE },
    })
    expect(minta.statusCode).toBe(200)
    expect(minta.json().data).toHaveProperty('otpExpiresAt')
    expect(minta.body).not.toContain(MOCK_CODE)

    const verif = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: PHONE, otp: MOCK_CODE },
    })
    expect(verif.statusCode).toBe(200)

    const body = verif.json() as { data: { accessToken: string } }
    const claims = app.jwt.verify<AuthUserClaims>(body.data.accessToken)
    expect(claims.role).toBe('PATIENT')
  })

  it('400 — nomor dan kode divalidasi zod', async () => {
    const nomorSalah = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '12345' },
    })
    expect(nomorSalah.statusCode).toBe(400)
    expect(nomorSalah.json().error.code).toBe('VALIDATION_ERROR')

    const kodeSalah = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: PHONE, otp: '12ab' },
    })
    expect(kodeSalah.statusCode).toBe(400)
  })

  it('429 — permintaan beruntun untuk nomor yang sama dibatasi', async () => {
    findFirst.mockResolvedValue(patient())
    const nomor = '081200000009'

    await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: nomor } })
    const kedua = await app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: nomor },
    })

    expect(kedua.statusCode).toBe(429)
    expect(kedua.json().error.code).toBe('RATE_LIMITED')
  })
})

import type { FastifyInstance } from 'fastify'
import { nakesLoginSchema, otpRequestSchema, otpVerifySchema } from '@careloop/shared'
import type { AuthUserClaims } from '@careloop/shared'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { expiresInSeconds, loginWithPassword, type LoginDeps } from './auth.service'
import {
  InMemoryOtpStore,
  generateOtpCode,
  requestOtp,
  verifyOtp,
  type OtpConfig,
  type OtpDeps,
} from './otp.service'

const USER_FIELDS = {
  id: true,
  fullName: true,
  role: true,
  passwordHash: true,
  isActive: true,
  isVerified: true,
} as const

export function registerAuthRoutes(app: FastifyInstance): void {
  const env = getEnv()

  // Dihitung sekali saat registrasi: JWT_EXPIRES_IN yang salah format menggagalkan
  // startup, bukan menggagalkan setiap permintaan login.
  const expiresIn = expiresInSeconds(env.JWT_EXPIRES_IN)

  const signToken = (claims: AuthUserClaims, expiresInSec: number): string =>
    app.jwt.sign(claims, { expiresIn: expiresInSec })

  const loginDeps: LoginDeps = {
    findUser: ({ phone, email }) =>
      prisma.user.findFirst({ where: phone ? { phone } : { email }, select: USER_FIELDS }),
    signToken,
  }

  const otpConfig: OtpConfig = {
    ttlSec: env.OTP_TTL_SEC,
    cooldownSec: env.OTP_RESEND_COOLDOWN_SEC,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    mockCode: env.PROVIDER_MODE === 'mock' ? env.OTP_MOCK_CODE : null,
  }

  const otpDeps: OtpDeps = {
    store: new InMemoryOtpStore(),
    now: () => Date.now(),
    findUser: (phone) => prisma.user.findFirst({ where: { phone }, select: USER_FIELDS }),
    signToken,
    randomCode: generateOtpCode,
  }

  app.get('/v1/auth/status', async () => {
    return { data: { status: 'ok', service: 'careloop-api' } }
  })

  // POST /v1/auth/login — nakes & admin (docs/API.md §2). Pasien lewat OTP di bawah.
  app.post('/v1/auth/login', async (req) => {
    const input = nakesLoginSchema.parse(req.body)
    return { data: await loginWithPassword(loginDeps, input, expiresIn) }
  })

  // POST /v1/auth/otp/request — pasien & keluarga. Pengiriman kode lewat WhatsApp
  // menyusul di CL-101; saat PROVIDER_MODE=mock kodenya tetap OTP_MOCK_CODE.
  app.post('/v1/auth/otp/request', async (req) => {
    const { phone } = otpRequestSchema.parse(req.body)
    return { data: await requestOtp(otpDeps, otpConfig, phone) }
  })

  app.post('/v1/auth/otp/verify', async (req) => {
    const input = otpVerifySchema.parse(req.body)
    return { data: await verifyOtp(otpDeps, input, expiresIn) }
  })
}

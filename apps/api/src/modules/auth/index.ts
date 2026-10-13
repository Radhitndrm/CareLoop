import type { FastifyInstance } from 'fastify'
import {
  nakesLoginSchema,
  otpRequestSchema,
  otpVerifySchema,
  staffActivationSchema,
} from '@careloop/shared'
import type { AuthUserClaims } from '@careloop/shared'
import { getEnv } from '../../lib/env'
import { prisma } from '../../lib/prisma'
import { expiresInSeconds, loginWithPassword, type LoginDeps } from './auth.service'
import { activateStaff, type StaffClient } from '../admin/admin.service'
import {
  generateOtpCode,
  getOtpConfig,
  getOtpStore,
  requestOtp,
  verifyOtp,
  type OtpConfig,
  type OtpDeps,
} from './otp.service'

const USER_FIELDS = {
  id: true,
  fullName: true,
  role: true,
  // Wajib dipilih: tanpa nakesRole di sini, JWT tidak membawa peran klinis dan
  // gerbang persetujuan dokter akan menolak semua orang (docs/API.md §3.2).
  nakesRole: true,
  // Staff lifecycle hanya untuk akun nakes; null untuk admin & pasien.
  staffStatus: true,
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

  const otpConfig: OtpConfig = getOtpConfig()

  const otpDeps: OtpDeps = {
    store: getOtpStore(),
    now: () => Date.now(),
    findUser: (phone) => prisma.user.findFirst({ where: { phone }, select: USER_FIELDS }),
    markVerified: (userId) =>
      prisma.user
        .update({ where: { id: userId }, data: { isVerified: true }, select: { id: true } })
        .then(() => undefined),
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

  // POST /v1/auth/activate — staf yang diundang menukar kode aktivasi dengan kata sandi.
  // Terbuka tanpa token memang belum ada akun aktif untuk dia; kode itulah bukti
  // kepemilikan akun, dan kode hanya bisa dibuat admin.
  app.post('/v1/auth/activate', async (req) => {
    const input = staffActivationSchema.parse(req.body)
    const data = await activateStaff(prisma as unknown as StaffClient, input)
    return { data }
  })
}

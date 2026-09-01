// CL-006: login nakes/admin berbasis kata sandi.
// Logika sengaja dipisah dari route dan menerima dependency (pencarian user +
// penandatangan token) agar bisa diuji tanpa database maupun instance Fastify.
import type { AuthSession, AuthUserClaims, NakesLoginInput, UserRole } from '@careloop/shared'
import { forbidden, unauthorized } from '../../lib/errors'
import { verifyPassword } from '../../lib/password'

/** Hanya nakes & admin yang punya kata sandi. Pasien/keluarga memakai OTP (CL-007). */
export const PASSWORD_LOGIN_ROLES: readonly UserRole[] = ['NAKES', 'ADMIN']

/** Pesan tunggal untuk semua kegagalan kredensial — jangan bocorkan mana yang salah. */
const INVALID_CREDENTIALS = 'Nomor/email atau kata sandi salah'

export interface AuthUserRecord {
  id: string
  fullName: string
  role: UserRole
  passwordHash: string | null
  isActive: boolean
  isVerified: boolean
}

export interface LoginDeps {
  findUser(identifier: { phone?: string; email?: string }): Promise<AuthUserRecord | null>
  signToken(claims: AuthUserClaims, expiresInSec: number): string
}

const DURATION_UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

/**
 * Terjemahkan JWT_EXPIRES_IN ("24h", "900", "15m", "7d") menjadi detik.
 * Dipanggil sekali saat route didaftarkan, sehingga nilai yang salah menggagalkan
 * startup — bukan menggagalkan login satu per satu.
 */
export function expiresInSeconds(spec: string): number {
  const match = /^(\d+)([smhd])?$/.exec(spec.trim())
  if (!match) {
    throw new Error(`JWT_EXPIRES_IN tidak valid: "${spec}". Contoh yang benar: 900, 15m, 24h, 7d`)
  }
  const amount = Number(match[1])
  const unit = match[2] ?? 's'
  return amount * DURATION_UNIT_SECONDS[unit]
}

export async function loginWithPassword(
  deps: LoginDeps,
  input: NakesLoginInput,
  expiresInSec: number,
): Promise<AuthSession> {
  const user = await deps.findUser({ phone: input.phone, email: input.email })

  // Verifikasi tetap dijalankan walau user tidak ada (verifyPassword memakai hash
  // pembanding) supaya durasi respons tidak membedakan akun terdaftar dan tidak.
  const passwordMatched = await verifyPassword(input.password, user?.passwordHash)

  if (!user || !passwordMatched) {
    throw unauthorized(INVALID_CREDENTIALS)
  }

  // Pasien/keluarga yang mencoba jalur kata sandi diperlakukan sama dengan kredensial
  // salah — keberadaan akunnya tidak dikonfirmasi.
  if (!PASSWORD_LOGIN_ROLES.includes(user.role)) {
    throw unauthorized(INVALID_CREDENTIALS)
  }

  if (!user.isActive) {
    throw forbidden('Akun Anda dinonaktifkan. Hubungi admin puskesmas.')
  }

  const claims: AuthUserClaims = { sub: user.id, role: user.role }

  return {
    accessToken: deps.signToken(claims, expiresInSec),
    expiresIn: expiresInSec,
    user: {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      isVerified: user.isVerified,
    },
  }
}

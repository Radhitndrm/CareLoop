import type { NakesRole, UserRole } from '../enums'

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface ApiResponse<T> {
  data: T
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}

export interface AuthUserClaims {
  sub: string
  role: UserRole
  /**
   * Peran klinis untuk akun NAKES. Menggantikan pengecekan berbasis nama/heuristik:
   * kewenangan menyetujui resep & ambang detak jantung dibaca dari sini
   * (docs/API.md §3.2). Mengikuti masa berlaku token, jadi perubahan peran baru
   * berlaku setelah nakes login ulang.
   */
  nakesRole?: NakesRole
  patientId?: string
  scope?: string
}

/** Profil ringkas yang ikut dikembalikan setelah login/verifikasi OTP (docs/API.md §2). */
export interface AuthSessionUser {
  id: string
  role: UserRole
  nakesRole?: NakesRole
  fullName: string
  isVerified: boolean
}

export interface AuthSession {
  accessToken: string
  /** Masa berlaku token dalam detik. */
  expiresIn: number
  user: AuthSessionUser
}

/** Respons permintaan OTP — kode tidak pernah ikut dikirim (docs/API.md §2). */
export interface OtpChallenge {
  otpExpiresAt: string
  retryAfterSec: number
}

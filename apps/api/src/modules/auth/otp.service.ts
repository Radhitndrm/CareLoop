// CL-007: login OTP pasien & keluarga (mock).
// Kode disimpan di memori proses — cukup untuk demo satu instance, tetapi hilang saat
// restart dan tidak dibagi antar replika. Pemindahan ke Redis dilakukan di CL-401.
import type { AuthSession, AuthUserClaims, OtpChallenge, UserRole } from '@careloop/shared'
import { rateLimited, unauthorized } from '../../lib/errors'
import type { AuthUserRecord } from './auth.service'

/** Hanya pasien & keluarga yang login lewat OTP. Nakes/admin memakai kata sandi (CL-006). */
export const OTP_LOGIN_ROLES: readonly UserRole[] = ['PATIENT', 'FAMILY']

/** Pesan tunggal untuk semua kegagalan verifikasi — jangan bocorkan penyebabnya. */
const INVALID_OTP = 'Kode OTP salah atau sudah kedaluwarsa'

export interface OtpRecord {
  /** null = nomor tidak terdaftar; challenge tetap dibuat agar respons tak bisa dibedakan. */
  code: string | null
  expiresAtMs: number
  issuedAtMs: number
  attemptsLeft: number
}

export interface OtpStore {
  get(phone: string): OtpRecord | undefined
  set(phone: string, record: OtpRecord): void
  delete(phone: string): void
}

export class InMemoryOtpStore implements OtpStore {
  private readonly records = new Map<string, OtpRecord>()

  get(phone: string): OtpRecord | undefined {
    return this.records.get(phone)
  }

  set(phone: string, record: OtpRecord): void {
    this.evictExpired(record.issuedAtMs)
    this.records.set(phone, record)
  }

  delete(phone: string): void {
    this.records.delete(phone)
  }

  /** Dibersihkan saat ada penulisan baru agar Map tidak tumbuh tanpa batas. */
  private evictExpired(nowMs: number): void {
    for (const [phone, record] of this.records) {
      if (record.expiresAtMs <= nowMs) this.records.delete(phone)
    }
  }
}

export interface OtpConfig {
  ttlSec: number
  cooldownSec: number
  maxAttempts: number
  /** Kode tetap saat PROVIDER_MODE=mock; null berarti kode dibangkitkan acak. */
  mockCode: string | null
}

export interface OtpDeps {
  store: OtpStore
  now(): number
  findUser(phone: string): Promise<AuthUserRecord | null>
  signToken(claims: AuthUserClaims, expiresInSec: number): string
  randomCode(): string
}

export function generateOtpCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
}

/**
 * Terbitkan OTP untuk sebuah nomor. Respons selalu sama bentuknya, baik nomornya
 * terdaftar maupun tidak, supaya endpoint ini tidak bisa dipakai memetakan pengguna.
 */
export async function requestOtp(
  deps: OtpDeps,
  config: OtpConfig,
  phone: string,
): Promise<OtpChallenge> {
  const nowMs = deps.now()
  const existing = deps.store.get(phone)

  if (existing) {
    const elapsedSec = Math.floor((nowMs - existing.issuedAtMs) / 1000)
    const remaining = config.cooldownSec - elapsedSec
    if (remaining > 0) {
      throw rateLimited(`Tunggu ${remaining} detik sebelum meminta kode baru`, {
        retryAfterSec: remaining,
      })
    }
  }

  const user = await deps.findUser(phone)
  const eligible = user !== null && user.isActive && OTP_LOGIN_ROLES.includes(user.role)

  deps.store.set(phone, {
    code: eligible ? (config.mockCode ?? deps.randomCode()) : null,
    expiresAtMs: nowMs + config.ttlSec * 1000,
    issuedAtMs: nowMs,
    attemptsLeft: config.maxAttempts,
  })

  return {
    otpExpiresAt: new Date(nowMs + config.ttlSec * 1000).toISOString(),
    retryAfterSec: config.cooldownSec,
  }
}

export async function verifyOtp(
  deps: OtpDeps,
  input: { phone: string; otp: string },
  expiresInSec: number,
): Promise<AuthSession> {
  const record = deps.store.get(input.phone)
  const nowMs = deps.now()

  if (!record || record.expiresAtMs <= nowMs || record.attemptsLeft <= 0) {
    deps.store.delete(input.phone)
    throw unauthorized(INVALID_OTP)
  }

  if (record.code === null || record.code !== input.otp) {
    // Percobaan dikurangi lebih dulu supaya brute force tetap terbatas walau kodenya benar.
    deps.store.set(input.phone, { ...record, attemptsLeft: record.attemptsLeft - 1 })
    throw unauthorized(INVALID_OTP)
  }

  const user = await deps.findUser(input.phone)
  if (!user || !user.isActive || !OTP_LOGIN_ROLES.includes(user.role)) {
    deps.store.delete(input.phone)
    throw unauthorized(INVALID_OTP)
  }

  // Kode sekali pakai: hapus sebelum token diterbitkan.
  deps.store.delete(input.phone)

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

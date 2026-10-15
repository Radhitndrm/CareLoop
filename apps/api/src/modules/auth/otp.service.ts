// CL-007: login OTP pasien & keluarga (mock).
// Kode disimpan lewat `OtpStore` yang bisa persisten: `RedisOtpStore` untuk
// cloud/multi-instance (lihat otp.store.ts) dan `InMemoryOtpStore` untuk dev &
// unit test. Anti-enumeration tetap sama apa pun backing store-nya.
import type { AuthSession, AuthUserClaims, OtpChallenge, UserRole } from '@careloop/shared'
import { rateLimited, unauthorized } from '../../lib/errors'
import { getEnv } from '../../lib/env'
import { createOtpStore, type OtpRecord, type OtpStore } from './otp.store'
import type { AuthUserRecord } from './auth.service'

/** Hanya pasien & keluarga yang login lewat OTP. Nakes/admin memakai kata sandi (CL-006). */
export const OTP_LOGIN_ROLES: readonly UserRole[] = ['PATIENT', 'FAMILY']

/** Pesan tunggal untuk semua kegagalan verifikasi — jangan bocorkan penyebabnya. */
const INVALID_OTP = 'Kode OTP salah atau sudah kedaluwarsa'

// Re-export supaya pemanggil lama (route, test, modul lain) tetap cukup satu import.
export { InMemoryOtpStore, RedisOtpStore, createOtpStore } from './otp.store'
export type { OtpRecord, OtpStore } from './otp.store'

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
  /**
   * Tandai nomor sudah terverifikasi. Opsional agar unit test lama tidak harus
   * menyediakan callback.
   *
   * WAJIB ada di produksi: tanpa ini `users.is_verified` tidak pernah naik, dan karena
   * itu prasyarat aktivasi `VERIFIED` tidak akan pernah terpenuhi — pasien yang OTP-nya
   * berhasil tidak akan pernah bisa diaktifkan.
   */
  markVerified?(userId: string): Promise<void>
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
  const existing = await deps.store.get(phone)

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

  await deps.store.set(phone, {
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
  const record = await deps.store.get(input.phone)
  const nowMs = deps.now()

  if (!record || record.expiresAtMs <= nowMs || record.attemptsLeft <= 0) {
    await deps.store.delete(input.phone)
    throw unauthorized(INVALID_OTP)
  }

  if (record.code === null || record.code !== input.otp) {
    // Percobaan dikurangi oleh store (atomik di Redis), bukan di memori proses ini,
    // supaya dua replika tidak bisa sama-sama memakai sisa percobaan yang sama.
    await deps.store.consumeAttempt(input.phone)
    throw unauthorized(INVALID_OTP)
  }

  const user = await deps.findUser(input.phone)
  if (!user || !user.isActive || !OTP_LOGIN_ROLES.includes(user.role)) {
    await deps.store.delete(input.phone)
    throw unauthorized(INVALID_OTP)
  }

  // Kode sekali pakai: ambil-hapus secara atomik sebelum token diterbitkan, supaya
  // dua permintaan bersamaan dengan kode sama tidak bisa dua-duanya berhasil.
  const consumed = await deps.store.consume(input.phone)
  if (!consumed || consumed.code !== input.otp || consumed.expiresAtMs <= nowMs) {
    throw unauthorized(INVALID_OTP)
  }

  // Verifikasi nomor adalah satu-satunya jalan menaikkan `is_verified`. Sengaja
  // dilakukan setelah kode dicocokkan, bukan saat kode diminta.
  if (!user.isVerified) {
    await deps.markVerified?.(user.id)
  }

  const claims: AuthUserClaims = { sub: user.id, role: user.role }

  return {
    accessToken: deps.signToken(claims, expiresInSec),
    expiresIn: expiresInSec,
    user: {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      isVerified: true,
    },
  }
}

// ---------------------------------------------------------------- store bersama

/**
 * Satu store OTP untuk seluruh proses, bukan satu per route.
 *
 * Sebelumnya `POST /v1/auth/otp/request` dan alur verifikasi pasien sama-sama
 * membuat store OTP sendiri. Kalau registration mengirim instruksi lewat
 * jalur berbeda, keduanya akan menerbitkan kode yang saling menimpa dan cooldown
 * tidak berlaku di sana — pasien bisa meminta kode berulang tanpa jeda.
 */
let sharedStore: OtpStore | undefined

export function getOtpStore(): OtpStore {
  sharedStore ??= createOtpStore()
  return sharedStore
}

/** Hanya untuk test: mengganti store mengisolasi state antar suite. */
export function setOtpStore(store: OtpStore): void {
  sharedStore = store
}

/** Untuk test: buang store bersama supaya suite berikutnya mendapat store baru. */
export function resetOtpStore(): void {
  sharedStore = undefined
}

/** Konfigurasi OTP dibaca dari env di satu tempat (docs/API.md §2). */
export function getOtpConfig(): OtpConfig {
  try {
    const env = getEnv()
    return {
      ttlSec: env.OTP_TTL_SEC,
      cooldownSec: env.OTP_RESEND_COOLDOWN_SEC,
      maxAttempts: env.OTP_MAX_ATTEMPTS,
      mockCode: env.PROVIDER_MODE === 'mock' ? env.OTP_MOCK_CODE : null,
    }
  } catch {
    // Di luar konteks server penuh (unit test), pakai default yang sama dengan env.
    return { ttlSec: 300, cooldownSec: 30, maxAttempts: 5, mockCode: '123456' }
  }
}

/**
 * Minta kode OTP untuk nomor yang **sudah terdaftar** sebagai pasien.
 *
 * Berbeda dengan `requestOtp` yang sengaja tidak membocorkan keberadaan nomor, jalur ini
 * hanya dipanggil setelah operator sudah punya akses ke record pasien, jadi tidak ada
 * risiko enumerasi. Cooldown-nya tetap ditegakkan supaya form pendaftaran tidak bisa
 * dipakai membanjiri WhatsApp pasien.
 */
export async function requestPatientOtp(
  input: { phone: string },
  config: OtpConfig,
  deps: { store: OtpStore; now: () => number },
): Promise<OtpChallenge> {
  const nowMs = deps.now()
  const existing = await deps.store.get(input.phone)

  if (existing) {
    const elapsedSec = Math.floor((nowMs - existing.issuedAtMs) / 1000)
    const remaining = config.cooldownSec - elapsedSec
    if (remaining > 0) {
      throw rateLimited(`Tunggu ${remaining} detik sebelum meminta kode baru`, {
        retryAfterSec: remaining,
      })
    }
  }

  await deps.store.set(input.phone, {
    code: config.mockCode ?? generateOtpCode(),
    expiresAtMs: nowMs + config.ttlSec * 1000,
    issuedAtMs: nowMs,
    attemptsLeft: config.maxAttempts,
  })

  return {
    otpExpiresAt: new Date(nowMs + config.ttlSec * 1000).toISOString(),
    retryAfterSec: config.cooldownSec,
  }
}

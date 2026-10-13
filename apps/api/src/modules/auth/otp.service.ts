// CL-007: login OTP pasien & keluarga (mock).
// Kode disimpan di memori proses — cukup untuk demo satu instance, tetapi hilang saat
// restart dan tidak dibagi antar replika. Pemindahan ke Redis dilakukan di CL-401.
import type { AuthSession, AuthUserClaims, OtpChallenge, UserRole } from '@careloop/shared'
import { rateLimited, unauthorized } from '../../lib/errors'
import { getEnv } from '../../lib/env'
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
 * membuat `InMemoryOtpStore` sendiri. Kalau registration mengirim instruksi lewat
 * jalur berbeda, keduanya akan menerbitkan kode yang saling menimpa dan cooldown
 * tidak berlaku di sana — pasien bisa Asking kode berulang tanpa jeda.
 */
let sharedStore: OtpStore = new InMemoryOtpStore()

export function getOtpStore(): OtpStore {
  return sharedStore
}

/** Hanya untuk test: mengganti store mengisolasi state antar suite. */
export function setOtpStore(store: OtpStore): void {
  sharedStore = store
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
  const existing = deps.store.get(input.phone)

  if (existing) {
    const elapsedSec = Math.floor((nowMs - existing.issuedAtMs) / 1000)
    const remaining = config.cooldownSec - elapsedSec
    if (remaining > 0) {
      throw rateLimited(`Tunggu ${remaining} detik sebelum meminta kode baru`, {
        retryAfterSec: remaining,
      })
    }
  }

  deps.store.set(input.phone, {
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

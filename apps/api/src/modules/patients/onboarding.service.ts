// Onboarding pasien: pencegahan duplikasi, pengaitan ke puskesmas, dan instruksi
// verifikasi WhatsApp (Fase C plan operasional).
//
// Prinsip yang dipegang di sini:
//
// 1. **Duplikasi dicek sebelum create.** Pencarian mengembalikan
//    kecocokan terbatas: data yang cukup untuk mengenali orang tetap ditampilkan,
//    patient's di luar scope nakes tidak pernah diberi nama maupun id. Operator
//    diberi tahu bahwa ada konflik tanpa ikut diberi akses ke record itu.
//
// 2. **Verifikasi tidak boleh punya fallback sukses palsu.** Pasien yang belum
//    verifikasi tetap `ONBOARDING` dan instruksi hanya bisa diminta ulang sesuai
//    cooldown OTP yang sudah ada.
import { rateLimited, forbidden, notFound } from '../../lib/errors'
import { AuditAction } from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { getOtpStore, getOtpConfig, requestPatientOtp } from '../auth/otp.service'
import { assertPatientInScope, type AuditContext, type PatientsPrismaClient } from './patients.service'

export type OnboardingPrismaClient = PatientsPrismaClient & {
  // `user.findMany` dipakai untuk lookup duplikasi (nomor bisa cocok pada banyak akun
  // tanpa perlu know-more tentang nomor tersebut beforehand).
  user: PatientsPrismaClient['user'] & {
    findMany(args: any): Promise<any[]>
  }
  nakesAssignment: {
    findMany(args: any): Promise<any[]>
  }
  auditLog?: any
}

export type LookupClient = OnboardingPrismaClient

/**
 * Bentuk kanonik nomor Indonesia: digits saja dengan prefiks 62.
 *
 * Operator bisa mengetik "0812…", "+62812…", atau "62812…" untuk nomor yang sama.
 * Tanpa normalisasi, pencarian duplikasi akan meloloskan akun yang sebenarnya sama —
 * dan di sinilah pemeriksaan duplikasi paling sering gagal bernilai.
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
  return digits
}

/** Semua bentuk yang mungkin tersimpan di database untuk satu nomor kanonik. */
export function phoneVariants(phone: string): string[] {
  const canonical = normalizePhone(phone)
  if (!canonical) return []
  // Database menyimpan apa yang diinput operator, jadi varian 08 dan 62 keduanya
  // harus dicoba; `+` tidak disimpan karena normalisasi di atas membuangnya.
  const local = canonical.startsWith('62') ? `0${canonical.slice(2)}` : canonical
  return [...new Set([canonical, local])]
}

/** Nomor ditampilkan sebagian: operator butuh mencocokkan, bukan menyalin data. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

export type LookupMatchKind = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'NOT_A_PATIENT'

export interface LookupMatch {
  kind: LookupMatchKind
  /** Hanya diisi untuk kecocokan di dalam scope nakes pemanggil. */
  patientId: string | null
  fullName: string | null
  maskedPhone: string | null
  status: string | null
  primaryClinicName: string | null
  matchedOn: 'PHONE' | 'NIK'
  /** Alasan actionable untuk operator. */
  hint: string
}

export interface LookupResult {
  /** True bila ada nomor/nik yang sudah dipakai tapi tidak dalam scope pemanggil. */
  hasConflict: boolean
  matches: LookupMatch[]
}

export interface LookupParams {
  claims: { sub: string; role: string; nakesRole?: string }
  phone?: string
  nik?: string
}

const HINTS: Record<LookupMatchKind, string> = {
  IN_SCOPE: 'Pasien sudah terdaftar di wilayah Anda. Lanjutkan data yang masih kurang.',
  OUT_OF_SCOPE:
    'Nomor ini sudah dipakai akun lain, tetapi di luar wilayah penugasan Anda. Hubungi admin untuk menautkannya.',
  NOT_A_PATIENT:
    'Nomor ini sudah dipakai akun non-pasien. Hubungi admin — jangan mengubah peran akun dari sini.',
}

/**
 * GET /v1/patients/lookup — cari kecocokan nomor WhatsApp / NIK sebelum membuat pasien.
 *
 * Pencarian tidak dibatasi scope untuk purposefully bisa mendeteksi konflik, tapi
 * yang bocor hanya "ada akun di nomor ini" — nama dan id Patients di luar scope tidak
 * pernah dikembalikan. Nakes tanpa scope melihat array kosong, bukan error.
 */
export async function lookupExisting(
  client: LookupClient,
  params: LookupParams,
): Promise<LookupResult> {
  const phone = params.phone?.trim()
  const nik = params.nik?.trim()
  if (!phone && !nik) return { hasConflict: false, matches: [] }

  const phoneForms = phone ? phoneVariants(phone) : []
  const rows = await client.user.findMany({
    where: {
      OR: [
        ...(phoneForms.length > 0 ? [{ phone: { in: phoneForms } }] : []),
        ...(nik ? [{ patient: { nik } }] : []),
      ],
    },
    select: {
      id: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true,
      patient: {
        select: {
          id: true,
          status: true,
          primaryPuskesmas: { select: { name: true } },
        },
      },
    },
  })

  if (rows.length === 0) return { hasConflict: false, matches: [] }

  // Satu akun bisa cocok pada dua kriteria (nomor + NIK). Satu akun menghasilkan satu
  // entri saja; `matchedOn` di-set PHONE kalau nomor yang cocok, karena itu kriteria
  // yang paling sering dipakai operator.
  const matches: LookupMatch[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)

    const isPatient = row.patient !== null
    const scope = await assertPatientInScopeSafe(client, params.claims, row.patient?.id ?? null)
    const kind: LookupMatchKind = isPatient
      ? scope
        ? 'IN_SCOPE'
        : 'OUT_OF_SCOPE'
      : 'NOT_A_PATIENT'

    // `matchedOn` harus mencerminkan kriteria yang benar-benar cocok pada baris ini.
    // Falls back ke NIK hanya bila NIK memang yang cocok; kalau keduanya tidak cocok
    // (mis. nomor berbeda format tapi sudah tertangkap normalisasi), tetap PHONE.
    const matchedOn: 'PHONE' | 'NIK' =
      phoneForms.includes(normalizePhone(row.phone)) ? 'PHONE' : 'NIK'

    matches.push({
      kind,
      patientId: kind === 'IN_SCOPE' ? row.patient?.id ?? null : null,
      fullName: kind === 'IN_SCOPE' ? row.fullName : null,
      maskedPhone: maskPhone(row.phone),
      status: kind === 'IN_SCOPE' ? row.patient?.status ?? null : null,
      primaryClinicName: kind === 'IN_SCOPE' ? row.patient?.primaryPuskesmas?.name ?? null : null,
      matchedOn,
      hint: HINTS[kind],
    })
  }

  return {
    hasConflict: matches.some((m) => m.kind !== 'IN_SCOPE'),
    matches,
  }
}

/**
 * `assertPatientInScope` melempar 404 untuk patients di luar scope — untuk lookup kita
 * justru membutuhkan jawaban "ada/tidak", jadi scope dicek tanpa melempar.
 */
async function assertPatientInScopeSafe(
  client: OnboardingPrismaClient,
  claims: LookupParams['claims'],
  patientId: string | null,
): Promise<boolean> {
  if (!patientId) return false
  if (claims.role === 'ADMIN') return true
  try {
    await assertPatientInScope(client, claims as any, patientId)
    return true
  } catch {
    return false
  }
}

export interface LinkClinicParams {
  patientId: string
  clinicId: string
  claims: { sub: string; role: string; nakesRole?: string }
  audit: AuditContext
}

export interface LinkClinicResult {
  patientId: string
  primaryPuskesmasId: string
  primaryPuskesmasName: string
  status: string
}

/**
 * POST /v1/patients/:id/link-clinic — tautkan pasien yang sudah ada ke puskesmas.
 *
 * NAKES hanya boleh menautkan ke puskesmas dalam penugasannya; ADMIN bebas. Ini jalur
 * resmi untuk "pasien ditemukan, sudah punya akun, tapi belum punya puskesmas".
 */
export async function linkClinic(
  client: OnboardingPrismaClient,
  params: LinkClinicParams,
): Promise<LinkClinicResult> {
  const clinic = await client.puskesmas.findUnique({
    where: { id: params.clinicId },
    select: { id: true, name: true, isActive: true },
  })
  if (!clinic) throw notFound('Puskesmas tidak ditemukan')
  if (!clinic.isActive) throw forbidden('Puskesmas sedang tidak aktif')

  if (params.claims.role !== 'ADMIN') {
    // Pasien harus sudah ada di scope supaya nakes tidak bisa menautkan pasien orang lain
    // ke puskesmasnya sendiri.
    await assertPatientInScope(client, params.claims as any, params.patientId)
    const assignments = await client.nakesAssignment.findMany({
      where: { nakesUserId: params.claims.sub, isActive: true },
      select: { puskesmasId: true },
    })
    const allowed = assignments.some((a) => a.puskesmasId === clinic.id)
    if (!allowed) throw forbidden('Puskesmas ini di luar wilayah penugasan Anda')
  } else {
    await assertPatientInScope(client, params.claims as any, params.patientId)
  }

  const updated = await client.patient.update({
    where: { id: params.patientId },
    data: { primaryPuskesmasId: clinic.id },
    select: { id: true, status: true, primaryPuskesmas: { select: { name: true } } },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_UPDATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { linkedClinicId: clinic.id, linkedClinicName: clinic.name },
  })

  return {
    patientId: updated.id,
    primaryPuskesmasId: clinic.id,
    primaryPuskesmasName: updated.primaryPuskesma?.name ?? clinic.name,
    status: updated.status,
  }
}

export interface VerificationParams {
  patientId: string
  claims: { sub: string; role: string; nakesRole?: string }
  audit: AuditContext
  now?: () => number
}

export interface VerificationResult {
  patientId: string
  maskedPhone: string
  otpExpiresAt: string
  retryAfterSec: number
  /** Selalu true: instruksi dikirim tanpa pernah menandai pasien sebagai terverifikasi. */
  instructionsSent: true
}

/**
 * POST /v1/patients/:id/verification-instructions — kirim ulang instruksi OTP.
 *
 * Memakai cooldown yang sama dengan login OTP supaya form pendaftaran tidak bisa
 * dipakai membanjiri WhatsApp pasien. Tidak ada jalur lain yang menandai
 * `is_verified`: hanya `/v1/auth/otp/verify` yang boleh.
 */
export async function sendVerificationInstructions(
  client: OnboardingPrismaClient,
  params: VerificationParams,
): Promise<VerificationResult> {
  await assertPatientInScope(client, params.claims as any, params.patientId)

  const record = await client.user.findUnique({
    where: { id: params.patientId },
    select: { phone: true, isVerified: true },
  })
  if (!record) throw notFound('Pasien tidak ditemukan')

  if (record.isVerified) {
    throw forbidden('Nomor WhatsApp pasien sudah terverifikasi')
  }

  const config = getOtpConfig()
  const now = params.now?.() ?? Date.now()

  // `requestPatientOtp` menegakkan cooldown dan memakai store yang sama dengan login,
  // jadi kedua al heavyweight saling menggantikan bukan saling menumpuk.
  const challenge = await requestPatientOtp({ phone: record.phone }, config, {
    store: getOtpStore(),
    now: () => now,
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_UPDATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { event: 'verification_instructions_sent', maskedPhone: maskPhone(record.phone) },
  })

  return {
    patientId: params.patientId,
    maskedPhone: maskPhone(record.phone),
    otpExpiresAt: challenge.otpExpiresAt,
    retryAfterSec: challenge.retryAfterSec,
    instructionsSent: true,
  }
}

export { rateLimited }
// Prasyarat & transisi status operasional pasien (Fase A plan operasional).
//
// Status `ONBOARDING` -> `ACTIVE` tidak boleh dilompati. Modul ini CENTRALIZAS
// aturannya di satu tempat supaya tiga hal tidak bisa berbeda pendapat:
//
//   1. UI: menampilkan checklist dan alasan kenapa tombol aktivasi disabled.
//   2. API: menolak `POST /v1/patients/:id/activate` bila prasyarat belum lengkap.
//   3. Scheduler: hanya `ACTIVE` yang boleh diproses (lihat isSchedulablePatientStatus).
//
// `evaluateActivation` sengaja dibuat murni (tidak menyentuh database) supaya aturan
// klinis-administratif ini bisa diuji tanpa database dan tanpa HTTP.
import { PatientStatus } from '@careloop/shared'

/** Kunci prasyarat. Dipakai juga sebagai pengenal saat UI merender checklist. */
export const ACTIVATION_REQUIREMENT_KEYS = [
  'PUSKESMA',
  'CONSENT',
  'VERIFIED',
  'MINIMUM_DATA',
  'ESCALATION_CONTACT',
  'APPROVED_MEDICATION',
  'ACTIVE_SCHEDULE',
] as const

export type ActivationRequirementKey = (typeof ACTIVATION_REQUIREMENT_KEYS)[number]

export interface ActivationSubject {
  status: string
  /** Puskesmas penanggung jawab utama; `null` berarti belum ditunjuk. */
  primaryPuskesmas: { isActive: boolean } | null
  consentPdpAt: Date | string | null
  consentShareWithNakes: boolean
  isVerified: boolean
  phone: string | null
  fullName: string | null
  dateOfBirth: Date | string | null
  gender: string | null
  address: string | null
  districtCode: string | null
  healthConditions: string[]
  emergencyPreference: string
  /** Kontak keluarga yang boleh dikirimi alert (isActive). */
  activeFamilyContacts: number
  /** Kontak nakes yang boleh dikirimi alert (isActive). */
  activeNakesContacts: number
  approvedMedications: number
  activeSchedules: number
}

export interface ActivationCheck {
  key: ActivationRequirementKey
  /** Label Bahasa Indonesia untuk UI operator. */
  label: string
  satisfied: boolean
  /** Alasan singkat kalau belum terpenuhi — ditampilkan apa adanya di UI. */
  detail: string | null
  /** Tautan perbaikan relative di web, supaya operator bisa langsung clicking. */
  fixPath: string | null
}

export interface ActivationChecklist {
  /** True hanya bila seluruh prasyarat terpenuhi. */
  ready: boolean
  checks: ActivationCheck[]
  /** Prasyarat yang belum terpenuhi; daftar ringkas untuk pesan error API. */
  blockers: ActivationCheck[]
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** Data minimum agar Orekta bisa menulis resep dan mengarahkan pasien. */
function missingMinimumData(subject: ActivationSubject): string[] {
  const missing: string[] = []
  if (!text(subject.fullName)) missing.push('nama lengkap')
  if (!text(subject.phone)) missing.push('nomor WhatsApp')
  if (!subject.dateOfBirth) missing.push('tanggal lahir')
  if (!subject.gender) missing.push('jenis kelamin')
  if (!text(subject.districtCode)) missing.push('kode wilayah')
  if (subject.healthConditions.length === 0) missing.push('kondisi penyakit')
  return missing
}

/**
 * Susun checklist aktivasi. Tidak melempar error: checklist yang belum lengkap
 * adalah jawaban yang valid, bukan kegagalan — operator justru butuh melihat apa
 * yang kurang.
 */
export function evaluateActivation(subject: ActivationSubject): ActivationChecklist {
  const missingData = missingMinimumData(subject)

  const checks: ActivationCheck[] = [
    {
      key: 'PUSKESMA',
      label: 'Puskesmas utama ditunjuk dan aktif',
      satisfied: subject.primaryPuskesmas?.isActive === true,
      detail:
        subject.primaryPuskesmas === null
          ? 'Belum ada puskesmas penanggung jawab.'
          : subject.primaryPuskesmas.isActive
            ? null
            : 'Puskesmas penanggung jawab sedang tidak aktif.',
      fixPath: subject.primaryPuskesmas === null ? '/patients' : '/admin/puskesmas',
    },
    {
      key: 'CONSENT',
      label: 'Persetujuan pemrosesan data (PDP) tercatat',
      satisfied: Boolean(subject.consentPdpAt) && subject.consentShareWithNakes,
      detail:
        !subject.consentPdpAt
          ? 'Persetujuan pemrosesan data belum dicatat.'
          : !subject.consentShareWithNakes
            ? 'Pasien belum menyetujui berbagi informasi dengan tenaga kesehatan.'
            : null,
      fixPath: '/patients',
    },
    {
      key: 'VERIFIED',
      label: 'Nomor WhatsApp terverifikasi',
      satisfied: subject.isVerified,
      detail: subject.isVerified ? null : 'Pasien belum memverifikasi nomor WhatsApp lewat OTP.',
      fixPath: '/patients',
    },
    {
      key: 'MINIMUM_DATA',
      label: 'Data minimum pasien lengkap',
      satisfied: missingData.length === 0,
      detail:
        missingData.length === 0
          ? null
          : `Masih kosong: ${missingData.join(', ')}.`,
      fixPath: '/patients',
    },
    {
      key: 'ESCALATION_CONTACT',
      label: 'Kontak eskalasi tersedia',
      // Guardrail flow §4: tanpa satu pun kontak, eskalasi tidak punya tujuan.
      satisfied: subject.activeFamilyContacts + subject.activeNakesContacts > 0,
      detail:
        subject.activeFamilyContacts + subject.activeNakesContacts > 0
          ? null
          : 'Minimal satu kontak keluarga atau kontak nakes yang bisa menerima alert.',
      fixPath: '/patients',
    },
    {
      key: 'APPROVED_MEDICATION',
      label: 'Minimal satu resep disetujui dokter/bidan',
      satisfied: subject.approvedMedications > 0,
      detail:
        subject.approvedMedications > 0
          ? null
          : 'Belum ada resep berstatus APPROVED. Resep DRAFT tidak boleh diproses.',
      fixPath: '/patients',
    },
    {
      key: 'ACTIVE_SCHEDULE',
      label: 'Minimal satu jadwal obat aktif',
      satisfied: subject.activeSchedules > 0,
      detail:
        subject.activeSchedules > 0
          ? null
          : 'Belum ada jadwal obat aktif dari resep yang disetujui.',
      fixPath: '/patients',
    },
  ]

  const blockers = checks.filter((check) => !check.satisfied)
  return { ready: blockers.length === 0, checks, blockers }
}

/**
 * Transisi status yang sah. Satu-satunya jalan ke `ACTIVE` adalah lewat
 * `activate`; `deactivate` dipakai untuk INACTIVE/BLOCKED. Menolak lompatan status yang tidak ada di peta transisi.
 */
const TRANSITIONS: Record<PatientStatus, PatientStatus[]> = {
  [PatientStatus.ONBOARDING]: [PatientStatus.ACTIVE, PatientStatus.INACTIVE, PatientStatus.BLOCKED],
  [PatientStatus.ACTIVE]: [PatientStatus.INACTIVE, PatientStatus.BLOCKED],
  [PatientStatus.INACTIVE]: [PatientStatus.ONBOARDING, PatientStatus.ACTIVE, PatientStatus.BLOCKED],
  [PatientStatus.BLOCKED]: [PatientStatus.ONBOARDING, PatientStatus.INACTIVE],
}

export function canTransitionPatientStatus(from: string, to: string): boolean {
  if (!(from in TRANSITIONS) || !(to in TRANSITIONS)) return false
  return (TRANSITIONS[from as PatientStatus] ?? []).includes(to as PatientStatus)
}

/** Alasan penolakan transisi, atau null bila transisi sah. */
export function patientStatusTransitionError(from: string, to: string): string | null {
  if (canTransitionPatientStatus(from, to)) return null
  return `Perubahan status pasien dari ${from} ke ${to} tidak diizinkan`
}
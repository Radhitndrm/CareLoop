// Antrean kerja nakes (Fase F plan operasional).
//
// Dashboard lama hanya menampilkan statistik — angka kepatuhan dan risiko. Angka itu
// tidak bisa dikerjakan. Yang dibutuhkan petugas puskesmas pagi hari adalah daftar
// pasien yang **menunggu tindakan mereka**, dikelompokkan menurut tindakan itu.
//
// Semua angka di sini dihitung dengan filter scope yang sama dengan dashboard utama
// (`buildScopedPatientWhere`), jadi work queue tidak pernah menampilkan pasien milik
// puskesmas lain.
//
// Yang sengaja TIDAK ada di sini: data klinis. Antrean ini hanya menjawab "pasien mana
// yang perlu saya tangani dan apa yang perlu diperbaiki", bukan isi rekam medisnya.
import { PatientStatus } from '@careloop/shared'
import type { AuthUserClaims } from '@careloop/shared'
import {
  buildScopedPatientWhere,
  resolveNakesScope,
  type DashboardFilterOptions,
} from './dashboard.service'

export type WorkQueueClient = {
  patient: {
    findMany(args: any): Promise<any[]>
    count(args: any): Promise<number>
  }
  escalationRun: {
    count(args: any): Promise<number>
  }
  emergencyAlert: {
    count(args: any): Promise<number>
  }
}

/** Satu item antrean: pasien + satu hal konkret yang harus dikerjakan. */
export interface WorkQueueItem {
  patientId: string
  fullName: string
  phone: string
  status: PatientStatus
  primaryPuskesmasName: string | null
  /** Apa yang perluStaff ini; bisa beberapa kalau sekaligus bermasalah. */
  reasons: string[]
}

export interface WorkQueueBucket {
  key: string
  label: string
  description: string
  count: number
  items: WorkQueueItem[]
}

/** Field yang dibaca untuk menilai kelengkapan; tidak dikirim apa pun ke klien. */
const PATIENT_BASE_SELECT = {
  id: true,
  status: true,
  districtCode: true,
  gender: true,
  dateOfBirth: true,
  healthConditions: true,
  primaryPuskesmas: { select: { name: true } },
  user: { select: { fullName: true, phone: true, isVerified: true, consentPdpAt: true } },
} as const

interface SubjectRow {
  id: string
  status: string
  districtCode: string | null
  gender: string | null
  dateOfBirth: Date | null
  healthConditions: string[]
  primaryPuskesmas: { name: string } | null
  user: { fullName: string; phone: string; isVerified: boolean; consentPdpAt: Date | null }
}

function missingMinimumData(row: SubjectRow): string[] {
  const missing: string[] = []
  if (!row.user.fullName.trim()) missing.push('nama lengkap')
  if (!row.user.phone.trim()) missing.push('nomor WhatsApp')
  if (!row.dateOfBirth) missing.push('tanggal lahir')
  if (!row.gender) missing.push('jenis kelamin')
  if (!row.districtCode) missing.push('kode wilayah')
  if (row.healthConditions.length === 0) missing.push('kondisi penyakit')
  return missing
}

function toItem(row: SubjectRow, reasons: string[]): WorkQueueItem {
  return {
    patientId: row.id,
    fullName: row.user.fullName,
    phone: row.user.phone,
    status: row.status as PatientStatus,
    primaryPuskesmasName: row.primaryPuskesmas?.name ?? null,
    reasons,
  }
}

export interface WorkQueueOptions extends DashboardFilterOptions {
  /** Batas item per kelompok; angka di `count` tetap penuh. */
  perBucketLimit?: number
  /** Saring ke satu puskesmas penanggung jawab (bukan sekadar wilayah/distrik). */
  clinicId?: string
}

export interface WorkQueueResult {
  buckets: WorkQueueBucket[]
  /** Total pasien yang punya setidaknya satu pekerjaan menunggu. */
  actionablePatients: number
}

/**
 * Susun antrean kerja. Satu kali query untuk seluruh patients ONBOARDING dalam scope,
 * lalu dikelompokkan di memori: daftar antrean ini kecil (puluhan), dan satu query
 * membuat semuabucket melihat data yang sama dalam snapshot yang konsisten.
 */
export async function getWorkQueue(
  client: WorkQueueClient,
  claims: AuthUserClaims,
  options: WorkQueueOptions = {},
): Promise<WorkQueueResult> {
  const scope = await resolveNakesScope(client as any, claims)
  const scopedWhere = buildScopedPatientWhere(scope, options)

  const extra: any[] = [{ status: { not: PatientStatus.ACTIVE } }]
  if (options.clinicId) extra.push({ primaryPuskesmasId: options.clinicId })
  const where = { AND: [scopedWhere, ...extra] }

  const rows = (await client.patient.findMany({
    where,
    select: {
      ...PATIENT_BASE_SELECT,
      familyContacts: { where: { isActive: true }, select: { id: true } },
      nakesContacts: { where: { isActive: true }, select: { id: true } },
      medications: {
        where: { status: 'APPROVED' },
        select: { id: true, schedules: { where: { isActive: true }, select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })) as unknown as Array<
    SubjectRow & {
      familyContacts: Array<{ id: string }>
      nakesContacts: Array<{ id: string }>
      medications: Array<{ id: string; schedules: Array<{ id: string }> }>
    }
  >

  const limit = options.perBucketLimit ?? 10
  const buckets: WorkQueueBucket[] = []
  let actionable = 0

  const push = (key: string, label: string, description: string, items: WorkQueueItem[]) => {
    if (items.length === 0) return
    actionable = Math.max(actionable, items.length)
    buckets.push({ key, label, description, count: items.length, items: items.slice(0, limit) })
  }

  push(
    'INCOMPLETE',
    'Data pasien belum lengkap',
    'Minimal data belum cukup untuk menulis resep dan mengarahkan pasien.',
    rows
      .filter((row) => missingMinimumData(row).length > 0)
      .map((row) => toItem(row, [`Kurang: ${missingMinimumData(row).join(', ')}`])),
  )

  push(
    'UNVERIFIED',
    'Menunggu verifikasi WhatsApp',
    'Nomor belum diverifikasi lewat OTP, jadi pasien belum bisa diaktifkan.',
    rows
      .filter((row) => !row.user.isVerified)
      .map((row) => toItem(row, ['Nomor WhatsApp belum terverifikasi'])),
  )

  push(
    'NO_ESCALATION_CONTACT',
    'Tanpa tujuan eskalasi',
    'Tidak ada kontak keluarga maupun nakes yang bisa menerima alert.',
    rows
      .filter((row) => row.familyContacts.length === 0 && row.nakesContacts.length === 0)
      .map((row) => toItem(row, ['Belum ada kontak yang boleh menerima alert'])),
  )

  push(
    'NO_APPROVED_MEDICATION',
    'Belum ada resep disetujui',
    'Resep DRAFT tidak menghasilkan reminder; perlu persetujuan dokter/bidan.',
    rows
      .filter((row) => row.medications.length === 0)
      .map((row) => toItem(row, ['Belum ada resep berstatus APPROVED'])),
  )

  push(
    'NO_ACTIVE_SCHEDULE',
    'Resep disetujui tapi belum punya jadwal',
    'Ada resep APPROVED namun belum ada jadwal obat aktif dari resep itu.',
    rows
      .filter(
        (row) =>
          row.medications.length > 0 &&
          row.medications.every((med) => med.schedules.length === 0),
      )
      .map((row) => toItem(row, ['Resep APPROVED belum punya jadwal aktif'])),
  )

  // Antrean keselamatan: eskalasi dan darurat yang belum ditangani. Angka, bukan
  // daftar pasien — tindakan nyata dilakukan lewat layar emergency & eskalasi.
  const patientFilter = scopedWhere
  const escalationActive = await client.escalationRun.count({
    where: {
      status: { in: ['WAITING_PATIENT', 'FAMILY_TIER_1', 'FAMILY_TIER_2', 'NAKES'] },
      patient: patientFilter,
    },
  })
  if (escalationActive > 0) {
    buckets.push({
      key: 'ACTIVE_ESCALATION',
      label: 'Eskalasi aktif',
      description: 'Pasien belum merespons pengingat dan sudah naik ke kontak keluarga/nakes.',
      count: escalationActive,
      items: [],
    })
  }

  const emergencyOpen = await client.emergencyAlert.count({
    where: {
      status: { in: ['PENDING_PATIENT_CONFIRM', 'ESCALATING'] },
      patient: patientFilter,
    },
  })
  if (emergencyOpen > 0) {
    buckets.push({
      key: 'OPEN_EMERGENCY',
      label: 'Darurat belum ditangani',
      description: 'Anomali terdeteksi dan belum ada konfirmasi bahwa pasien aman.',
      count: emergencyOpen,
      items: [],
    })
  }

  return { buckets, actionablePatients: actionable }
}
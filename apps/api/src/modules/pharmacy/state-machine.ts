// State machine permintaan obat / alur farmasi (docs/API.md §3.6).
//
// Pisah dari service supaya aturan transisi bisa diuji tanpa database —
// polanya sama dengan modules/escalation/state-machine.ts (AGENTS.md §8).
//
// Kunci desain: OVERDUE bukan state. Keterlambatan dihitung dari
// `dueAt` vs waktu sekarang, sehingga status asli (sudah disiapkan atau belum)
// tetap terbaca saat pasien datang terlambat.
import {
  MedicationRequestAction,
  MedicationRequestStatus,
  type MedicationRequestReason,
} from '@careloop/shared'

export type PharmacyState = MedicationRequestStatus
export type PharmacyEvent = MedicationRequestAction

export type PharmacyActor = 'PATIENT' | 'DOCTOR' | 'PHARMACIST' | 'SYSTEM'

/** Alasan pemblokiran — selalu wajib, bukan opsional. */
export interface BlockedReason {
  reason: string
  substituteName?: string
}

export interface PharmacyTransitionContext {
  /** Aksi datang dari patient/keluarga, bukan nakes. */
  fromPatient: boolean
}

/** Aksi yang valid untuk sebuah state. Dipakai juga untuk pesan error 422. */
export const PHARMACY_ALLOWED_ACTIONS: Record<PharmacyState, readonly PharmacyEvent[]> = {
  PENDING_DOCTOR: [MedicationRequestAction.APPROVED, MedicationRequestAction.REJECTED],
  QUEUED: [
    MedicationRequestAction.START_PREPARING,
    MedicationRequestAction.MARK_OUT_OF_STOCK,
    MedicationRequestAction.MARK_SUBSTITUTED,
  ],
  PREPARING: [
    MedicationRequestAction.MARK_READY,
    MedicationRequestAction.MARK_OUT_OF_STOCK,
    MedicationRequestAction.MARK_SUBSTITUTED,
  ],
  READY: [
    MedicationRequestAction.DISPENSED,
    MedicationRequestAction.MARK_OUT_OF_STOCK,
    MedicationRequestAction.MARK_SUBSTITUTED,
    MedicationRequestAction.RETURNED_TO_QUEUE,
  ],
  DISPENSED: [],
  REJECTED: [],
  OUT_OF_STOCK: [],
  SUBSTITUTED: [],
}

export class InvalidPharmacyTransitionError extends Error {
  constructor(
    public readonly from: PharmacyState,
    public readonly event: PharmacyEvent,
  ) {
    super(
      `Permintaan obat berstatus ${from} tidak bisa diubah menjadi ${event}. ` +
        `Aksi yang valid: ${describeAllowed(from)}`,
    )
    this.name = 'InvalidPharmacyTransitionError'
  }
}

export function describeAllowed(state: PharmacyState): string {
  const allowed = PHARMACY_ALLOWED_ACTIONS[state]
  return allowed.length === 0 ? '(tidak ada — status sudah final)' : allowed.join(', ')
}

export function isTerminal(state: PharmacyState): boolean {
  return PHARMACY_ALLOWED_ACTIONS[state].length === 0
}

/**
 * Kembalikan state berikutnya, atau lempar bila transisi tidak valid.
 * Tidak ada jalur pintas: `PENDING_DOCTOR -> DISPENSED` akan ditolak di sini
 * sebelum service menyentuh database.
 *
 * `CREATED` tidak pernah jadi transisi — dia hanya jejak audit baris pertama
 * yang dibuat createMedicationRequest, bukan aksi yang bisa dipanggil klien.
 */
export function reducePharmacy(
  state: PharmacyState,
  event: PharmacyEvent,
): { to: PharmacyState; blocked?: BlockedReason } {
  if (event === MedicationRequestAction.CREATED) {
    throw new InvalidPharmacyTransitionError(state, event)
  }

  const allowed = PHARMACY_ALLOWED_ACTIONS[state]
  if (!allowed.includes(event)) {
    throw new InvalidPharmacyTransitionError(state, event)
  }

  switch (event) {
    case MedicationRequestAction.APPROVED:
      return { to: MedicationRequestStatus.QUEUED }
    case MedicationRequestAction.REJECTED:
      return { to: MedicationRequestStatus.REJECTED }
    case MedicationRequestAction.START_PREPARING:
      return { to: MedicationRequestStatus.PREPARING }
    case MedicationRequestAction.MARK_READY:
      return { to: MedicationRequestStatus.READY }
    case MedicationRequestAction.DISPENSED:
      return { to: MedicationRequestStatus.DISPENSED }
    case MedicationRequestAction.MARK_OUT_OF_STOCK:
      return { to: MedicationRequestStatus.OUT_OF_STOCK }
    case MedicationRequestAction.MARK_SUBSTITUTED:
      return { to: MedicationRequestStatus.SUBSTITUTED }
    case MedicationRequestAction.RETURNED_TO_QUEUE:
      return { to: MedicationRequestStatus.QUEUED }
    default:
      return assertNever(event)
  }
}

/** Aksi yang boleh dilakukan farmasi pada state tertentu (untuk menentukan tombol UI). */
export function pharmacistActionsFor(state: PharmacyState): readonly PharmacyEvent[] {
  switch (state) {
    case MedicationRequestStatus.QUEUED:
    case MedicationRequestStatus.PREPARING:
    case MedicationRequestStatus.READY:
      return PHARMACY_ALLOWED_ACTIONS[state]
    default:
      return []
  }
}

/**
 * Keterlambatan sebagai kondisi turunan, bukan status.
 * True hanya untuk permintaan yang masih boleh diselesaikan farmasi tetapi
 * tanggal jatuh temponya sudah lewat — status final tidak pernah dilaporkan
 * overdue karena sudah tidak ada yang perlu dikejar.
 */
export function isOverdue(state: PharmacyState, dueAt: Date, now: Date): boolean {
  if (
    state !== MedicationRequestStatus.QUEUED &&
    state !== MedicationRequestStatus.PREPARING &&
    state !== MedicationRequestStatus.READY
  ) {
    return false
  }
  // dueAt adalah DATE (tengah malam UTC), jadi bandingkan against midnight
  // of today — kalau tidak, obat yang jatuh tempo hari ini pukul 08:00 akan
  // terhitung terlambat sebelum hari paginya.
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return dueAt.getTime() < todayUtc
}

/** Label Bahasa Indonesia untuk UI & pesan WhatsApp. */
export const PHARMACY_STATUS_LABEL: Record<PharmacyState, string> = {
  PENDING_DOCTOR: 'Menunggu persetujuan dokter',
  QUEUED: 'Masuk antrean',
  PREPARING: 'Sedang disiapkan',
  READY: 'Siap diambil',
  DISPENSED: 'Sudah diserahkan',
  REJECTED: 'Ditolak dokter',
  OUT_OF_STOCK: 'Stok kosong',
  SUBSTITUTED: 'Diganti obatnya',
}

export const PHARMACY_REASON_LABEL: Record<MedicationRequestReason, string> = {
  EARLY_PICKUP: 'Ambil lebih awal',
  MEDICATION_LOST: 'Obat hilang',
  DAMAGED: 'Obat rusak',
  EXTRA: 'Tambahan obat',
  OTHER: 'Lainnya',
}

function assertNever(x: never): never {
  throw new Error(`Unexpected pharmacy value: ${String(x)}`)
}
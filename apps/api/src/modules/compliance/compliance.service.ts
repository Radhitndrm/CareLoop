// CL-107: konfirmasi kepatuhan 1-tap.
//
// Pertanyaan inti endpoint ini adalah "pasien sudah minum obat untuk slot yang mana?".
// Slot adalah pasangan (scheduleId, scheduledAt) — konsisten dengan unique index
// compliance_logs (docs/DATABASE.md §3.8), sehingga konfirmasi dari app maupun dari
// webhook WhatsApp selalu mendarat di baris yang sama dan tidak pernah menggandakan
// catatan.
//
// Urutan tulisan dijaga: log kepatuhan dibuat lebih dulu, baru run eskalasi diselesaikan.
// Bila proses gagal di tengah, konsekuensinya satu baris adherence yang kurang — jauh
// lebih ringan daripada keluarga tidak tahu pasien sudah minum sehingga alarm tetap berbunyi.
import {
  ComplianceStatus,
  type ComplianceChannel,
  type EscalationRunStatus,
} from '@careloop/shared'
import { alreadyProcessed, forbidden, invalidTransition, notFound } from '../../lib/errors'
import { runOnce } from '../../lib/idempotency'
import { tryCreateAuditLog } from '../../lib/audit'
import { getEnv } from '../../lib/env'
import { nextFireAt, type ReminderScheduleInput } from '../reminders/next-fire-at'
import { ACTIVE_ESCALATION_STATUSES, resolveEscalationRun } from '../escalation/escalation.service'

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
/**
 * Batas langkah mundur saat mencari slot. Jadwal berbasis `daysOfWeek` bisa menyisakan
 * jeda hingga 7 hari antar fire, dan `COMPLIANCE_CONFIRM_MAX_LATE_MINUTES` maksimum 7
 * hari — 10 langkah menutup keduanya. Slot yang lebih tua dari ini pasti ditolak
 * `isBeyondLatenessLimit` dan tidak perlu dicari, jadi iterasi tetap murah.
 */
const MAX_SLOT_LOOKBACK_STEPS = 10
/** Fallback bila env tidak terbaca (mis. unit test di luar konteks server). */
const DEFAULT_MAX_LATE_MINUTES = 1440

export type CompliancePrismaClient = {
  schedule: {
    findUnique(args: any): Promise<any>
  }
  complianceLog: {
    findUnique(args: any): Promise<any>
    create(args: any): Promise<any>
  }
  escalationRun?: {
    findFirst(args: any): Promise<any>
  }
  auditLog?: {
    create(args: any): Promise<any>
  }
}

export interface ConfirmSchedule extends ReminderScheduleInput {
  id: string
  patientId: string
  medicationId: string
  /** Jendela ketepatan menit; lewat ini tercatat CONFIRMED_LATE, bukan MISSED (AC-2.3). */
  timeWindowMinutes: number
}

export interface ClassificationInput {
  scheduledAt: Date
  confirmedAt: Date
  timeWindowMinutes: number
}

/**
 * CONFIRMED bila konfirmasi masih di dalam `timeWindowMinutes` (tepat di batas masih
 * CONFIRMED), CONFIRMED_LATE bila lewat — PRD AC-2.3 menyatakan konfirmasi terlambat
 * tetap dihitung sebagai tetap diminum, bukan MISSED.
 *
 * Konfirmasi lebih awal dari jadwal (pasien antre sebelum pengingat tiba) juga
 * CONFIRMED: diminum tepat waktu tidak boleh tercatat sebagai masalah kepatuhan.
 */
export function classifyConfirmation(input: ClassificationInput): ComplianceStatus {
  const deltaMs = input.confirmedAt.getTime() - input.scheduledAt.getTime()

  if (deltaMs <= 0) return ComplianceStatus.CONFIRMED

  const windowMs = Math.max(0, input.timeWindowMinutes) * MINUTE_MS
  return deltaMs <= windowMs ? ComplianceStatus.CONFIRMED : ComplianceStatus.CONFIRMED_LATE
}

/**
 * Guard slot basi: konfirmasi yang jauh melewati waktu jadwal tidak lagi dicatat.
 * Tanpa guard ini slot lama bisa ditutup kapan saja dan angka adherence jadi tidak
 * bermakna karena bisa "dibersihkan" sesuka hati.
 */
export function isBeyondLatenessLimit(
  scheduledAt: Date,
  confirmedAt: Date,
  maxLateMinutes: number,
): boolean {
  return confirmedAt.getTime() - scheduledAt.getTime() > maxLateMinutes * MINUTE_MS
}

/**
 * Slot terakhir yang sudah jatuh tempo pada atau sebelum `before`.
 *
 * `nextFireAt` (CL-105) hanya mencari ke depan, jadi di sini kita mundur satu hari per
 * iterasi: ambil fire pertama pada jendela (cursor - 1 hari, cursor]. Karena `nextFireAt`
 * mengembalikan yang pertama sesudah `probe`, hasilnya otomatis slot terbaru di sebelum
 * cursor — tanpa mengulangi aritmetika zona waktu di modul ini.
 */
function latestDueFireAt(
  schedule: ReminderScheduleInput,
  before: Date,
  maxSteps: number,
): Date | null {
  let cursor = new Date(before.getTime())

  for (let step = 0; step < Math.max(1, maxSteps); step++) {
    const probe = new Date(cursor.getTime() - DAY_MS)
    const fire = nextFireAt(schedule, { after: probe })

    if (!fire) return null
    if (fire.getTime() <= cursor.getTime()) return fire

    cursor = probe
  }

  return null
}

function defaultMaxLateMinutes(): number {
  try {
    return getEnv().COMPLIANCE_CONFIRM_MAX_LATE_MINUTES
  } catch {
    return DEFAULT_MAX_LATE_MINUTES
  }
}

export interface ConfirmSlot {
  scheduledAt: Date | null
  maxLateMinutes: number
  /** true bila slot ada tetapi sudah terlalu basi untuk diterima. */
  tooLate: boolean
}

export interface ConfirmSlotOptions {
  now?: Date
  maxLateMinutes?: number
}

/** Tentukan slot yang dikonfirmasi, sekaligus keputusan basi/tidaknya. */
export function resolveConfirmSlot(
  schedule: ConfirmSchedule,
  options: ConfirmSlotOptions = {},
): ConfirmSlot {
  const now = options.now ?? new Date()
  const maxLateMinutes = options.maxLateMinutes ?? defaultMaxLateMinutes()

  const scheduledAt = latestDueFireAt(schedule, now, MAX_SLOT_LOOKBACK_STEPS)

  return {
    scheduledAt,
    maxLateMinutes,
    tooLate: scheduledAt !== null && isBeyondLatenessLimit(scheduledAt, now, maxLateMinutes),
  }
}

export interface ConfirmIntakeInput {
  scheduleId: string
  channel: ComplianceChannel
  /** Source message id (webhook WhatsApp) untuk jejak pesan asal. */
  sourceMessageId?: string | null
  notes?: string | null
  /** Aktor yang mengonfirmasi — dipakai untuk audit dan escalation_step. */
  actorUserId?: string | null
  now?: Date
  maxLateMinutes?: number
}

export interface ConfirmIntakeResult {
  log: any
  scheduledAt: Date
  status: ComplianceStatus
  /** null bila memang tidak ada run aktif untuk jadwal ini. */
  escalationRunId: string | null
  escalationResolved: boolean
}

/**
 * Tulis konfirmasi minum obat untuk slot jatuh tempo terakhir pada `scheduleId`.
 *
 * Melempar (bukan diam) pada: jadwal tidak ada → 404; tidak ada slot jatuh tempo atau
 * slot sudah basi → 422; slot sudah pernah dikonfirmasi → 409 ALREADY_PROCESSED.
 *
 * Pemanggil bertanggung jawab atas ownership (lihat `assertScheduleOwner`) dan role —
 * service ini transport-agnostic dan tidak memverifikasi JWT.
 */
export async function confirmMedicationIntake(
  client: CompliancePrismaClient,
  input: ConfirmIntakeInput,
): Promise<ConfirmIntakeResult> {
  const schedule = await client.schedule.findUnique({
    where: { id: input.scheduleId },
    select: {
      id: true,
      patientId: true,
      medicationId: true,
      timeOfDay: true,
      daysOfWeek: true,
      timeWindowMinutes: true,
      startDate: true,
      endDate: true,
      patient: { select: { user: { select: { timezone: true } } } },
    },
  })

  if (!schedule) {
    throw notFound(`Jadwal ${input.scheduleId} tidak ditemukan`)
  }

  const confirmedAt = input.now ?? new Date()
  const slot = resolveConfirmSlot(
    { ...schedule, timezone: schedule.patient?.user?.timezone ?? undefined },
    { now: confirmedAt, maxLateMinutes: input.maxLateMinutes },
  )

  if (!slot.scheduledAt) {
    throw invalidTransition(
      `Tidak ada jadwal yang jatuh tempo dalam ${slot.maxLateMinutes} menit terakhir`,
    )
  }

  if (slot.tooLate) {
    throw invalidTransition(
      `Konfirmasi lewat ${slot.maxLateMinutes} menit dari waktu jadwal — slot sudah basi`,
    )
  }

  const scheduledAt = slot.scheduledAt
  const status = classifyConfirmation({
    scheduledAt,
    confirmedAt,
    timeWindowMinutes: schedule.timeWindowMinutes,
  })

  // Idempotensi CL-009: unique index (scheduleId, scheduledAt) yang jadi wasit, bukan
  // pengecekan "sudah ada?" di aplikasi — dua permintaan yang tiba bersamaan tetap aman.
  const { created, value: log } = await runOnce({
    create: () =>
      client.complianceLog.create({
        data: {
          patientId: schedule.patientId,
          scheduleId: schedule.id,
          medicationId: schedule.medicationId,
          scheduledAt,
          confirmedAt,
          status,
          channel: input.channel,
          sourceMessageId: input.sourceMessageId ?? null,
          notes: input.notes ?? null,
        },
      }),
    findExisting: () =>
      client.complianceLog.findUnique({
        where: { scheduleId_scheduledAt: { scheduleId: schedule.id, scheduledAt } },
      }),
    constraint: ['scheduleId', 'scheduledAt'],
  })

  if (!created) {
    // Perbaikan parsial: kalau percobaan sebelumnya berhasil menulis log tapi gagal menutup
    // eskalasi, percobaan ulang ini akan mendarat di cabang 409. Tutup dulu agar pasien
    // yang sudah konfirmasi tidak tetap mendapat alert keluarga, baru laporkan duplikat.
    await resolveActiveEscalation(client, schedule, input.actorUserId, input.notes)

    throw alreadyProcessed(
      `Slot ${schedule.id} pada ${scheduledAt.toISOString()} sudah dikonfirmasi`,
      {
        logId: log.id,
        status: log.status,
        confirmedAt:
          log.confirmedAt instanceof Date ? log.confirmedAt.toISOString() : log.confirmedAt,
      },
    )
  }

  // Pasien memang merespons, jadi run yang menunggu dia ditutup dengan event
  // PATIENT_CONFIRMED — bukan CANCELLED, supaya resolution_type di audit tetap jujur.
  const activeRun = await resolveActiveEscalation(client, schedule, input.actorUserId, input.notes)

  await tryCreateAuditLog(client as any, {
    action: 'compliance.confirmed',
    actorUserId: input.actorUserId ?? schedule.patientId,
    actorRole: 'PATIENT',
    resourceType: 'compliance_log',
    resourceId: log.id,
    patientId: schedule.patientId,
    meta: {
      scheduleId: schedule.id,
      channel: input.channel,
      status,
      scheduledAt: scheduledAt.toISOString(),
      confirmedAt: confirmedAt.toISOString(),
      escalationRunId: activeRun?.id ?? null,
    },
  })

  return {
    log,
    scheduledAt,
    status,
    escalationRunId: activeRun?.id ?? null,
    escalationResolved: Boolean(activeRun),
  }
}

/**
 * Tutup run eskalasi aktif yang berasal dari jadwal ini, kalau ada.
 *
 * Dijalankan baik pada konfirmasi baru maupun pada percobaan ulang, supaya kegagalan
 * di tengah tidak meninggalkan run terbuka permanen.
 */
async function resolveActiveEscalation(
  client: CompliancePrismaClient,
  schedule: { id: string; patientId: string },
  actorUserId: string | null | undefined,
  notes: string | null | undefined,
) {
  if (!client.escalationRun) return null

  const activeRun = await client.escalationRun.findFirst({
    where: {
      sourceScheduleId: schedule.id,
      status: { in: ACTIVE_ESCALATION_STATUSES as EscalationRunStatus[] },
    },
    orderBy: { startedAt: 'desc' },
  })

  if (!activeRun) return null

  await resolveEscalationRun(client as any, {
    runId: activeRun.id,
    actorUserId: actorUserId ?? schedule.patientId,
    notes: notes ?? 'Pasien mengonfirmasi sudah minum obat',
  })

  return activeRun
}

/**
 * Guard kepemilikan: pasien hanya boleh mengonfirmasi jadwalnya sendiri. Role lain
 * (nakes/admin) diteruskan — cakupan wilayah mereka ditegakkan di modul masing-masing.
 */
export function assertScheduleOwner(input: {
  claimsRole: string
  claimsSub: string
  patientId: string
}): void {
  if (input.claimsRole === 'PATIENT' && input.claimsSub !== input.patientId) {
    throw forbidden('Jadwal ini bukan milik Anda')
  }
}

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

/** Fallback `COMPLIANCE_DEFER_MINUTES` bila env tidak terbaca. */
const DEFAULT_DEFER_MINUTES = 15

export type CompliancePrismaClient = {
  schedule: {
    findUnique(args: any): Promise<any>
  }
  complianceLog: {
    findUnique(args: any): Promise<any>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    findMany(args: any): Promise<any[]>
    count(args: any): Promise<number>
    groupBy(args: any): Promise<any[]>
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

function defaultDeferMinutes(): number {
  try {
    return getEnv().COMPLIANCE_DEFER_MINUTES
  } catch {
    return DEFAULT_DEFER_MINUTES
  }
}

/**
 * Baca schedule beserta kolom yang dibutuhkan penentuan slot, lalu tegakkan gate klinis:
 * resep yang belum disahkan dokter tidak boleh ditutup apa pun — baik "sudah diminum"
 * maupun "ditunda", karena keduanya menyatakan pasien sudah menerima obat resmi.
 */
async function loadConfirmableSchedule(
  client: CompliancePrismaClient,
  scheduleId: string,
): Promise<any> {
  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      patientId: true,
      medicationId: true,
      timeOfDay: true,
      daysOfWeek: true,
      timeWindowMinutes: true,
      startDate: true,
      endDate: true,
      status: true,
      patient: { select: { user: { select: { timezone: true } } } },
    },
  })

  if (!schedule) {
    throw notFound(`Jadwal ${scheduleId} tidak ditemukan`)
  }

  // Jadwal tanpa kolom status dibaca sebagai APPROVED agar data lama yang belum
  // dimigrasikan tidak ikut kehilangan konfirmasi.
  if (schedule.status && schedule.status !== 'APPROVED') {
    throw invalidTransition('Preskripsi ini belum disetujui dokter')
  }

  return schedule
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
  const schedule = await loadConfirmableSchedule(client, input.scheduleId)

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
    // Slot yang sudah ditunda lalu dikonfirmasi: pasien berubah pikiran, dan itu
    // jawaban yang valid — baris yang sama dinaikkan statusnya, bukan ditolak 409.
    // Tanpa cabang ini "Tunda 15 menit" jadi jebakan: konfirmasi berikutnya selalu gagal.
    if (log.status === ComplianceStatus.TUNDA) {
      const upgraded = await client.complianceLog.update({
        where: { id: log.id },
        data: {
          status,
          confirmedAt,
          channel: input.channel,
          sourceMessageId: input.sourceMessageId ?? null,
          notes: input.notes ?? null,
        },
      })
      const upgradedRun = await resolveActiveEscalation(
        client,
        schedule,
        input.actorUserId,
        input.notes,
      )

      await tryCreateAuditLog(client as any, {
        action: 'compliance.confirmed',
        actorUserId: input.actorUserId ?? schedule.patientId,
        actorRole: 'PATIENT',
        resourceType: 'compliance_log',
        resourceId: upgraded.id,
        patientId: schedule.patientId,
        meta: {
          scheduleId: schedule.id,
          channel: input.channel,
          status,
          scheduledAt: scheduledAt.toISOString(),
          confirmedAt: confirmedAt.toISOString(),
          upgradedFromDeferred: true,
          escalationRunId: upgradedRun?.id ?? null,
        },
      })

      return {
        log: upgraded,
        scheduledAt,
        status,
        escalationRunId: upgradedRun?.id ?? null,
        escalationResolved: Boolean(upgradedRun),
      }
    }

    // Perbaikan parsial: kalau percobaan sebelumnya berhasil menulis log tapi gagal menutup
    // eskalasi, percobaan ulang ini akan mendarat di cabang 409. Tutup dulu agar pasien
    // yang sudah konfirmasi tidak tetap mendapat alert keluarga, lalu laporkan duplikat.
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

export interface DeferIntakeInput {
  scheduleId: string
  channel: ComplianceChannel
  /** Berapa menit penundaan. Default `COMPLIANCE_DEFER_MINUTES`. */
  minutes?: number
  notes?: string | null
  actorUserId?: string | null
  sourceMessageId?: string | null
  now?: Date
}

export interface DeferExecutionDeps {
  /**
   * Antrekan reminder susulan. Default `getReminderJobQueue().schedule(...)`; disuntik di
   * test dan bila pemanggil memang tidak punya queue.
   */
  enqueueReminder?: (input: { scheduleId: string; dueAt: Date }) => Promise<string>
}

export interface DeferIntakeResult {
  log: any
  scheduledAt: Date
  deferredUntil: Date
  minutes: number
  /** Id job reminder susulan; null bila tidak ada queue yang disuntikkan. */
  reminderJobId: string | null
  /** Run eskalasi yang tetap berjalan — pasien merespons, tapi belum minum. */
  escalationRunId: string | null
  /** true bila slot sudah pernah ditunda: reply kedua tidak menambah reminder susulan. */
  alreadyDeferred: boolean
}

/**
 * Tandai slot jatuh tempo sebagai `TUNDA` lalu minta pengingat diulang (FR-2.4 / AC-2.4).
 *
 * Dua keputusan yang disengaja:
 *
 *   - Slot dicatat `TUNDA`, bukan dibiarkan `PENDING`: pasien sudah membalas dengan jujur
 *     "belum siap". Tanpa baris ini angka adherence menghitung slot itu sebagai belum
 *     dijawab, dan angka kepatuhan bukan lagi data.
 *   - Run eskalasi dibiarkan terbuka. Menunda bukan berarti minum, jadi alarm tetap
 *     harus berbunyi kalau pasien akhirnya tidak minum (FR-3.1).
 *
 * Konfirmasi berikutnya pada slot yang sama menaikkan baris `TUNDA` itu menjadi
 * `CONFIRMED`/`CONFIRMED_LATE` — bukan 409.
 */
export async function deferMedicationIntake(
  client: CompliancePrismaClient,
  input: DeferIntakeInput,
  deps: DeferExecutionDeps = {},
): Promise<DeferIntakeResult> {
  const schedule = await loadConfirmableSchedule(client, input.scheduleId)

  const deferredAt = input.now ?? new Date()
  const slot = resolveConfirmSlot(
    { ...schedule, timezone: schedule.patient?.user?.timezone ?? undefined },
    { now: deferredAt },
  )

  if (!slot.scheduledAt) {
    throw invalidTransition(
      `Tidak ada jadwal yang jatuh tempo dalam ${slot.maxLateMinutes} menit terakhir`,
    )
  }

  if (slot.tooLate) {
    throw invalidTransition(
      `Penundaan lewat ${slot.maxLateMinutes} menit dari waktu jadwal — slot sudah basi`,
    )
  }

  const scheduledAt = slot.scheduledAt
  const minutes = Math.max(1, Math.floor(input.minutes ?? defaultDeferMinutes()))
  const deferredUntil = new Date(deferredAt.getTime() + minutes * MINUTE_MS)

  const { created, value: log } = await runOnce({
    create: () =>
      client.complianceLog.create({
        data: {
          patientId: schedule.patientId,
          scheduleId: schedule.id,
          medicationId: schedule.medicationId,
          scheduledAt,
          confirmedAt: null,
          status: ComplianceStatus.TUNDA,
          channel: input.channel,
          sourceMessageId: input.sourceMessageId ?? null,
          notes: input.notes ?? `Pasien menunda ${minutes} menit`,
        },
      }),
    findExisting: () =>
      client.complianceLog.findUnique({
        where: { scheduleId_scheduledAt: { scheduleId: schedule.id, scheduledAt } },
      }),
    constraint: ['scheduleId', 'scheduledAt'],
  })

  if (!created) {
    if (log.status !== ComplianceStatus.TUNDA) {
      throw alreadyProcessed(
        `Slot ${schedule.id} pada ${scheduledAt.toISOString()} sudah punya jawaban (${log.status})`,
        { logId: log.id, status: log.status },
      )
    }

    // Sudah ditunda: Balas tanpa menambah reminder susulan kedua supaya tidak spam.
    return {
      log,
      scheduledAt,
      deferredUntil,
      minutes,
      reminderJobId: null,
      escalationRunId: await findActiveEscalationId(client, schedule),
      alreadyDeferred: true,
    }
  }

  let reminderJobId: string | null = null
  try {
    reminderJobId = deps.enqueueReminder
      ? await deps.enqueueReminder({ scheduleId: schedule.id, dueAt: deferredUntil })
      : null
  } catch {
    // Penundaan tetap tercatat walau job susulan gagal diantrekan: slot TUNDA adalah
    // fakta, dan dispatcher reminder akan tetap mengambil jadwal berikutnya seperti biasa.
    reminderJobId = null
  }

  const escalationRunId = await findActiveEscalationId(client, schedule)

  await tryCreateAuditLog(client as any, {
    action: 'compliance.deferred',
    actorUserId: input.actorUserId ?? schedule.patientId,
    actorRole: 'PATIENT',
    resourceType: 'compliance_log',
    resourceId: log.id,
    patientId: schedule.patientId,
    meta: {
      scheduleId: schedule.id,
      channel: input.channel,
      minutes,
      scheduledAt: scheduledAt.toISOString(),
      deferredUntil: deferredUntil.toISOString(),
      reminderJobId,
      escalationRunId,
    },
  })

  return {
    log,
    scheduledAt,
    deferredUntil,
    minutes,
    reminderJobId,
    escalationRunId,
    alreadyDeferred: false,
  }
}

/** Id run eskalasi aktif milik jadwal ini, tanpa menutupnya. */
async function findActiveEscalationId(
  client: CompliancePrismaClient,
  schedule: { id: string; patientId: string },
): Promise<string | null> {
  if (!client.escalationRun) return null

  const activeRun = await client.escalationRun.findFirst({
    where: {
      sourceScheduleId: schedule.id,
      status: { in: ACTIVE_ESCALATION_STATUSES as EscalationRunStatus[] },
    },
    orderBy: { startedAt: 'desc' },
  })

  return activeRun?.id ?? null
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

export interface ComplianceListItem {
  id: string
  scheduledAt: string
  confirmedAt: string | null
  status: string
  channel: string
  medicationName: string
  scheduleId: string
  timeOfDay: string
  doseQty: string
}

export interface ComplianceListResult {
  items: ComplianceListItem[]
  total: number
  limit: number
  offset: number
  summary: {
    confirmed: number
    confirmedLate: number
    missed: number
    pending: number
    adherenceRate: number
  }
}

/**
 * Timeline konfirmasi minum obat untuk satu pasien — sisi nakes.
 *
 * Pasien pressing "sudah minum" lewat WhatsApp atau tombol di app akan muncul
 * di sini sebagai CONFIRMED/CONFIRMED_LATE, sehingga perawat dan dokter bisa
 * melihat kepatuhan tanpa menghitung ulang dari agregat dashboard.
 */
export async function listPatientCompliance(
  client: CompliancePrismaClient,
  params: {
    patientId: string
    from?: string | Date | null
    to?: string | Date | null
    status?: string | null
    limit: number
    offset: number
  },
): Promise<ComplianceListResult> {
  const where: Record<string, unknown> = { patientId: params.patientId }

  if (params.status) where.status = params.status

  const dateFilter: Record<string, Date> = {}
  if (params.from) dateFilter.gte = new Date(params.from)
  if (params.to) dateFilter.lte = new Date(params.to)
  if (Object.keys(dateFilter).length > 0) where.scheduledAt = dateFilter

  const [records, total, grouped] = await Promise.all([
    client.complianceLog.findMany({
      where,
      select: {
        id: true,
        scheduledAt: true,
        confirmedAt: true,
        status: true,
        channel: true,
        scheduleId: true,
        schedule: {
          select: {
            timeOfDay: true,
            doseQty: true,
            medication: { select: { name: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    }),
    client.complianceLog.count({ where }),
    client.complianceLog.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    }),
  ])

  const counts: Record<string, number> = {}
  for (const row of grouped as unknown as Array<{ status: string; _count: { _all: number } }>) {
    counts[row.status] = row._count._all
  }

  const confirmed = counts.CONFIRMED ?? 0
  const confirmedLate = counts.CONFIRMED_LATE ?? 0
  const missed = counts.MISSED ?? 0
  const pending = counts.PENDING ?? 0
  const decided = confirmed + confirmedLate + missed

  return {
    items: records.map((record: any) => ({
      id: record.id,
      scheduledAt: record.scheduledAt.toISOString(),
      confirmedAt: record.confirmedAt ? record.confirmedAt.toISOString() : null,
      status: record.status,
      channel: record.channel,
      medicationName: record.schedule?.medication?.name ?? 'Obat',
      scheduleId: record.scheduleId,
      timeOfDay: record.schedule?.timeOfDay ?? '',
      doseQty: record.schedule?.doseQty ?? '',
    })),
    total,
    limit: params.limit,
    offset: params.offset,
    summary: {
      confirmed,
      confirmedLate,
      missed,
      pending,
      adherenceRate: decided > 0 ? Math.round(((confirmed + confirmedLate) / decided) * 100) / 100 : 0,
    },
  }
}

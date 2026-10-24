// CL-106: Worker Pengiriman Reminder.
//
// Dipanggil saat job reminder fire (CL-105 menjadwalkan, CL-104 mengeksekusi lewat queue).
// Urutan: baca schedule + obat + pasien -> komposisi (CL-102) -> kirim via WhatsAppService
// (CL-101) -> catat ReminderLog -> mulai escalation run WAITING_PATIENT (CL-109).
//
// Retry dipegang worker ini, bukan WhatsAppService dan bukan BullMQ. Alasannya: jumlah
// percobaan harus terlihat sebagai baris `RETRYING` di reminder_logs (AC "retry <= 3 &
// log gagal"), dan WhatsAppServiceretry internal-nya tidak memberi hook per percobaan.
// Worker memakai provider yang sama lewat `createWhatsAppService({ maxAttempts: 1 })`
// supaya tidak ada dua lapis retry (yang bisa jadi 3 x 3 = 9 kiriman).
import type { PrismaClient } from '@prisma/client'
import {
  AuditAction,
  Channel,
  EscalationContext,
  isSchedulablePatientStatus,
  ReminderChannel,
  ReminderStatus,
} from '@careloop/shared'
import {
  buildReminderBody,
  buildReminderTemplate,
  reminderTemplateButtonPayload,
} from '../../integrations/whatsapp/templates'
import { isWindowClosedError } from '../../integrations/whatsapp/errors'
import { createWhatsAppService, type WhatsAppService } from '../../integrations/whatsapp/whatsapp.service'
import { getTtsService, TtsError, type TtsService } from '../../integrations/tts'
import { tryCreateAuditLog } from '../../lib/audit'
import { getEnv } from '../../lib/env'
import type { WhatsAppSendResult } from '../../integrations/whatsapp/types'
import { createJobQueue, type JobQueue, type QueueMode } from '../../lib/queue'
import { startEscalationRun, type EscalationPrismaClient } from '../escalation/escalation.service'

export const REMINDER_QUEUE_NAME = 'reminder'

/** Batas percobaan kirim per FR-1.3 (retry maksimal 2x di luar percobaan pertama). */
export const REMINDER_MAX_SEND_ATTEMPTS = 3

/** Jeda antar percobaan dalam ms. Default 1000; test mengeset 0 agar tidak lambat. */
export const REMINDER_RETRY_DELAY_MS = 1000

export interface ReminderJobPayload {
  scheduleId: string
  /** Kunci idempotensi: waktu target dalam UTC (hasil `nextFireAt`, CL-105). */
  dueAt: string
}

export type ReminderWorkerOutcome = 'SENT' | 'SKIPPED' | 'DUPLICATE' | 'FAILED'

export interface ReminderWorkerResult {
  outcome: ReminderWorkerOutcome
  scheduleId: string
  patientId: string | null
  /** Id baris ReminderLog terakhir yang ditulis; null bila tidak ada pengiriman. */
  reminderLogId: string | null
  escalationRunId: string | null
  /** Jumlah pemanggilan WA interaktif yang benar-benar terjadi. */
  sendAttempts: number
  providerMessageId: string | null
  voice: 'SENT' | 'FAILED' | 'SKIPPED'
  error: string | null
}

/** Prisma penuh untuk reminder log, plus bentuk duck-typed yang dipakai CL-109. */
export type ReminderPrismaClient = Pick<PrismaClient, 'schedule' | 'reminderLog' | 'auditLog'> &
  EscalationPrismaClient

export interface ReminderWorkerDeps {
  prisma: ReminderPrismaClient
  whatsapp: WhatsAppService
  /** Nama template Meta untuk pengingat proaktif. Default dari env `WHATSAPP_REMINDER_TEMPLATE`. */
  reminderTemplateName?: string
  /** Payload quick-reply template. Default dari env `WHATSAPP_REMINDER_TEMPLATE_BUTTON`. */
  templateButton?: 'KONFIRMS' | 'CONFIRM_TAKEN'
  /** Default `getTtsService()` (stub; TTS sungguhan menyusul di CL-305). */
  tts?: TtsService
  /** Default 1000. Set 0 di test. */
  retryDelayMs?: number
  now?: () => Date
  logger?: { error(obj: unknown, msg: string): void }
}

export interface ReminderScheduleData {
  id: string
  patientId: string
  timeOfDay: string
  isActive: boolean
  /** Status persetujuan klinis; hanya APPROVED boleh memicu reminder (docs/API.md §3.2). */
  status: string
  /** Status operasional pasien; hanya ACTIVE boleh memicu reminder (guardrail flow §2). */
  patientStatus: string
  doseQty: string
  medicationName: string
  patientPhone: string
  patientName: string
  voiceEnabled: boolean
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

function defaultReminderTemplate(): string {
  try {
    return getEnv().WHATSAPP_REMINDER_TEMPLATE
  } catch {
    return 'pengingat_obat'
  }
}

function templateButtonMode(): 'KONFIRMS' | 'CONFIRM_TAKEN' {
  try {
    return getEnv().WHATSAPP_REMINDER_TEMPLATE_BUTTON
  } catch {
    return 'KONFIRMS'
  }
}

export function parseDueAt(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`dueAt tidak valid: ${String(value)}`)
  }
  return date
}

/** Muat schedule beserta obat & pasien; null bila schedule tidak ada. */
export async function loadReminderSchedule(
  client: ReminderPrismaClient,
  scheduleId: string,
): Promise<ReminderScheduleData | null> {
  const schedule = await client.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      medication: { select: { name: true } },
      patient: {
        select: {
          voiceEnabled: true,
          status: true,
          user: { select: { phone: true, fullName: true } },
        },
      },
    },
  })

  if (!schedule) return null

  return {
    id: schedule.id,
    patientId: schedule.patientId,
    timeOfDay: schedule.timeOfDay,
    isActive: schedule.isActive,
    status: schedule.status ?? 'APPROVED',
    patientStatus: schedule.patient?.status ?? 'ONBOARDING',
    doseQty: schedule.doseQty,
    medicationName: schedule.medication?.name ?? 'Obat',
    patientPhone: schedule.patient?.user?.phone ?? '',
    patientName: schedule.patient?.user?.fullName ?? 'Pasien',
    voiceEnabled: schedule.patient?.voiceEnabled ?? false,
  }
}

interface WriteLogInput {
  scheduleId: string
  patientId: string
  scheduledFireAt: Date
  channel: ReminderChannel
  status: ReminderStatus
  attempt: number
  providerMessageId?: string | null
  error?: string | null
}

/** Tambah satu baris reminder_logs. Satu baris = satu percobaan pada satu kanal. */
export async function writeReminderLog(
  client: ReminderPrismaClient,
  input: WriteLogInput,
  now: () => Date = () => new Date(),
): Promise<string> {
  const row = await client.reminderLog.create({
    data: {
      scheduleId: input.scheduleId,
      patientId: input.patientId,
      scheduledFireAt: input.scheduledFireAt,
      actualFireAt: now(),
      channel: input.channel,
      status: input.status,
      attempt: input.attempt,
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
    },
    select: { id: true },
  })
  return row.id
}

function skipped(
  scheduleId: string,
  patientId: string | null,
  reason: string,
): ReminderWorkerResult {
  return {
    outcome: 'SKIPPED',
    scheduleId,
    patientId,
    reminderLogId: null,
    escalationRunId: null,
    sendAttempts: 0,
    providerMessageId: null,
    voice: 'SKIPPED',
    error: reason,
  }
}

/**
 * Kirim reminder dengan retry sendiri agar setiap percobaan bisa dicatat.
 * Mengembalikan `null` bila seluruh percobaan gagal (baris log sudah ditulis).
 */
async function sendWithRetries(
  deps: ReminderWorkerDeps,
  context: {
    schedule: ReminderScheduleData
    scheduledFireAt: Date
    body: ReturnType<typeof buildReminderBody>
  },
): Promise<{
  providerMessageId: string | null
  logId: string | null
  attempts: number
  error: string | null
  /** true = terkirim lewat template karena jendela 24 jam tertutup. */
  usedTemplate?: boolean
}> {
  const { prisma, logger } = deps
  const now = deps.now ?? (() => new Date())
  const retryDelayMs = deps.retryDelayMs ?? REMINDER_RETRY_DELAY_MS
  const { schedule, scheduledFireAt, body } = context
  const reminderTemplateName = deps.reminderTemplateName ?? defaultReminderTemplate()

  // Provider yang sama, tapi retry internal dimatikan supaya hitungan percobaan
  // sepenuhnya milik worker ini.
  const single = createWhatsAppService({ provider: deps.whatsapp.provider, maxAttempts: 1 })

  let attempts = 0
  let lastError = 'Kirim WhatsApp gagal'
  let lastLogId: string | null = null

  for (let attempt = 1; attempt <= REMINDER_MAX_SEND_ATTEMPTS; attempt++) {
    attempts = attempt
    try {
      // Per percobaan, bukan di luar loop: percobaan kedua yang berhasil lewat kanal
      // interaktif tidak boleh ikut dicatat "dikirim sebagai template" dari percobaan pertama.
      let usedTemplate = false
      let result: WhatsAppSendResult
      try {
        result = await single.sendInteractive(schedule.patientPhone, body)
      } catch (error) {
        // Di luar jendela 24 jam Meta menolak pesan interaktif. Itu kondisi normal untuk
        // pengingat terjadwal, bukan kegagalan — jadi langsung dicoba ulang sebagai
        // template (boleh dikirim proaktif). Bila template pun gagal, error aslinya
        // yang dilaporkan agar angka kegagalan di log tetap jujur.
        if (!isWindowClosedError(error)) throw error

        result = await single.send({
          kind: 'TEMPLATE',
          to: schedule.patientPhone,
          templateName: reminderTemplateName,
          parameters: buildReminderTemplate(
            reminderTemplateName,
            {
              medicationName: schedule.medicationName,
              doseQty: schedule.doseQty,
              timeOfDay: schedule.timeOfDay,
              patientName: schedule.patientName,
            },
            reminderTemplateButtonPayload(deps.templateButton ?? templateButtonMode(), schedule.id),
          ),
        })
        usedTemplate = true
      }

      const logId = await writeReminderLog(
        prisma,
        {
          scheduleId: schedule.id,
          patientId: schedule.patientId,
          scheduledFireAt,
          channel: ReminderChannel.WHATSAPP,
          status: ReminderStatus.SENT,
          attempt,
          providerMessageId: result.providerMessageId,
          // Dicatat di `error` supaya jejak audit tidak claiming terkirim via kanal
          // interaktif padahal sebenarnya lewat template.
          error: usedTemplate ? 'dikirim sebagai message template (jendela 24 jam tertutup)' : null,
        },
        now,
      )
      return {
        providerMessageId: result.providerMessageId,
        logId,
        attempts,
        error: null,
        usedTemplate,
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      const willRetry = attempt < REMINDER_MAX_SEND_ATTEMPTS
      lastLogId = await writeReminderLog(
        prisma,
        {
          scheduleId: schedule.id,
          patientId: schedule.patientId,
          scheduledFireAt,
          channel: ReminderChannel.WHATSAPP,
          status: willRetry ? ReminderStatus.RETRYING : ReminderStatus.FAILED,
          attempt,
          error: lastError,
        },
        now,
      )
      logger?.error({ err: error, scheduleId: schedule.id, attempt }, 'gagal mengirim reminder')
      if (willRetry) await sleep(retryDelayMs)
    }
  }

  return { providerMessageId: null, logId: lastLogId, attempts, error: lastError }
}

/**
 * Job handler reminder. Tidak melempar error saat pengiriman gagal — status FAILED
 * sudah tersimpan di ReminderLog dan dikembalikan di result, supaya tidak ada retry
 * kedua dari lapisan queue.
 */
export async function handleReminderJob(
  deps: ReminderWorkerDeps,
  payload: ReminderJobPayload,
): Promise<ReminderWorkerResult> {
  const { prisma, whatsapp, logger } = deps
  const tts = deps.tts ?? getTtsService()
  const now = deps.now ?? (() => new Date())
  const scheduledFireAt = parseDueAt(payload.dueAt)

  const schedule = await loadReminderSchedule(prisma, payload.scheduleId)
  if (!schedule)
    return skipped(payload.scheduleId, null, `Schedule ${payload.scheduleId} tidak ditemukan`)
  if (!schedule.isActive) return skipped(schedule.id, schedule.patientId, 'Schedule tidak aktif')

  // Preskripsi belum disahkan dokter -> jangan ganggu pasien dengan pengingat
  // obat yang belum resmi (docs/API.md §3.2).
  if (schedule.status !== 'APPROVED') {
    return skipped(
      schedule.id,
      schedule.patientId,
      `Preskripsi belum disetujui dokter (status ${schedule.status})`,
    )
  }

  // Pasien yang belum diaktivasi (ONBOARDING/INACTIVE/BLOCKED) tidak boleh diganggu
  // (guardrail flow §2). Dicek di worker DAN di dispatcher: dispatcher menahan
  // pekerjaan, worker menutup jalur manual/internal yang mungkin masuk ke sini.
  if (!isSchedulablePatientStatus(schedule.patientStatus)) {
    return skipped(
      schedule.id,
      schedule.patientId,
      `Pasien belum berstatus ACTIVE (status ${schedule.patientStatus})`,
    )
  }

  // Idempotensi (RM-5): slot waktu yang sudah punya baris SENT tidak dikirim ulang.
  const alreadySent = await prisma.reminderLog.findFirst({
    where: { scheduleId: schedule.id, scheduledFireAt, status: ReminderStatus.SENT },
    select: { id: true, providerMessageId: true },
  })
  if (alreadySent) {
    return {
      outcome: 'DUPLICATE',
      scheduleId: schedule.id,
      patientId: schedule.patientId,
      reminderLogId: alreadySent.id,
      escalationRunId: null,
      sendAttempts: 0,
      providerMessageId: alreadySent.providerMessageId ?? null,
      voice: 'SKIPPED',
      error: null,
    }
  }

  const sent = await sendWithRetries(deps, {
    schedule,
    scheduledFireAt,
    body: buildReminderBody(
      {
        medicationName: schedule.medicationName,
        doseQty: schedule.doseQty,
        timeOfDay: schedule.timeOfDay,
      },
      schedule.id,
    ),
  })

  if (sent.logId === null || sent.providerMessageId === null) {
    await tryCreateAuditLog(
      prisma,
      {
        action: AuditAction.REMINDER_FAILED,
        resourceType: 'reminder_log',
        resourceId: sent.logId,
        patientId: schedule.patientId,
        meta: { scheduleId: schedule.id, attempts: sent.attempts, error: sent.error },
      },
      logger,
    )
    return {
      outcome: 'FAILED',
      scheduleId: schedule.id,
      patientId: schedule.patientId,
      reminderLogId: sent.logId,
      escalationRunId: null,
      sendAttempts: sent.attempts,
      providerMessageId: null,
      voice: 'SKIPPED',
      error: sent.error,
    }
  }

  await tryCreateAuditLog(
    prisma,
    {
      action: AuditAction.REMINDER_SENT,
      resourceType: 'reminder_log',
      resourceId: sent.logId,
      patientId: schedule.patientId,
      meta: {
        scheduleId: schedule.id,
        providerMessageId: sent.providerMessageId,
        attempts: sent.attempts,
      },
    },
    logger,
  )

  // Voice reminder (RM-3). Teks sudah terkirim sebelum TTS, jadi kegagalan TTS hanya
  // dicatat sebagai baris VOICE berstatus FAILED dan tidak mengubah hasil (RM-4).
  let voice: ReminderWorkerResult['voice'] = 'SKIPPED'
  if (schedule.voiceEnabled) {
    try {
      const speech = await tts.synthesize(
        `Pengingat minum obat ${schedule.medicationName}, ${schedule.doseQty}, pukul ${schedule.timeOfDay}.`,
        { locale: 'id-ID', cacheKey: schedule.id },
      )
      await whatsapp.sendAudio(schedule.patientPhone, speech.audioUrl)
      await writeReminderLog(
        prisma,
        {
          scheduleId: schedule.id,
          patientId: schedule.patientId,
          scheduledFireAt,
          channel: ReminderChannel.VOICE,
          status: ReminderStatus.SENT,
          attempt: 1,
          providerMessageId: sent.providerMessageId,
        },
        now,
      )
      voice = 'SENT'
    } catch (error) {
      await writeReminderLog(
        prisma,
        {
          scheduleId: schedule.id,
          patientId: schedule.patientId,
          scheduledFireAt,
          channel: ReminderChannel.VOICE,
          status: ReminderStatus.FAILED,
          attempt: 1,
          error: error instanceof TtsError ? error.message : String(error),
        },
        now,
      )
      voice = 'FAILED'
      logger?.error({ err: error, scheduleId: schedule.id }, 'gagal mengirim voice reminder')
    }
  }

  // Setelah reminder terkirim, buka run eskalasi WAITING_PATIENT (CL-109).
  // Kegagalan di sini sengaja dibiarkan melempar: reminder sudah terkirim (baris SENT
  // ada) sehingga tidak ada risiko kirim ganda, sementara pasien yang tidak
  // dikonfirmasi justru butuh jaring pengaman — kegagalan harus terlihat di antrean,
  // bukan tenggelam diam-diam. Timeout ke keluarga/nakes adalah CL-110.
  const run = await startEscalationRun(prisma, {
    patientId: schedule.patientId,
    context: EscalationContext.SCHEDULE,
    sourceScheduleId: schedule.id,
    initialStep: {
      contactPhone: schedule.patientPhone,
      channel: Channel.WHATSAPP,
      messageKey: 'reminder.sent',
      providerMessageId: sent.providerMessageId,
      sentAt: now(),
    },
  })

  return {
    outcome: 'SENT',
    scheduleId: schedule.id,
    patientId: schedule.patientId,
    reminderLogId: sent.logId,
    escalationRunId: run?.id ?? null,
    sendAttempts: sent.attempts,
    providerMessageId: sent.providerMessageId,
    voice,
    error: null,
  }
}

/**
 * Queue reminder dengan `attempts: 1` supaya retry tidak berlipat: worker sudah
 * mencoba sampai 3× dan mencatatnya, BullMQ tidak perlu mengulang job-nya.
 */
export function createReminderJobQueue(
  deps: ReminderWorkerDeps,
  options: { mode?: QueueMode } = {},
): JobQueue<ReminderJobPayload> {
  return createJobQueue<ReminderJobPayload>({
    name: REMINDER_QUEUE_NAME,
    mode: options.mode,
    defaultAttempts: 1,
    handler: async (payload) => {
      await handleReminderJob(deps, payload)
    },
  })
}

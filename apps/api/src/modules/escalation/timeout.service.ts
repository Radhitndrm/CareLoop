// CL-110: Timeout Pasien + Alert Keluarga (area: safety / escalation).
// Menjadwalkan timeout saat state WAITING_PATIENT dimasuki. Saat waktu habis tanpa konfirmasi:
// 1. Transisi ke tier aktif (FAMILY_TIER_1 / FAMILY_TIER_2 / NAKES).
// 2. Kirim notifikasi ke semua kontak keluarga aktif di tier tersebut (AC-3.1).
// 3. Menegakkan aturan anti-spam (hanya sekali per jendela eskalasi, AC-3.2).
// 4. Pesan berisi instruksi jelas untuk menghubungi pasien (AC-3.3).
// 5. Durasi timeout configurable via env / per-pasien (AGENTS.md §2).
// 6. Mencatat kejadian ke tabel Notification + EscalationStep + AuditLog (CL-010).
import {
  AuditAction,
  Channel,
  EscalationContext,
  EscalationRunStatus,
  EscalationTier,
  FamilyTier,
  NotificationStatus,
  NotificationType,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { getEnv } from '../../lib/env'
import {
  transitionEscalationRun,
  type EscalationPrismaClient,
} from './escalation.service'

export interface EscalationTimeoutJobPayload {
  runId: string
  patientId: string
  context: EscalationContext
  expectedStatus: EscalationRunStatus
  scheduledAt: string
}

export interface EscalationQueueAdapter {
  scheduleTimeout(payload: EscalationTimeoutJobPayload, delayMs: number): Promise<string>
  cancelTimeout(jobId: string): Promise<void>
}

/** In-memory scheduler yang mendukung unit testing dan fallback offline tanpa Redis. */
export class InMemoryEscalationQueueAdapter implements EscalationQueueAdapter {
  private timers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; payload: EscalationTimeoutJobPayload }
  >()

  constructor(
    private readonly onTimeout?: (payload: EscalationTimeoutJobPayload) => Promise<void>,
  ) {}

  async scheduleTimeout(payload: EscalationTimeoutJobPayload, delayMs: number): Promise<string> {
    const jobId = `job-${payload.runId}-${Date.now()}`
    const timer = setTimeout(async () => {
      this.timers.delete(jobId)
      if (this.onTimeout) {
        await this.onTimeout(payload)
      }
    }, delayMs)

    this.timers.set(jobId, { timer, payload })
    return jobId
  }

  async cancelTimeout(jobId: string): Promise<void> {
    const entry = this.timers.get(jobId)
    if (entry) {
      clearTimeout(entry.timer)
      this.timers.delete(jobId)
    }
  }

  get activeJobCount(): number {
    return this.timers.size
  }

  clear(): void {
    for (const entry of this.timers.values()) {
      clearTimeout(entry.timer)
    }
    this.timers.clear()
  }
}

export interface FamilyAlertMessageInput {
  contactPhone: string
  contactName: string
  patientName: string
  patientPhone?: string
  medicationName?: string
  scheduledTime?: string
  tier: EscalationTier
  instructions: string
  /**
   * Id run eskalasi. Wajib: dipakai membangun tombol "Saya Tangani" (`HANDLE_<runId>`)
   * supaya keluarga bisa menutup eskalasi dari WhatsApp tanpa menghubungi nakes.
   */
  runId: string
}

export interface NakesAlertMessageInput {
  contactPhone: string
  nakesName: string
  patientName: string
  patientPhone?: string
  medicationName?: string
  scheduledTime?: string
  instructions: string
  /** Id run eskalasi — sumber tombol "Saya Tangani". Lihat `FamilyAlertMessageInput.runId`. */
  runId: string
}

export interface EscalationNotifier {
  sendFamilyAlert(input: FamilyAlertMessageInput): Promise<{ providerMessageId: string | null }>
  sendNakesAlert?(input: NakesAlertMessageInput): Promise<{ providerMessageId: string | null }>
}

/** Default mock / stub notifier jika WhatsApp service belum di-inject. */
export class MockEscalationNotifier implements EscalationNotifier {
  public sentAlerts: FamilyAlertMessageInput[] = []
  public sentNakesAlerts: NakesAlertMessageInput[] = []

  async sendFamilyAlert(input: FamilyAlertMessageInput): Promise<{ providerMessageId: string | null }> {
    this.sentAlerts.push(input)
    return { providerMessageId: `mock-wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
  }

  async sendNakesAlert(input: NakesAlertMessageInput): Promise<{ providerMessageId: string | null }> {
    this.sentNakesAlerts.push(input)
    return { providerMessageId: `mock-wa-nakes-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
  }
}

/** Menghitung durasi timeout per tier (detik) secara configurable (AGENTS.md §2, AC-7.5). */
export function getTierTimeoutSec(
  tier: EscalationTier | EscalationRunStatus,
  context?: EscalationContext,
  configSnapshot?: Record<string, unknown> | null,
): number {
  // 1. Cek konfigurasi per-pasien jika ada override (AC-7.5)
  if (configSnapshot) {
    if (
      tier === 'WAITING_PATIENT' &&
      typeof configSnapshot.patientWaitSec === 'number'
    ) {
      return configSnapshot.patientWaitSec
    }

    if (
      (tier === 'FAMILY_TIER_1' || tier === 'TIER_1') &&
      (typeof configSnapshot.tier1WaitSec === 'number' ||
        typeof configSnapshot.familyTier1WaitSec === 'number')
    ) {
      return (configSnapshot.tier1WaitSec ?? configSnapshot.familyTier1WaitSec) as number
    }

    if (
      (tier === 'FAMILY_TIER_2' || tier === 'TIER_2') &&
      (typeof configSnapshot.tier2WaitSec === 'number' ||
        typeof configSnapshot.familyTier2WaitSec === 'number')
    ) {
      return (configSnapshot.tier2WaitSec ?? configSnapshot.familyTier2WaitSec) as number
    }

    if (
      tier === 'NAKES' &&
      typeof configSnapshot.nakesWaitSec === 'number'
    ) {
      return configSnapshot.nakesWaitSec
    }
  }

  // 2. Baca dari runtime env (getEnv) atau fallback aman jika dipanggil di luar konteks server penuh
  try {
    const env = getEnv()
    if (tier === 'WAITING_PATIENT') {
      if (context === 'EMERGENCY') {
        return env.EMERGENCY_PATIENT_CONFIRM_SEC
      }
      return env.ESCALATION_PATIENT_WAIT_SEC
    }
    if (tier === 'FAMILY_TIER_1' || tier === 'TIER_1') {
      return env.ESCALATION_FAMILY_TIER1_WAIT_SEC
    }
    if (tier === 'FAMILY_TIER_2' || tier === 'TIER_2') {
      return env.ESCALATION_FAMILY_TIER2_WAIT_SEC
    }
    if (tier === 'NAKES') {
      return env.ESCALATION_NAKES_WAIT_SEC
    }
  } catch {
    const envSec = process.env.ESCALATION_PATIENT_WAIT_SEC
      ? parseInt(process.env.ESCALATION_PATIENT_WAIT_SEC, 10)
      : undefined
    const emergencySec = process.env.EMERGENCY_PATIENT_CONFIRM_SEC
      ? parseInt(process.env.EMERGENCY_PATIENT_CONFIRM_SEC, 10)
      : undefined
    const tier1Sec = process.env.ESCALATION_FAMILY_TIER1_WAIT_SEC
      ? parseInt(process.env.ESCALATION_FAMILY_TIER1_WAIT_SEC, 10)
      : undefined
    const tier2Sec = process.env.ESCALATION_FAMILY_TIER2_WAIT_SEC
      ? parseInt(process.env.ESCALATION_FAMILY_TIER2_WAIT_SEC, 10)
      : undefined
    const nakesSec = process.env.ESCALATION_NAKES_WAIT_SEC
      ? parseInt(process.env.ESCALATION_NAKES_WAIT_SEC, 10)
      : undefined

    if (tier === 'WAITING_PATIENT') {
      if (context === 'EMERGENCY') {
        return emergencySec && !Number.isNaN(emergencySec) ? emergencySec : 45
      }
      return envSec && !Number.isNaN(envSec) ? envSec : 1800
    }
    if (tier === 'FAMILY_TIER_1' || tier === 'TIER_1') {
      return tier1Sec && !Number.isNaN(tier1Sec) ? tier1Sec : 900
    }
    if (tier === 'FAMILY_TIER_2' || tier === 'TIER_2') {
      return tier2Sec && !Number.isNaN(tier2Sec) ? tier2Sec : 900
    }
    if (tier === 'NAKES') {
      return nakesSec && !Number.isNaN(nakesSec) ? nakesSec : 1800
    }
  }

  return 900
}

/** Menghitung durasi timeout pasien (detik) secara configurable (AGENTS.md §2). */
export function getPatientTimeoutSec(
  context: EscalationContext,
  configSnapshot?: Record<string, unknown> | null,
): number {
  return getTierTimeoutSec('WAITING_PATIENT', context, configSnapshot)
}

/** Menyusun teks pesan alert keluarga dengan instruksi menghubungi pasien (AC-3.3). */
export function formatFamilyAlertMessage(input: {
  patientName: string
  patientPhone?: string
  medicationName?: string
  scheduledTime?: string
}): { body: string; instructions: string } {
  const medInfo = input.medicationName
    ? `minum obat ${input.medicationName}${input.scheduledTime ? ` (jadwal ${input.scheduledTime})` : ''}`
    : 'mengonfirmasi jadwal minum obat'

  const instructions = input.patientPhone
    ? `Mohon segera hubungi beliau di nomor ${input.patientPhone} atau kunjungi tempat tinggalnya untuk memastikan kondisinya.`
    : 'Mohon segera hubungi beliau atau kunjungi tempat tinggalnya untuk memastikan kondisinya.'

  const body = `[CareLoop] PERINGATAN KELUARGA: ${input.patientName} belum ${medInfo}. ${instructions}`

  return { body, instructions }
}

/** Menyusun teks pesan alert nakes dengan instruksi memeriksa kondisi pasien (AC-7.1, AC-7.3). */
export function formatNakesEscalationAlertMessage(input: {
  patientName: string
  patientPhone?: string
  medicationName?: string
  scheduledTime?: string
}): { body: string; instructions: string } {
  const medInfo = input.medicationName
    ? `minum obat ${input.medicationName}${input.scheduledTime ? ` (jadwal ${input.scheduledTime})` : ''}`
    : 'mengonfirmasi jadwal minum obat'

  const instructions =
    'Pasien belum merespons pengingat dan tidak dapat dihubungi oleh keluarga atau tidak memiliki kontak keluarga terdekat. Mohon tenaga kesehatan/kader memeriksa kondisi pasien.'

  const body = `[CareLoop] PERINGATAN NAKES: ${input.patientName} belum ${medInfo}. ${instructions}`

  return { body, instructions }
}

export interface TimeoutExecutionDeps {
  notifier: EscalationNotifier
  queueAdapter?: EscalationQueueAdapter
  now?: () => Date
}

export interface TimeoutExecutionResult {
  runId: string
  previousStatus: EscalationRunStatus
  newStatus: EscalationRunStatus
  notifiedCount: number
  scheduledNextJobId?: string
  skippedAntiSpam?: boolean
  details?: Record<string, unknown>
}

/**
 * Menangani timeout eskalasi bertingkat penuh (WAITING_PATIENT -> FAMILY_TIER_1 -> FAMILY_TIER_2 -> NAKES -> TIMED_OUT).
 * Mendukung chaining penjadwalan otomatis via queueAdapter (AC-7.1), skip tier kosong (AC-7.3), dan anti-spam (AC-3.2).
 */
export async function handleEscalationTimeout(
  client: EscalationPrismaClient & {
    notification?: {
      create(args: any): Promise<any>
      findFirst(args: any): Promise<any>
    }
    familyContact?: {
      findMany(args: any): Promise<any>
    }
    nakesContact?: {
      findMany(args: any): Promise<any>
    }
  },
  deps: TimeoutExecutionDeps,
  payload: EscalationTimeoutJobPayload,
): Promise<TimeoutExecutionResult> {
  // 1. Ambil data run saat ini
  const run = await client.escalationRun.findUnique({
    where: { id: payload.runId },
    include: {
      steps: true,
      patient: {
        select: {
          id: true,
          livingSituation: true,
          emergencyPreference: true,
          user: { select: { fullName: true, phone: true } },
          schedules: {
            where: { id: payload.runId },
            include: { medication: true },
          },
        },
      },
    },
  })

  // 2. Guard idempotency / pembatalan sebelumnya (AC-3.4, AC-7.2):
  // Jika pasien sudah konfirmasi (status sudah RESOLVED/HANDLED) atau status bukan lagi expectedStatus,
  // maka timeout diabaikan dan alert TIDAK dikirim.
  if (!run || run.status !== payload.expectedStatus) {
    return {
      runId: payload.runId,
      previousStatus: run?.status ?? 'RESOLVED',
      newStatus: run?.status ?? 'RESOLVED',
      notifiedCount: 0,
      details: { skipped: true, reason: 'RUN_ALREADY_RESOLVED_OR_CHANGED' },
    }
  }

  // 3. Guard Anti-Spam per stage (AC-3.2):
  const alreadyAlertedAtCurrentStage = (run.steps ?? []).some((s: any) => {
    if (run.status === 'WAITING_PATIENT') {
      return (
        s.messageKey?.startsWith('alert.family') &&
        (s.tier === 'TIER_1' || s.tier === 'TIER_2')
      )
    }
    if (run.status === 'FAMILY_TIER_1') {
      return s.messageKey === 'alert.family.tier_2' || s.messageKey === 'alert.nakes'
    }
    if (run.status === 'FAMILY_TIER_2') {
      return s.messageKey === 'alert.nakes'
    }
    return false
  })

  if (alreadyAlertedAtCurrentStage) {
    return {
      runId: run.id,
      previousStatus: run.status,
      newStatus: run.status,
      notifiedCount: 0,
      skippedAntiSpam: true,
      details: { skipped: true, reason: 'ANTI_SPAM_WINDOW_ACTIVE' },
    }
  }

  // 4. Lakukan transisi state machine: status saat ini + TIMEOUT -> status berikutnya (AC-7.1)
  const { run: updatedRun, transition } = await transitionEscalationRun(client, {
    runId: run.id,
    event: 'TIMEOUT',
  })

  let notifiedCount = 0
  const patientName = run.patient?.user?.fullName ?? 'Pasien'
  const patientPhone = run.patient?.user?.phone ?? undefined

  // 5. Jika target transisi menyertakan keluarga (FAMILY_TIER_1 atau FAMILY_TIER_2)
  if (transition.notify.includes('FAMILY_TIER_1') || transition.notify.includes('FAMILY_TIER_2')) {
    const targetFamilyTier: FamilyTier =
      updatedRun.currentTier === 'TIER_2' ? 'TIER_2' : 'TIER_1'

    // Ambil seluruh kontak keluarga aktif di tier ini (AC-3.1)
    let contacts: any[] = []
    if (client.familyContact?.findMany) {
      contacts = await client.familyContact.findMany({
        where: {
          patientId: run.patientId,
          tier: targetFamilyTier,
          isActive: true,
        },
        orderBy: { priority: 'asc' },
      })
    }

    const { body, instructions } = formatFamilyAlertMessage({
      patientName,
      patientPhone,
    })

    for (const contact of contacts) {
      // Kirim alert via WhatsApp notifier
      const sendResult = await deps.notifier.sendFamilyAlert({
        contactPhone: contact.phone,
        contactName: contact.name,
        patientName,
        patientPhone,
        tier: updatedRun.currentTier ?? 'TIER_1',
        instructions,
        runId: run.id,
      })

      // Catat ke tabel Notification
      if (client.notification?.create) {
        await client.notification.create({
          data: {
            patientId: run.patientId,
            userId: contact.userId ?? null,
            channel: 'WHATSAPP',
            type: NotificationType.ESCALATION,
            title: 'Peringatan Eskalasi: Pasien Belum Konfirmasi Obat',
            body,
            payload: {
              runId: run.id,
              tier: updatedRun.currentTier,
              contactName: contact.name,
              contactPhone: contact.phone,
            },
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            providerMessageId: sendResult.providerMessageId,
          },
        })
      }

      // Catat ke tabel EscalationStep (AC-7.4)
      await client.escalationStep.create({
        data: {
          runId: run.id,
          tier: updatedRun.currentTier,
          contactUserId: contact.userId ?? null,
          contactPhone: contact.phone,
          channel: Channel.WHATSAPP,
          messageKey: `alert.family.${(updatedRun.currentTier ?? 'tier_1').toLowerCase()}`,
          sentAt: new Date(),
          response: 'NONE',
          providerMessageId: sendResult.providerMessageId,
        },
      })

      // Catat ke AuditLog
      if (client.auditLog) {
        await tryCreateAuditLog(client as any, {
          action: AuditAction.ESCALATION_STEP,
          actorRole: 'SYSTEM' as any,
          resourceType: 'escalation_run',
          resourceId: run.id,
          patientId: run.patientId,
          meta: {
            event: 'TIMEOUT_FAMILY_ALERT',
            tier: updatedRun.currentTier,
            notifiedPhone: contact.phone,
            notifiedName: contact.name,
          },
        })
      }

      notifiedCount++
    }
  }

  // 6. Jika target transisi menyertakan NAKES (AC-7.1, AC-7.3)
  if (transition.notify.includes('NAKES')) {
    let nakesContacts: any[] = []
    if (client.nakesContact?.findMany) {
      nakesContacts = await client.nakesContact.findMany({
        where: {
          patientId: run.patientId,
          isActive: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      })
    }

    const { body, instructions } = formatNakesEscalationAlertMessage({
      patientName,
      patientPhone,
    })

    if (nakesContacts.length > 0) {
      for (const contact of nakesContacts) {
        let providerMessageId: string | null = null
        if (deps.notifier.sendNakesAlert) {
          const sendResult = await deps.notifier.sendNakesAlert({
            contactPhone: contact.phone,
            nakesName: contact.nakesName,
            patientName,
            patientPhone,
            instructions,
            runId: run.id,
          })
          providerMessageId = sendResult.providerMessageId
        } else {
          const sendResult = await deps.notifier.sendFamilyAlert({
            contactPhone: contact.phone,
            contactName: contact.nakesName,
            patientName,
            patientPhone,
            tier: 'NAKES',
            instructions,
            runId: run.id,
          })
          providerMessageId = sendResult.providerMessageId
        }

        if (client.notification?.create) {
          await client.notification.create({
            data: {
              patientId: run.patientId,
              userId: contact.nakesUserId ?? null,
              channel: 'WHATSAPP',
              type: NotificationType.ESCALATION,
              title: 'Peringatan Eskalasi: Pasien Memerlukan Penanganan Nakes',
              body,
              payload: {
                runId: run.id,
                tier: 'NAKES',
                nakesName: contact.nakesName,
                nakesPhone: contact.phone,
              },
              status: NotificationStatus.SENT,
              sentAt: new Date(),
              providerMessageId,
            },
          })
        }

        await client.escalationStep.create({
          data: {
            runId: run.id,
            tier: 'NAKES',
            contactUserId: contact.nakesUserId ?? null,
            contactPhone: contact.phone,
            channel: Channel.WHATSAPP,
            messageKey: 'alert.nakes',
            sentAt: new Date(),
            response: 'NONE',
            providerMessageId,
          },
        })

        if (client.auditLog) {
          await tryCreateAuditLog(client as any, {
            action: AuditAction.ESCALATION_STEP,
            actorRole: 'SYSTEM' as any,
            resourceType: 'escalation_run',
            resourceId: run.id,
            patientId: run.patientId,
            meta: {
              event: 'TIMEOUT_NAKES_ALERT',
              tier: 'NAKES',
              notifiedPhone: contact.phone,
              notifiedName: contact.nakesName,
            },
          })
        }

        notifiedCount++
      }
    } else {
      // Jika pasien belum memiliki kontak nakes terspesialisasi, tetap catat ke step dan notifikasi (AC-7.4)
      if (client.notification?.create) {
        await client.notification.create({
          data: {
            patientId: run.patientId,
            channel: 'WHATSAPP',
            type: NotificationType.ESCALATION,
            title: 'Peringatan Eskalasi: Pasien Memerlukan Penanganan Nakes',
            body,
            payload: {
              runId: run.id,
              tier: 'NAKES',
            },
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        })
      }

      await client.escalationStep.create({
        data: {
          runId: run.id,
          tier: 'NAKES',
          contactPhone: '-',
          channel: Channel.WHATSAPP,
          messageKey: 'alert.nakes',
          sentAt: new Date(),
          response: 'NONE',
        },
      })

      if (client.auditLog) {
        await tryCreateAuditLog(client as any, {
          action: AuditAction.ESCALATION_STEP,
          actorRole: 'SYSTEM' as any,
          resourceType: 'escalation_run',
          resourceId: run.id,
          patientId: run.patientId,
          meta: {
            event: 'TIMEOUT_NAKES_ALERT',
            tier: 'NAKES',
            notes: 'No specific nakes contact assigned',
          },
        })
      }
    }
  }

  // 7. Penjadwalan timeout otomatis untuk tier berikutnya (AC-7.1)
  let scheduledNextJobId: string | undefined
  if (
    deps.queueAdapter &&
    (updatedRun.status === 'FAMILY_TIER_1' ||
      updatedRun.status === 'FAMILY_TIER_2' ||
      updatedRun.status === 'NAKES')
  ) {
    const delaySec = getTierTimeoutSec(updatedRun.status, run.context, run.configSnapshot)
    scheduledNextJobId = await deps.queueAdapter.scheduleTimeout(
      {
        runId: run.id,
        patientId: run.patientId,
        context: run.context,
        expectedStatus: updatedRun.status,
        scheduledAt: new Date().toISOString(),
      },
      delaySec * 1000,
    )
  }

  return {
    runId: run.id,
    previousStatus: run.status,
    newStatus: updatedRun.status,
    notifiedCount,
    scheduledNextJobId,
  }
}

/**
 * Menangani timeout eskalasi pasien saat WAITING_PATIENT habis.
 * Mempertahankan kompatibilitas mundur dengan mendelegasikan ke handleEscalationTimeout.
 */
export async function handlePatientEscalationTimeout(
  client: EscalationPrismaClient & {
    notification?: {
      create(args: any): Promise<any>
      findFirst(args: any): Promise<any>
    }
    familyContact?: {
      findMany(args: any): Promise<any>
    }
    nakesContact?: {
      findMany(args: any): Promise<any>
    }
  },
  deps: TimeoutExecutionDeps,
  payload: EscalationTimeoutJobPayload,
): Promise<TimeoutExecutionResult> {
  return handleEscalationTimeout(client, deps, payload)
}

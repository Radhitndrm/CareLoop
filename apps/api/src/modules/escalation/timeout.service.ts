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
}

export interface EscalationNotifier {
  sendFamilyAlert(input: FamilyAlertMessageInput): Promise<{ providerMessageId: string | null }>
}

/** Default mock / stub notifier jika WhatsApp service belum di-inject. */
export class MockEscalationNotifier implements EscalationNotifier {
  public sentAlerts: FamilyAlertMessageInput[] = []

  async sendFamilyAlert(input: FamilyAlertMessageInput): Promise<{ providerMessageId: string | null }> {
    this.sentAlerts.push(input)
    return { providerMessageId: `mock-wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }
  }
}

/** Menghitung durasi timeout pasien (detik) secara configurable (AGENTS.md §2). */
export function getPatientTimeoutSec(
  context: EscalationContext,
  configSnapshot?: Record<string, unknown> | null,
): number {
  // 1. Cek konfigurasi per-pasien jika ada override
  if (configSnapshot && typeof configSnapshot.patientWaitSec === 'number') {
    return configSnapshot.patientWaitSec
  }

  const env = getEnv()
  // 2. Berdasarkan konteks (darurat 30-60 detik vs jadwal obat 30 menit)
  if (context === 'EMERGENCY') {
    return env.EMERGENCY_PATIENT_CONFIRM_SEC
  }
  return env.ESCALATION_PATIENT_WAIT_SEC
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

export interface TimeoutExecutionDeps {
  notifier: EscalationNotifier
}

export interface TimeoutExecutionResult {
  runId: string
  previousStatus: EscalationRunStatus
  newStatus: EscalationRunStatus
  notifiedCount: number
  skippedAntiSpam?: boolean
  details?: Record<string, unknown>
}

/**
 * Menangani timeout eskalasi pasien saat WAITING_PATIENT habis.
 * Dipanggil oleh scheduler / queue worker saat delayed job jatuh tempo.
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
          user: { select: { fullName: true, phone: true } },
          schedules: {
            where: { id: payload.runId },
            include: { medication: true },
          },
        },
      },
    },
  })

  // 2. Guard idempotency / pembatalan sebelumnya (AC-3.4):
  // Jika pasien sudah konfirmasi (status sudah RESOLVED/HANDLED) atau status bukan lagi WAITING_PATIENT,
  // maka timeout diabaikan dan alert TIDAK dikirim ke keluarga.
  if (!run || run.status !== payload.expectedStatus) {
    return {
      runId: payload.runId,
      previousStatus: run?.status ?? 'RESOLVED',
      newStatus: run?.status ?? 'RESOLVED',
      notifiedCount: 0,
      details: { skipped: true, reason: 'RUN_ALREADY_RESOLVED_OR_CHANGED' },
    }
  }

  // 3. Guard Anti-Spam (AC-3.2):
  // Periksa apakah alert untuk tier ini sudah pernah terkirim di jendela run ini.
  const alreadyAlertedInRun = (run.steps ?? []).some(
    (s: any) =>
      s.messageKey?.startsWith('alert.family') &&
      (s.tier === 'TIER_1' || s.tier === 'TIER_2'),
  )

  if (alreadyAlertedInRun) {
    return {
      runId: run.id,
      previousStatus: run.status,
      newStatus: run.status,
      notifiedCount: 0,
      skippedAntiSpam: true,
      details: { skipped: true, reason: 'ANTI_SPAM_WINDOW_ACTIVE' },
    }
  }

  // 4. Lakukan transisi state machine: WAITING_PATIENT + TIMEOUT -> tier aktif
  const { run: updatedRun, transition } = await transitionEscalationRun(client, {
    runId: run.id,
    event: 'TIMEOUT',
  })

  let notifiedCount = 0

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

    const patientName = run.patient?.user?.fullName ?? 'Pasien'
    const patientPhone = run.patient?.user?.phone ?? undefined
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

  return {
    runId: run.id,
    previousStatus: run.status,
    newStatus: updatedRun.status,
    notifiedCount,
  }
}

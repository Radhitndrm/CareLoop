// CL-204: Membuat Emergency dari Anomali (area: safety / emergency).
// Saat anomali terdeteksi (CL-202/CL-203):
// 1. Buat record EmergencyAlert dengan state PENDING_PATIENT_CONFIRM (AC-4.1).
// 2. Buat EscalationRun dengan context EMERGENCY dan link sourceEmergencyId (CL-109).
// 3. Kirim konfirmasi "Apakah Anda aman?" ke pasien via WhatsApp dan In-App Notification (CL-102).
// 4. Jadwalkan timeout 30–60 detik secara configurable (FR-4.3).
// 5. Catat ke EscalationStep dan AuditLog (CL-010).
import {
  AuditAction,
  Channel,
  EmergencyStatus,
  EmergencyTrigger,
  EscalationContext,
  EscalationRunStatus,
  NotificationStatus,
  NotificationType,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { notFound } from '../../lib/errors'
import { getWhatsAppService, type WhatsAppService } from '../../integrations/whatsapp'
import {
  startEscalationRun,
  type EscalationPrismaClient,
} from '../escalation/escalation.service'
import {
  getPatientTimeoutSec,
  InMemoryEscalationQueueAdapter,
  type EscalationQueueAdapter,
} from '../escalation/timeout.service'

export interface CreateEmergencyInput {
  patientId: string
  hrBpm?: number | null
  triggeredAt?: Date | string
  triggerType?: EmergencyTrigger
  anomalyReason?: string | null
  notes?: string | null
  locationLat?: number | null
  locationLng?: number | null
  configSnapshot?: Record<string, unknown> | null
}

export interface EmergencyExecutionDeps {
  whatsAppService?: WhatsAppService
  queueAdapter?: EscalationQueueAdapter
  now?: () => Date
}

export type EmergencyPrismaClient = EscalationPrismaClient & {
  emergencyAlert: {
    create(args: any): Promise<any>
    findUnique(args: any): Promise<any>
    findFirst?(args: any): Promise<any>
    findMany?(args: any): Promise<any>
    update?(args: any): Promise<any>
  }
  notification?: {
    create(args: any): Promise<any>
    findFirst?(args: any): Promise<any>
    findMany?(args: any): Promise<any>
  }
}

export interface CreateEmergencyResult {
  emergencyAlert: any
  escalationRun: any
  timeoutSec: number
  jobId: string
  inAppNotification?: any
  waMessageId?: string | null
}

/** Singleton default queue adapter untuk timeout emergency in-memory (CL-104 fallback). */
export const defaultEmergencyQueueAdapter = new InMemoryEscalationQueueAdapter()

/**
 * Menghitung durasi timeout konfirmasi pasien saat anomali darurat (FR-4.3).
 * Spesifikasi PRD & FR-4.3: dibatasi antara 30 hingga 60 detik (default 45s).
 */
export function getEmergencyTimeoutSec(
  configSnapshot?: Record<string, unknown> | null,
): number {
  const rawSec = getPatientTimeoutSec(EscalationContext.EMERGENCY, configSnapshot)
  if (rawSec < 30) return 30
  if (rawSec > 60) return 60
  return rawSec
}

/** Format teks pesan konfirmasi darurat ke nomor WhatsApp pasien (AC-4.1 / CL-102). */
export function formatPatientEmergencyConfirmationMessage(input: {
  patientName: string
  hrBpm?: number | null
  timeoutSec: number
}): string {
  const hrText = input.hrBpm ? ` (${input.hrBpm} bpm)` : ''
  return `[CareLoop PERINGATAN DARURAT]\nHalo ${input.patientName}, terdeteksi anomali detak jantung${hrText}.\nApakah Anda aman?\n\nSegera buka aplikasi CareLoop atau balas 'AMAN' dalam ${input.timeoutSec} detik jika kondisi Anda baik-baik saja.`
}

/**
 * Memicu kejadian darurat dari anomali tanda vital pasien (CL-204 / AC-4.1).
 */
export async function createEmergencyFromAnomaly(
  prisma: EmergencyPrismaClient,
  input: CreateEmergencyInput,
  deps?: EmergencyExecutionDeps,
): Promise<CreateEmergencyResult> {
  // 1. Validasi keberadaan pasien dan data akun (User)
  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    include: {
      user: {
        select: { id: true, fullName: true, phone: true },
      },
    },
  })

  if (!patient) {
    throw notFound(`Data pasien dengan ID ${input.patientId} tidak ditemukan`)
  }

  const nowFn = deps?.now ?? (() => new Date())
  const currentTime = nowFn()
  const triggeredAt = input.triggeredAt ? new Date(input.triggeredAt) : currentTime

  // 2. Tentukan timeout konfirmasi darurat (30–60 detik)
  const timeoutSec = getEmergencyTimeoutSec(input.configSnapshot)

  // 3. Buat rekaman EmergencyAlert di database (status PENDING_PATIENT_CONFIRM)
  const emergencyAlert = await prisma.emergencyAlert.create({
    data: {
      patientId: input.patientId,
      triggeredAt,
      triggerType: input.triggerType ?? EmergencyTrigger.ANOMALY_HR,
      hrBpm: input.hrBpm ?? null,
      status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
      locationLat: input.locationLat ?? null,
      locationLng: input.locationLng ?? null,
      notes: input.notes ?? input.anomalyReason ?? 'Anomali detak jantung terdeteksi',
    },
  })

  // 4. Mulai EscalationRun baru dengan context EMERGENCY
  const escalationRun = await startEscalationRun(prisma, {
    patientId: input.patientId,
    context: EscalationContext.EMERGENCY,
    sourceEmergencyId: emergencyAlert.id,
    configSnapshot: {
      ...input.configSnapshot,
      timeoutSec,
      emergencyAlertId: emergencyAlert.id,
      hrBpm: input.hrBpm,
      anomalyReason: input.anomalyReason,
    },
    cancelExisting: true,
  })

  // 5. Kirim konfirmasi ke WhatsApp pasien (CL-102)
  const waService = deps?.whatsAppService ?? getWhatsAppService()
  const patientName = patient.user?.fullName ?? 'Pasien'
  const patientPhone = patient.user?.phone ?? ''
  const waBody = formatPatientEmergencyConfirmationMessage({
    patientName,
    hrBpm: input.hrBpm,
    timeoutSec,
  })

  let waMessageId: string | null = null
  let waError: string | null = null

  if (patientPhone) {
    try {
      const waResult = await waService.sendText(patientPhone, waBody)
      waMessageId = waResult.providerMessageId
    } catch (err) {
      waError = err instanceof Error ? err.message : String(err)
    }
  }

  // Catat langkah konfirmasi pasien di tabel escalation_steps
  await prisma.escalationStep.create({
    data: {
      runId: escalationRun.id,
      contactUserId: patient.user?.id ?? null,
      contactPhone: patientPhone || '-',
      channel: Channel.WHATSAPP,
      messageKey: 'emergency.confirm_patient',
      sentAt: currentTime,
      providerMessageId: waMessageId,
      error: waError,
    },
  })

  // 6. Buat notifikasi in-app untuk aplikasi mobile pasien
  let inAppNotification: any = null
  if (prisma.notification?.create) {
    inAppNotification = await prisma.notification.create({
      data: {
        patientId: input.patientId,
        userId: patient.user?.id ?? patient.id,
        channel: Channel.IN_APP,
        type: NotificationType.EMERGENCY,
        title: 'Peringatan Detak Jantung Tidak Normal',
        body: `Terdeteksi anomali detak jantung${input.hrBpm ? ` (${input.hrBpm} bpm)` : ''}. Apakah Anda aman?`,
        payload: {
          emergencyAlertId: emergencyAlert.id,
          runId: escalationRun.id,
          hrBpm: input.hrBpm ?? null,
          anomalyReason: input.anomalyReason ?? null,
          timeoutSec,
          actionPrompt: 'Apakah Anda aman?',
          options: ['SAFE', 'NEED_HELP'],
          expiresAt: new Date(currentTime.getTime() + timeoutSec * 1000).toISOString(),
        },
        status: NotificationStatus.SENT,
        sentAt: currentTime,
      },
    })
  }

  // 7. Jadwalkan timeout 30–60 detik pada queue adapter (AC-4.1)
  const queueAdapter = deps?.queueAdapter ?? defaultEmergencyQueueAdapter
  const jobId = await queueAdapter.scheduleTimeout(
    {
      runId: escalationRun.id,
      patientId: input.patientId,
      context: EscalationContext.EMERGENCY,
      expectedStatus: EscalationRunStatus.WAITING_PATIENT,
      scheduledAt: currentTime.toISOString(),
    },
    timeoutSec * 1000,
  )

  // 8. Catat ke audit log sistem (CL-010)
  await tryCreateAuditLog(prisma as any, {
    actorUserId: patient.user?.id ?? null,
    action: AuditAction.EMERGENCY_TRIGGERED,
    resourceType: 'EmergencyAlert',
    resourceId: emergencyAlert.id,
    patientId: input.patientId,
    meta: {
      hrBpm: input.hrBpm,
      anomalyReason: input.anomalyReason,
      escalationRunId: escalationRun.id,
      timeoutSec,
      jobId,
    },
  })

  return {
    emergencyAlert,
    escalationRun,
    timeoutSec,
    jobId,
    inAppNotification,
    waMessageId,
  }
}

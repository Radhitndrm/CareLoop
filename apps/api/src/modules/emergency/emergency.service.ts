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
import { notFound, invalidTransition } from '../../lib/errors'
import { getWhatsAppService, type WhatsAppService } from '../../integrations/whatsapp'
import {
  startEscalationRun,
  resolveEscalationRun,
  transitionEscalationRun,
  isActiveStatus,
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
    update(args: any): Promise<any>
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

export interface PatientEmergencyResponseInput {
  emergencyId: string
  response: 'SAFE' | 'NEED_HELP'
  actorUserId?: string | null
  notes?: string | null
}

export interface PatientEmergencyResponseResult {
  emergencyId: string
  status: EmergencyStatus
  patientConfirmedSafe: boolean
  patientConfirmedAt: Date
  escalationRunId: string | null
  escalationStatus?: string
  resolvedAt?: Date | null
}

/**
 * Menangani respons pasien terhadap peringatan darurat (CL-205 / AC-4.2).
 * - "SAFE": Pasien aman -> status darurat diselesaikan (RESOLVED_SAFE), eskalasi dibatalkan,
 *   dan keluarga TIDAK dialert.
 * - "NEED_HELP": Pasien membutuhkan bantuan -> mempercepat eskalasi langsung ke tier aktif.
 */
export async function handlePatientEmergencyResponse(
  prisma: EmergencyPrismaClient,
  input: PatientEmergencyResponseInput,
  deps?: EmergencyExecutionDeps,
): Promise<PatientEmergencyResponseResult> {
  const emergency = await prisma.emergencyAlert.findUnique({
    where: { id: input.emergencyId },
    include: {
      escalationRun: true,
      patient: {
        include: {
          user: {
            select: { id: true, fullName: true, phone: true },
          },
        },
      },
    },
  })

  if (!emergency) {
    throw notFound(`Emergency alert dengan ID ${input.emergencyId} tidak ditemukan`)
  }

  const nowFn = deps?.now ?? (() => new Date())
  const currentTime = nowFn()

  // Idempotency guard: jika sudah selesai SAFE dan pasien mengirim SAFE lagi
  if (emergency.status === EmergencyStatus.RESOLVED_SAFE) {
    if (input.response === 'SAFE') {
      return {
        emergencyId: emergency.id,
        status: emergency.status,
        patientConfirmedSafe: emergency.patientConfirmedSafe ?? true,
        patientConfirmedAt: emergency.patientConfirmedAt ?? emergency.updatedAt,
        escalationRunId: emergency.escalationRun?.id ?? null,
        escalationStatus: emergency.escalationRun?.status,
        resolvedAt: emergency.resolvedAt,
      }
    }

    throw invalidTransition(
      `Status darurat saat ini (${emergency.status}) sudah diselesaikan dan tidak dapat diubah lagi`,
      { currentStatus: emergency.status },
    )
  }

  // Jika sudah status terminal lain (misal TIMED_OUT)
  if (emergency.status === EmergencyStatus.TIMED_OUT) {
    throw invalidTransition(
      `Batas waktu konfirmasi darurat sudah habis (TIMED_OUT) dan telah dialihkan ke eskalasi lanjutan`,
      { currentStatus: emergency.status },
    )
  }

  const queueAdapter = deps?.queueAdapter ?? defaultEmergencyQueueAdapter

  if (input.response === 'SAFE') {
    // 1. Perbarui status EmergencyAlert menjadi RESOLVED_SAFE
    const updatedNotes = input.notes
      ? `${emergency.notes ?? ''} | Konfirmasi pasien: ${input.notes}`.trim()
      : emergency.notes

    await prisma.emergencyAlert.update({
      where: { id: emergency.id },
      data: {
        status: EmergencyStatus.RESOLVED_SAFE,
        patientConfirmedSafe: true,
        patientConfirmedAt: currentTime,
        resolvedAt: currentTime,
        notes: updatedNotes,
      },
    })

    // 2. Selesaikan EscalationRun aktif jika ada (AC-4.2: keluarga TIDAK dialert)
    if (emergency.escalationRun && isActiveStatus(emergency.escalationRun.status)) {
      await resolveEscalationRun(prisma, {
        runId: emergency.escalationRun.id,
        actorUserId: input.actorUserId ?? emergency.patient?.user?.id,
        notes: input.notes ?? 'Pasien konfirmasi kondisi aman (SAFE)',
      })

      // Batalkan timer timeout terjadwal di queue adapter jika tersimpan
      const config = emergency.escalationRun.configSnapshot as Record<string, unknown> | null
      if (config && typeof config.jobId === 'string') {
        await queueAdapter.cancelTimeout(config.jobId)
      }

      // Catat langkah konfirmasi sukses di tabel escalation_steps
      await prisma.escalationStep.create({
        data: {
          runId: emergency.escalationRun.id,
          contactUserId: input.actorUserId ?? emergency.patient?.user?.id ?? null,
          contactPhone: emergency.patient?.user?.phone ?? '-',
          channel: Channel.IN_APP,
          messageKey: 'emergency.patient_confirmed_safe',
          sentAt: currentTime,
          respondedAt: currentTime,
          response: 'ACK_HANDLE',
        },
      })
    }

    // 3. Catat ke AuditLog
    await tryCreateAuditLog(prisma as any, {
      actorUserId: input.actorUserId ?? emergency.patient?.user?.id ?? null,
      action: AuditAction.EMERGENCY_RESOLVED,
      resourceType: 'EmergencyAlert',
      resourceId: emergency.id,
      patientId: emergency.patientId,
      meta: {
        response: 'SAFE',
        previousStatus: emergency.status,
        newStatus: EmergencyStatus.RESOLVED_SAFE,
        escalationRunId: emergency.escalationRun?.id ?? null,
      },
    })

    return {
      emergencyId: emergency.id,
      status: EmergencyStatus.RESOLVED_SAFE,
      patientConfirmedSafe: true,
      patientConfirmedAt: currentTime,
      escalationRunId: emergency.escalationRun?.id ?? null,
      escalationStatus: 'RESOLVED',
      resolvedAt: currentTime,
    }
  }

  // JIKA PASIEN MERESPONS "NEED_HELP":
  // Percepat eskalasi darurat langsung ke keluarga/nakes tanpa menunggu sisa waktu timeout pasien (CL-205)
  const updatedNotes = input.notes
    ? `${emergency.notes ?? ''} | Pasien minta bantuan: ${input.notes}`.trim()
    : `${emergency.notes ?? ''} | Pasien merespons butuh bantuan (NEED_HELP)`.trim()

  await prisma.emergencyAlert.update({
    where: { id: emergency.id },
    data: {
      status: EmergencyStatus.ESCALATING,
      patientConfirmedSafe: false,
      patientConfirmedAt: currentTime,
      notes: updatedNotes,
    },
  })

  let newEscalationStatus = emergency.escalationRun?.status

  if (emergency.escalationRun && emergency.escalationRun.status === 'WAITING_PATIENT') {
    // Batalkan timer timeout pasien yang sedang berjalan
    const config = emergency.escalationRun.configSnapshot as Record<string, unknown> | null
    if (config && typeof config.jobId === 'string') {
      await queueAdapter.cancelTimeout(config.jobId)
    }

    // Langsung picu event TIMEOUT pada state machine untuk mempercepat transisi ke tier aktif
    const { run: transitionedRun } = await transitionEscalationRun(prisma, {
      runId: emergency.escalationRun.id,
      event: 'TIMEOUT',
      actorUserId: input.actorUserId ?? emergency.patient?.user?.id,
      notes: 'Pasien merespons butuh bantuan (NEED_HELP), mempercepat eskalasi',
    })

    newEscalationStatus = transitionedRun.status

    // Catat langkah permintaan bantuan di escalation_steps
    await prisma.escalationStep.create({
      data: {
        runId: emergency.escalationRun.id,
        contactUserId: input.actorUserId ?? emergency.patient?.user?.id ?? null,
        contactPhone: emergency.patient?.user?.phone ?? '-',
        channel: Channel.IN_APP,
        messageKey: 'emergency.patient_requested_help',
        sentAt: currentTime,
        respondedAt: currentTime,
        response: 'NONE',
      },
    })
  }

  // Catat ke AuditLog
  await tryCreateAuditLog(prisma as any, {
    actorUserId: input.actorUserId ?? emergency.patient?.user?.id ?? null,
    action: AuditAction.ESCALATION_STEP,
    resourceType: 'EmergencyAlert',
    resourceId: emergency.id,
    patientId: emergency.patientId,
    meta: {
      response: 'NEED_HELP',
      previousStatus: emergency.status,
      newStatus: EmergencyStatus.ESCALATING,
      escalationRunId: emergency.escalationRun?.id ?? null,
      acceleratedToStatus: newEscalationStatus,
    },
  })

  return {
    emergencyId: emergency.id,
    status: EmergencyStatus.ESCALATING,
    patientConfirmedSafe: false,
    patientConfirmedAt: currentTime,
    escalationRunId: emergency.escalationRun?.id ?? null,
    escalationStatus: newEscalationStatus,
    resolvedAt: null,
  }
}

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
  familyContact?: {
    findMany?(args: any): Promise<any>
  }
  nakesContact?: {
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

// ============================================================================
// CL-206: Timeout + Lokasi + Alert Darurat (112) (AC-4.3 / AC-4.4 / AC-4.5 / AC-4.6 / AC-4.7)
// ============================================================================

export interface EmergencyLocationResult {
  hasLocation: boolean
  mapsUrl?: string
  locationText: string
}

/** Format lokasi GPS pasien atau fallback bila GPS tidak aktif (AC-4.3). */
export function formatEmergencyLocation(
  lat?: number | string | null,
  lng?: number | string | null,
): EmergencyLocationResult {
  if (lat != null && lng != null && lat !== '' && lng !== '') {
    const latStr = String(lat)
    const lngStr = String(lng)
    const mapsUrl = `https://maps.google.com/?q=${latStr},${lngStr}`
    return {
      hasLocation: true,
      mapsUrl,
      locationText: `Lokasi terakhir: ${mapsUrl}`,
    }
  }

  return {
    hasLocation: false,
    locationText: 'Lokasi pasien tidak tersedia',
  }
}

export interface EmergencyAlertFamilyMessageInput {
  patientName: string
  patientPhone?: string | null
  hrBpm?: number | null
  anomalyReason?: string | null
  locationText: string
  mapsUrl?: string
}

/** Format pesan peringatan darurat WA untuk keluarga dengan deep link tel:112 (AC-4.3, AC-4.6). */
export function formatEmergencyFamilyAlertMessage(input: EmergencyAlertFamilyMessageInput): {
  body: string
  tel112: string
} {
  const condition = input.hrBpm
    ? `detak jantung abnormal (${input.hrBpm} bpm)`
    : (input.anomalyReason ?? 'detak jantung abnormal')

  const tel112 = 'tel:112'

  const body = [
    `[CareLoop DARURAT] PERINGATAN KONDISI PASIEN!`,
    `Pasien ${input.patientName} mengalami ${condition} dan tidak merespons konfirmasi darurat (Pasien tidak merespons).`,
    input.locationText,
    `Bila membutuhkan pertolongan medis segera, hubungi nomor darurat 112: ${tel112} (tekan untuk membuka panggilan).`,
    input.patientPhone ? `Nomor HP pasien: ${input.patientPhone}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return { body, tel112 }
}

export interface EmergencyAlertNakesMessageInput extends EmergencyAlertFamilyMessageInput {
  livingSituation?: string | null
}

/** Format pesan peringatan darurat untuk Nakes / Kader pembina (AC-4.5, AC-4.6). */
export function formatEmergencyNakesAlertMessage(input: EmergencyAlertNakesMessageInput): {
  body: string
  tel112: string
} {
  const condition = input.hrBpm
    ? `detak jantung abnormal (${input.hrBpm} bpm)`
    : (input.anomalyReason ?? 'detak jantung abnormal')

  const tel112 = 'tel:112'
  const isAlone = input.livingSituation === 'ALONE'
  const situationTag = isAlone ? ' (Pasien Tinggal Sendiri / ALONE)' : ''

  const body = [
    `[CareLoop DARURAT NAKES] PERINGATAN PRIORITAS TINGGI!`,
    `Pasien ${input.patientName}${situationTag} mengalami ${condition} dan tidak merespons konfirmasi darurat.`,
    input.locationText,
    `Mohon nakes/kader pembina segera melakukan pengecekan ke lokasi pasien atau hubungi 112: ${tel112}.`,
    input.patientPhone ? `Nomor HP pasien: ${input.patientPhone}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return { body, tel112 }
}

export interface HandleEmergencyTimeoutInput {
  emergencyId?: string
  runId?: string
  actorUserId?: string | null
  notes?: string
}

export interface HandleEmergencyTimeoutResult {
  emergencyId: string
  escalationRunId: string | null
  status: EmergencyStatus
  previousStatus: EmergencyStatus
  escalationStatus?: string
  hasLocation: boolean
  locationLat: string | number | null
  locationLng: string | number | null
  notifiedFamilyCount: number
  notifiedNakesCount: number
  tel112: string
  alertSentToFamilyAt?: Date | null
  alertSentToNakesAt?: Date | null
  skipped?: boolean
  reason?: string
}

/**
 * Menangani timeout konfirmasi darurat pasien (CL-206).
 * Jika pasien tidak merespons dalam 30–60 detik (default 45s):
 * 1. Ambil lokasi GPS terakhir pasien jika ada (AC-4.3).
 * 2. Transisi escalation run ke tier aktif berikutnya (AC-4.4).
 * 3. Kirim alert WA ke seluruh kontak keluarga aktif terurut tier (AC-4.4).
 * 4. Jika pasien living_situation=alone tanpa tier-1 -> alert nakes otomatis (AC-4.5).
 * 5. Tampilkan tombol/deep link one-tap call 112 (tel:112) tanpa auto-dial (AC-4.6).
 * 6. Catat pembaruan status ke emergency_alerts dan audit_logs (AC-4.7).
 */
export async function handleEmergencyTimeout(
  prisma: EmergencyPrismaClient,
  input: HandleEmergencyTimeoutInput,
  deps?: EmergencyExecutionDeps,
): Promise<HandleEmergencyTimeoutResult> {
  const currentTime = deps?.now ? deps.now() : new Date()
  const waService = deps?.whatsAppService ?? getWhatsAppService()

  // 1. Cari rekaman EmergencyAlert & relasi terkait
  let emergency: any = null
  if (input.emergencyId) {
    emergency = await prisma.emergencyAlert.findUnique({
      where: { id: input.emergencyId },
      include: {
        patient: {
          include: {
            user: { select: { id: true, fullName: true, phone: true } },
            familyContacts: {
              where: { isActive: true },
              orderBy: [{ tier: 'asc' }, { priority: 'asc' }],
            },
            nakesContacts: {
              where: { isActive: true },
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
        escalationRun: {
          include: { steps: true },
        },
      },
    })
  } else if (input.runId) {
    if (prisma.emergencyAlert.findFirst) {
      emergency = await prisma.emergencyAlert.findFirst({
        where: { escalationRun: { id: input.runId } },
        include: {
          patient: {
            include: {
              user: { select: { id: true, fullName: true, phone: true } },
              familyContacts: {
                where: { isActive: true },
                orderBy: [{ tier: 'asc' }, { priority: 'asc' }],
              },
              nakesContacts: {
                where: { isActive: true },
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          },
          escalationRun: {
            include: { steps: true },
          },
        },
      })
    }
    // Fallback bila findFirst belum ada di mock client
    if (!emergency && prisma.escalationRun.findUnique) {
      const run = await prisma.escalationRun.findUnique({
        where: { id: input.runId },
        include: {
          emergency: {
            include: {
              patient: {
                include: {
                  user: { select: { id: true, fullName: true, phone: true } },
                  familyContacts: {
                    where: { isActive: true },
                    orderBy: [{ tier: 'asc' }, { priority: 'asc' }],
                  },
                  nakesContacts: {
                    where: { isActive: true },
                    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                  },
                },
              },
              escalationRun: { include: { steps: true } },
            },
          },
        },
      })
      emergency = run?.emergency ?? null
    }
  }

  if (!emergency) {
    throw notFound(
      `Alert darurat ${input.emergencyId || input.runId || ''} tidak ditemukan untuk penanganan timeout`,
    )
  }

  // 2. Guard Idempotensi / Status Terminal (AC-4.2)
  if (
    emergency.status === EmergencyStatus.RESOLVED_SAFE ||
    emergency.status === EmergencyStatus.HANDLED
  ) {
    return {
      emergencyId: emergency.id,
      escalationRunId: emergency.escalationRun?.id ?? null,
      status: emergency.status,
      previousStatus: emergency.status,
      escalationStatus: emergency.escalationRun?.status,
      hasLocation: Boolean(emergency.locationLat && emergency.locationLng),
      locationLat: emergency.locationLat ? String(emergency.locationLat) : null,
      locationLng: emergency.locationLng ? String(emergency.locationLng) : null,
      notifiedFamilyCount: 0,
      notifiedNakesCount: 0,
      tel112: 'tel:112',
      skipped: true,
      reason: 'EMERGENCY_ALREADY_RESOLVED',
    }
  }

  // Guard anti-spam: jika sudah ESCALATING dan alert sudah pernah terkirim di jendela ini
  const alreadyEscalated =
    emergency.status === EmergencyStatus.ESCALATING &&
    Boolean(emergency.alertSentToFamilyAt || emergency.alertSentToNakesAt)

  if (alreadyEscalated) {
    return {
      emergencyId: emergency.id,
      escalationRunId: emergency.escalationRun?.id ?? null,
      status: emergency.status,
      previousStatus: emergency.status,
      escalationStatus: emergency.escalationRun?.status,
      hasLocation: Boolean(emergency.locationLat && emergency.locationLng),
      locationLat: emergency.locationLat ? String(emergency.locationLat) : null,
      locationLng: emergency.locationLng ? String(emergency.locationLng) : null,
      notifiedFamilyCount: 0,
      notifiedNakesCount: 0,
      tel112: 'tel:112',
      skipped: true,
      reason: 'EMERGENCY_ALREADY_ESCALATED',
    }
  }

  // 3. Ambil lokasi GPS terakhir pasien (AC-4.3)
  const patient = emergency.patient
  const lastLat = patient?.lastKnownLat ?? emergency.locationLat ?? null
  const lastLng = patient?.lastKnownLng ?? emergency.locationLng ?? null
  const { hasLocation, mapsUrl, locationText } = formatEmergencyLocation(lastLat, lastLng)

  const patientName = patient?.user?.fullName ?? 'Pasien'
  const patientPhone = patient?.user?.phone ?? null

  // 4. Transisi EscalationRun via State Machine
  let newEscalationStatus = emergency.escalationRun?.status
  let notifyTargets: string[] = []

  if (emergency.escalationRun && emergency.escalationRun.status === 'WAITING_PATIENT') {
    const { run: transitionedRun, transition } = await transitionEscalationRun(prisma, {
      runId: emergency.escalationRun.id,
      event: 'TIMEOUT',
      actorUserId: input.actorUserId ?? null,
      notes: input.notes ?? 'Pasien tidak merespons konfirmasi darurat (timeout)',
    })
    newEscalationStatus = transitionedRun.status
    notifyTargets = transition.notify
  }

  // 5. Tentukan target notifikasi (AC-4.4 & AC-4.5)
  const activeFamilyContacts: any[] = (patient?.familyContacts ?? []).filter(
    (c: any) => c.isActive !== false,
  )
  const hasTier1 = activeFamilyContacts.some((c: any) => c.tier === 'TIER_1')
  const isAloneWithoutTier1 = patient?.livingSituation === 'ALONE' && !hasTier1
  const shouldAlertNakes = isAloneWithoutTier1 || notifyTargets.includes('NAKES')
  const shouldAlertFamily =
    !isAloneWithoutTier1 &&
    (notifyTargets.includes('FAMILY_TIER_1') ||
      notifyTargets.includes('FAMILY_TIER_2') ||
      activeFamilyContacts.length > 0)

  let notifiedFamilyCount = 0
  let notifiedNakesCount = 0

  // 6. Kirim Alert WA ke Seluruh Kontak Keluarga Aktif Terurut Tier (AC-4.3, AC-4.4, AC-4.6)
  if (shouldAlertFamily) {
    const sortedContacts = [...activeFamilyContacts].sort((a: any, b: any) => {
      if (a.tier !== b.tier) return a.tier === 'TIER_1' ? -1 : 1
      return (a.priority ?? 1) - (b.priority ?? 1)
    })

    const familyMessage = formatEmergencyFamilyAlertMessage({
      patientName,
      patientPhone,
      hrBpm: emergency.hrBpm,
      anomalyReason: emergency.notes,
      locationText,
      mapsUrl,
    })

    for (const contact of sortedContacts) {
      let providerMsgId: string | null = null
      let waError: string | null = null

      if (contact.phone) {
        try {
          const res = await waService.sendText(contact.phone, familyMessage.body)
          providerMsgId = res.providerMessageId
        } catch (err) {
          waError = err instanceof Error ? err.message : String(err)
        }
      }

      if (prisma.notification?.create) {
        await prisma.notification.create({
          data: {
            patientId: patient?.id ?? emergency.patientId,
            userId: contact.userId ?? null,
            channel: Channel.WHATSAPP,
            type: NotificationType.EMERGENCY,
            title: 'Peringatan Darurat: Detak Jantung Pasien Abnormal',
            body: familyMessage.body,
            payload: {
              emergencyAlertId: emergency.id,
              runId: emergency.escalationRun?.id ?? null,
              patientName,
              hrBpm: emergency.hrBpm,
              tier: contact.tier,
              contactName: contact.name,
              contactPhone: contact.phone,
              hasLocation,
              locationLat: lastLat ? String(lastLat) : null,
              locationLng: lastLng ? String(lastLng) : null,
              mapsUrl: mapsUrl ?? null,
              tel112: familyMessage.tel112,
              hasAutoDial: false,
            },
            status: NotificationStatus.SENT,
            sentAt: currentTime,
            providerMessageId: providerMsgId,
            error: waError,
          },
        })
      }

      if (emergency.escalationRun) {
        await prisma.escalationStep.create({
          data: {
            runId: emergency.escalationRun.id,
            tier: contact.tier,
            contactUserId: contact.userId ?? null,
            contactPhone: contact.phone,
            channel: Channel.WHATSAPP,
            messageKey: 'emergency.alert_family',
            sentAt: currentTime,
            response: 'NONE',
            providerMessageId: providerMsgId,
            error: waError,
          },
        })
      }

      notifiedFamilyCount++
    }
  }

  // 7. Alert Nakes Otomatis untuk Pasien ALONE Tanpa Tier-1 (AC-4.5, AC-4.6)
  if (shouldAlertNakes) {
    const nakesContacts = (patient?.nakesContacts ?? []).filter((n: any) => n.isActive !== false)

    const nakesMessage = formatEmergencyNakesAlertMessage({
      patientName,
      patientPhone,
      hrBpm: emergency.hrBpm,
      anomalyReason: emergency.notes,
      locationText,
      mapsUrl,
      livingSituation: patient?.livingSituation,
    })

    for (const nakes of nakesContacts) {
      let providerMsgId: string | null = null
      let waError: string | null = null

      if (nakes.phone) {
        try {
          const res = await waService.sendText(nakes.phone, nakesMessage.body)
          providerMsgId = res.providerMessageId
        } catch (err) {
          waError = err instanceof Error ? err.message : String(err)
        }
      }

      if (prisma.notification?.create) {
        await prisma.notification.create({
          data: {
            patientId: patient?.id ?? emergency.patientId,
            userId: nakes.nakesUserId ?? null,
            channel: Channel.WHATSAPP,
            type: NotificationType.EMERGENCY,
            title: isAloneWithoutTier1
              ? 'Alert Darurat Prioritas: Pasien Tinggal Sendiri (Alone)'
              : 'Alert Darurat Nakes',
            body: nakesMessage.body,
            payload: {
              emergencyAlertId: emergency.id,
              runId: emergency.escalationRun?.id ?? null,
              priority: isAloneWithoutTier1 ? 'HIGH' : 'NORMAL',
              patientName,
              hrBpm: emergency.hrBpm,
              livingSituation: patient?.livingSituation,
              nakesName: nakes.nakesName,
              nakesPhone: nakes.phone,
              hasLocation,
              locationLat: lastLat ? String(lastLat) : null,
              locationLng: lastLng ? String(lastLng) : null,
              mapsUrl: mapsUrl ?? null,
              tel112: nakesMessage.tel112,
              hasAutoDial: false,
            },
            status: NotificationStatus.SENT,
            sentAt: currentTime,
            providerMessageId: providerMsgId,
            error: waError,
          },
        })
      }

      if (emergency.escalationRun) {
        await prisma.escalationStep.create({
          data: {
            runId: emergency.escalationRun.id,
            tier: 'NAKES',
            contactUserId: nakes.nakesUserId ?? null,
            contactPhone: nakes.phone,
            channel: Channel.WHATSAPP,
            messageKey: 'emergency.alert_nakes',
            sentAt: currentTime,
            response: 'NONE',
            providerMessageId: providerMsgId,
            error: waError,
          },
        })
      }

      notifiedNakesCount++
    }

    // Selalu buat notifikasi IN_APP dashboard nakes (CL-208 / AC-4.5)
    if (prisma.notification?.create) {
      await prisma.notification.create({
        data: {
          patientId: patient?.id ?? emergency.patientId,
          userId: null,
          channel: Channel.IN_APP,
          type: NotificationType.EMERGENCY,
          title: isAloneWithoutTier1
            ? 'Alert Darurat Prioritas: Pasien Tinggal Sendiri (Alone)'
            : 'Alert Darurat Nakes',
          body: nakesMessage.body,
          payload: {
            emergencyAlertId: emergency.id,
            runId: emergency.escalationRun?.id ?? null,
            priority: isAloneWithoutTier1 ? 'HIGH' : 'NORMAL',
            patientName,
            hrBpm: emergency.hrBpm,
            livingSituation: patient?.livingSituation,
            hasLocation,
            locationLat: lastLat ? String(lastLat) : null,
            locationLng: lastLng ? String(lastLng) : null,
            mapsUrl: mapsUrl ?? null,
            tel112: nakesMessage.tel112,
            hasAutoDial: false,
          },
          status: NotificationStatus.SENT,
          sentAt: currentTime,
        },
      })
    }
  }

  // 8. Update tabel EmergencyAlert (AC-4.7)
  const familyAlertSentAt = notifiedFamilyCount > 0 ? currentTime : emergency.alertSentToFamilyAt
  const nakesAlertSentAt =
    notifiedNakesCount > 0 || shouldAlertNakes ? currentTime : emergency.alertSentToNakesAt

  const updatedNotes = [
    emergency.notes ?? '',
    `Timeout tercapai (${currentTime.toISOString()}).`,
    hasLocation ? `Lokasi GPS: ${lastLat}, ${lastLng}` : 'Lokasi pasien tidak tersedia.',
    notifiedFamilyCount > 0 ? `Alert dikirim ke ${notifiedFamilyCount} kontak keluarga.` : null,
    shouldAlertNakes ? `Alert nakes dikirim (livingSituation: ${patient?.livingSituation ?? 'ALONE'}).` : null,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  await prisma.emergencyAlert.update({
    where: { id: emergency.id },
    data: {
      status: EmergencyStatus.ESCALATING,
      locationLat: lastLat ? (lastLat as any) : null,
      locationLng: lastLng ? (lastLng as any) : null,
      alertSentToFamilyAt: familyAlertSentAt,
      alertSentToNakesAt: nakesAlertSentAt,
      notes: updatedNotes,
    },
  })

  // 9. Catat ke AuditLog (AC-4.7)
  await tryCreateAuditLog(prisma as any, {
    actorUserId: input.actorUserId ?? patient?.user?.id ?? null,
    action: AuditAction.ESCALATION_STEP,
    resourceType: 'EmergencyAlert',
    resourceId: emergency.id,
    patientId: emergency.patientId,
    meta: {
      event: 'EMERGENCY_TIMEOUT',
      previousStatus: emergency.status,
      newStatus: EmergencyStatus.ESCALATING,
      hasLocation,
      locationLat: lastLat ? String(lastLat) : null,
      locationLng: lastLng ? String(lastLng) : null,
      notifiedFamilyCount,
      notifiedNakesCount,
      livingSituation: patient?.livingSituation,
      tel112: 'tel:112',
      hasAutoDial: false,
    },
  })

  return {
    emergencyId: emergency.id,
    escalationRunId: emergency.escalationRun?.id ?? null,
    status: EmergencyStatus.ESCALATING,
    previousStatus: emergency.status,
    escalationStatus: newEscalationStatus,
    hasLocation,
    locationLat: lastLat ? String(lastLat) : null,
    locationLng: lastLng ? String(lastLng) : null,
    notifiedFamilyCount,
    notifiedNakesCount,
    tel112: 'tel:112',
    alertSentToFamilyAt: familyAlertSentAt,
    alertSentToNakesAt: nakesAlertSentAt,
  }
}

// CL-109: Persistensi Escalation Run & Step ke Database (Prisma).
// Menghubungkan state machine murni (reduceEscalation) ke PostgreSQL secara transaksional,
// menegakkan guard satu run aktif per (patient, context), dan mencatat riwayat langkah
// di tabel escalation_steps (AC-7.4).
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  AuditAction,
  Channel,
  EscalationContext,
  EscalationEventType,
  EscalationRunStatus,
  EscalationStepResponse,
  EscalationTier,
  ResolutionType,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { conflict, notFound } from '../../lib/errors'
import { isUniqueViolation } from '../../lib/idempotency'
import {
  reduceEscalation,
  type EscalationRunContext,
  type TransitionResult,
} from './state-machine'

export const ACTIVE_ESCALATION_STATUSES: readonly EscalationRunStatus[] = [
  'WAITING_PATIENT',
  'FAMILY_TIER_1',
  'FAMILY_TIER_2',
  'NAKES',
] as const

export const TERMINAL_ESCALATION_STATUSES: readonly EscalationRunStatus[] = [
  'HANDLED',
  'RESOLVED',
  'TIMED_OUT',
] as const

export function isActiveStatus(status: EscalationRunStatus): boolean {
  return (ACTIVE_ESCALATION_STATUSES as readonly string[]).includes(status)
}

export function isTerminalStatus(status: EscalationRunStatus): boolean {
  return (TERMINAL_ESCALATION_STATUSES as readonly string[]).includes(status)
}

/** Client yang diterima: PrismaClient penuh, TransactionClient, atau mock duck-typed. */
export type EscalationPrismaClient = {
  escalationRun: {
    findFirst(args: any): Promise<any>
    findUnique(args: any): Promise<any>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    findMany?(args: any): Promise<any>
  }
  escalationStep: {
    create(args: any): Promise<any>
    findMany?(args: any): Promise<any>
  }
  patient: {
    findUnique(args: any): Promise<any>
  }
  auditLog?: {
    create(args: any): Promise<any>
  }
  $transaction?: <T>(fn: (tx: any) => Promise<T>) => Promise<T>
}

async function withTransaction<T>(
  client: EscalationPrismaClient,
  fn: (tx: EscalationPrismaClient) => Promise<T>,
): Promise<T> {
  if ('$transaction' in client && typeof client.$transaction === 'function') {
    return (client.$transaction as (cb: (tx: any) => Promise<T>) => Promise<T>)(fn)
  }
  return fn(client)
}

export interface CreateEscalationStepInput {
  tier?: EscalationTier | null
  contactUserId?: string | null
  contactPhone: string
  channel?: Channel
  messageKey: string
  sentAt?: Date | null
  deliveredAt?: Date | null
  readAt?: Date | null
  respondedAt?: Date | null
  response?: EscalationStepResponse
  providerMessageId?: string | null
  error?: string | null
}

export interface StartEscalationRunInput {
  patientId: string
  context: EscalationContext
  sourceScheduleId?: string | null
  sourceEmergencyId?: string | null
  configSnapshot?: Record<string, unknown> | null
  /**
   * Jika true (default sesuai AC-CL-109): run aktif lama dengan (patientId, context) yang sama
   * otomatis dibatalkan (status: RESOLVED, resolutionType: CANCELLED).
   * Jika false: melempar 409 CONFLICT jika sudah ada run aktif.
   */
  cancelExisting?: boolean
  /** Langkah awal yang dicatat saat run dibuat (misal NOTIFIED_PATIENT). */
  initialStep?: CreateEscalationStepInput
}

export interface TransitionEscalationRunInput {
  runId: string
  event: EscalationEventType
  /** Konteks pasien (hasTier1, hasTier2, nakesFirst). Jika tidak diisi, dibaca dari DB. */
  context?: EscalationRunContext
  actorUserId?: string | null
  notes?: string | null
  /** Step kustom untuk mencatat pengiriman alert atau respons pada transisi ini. */
  step?: CreateEscalationStepInput
  steps?: CreateEscalationStepInput[]
}

export interface ResolveEscalationRunInput {
  runId: string
  actorUserId?: string | null
  notes?: string | null
}

export interface HandleEscalationRunInput {
  runId: string
  /**
   * Aktor penangani. `null` sah untuk kontak yang belum punya akun `users`
   * (mis. keluarga yang cuma disimpan sebagai nomor HP) — yang penting run tetap
   * tercatat ditangani, bukan diisi dengan id orang lain.
   */
  actorUserId: string | null
  actorRole: 'FAMILY' | 'NAKES'
  notes?: string | null
}

export interface CancelEscalationRunInput {
  runId: string
  actorUserId?: string | null
  reason?: string | null
}

/** Membaca konteks eskalasi pasien dari tabel Patient & FamilyContact. */
export async function resolvePatientEscalationContext(
  client: EscalationPrismaClient,
  patientId: string,
): Promise<EscalationRunContext> {
  const patient = await client.patient.findUnique({
    where: { id: patientId },
    select: {
      emergencyPreference: true,
      livingSituation: true,
      familyContacts: {
        where: { isActive: true },
        select: { tier: true },
      },
    },
  })

  if (!patient) {
    throw notFound(`Data pasien ${patientId} tidak ditemukan untuk eskalasi`)
  }

  const contacts = (patient.familyContacts ?? []).filter(
    (c: { tier: string; isActive?: boolean }) => c.isActive !== false,
  )
  const hasTier1 = contacts.some((c: { tier: string }) => c.tier === 'TIER_1')
  let hasTier2 = contacts.some((c: { tier: string }) => c.tier === 'TIER_2')
  let nakesFirst = patient.emergencyPreference === 'NAKES_FIRST'

  // AC-4.5: Pasien dengan living_situation=alone dan tanpa family tier-1 aktif -> alert nakes otomatis (langsung nakes)
  if (patient.livingSituation === 'ALONE' && !hasTier1) {
    nakesFirst = true
    hasTier2 = false
  }

  return { hasTier1, hasTier2, nakesFirst }
}

/**
 * Memulai EscalationRun baru dengan guard transaksional.
 * Hanya 1 run aktif per (patientId, context).
 * Jika ada run aktif sebelumnya dan cancelExisting=true (default), run lama dibatalkan.
 */
export async function startEscalationRun(
  client: EscalationPrismaClient,
  input: StartEscalationRunInput,
): Promise<any> {
  const cancelExisting = input.cancelExisting ?? true

  return withTransaction(client, async (tx) => {
    // 1. Cek run aktif yang sudah ada untuk (patientId, context)
    const existingActive = await tx.escalationRun.findFirst({
      where: {
        patientId: input.patientId,
        context: input.context,
        status: { in: ACTIVE_ESCALATION_STATUSES as EscalationRunStatus[] },
      },
    })

    if (existingActive) {
      if (!cancelExisting) {
        throw conflict('Pasien sudah memiliki eskalasi aktif untuk konteks ini', {
          activeRunId: existingActive.id,
          context: input.context,
        })
      }

      // Batalkan run aktif lama
      const cancelTime = new Date()
      await tx.escalationRun.update({
        where: { id: existingActive.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'CANCELLED',
          resolvedAt: cancelTime,
        },
      })

      // Catat langkah pembatalan di run lama
      await tx.escalationStep.create({
        data: {
          runId: existingActive.id,
          tier: existingActive.currentTier,
          contactPhone: '-',
          channel: 'PUSH',
          messageKey: 'run.cancelled_by_new_run',
          sentAt: cancelTime,
          response: 'NONE',
        },
      })
    }

    // 2. Buat EscalationRun baru
    let newRun: any
    try {
      newRun = await tx.escalationRun.create({
        data: {
          patientId: input.patientId,
          context: input.context,
          sourceScheduleId: input.sourceScheduleId ?? null,
          sourceEmergencyId: input.sourceEmergencyId ?? null,
          status: 'WAITING_PATIENT',
          currentTier: null,
          startedAt: new Date(),
          configSnapshot: input.configSnapshot ? (input.configSnapshot as Prisma.InputJsonValue) : undefined,
        },
      })
    } catch (error) {
      if (isUniqueViolation(error, 'EscalationRun_active_patient_context_key')) {
        throw conflict('Pasien sudah memiliki eskalasi aktif untuk konteks ini', {
          context: input.context,
        })
      }
      throw error
    }

    // 3. Simpan initial step jika ada
    if (input.initialStep) {
      await tx.escalationStep.create({
        data: {
          runId: newRun.id,
          tier: input.initialStep.tier ?? null,
          contactUserId: input.initialStep.contactUserId ?? null,
          contactPhone: input.initialStep.contactPhone,
          channel: input.initialStep.channel ?? 'WHATSAPP',
          messageKey: input.initialStep.messageKey,
          sentAt: input.initialStep.sentAt ?? new Date(),
          deliveredAt: input.initialStep.deliveredAt ?? null,
          readAt: input.initialStep.readAt ?? null,
          respondedAt: input.initialStep.respondedAt ?? null,
          response: input.initialStep.response ?? 'NONE',
          providerMessageId: input.initialStep.providerMessageId ?? null,
          error: input.initialStep.error ?? null,
        },
      })
    }

    // 4. Catat ke AuditLog bila client mendukung
    if (tx.auditLog) {
      await tryCreateAuditLog(tx as any, {
        action: AuditAction.ESCALATION_STEP,
        resourceType: 'escalation_run',
        resourceId: newRun.id,
        patientId: input.patientId,
        meta: {
          action: 'START_RUN',
          context: input.context,
          sourceScheduleId: input.sourceScheduleId,
          sourceEmergencyId: input.sourceEmergencyId,
          replacedActiveRunId: existingActive?.id ?? null,
        },
      })
    }

    // Kembalikan run lengkap beserta step
    return tx.escalationRun.findUnique({
      where: { id: newRun.id },
      include: { steps: true },
    })
  })
}

/**
 * Melakukan transisi state machine pada run eskalasi, memperbarui status di DB,
 * dan mencatat langkah transisi di escalation_steps secara transaksional (AC-7.4).
 */
export async function transitionEscalationRun(
  client: EscalationPrismaClient,
  input: TransitionEscalationRunInput,
): Promise<{ run: any; transition: TransitionResult }> {
  return withTransaction(client, async (tx) => {
    const run = await tx.escalationRun.findUnique({
      where: { id: input.runId },
      include: { steps: true },
    })

    if (!run) {
      throw notFound(`Escalation run ${input.runId} tidak ditemukan`)
    }

    // State machine murni melempar InvalidTransitionError jika run sudah di status final
    const ctx = input.context ?? (await resolvePatientEscalationContext(tx, run.patientId))
    const transition = reduceEscalation(run.status, input.event, ctx)

    // Tentukan perubahan tier dan penyelesaian
    let nextTier: EscalationTier | null = run.currentTier
    if (transition.to === 'FAMILY_TIER_1') nextTier = 'TIER_1'
    else if (transition.to === 'FAMILY_TIER_2') nextTier = 'TIER_2'
    else if (transition.to === 'NAKES') nextTier = 'NAKES'

    const now = new Date()
    let resolvedAt: Date | undefined
    let resolutionType: ResolutionType | undefined
    let resolvedByUserId: string | null | undefined

    if (transition.to === 'RESOLVED') {
      resolvedAt = now
      resolutionType = input.event === 'PATIENT_CONFIRMED' ? 'PATIENT_CONFIRMED' : 'CANCELLED'
      resolvedByUserId = input.actorUserId ?? null
    } else if (transition.to === 'HANDLED') {
      resolvedAt = now
      resolutionType = input.event === 'FAMILY_HANDLED' ? 'FAMILY_HANDLED' : 'NAKES_HANDLED'
      resolvedByUserId = input.actorUserId ?? null
    } else if (transition.to === 'TIMED_OUT') {
      resolvedAt = now
      resolutionType = 'TIMEOUT'
    }

    // Perbarui EscalationRun di DB
    await tx.escalationRun.update({
      where: { id: run.id },
      data: {
        status: transition.to,
        currentTier: nextTier,
        resolvedAt,
        resolutionType,
        resolvedByUserId,
      },
    })

    // Tulis step(s) ke escalation_steps (AC-7.4)
    const stepsToCreate: CreateEscalationStepInput[] = []
    if (input.steps && input.steps.length > 0) {
      stepsToCreate.push(...input.steps)
    } else if (input.step) {
      stepsToCreate.push(input.step)
    } else {
      // Default auto-step untuk mencatat histori transisi jika pemanggil tidak memasok step kustom
      stepsToCreate.push({
        tier: nextTier,
        contactUserId: input.actorUserId ?? null,
        contactPhone: '-',
        channel: 'WHATSAPP',
        messageKey: `transition.${input.event.toLowerCase()}`,
        sentAt: now,
        response:
          input.event === 'FAMILY_HANDLED' || input.event === 'NAKES_HANDLED'
            ? 'ACK_HANDLE'
            : 'NONE',
      })
    }

    for (const stepInput of stepsToCreate) {
      await tx.escalationStep.create({
        data: {
          runId: run.id,
          tier: stepInput.tier ?? nextTier,
          contactUserId: stepInput.contactUserId ?? null,
          contactPhone: stepInput.contactPhone,
          channel: stepInput.channel ?? 'WHATSAPP',
          messageKey: stepInput.messageKey,
          sentAt: stepInput.sentAt ?? now,
          deliveredAt: stepInput.deliveredAt ?? null,
          readAt: stepInput.readAt ?? null,
          respondedAt: stepInput.respondedAt ?? null,
          response: stepInput.response ?? 'NONE',
          providerMessageId: stepInput.providerMessageId ?? null,
          error: stepInput.error ?? null,
        },
      })
    }

    // Audit log
    if (tx.auditLog) {
      const auditAction =
        transition.to === 'HANDLED'
          ? AuditAction.ESCALATION_HANDLED
          : AuditAction.ESCALATION_STEP
      await tryCreateAuditLog(tx as any, {
        action: auditAction,
        actorUserId: input.actorUserId,
        resourceType: 'escalation_run',
        resourceId: run.id,
        patientId: run.patientId,
        meta: {
          from: run.status,
          to: transition.to,
          event: input.event,
          notify: transition.notify,
          notes: input.notes,
        },
      })
    }

    const updatedRun = await tx.escalationRun.findUnique({
      where: { id: run.id },
      include: { steps: true },
    })

    return { run: updatedRun, transition }
  })
}

/** Helper saat pasien mengonfirmasi minum obat -> run diselesaikan (RESOLVED). */
export async function resolveEscalationRun(
  client: EscalationPrismaClient,
  input: ResolveEscalationRunInput,
): Promise<{ run: any; transition: TransitionResult }> {
  return transitionEscalationRun(client, {
    runId: input.runId,
    event: 'PATIENT_CONFIRMED',
    actorUserId: input.actorUserId,
    notes: input.notes,
  })
}

/** Helper saat keluarga / nakes mengambil tindakan -> run ditandai (HANDLED). */
export async function handleEscalationRun(
  client: EscalationPrismaClient,
  input: HandleEscalationRunInput,
): Promise<{ run: any; transition: TransitionResult }> {
  const event: EscalationEventType =
    input.actorRole === 'FAMILY' ? 'FAMILY_HANDLED' : 'NAKES_HANDLED'
  return transitionEscalationRun(client, {
    runId: input.runId,
    event,
    actorUserId: input.actorUserId,
    notes: input.notes,
  })
}

/** Helper untuk membatalkan run aktif secara eksplisit (misal jadwal obat dihapus/diubah). */
export async function cancelEscalationRun(
  client: EscalationPrismaClient,
  input: CancelEscalationRunInput,
): Promise<any> {
  return withTransaction(client, async (tx) => {
    const run = await tx.escalationRun.findUnique({
      where: { id: input.runId },
    })
    if (!run) {
      throw notFound(`Escalation run ${input.runId} tidak ditemukan`)
    }

    if (isTerminalStatus(run.status)) {
      return run
    }

    const now = new Date()
    const updated = await tx.escalationRun.update({
      where: { id: run.id },
      data: {
        status: 'RESOLVED',
        resolutionType: 'CANCELLED',
        resolvedAt: now,
        resolvedByUserId: input.actorUserId ?? null,
      },
    })

    await tx.escalationStep.create({
      data: {
        runId: run.id,
        tier: run.currentTier,
        contactPhone: '-',
        channel: 'PUSH',
        messageKey: 'run.cancelled_manually',
        sentAt: now,
        response: 'NONE',
      },
    })

    return updated
  })
}

/** Mengambil run aktif untuk pasien pada konteks tertentu jika ada. */
export async function getActiveEscalationRun(
  client: EscalationPrismaClient,
  patientId: string,
  context: EscalationContext,
): Promise<any | null> {
  return client.escalationRun.findFirst({
    where: {
      patientId,
      context,
      status: { in: ACTIVE_ESCALATION_STATUSES as EscalationRunStatus[] },
    },
    include: { steps: true },
  })
}

/** Mengambil escalation run berdasarkan ID. */
export async function getEscalationRunById(
  client: EscalationPrismaClient,
  runId: string,
): Promise<any | null> {
  return client.escalationRun.findUnique({
    where: { id: runId },
    include: {
      steps: true,
      patient: {
        select: {
          id: true,
          nik: true,
          livingSituation: true,
          emergencyPreference: true,
        },
      },
      resolvedByUser: {
        select: {
          id: true,
          fullName: true,
          role: true,
        },
      },
    },
  })
}

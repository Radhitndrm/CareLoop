// CL-112: Dispatcher intent tombol WhatsApp → domain service.
//
// Reply tombol di WhatsApp berakhir di satu tempat: `dispatchWaIntent`. Webhook produksi
// (`modules/webhook`) dan WhatsApp Simulator (`/v1/dev/whatsapp/*`) sama-sama memanggil
// fungsi ini, jadi tidak ada cabang bisnis khusus simulator — perubahan state pada demo
// melewati service yang sama persis dengan perubahan state di produksi.
//
// Yang dilakukan di sini, dan hanya di sini:
//   1. memastikan resource id ada dan skemanya cocok dengan intent;
//   2. memastikan pengirim adalah orang yang berhak atas resource itu (scope check) —
//      nomor yang salah harus ditolak, bukan diam-diam dicatat;
//   3. meneruskan ke service domain yang sudah ada (compliance / emergency / escalation).
//
// Dispatcher tidak mengubah status langsung dan tidak menulis tabel domain sendiri.
import { toWaId } from '../../integrations/whatsapp/whatsapp.service'
import { WaButtonIntent } from '../../integrations/whatsapp/parser'
import type { JobQueue } from '../../lib/queue'
import { forbidden, invalidTransition, notFound } from '../../lib/errors'
import type { ReminderJobPayload } from '../reminders/reminder.worker'
import {
  confirmMedicationIntake,
  deferMedicationIntake,
  type CompliancePrismaClient,
} from '../compliance/compliance.service'
import {
  handlePatientEmergencyResponse,
  type EmergencyExecutionDeps,
} from '../emergency/emergency.service'
import { handleEscalationRun } from '../escalation/escalation.service'

export type WaIntent = WaButtonIntent
export type WaIntentResourceType = 'schedule' | 'emergency' | 'escalation'

export interface WaIntentPrismaClient {
  schedule: { findUnique(args: any): Promise<any> }
  emergencyAlert: { findUnique(args: any): Promise<any> }
  escalationRun: { findUnique(args: any): Promise<any> }
  user: { findFirst(args: any): Promise<any> }
  familyContact: { findMany(args: any): Promise<any[]> }
  nakesContact: { findMany(args: any): Promise<any[]> }
}

/** Aktor yang menekan tombol. `actorRole` decides event mana yang dipakai state machine. */
export interface WaIntentActor {
  userId: string | null
  role: 'PATIENT' | 'FAMILY' | 'NAKES'
}

export interface DispatchWaIntentInput {
  intent: WaIntent
  /** Id pada button id: scheduleId / emergencyId / escalationRunId. */
  resourceId: string | null
  /** Nomor WhatsApp pengirim — dipakai untuk pengecekan scope. */
  actorPhone?: string | null
  sourceMessageId?: string | null
  notes?: string | null
  now?: Date
}

export interface DispatchWaIntentDeps {
  prisma: WaIntentPrismaClient
  /** Queue reminder susulan untuk intent DEFER. */
  reminderQueue?: JobQueue<ReminderJobPayload> | null
  /** Dep eksekusi darurat (WhatsApp + queue timeout). */
  emergency?: EmergencyExecutionDeps
}

export interface DispatchWaIntentResult {
  intent: WaIntent
  resourceType: WaIntentResourceType
  resourceId: string
  /** Ringkasan singkat untuk audit & panel simulator. */
  outcome: string
  details: Record<string, unknown>
}

/** Intent apa resource id-nyaschedule / emergency / escalation. */
export function resourceTypeForIntent(intent: WaIntent): WaIntentResourceType {
  switch (intent) {
    case WaButtonIntent.CONFIRM_TAKEN:
    case WaButtonIntent.DEFER:
      return 'schedule'
    case WaButtonIntent.SAFE:
    case WaButtonIntent.NEED_HELP:
      return 'emergency'
    case WaButtonIntent.HANDLE:
      return 'escalation'
  }
}

function requireResourceId(intent: WaIntent, resourceId: string | null): string {
  if (!resourceId || resourceId.trim() === '') {
    throw invalidTransition(
      `Tombol ${intent} tidak membawa id resource — reply tanpa tahu resource mana tidak boleh diproses`,
    )
  }
  return resourceId.trim()
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  try {
    return toWaId(phone)
  } catch {
    return null
  }
}

function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a)
  const right = normalizePhone(b)
  return left !== null && right !== null && left === right
}

async function findUserByPhone(client: WaIntentPrismaClient, phone: string): Promise<any> {
  const candidates = [phone, normalizePhone(phone)].filter((v): v is string => Boolean(v))
  if (candidates.length === 0) return null
  return client.user.findFirst({
    where: { OR: [{ phone: { in: candidates } }, { phone: `+${candidates[0]}` }] },
    select: { id: true, phone: true, role: true },
  })
}

export async function dispatchWaIntent(
  deps: DispatchWaIntentDeps,
  input: DispatchWaIntentInput,
): Promise<DispatchWaIntentResult> {
  const { prisma } = deps
  const resourceId = requireResourceId(input.intent, input.resourceId)
  const resourceType = resourceTypeForIntent(input.intent)

  if (resourceType === 'schedule') {
    return dispatchComplianceIntent(deps, input, resourceId)
  }
  if (resourceType === 'emergency') {
    return dispatchEmergencyIntent(deps, input, resourceId)
  }
  return dispatchEscalationIntent(deps, input, resourceId)
}

// ---------------------------------------------------------------- reminder: CONFIRM_TAKEN / DEFER

async function dispatchComplianceIntent(
  deps: DispatchWaIntentDeps,
  input: DispatchWaIntentInput,
  scheduleId: string,
): Promise<DispatchWaIntentResult> {
  const { prisma } = deps
  const complianceClient = prisma as unknown as CompliancePrismaClient

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      patientId: true,
      patient: { select: { user: { select: { id: true, phone: true } } } },
    },
  })

  if (!schedule) throw notFound(`Jadwal ${scheduleId} tidak ditemukan`)

  const patientPhone = schedule.patient?.user?.phone ?? null
  if (input.actorPhone && !samePhone(input.actorPhone, patientPhone)) {
    throw forbidden('Nomor ini bukan milik pasien pada jadwal tersebut')
  }

  const actorUserId = schedule.patient?.user?.id ?? schedule.patientId ?? null

  if (input.intent === WaButtonIntent.CONFIRM_TAKEN) {
    const result = await confirmMedicationIntake(complianceClient, {
      scheduleId,
      channel: 'WHATSAPP',
      sourceMessageId: input.sourceMessageId ?? null,
      notes: input.notes ?? null,
      actorUserId,
      now: input.now,
    })

    return {
      intent: input.intent,
      resourceType: 'schedule',
      resourceId: scheduleId,
      outcome: result.status,
      details: {
        logId: result.log.id,
        scheduledAt: result.scheduledAt.toISOString(),
        escalationRunId: result.escalationRunId,
        escalationResolved: result.escalationResolved,
      },
    }
  }

  const result = await deferMedicationIntake(
    complianceClient,
    {
      scheduleId,
      channel: 'WHATSAPP',
      notes: input.notes ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      actorUserId,
      now: input.now,
    },
    deps.reminderQueue
      ? {
          enqueueReminder: async ({ scheduleId: id, dueAt }) =>
            deps.reminderQueue!.schedule(
              { scheduleId: id, dueAt: dueAt.toISOString() },
              Math.max(0, dueAt.getTime() - (input.now ?? new Date()).getTime()),
              { jobId: `reminder-${id}-defer-${dueAt.getTime()}` },
            ),
        }
      : {},
  )

  return {
    intent: input.intent,
    resourceType: 'schedule',
    resourceId: scheduleId,
    outcome: 'TUNDA',
    details: {
      logId: result.log.id,
      scheduledAt: result.scheduledAt.toISOString(),
      deferredUntil: result.deferredUntil.toISOString(),
      minutes: result.minutes,
      reminderJobId: result.reminderJobId,
      escalationRunId: result.escalationRunId,
      alreadyDeferred: result.alreadyDeferred,
    },
  }
}

// ---------------------------------------------------------------- emergency: SAFE / NEED_HELP

async function dispatchEmergencyIntent(
  deps: DispatchWaIntentDeps,
  input: DispatchWaIntentInput,
  emergencyId: string,
): Promise<DispatchWaIntentResult> {
  const { prisma } = deps

  const alert = await prisma.emergencyAlert.findUnique({
    where: { id: emergencyId },
    select: {
      id: true,
      patientId: true,
      patient: { select: { user: { select: { id: true, phone: true } } } },
    },
  })

  if (!alert) throw notFound(`Peringatan darurat ${emergencyId} tidak ditemukan`)

  if (input.actorPhone && !samePhone(input.actorPhone, alert.patient?.user?.phone)) {
    throw forbidden('Nomor ini bukan milik pasien pada peringatan darurat tersebut')
  }

  const response = input.intent === WaButtonIntent.SAFE ? 'SAFE' : 'NEED_HELP'
  const result = await handlePatientEmergencyResponse(prisma as any, {
    emergencyId,
    response,
    actorUserId: alert.patient?.user?.id ?? alert.patientId ?? null,
    notes: input.notes ?? null,
  }, deps.emergency)

  return {
    intent: input.intent,
    resourceType: 'emergency',
    resourceId: emergencyId,
    outcome: response,
    details: {
      status: result.status,
      patientConfirmedSafe: result.patientConfirmedSafe,
      escalationRunId: result.escalationRunId,
      escalationStatus: result.escalationStatus ?? null,
    },
  }
}

// ---------------------------------------------------------------- escalation: HANDLE

async function dispatchEscalationIntent(
  deps: DispatchWaIntentDeps,
  input: DispatchWaIntentInput,
  runId: string,
): Promise<DispatchWaIntentResult> {
  const { prisma } = deps

  const run = await prisma.escalationRun.findUnique({
    where: { id: runId },
    select: { id: true, patientId: true, status: true },
  })

  if (!run) throw notFound(`Eskalasi ${runId} tidak ditemukan`)

  const actor = await resolveEscalationActor(prisma, run.patientId, input.actorPhone)

  // Families & nakes hanya boleh menutup escalation milik pasien yang mereka hubungi.
  // Tanpa nomor (mis. dipanggil dari panel tanpa identitas pengirim) actor ditolak:
  // "saya tangani" tanpa tahu escalation siapa tidak boleh menutup alarm orang lain.
  if (!actor) {
    throw forbidden(
      'Nomor pengirim bukan kontak keluarga maupun nakes pada eskalasi ini',
    )
  }

  const { run: updated, transition } = await handleEscalationRun(prisma as any, {
    runId,
    actorUserId: actor.userId,
    actorRole: actor.role === 'NAKES' ? 'NAKES' : 'FAMILY',
    notes: input.notes ?? null,
  })

  return {
    intent: input.intent,
    resourceType: 'escalation',
    resourceId: runId,
    outcome: transition.to,
    details: {
      status: updated.status,
      currentTier: updated.currentTier ?? null,
      resolutionType: updated.resolutionType ?? null,
      actorRole: actor.role,
    },
  }
}

/**
 * Petakan nomor pengirim ke aktor pada eskalasi seorang pasien: user (kalau ada di
 * `users`), lalu kontak keluarga, lalu kontak nakes. Dipakai untuk menentukan event
 * state machine (FAMILY_HANDLED vs NAKES_HANDLED) sekaligus menyaring penerima yang salah.
 */
export async function resolveEscalationActor(
  client: WaIntentPrismaClient,
  patientId: string,
  actorPhone: string | null | undefined,
): Promise<WaIntentActor | null> {
  if (!actorPhone) return null

  const user = await findUserByPhone(client, actorPhone)
  if (user) {
    return {
      userId: user.id,
      role: user.role === 'NAKES' ? 'NAKES' : user.role === 'FAMILY' ? 'FAMILY' : 'PATIENT',
    }
  }

  const [family, nakes] = await Promise.all([
    client.familyContact.findMany({
      where: { patientId },
      select: { phone: true, userId: true },
    }),
    client.nakesContact.findMany({
      where: { patientId },
      select: { phone: true, nakesUserId: true },
    }),
  ])

  const familyHit = family.find((c: any) => samePhone(c.phone, actorPhone))
  if (familyHit) return { userId: familyHit.userId ?? null, role: 'FAMILY' }

  const nakesHit = nakes.find((c: any) => samePhone(c.phone, actorPhone))
  if (nakesHit) return { userId: nakesHit.nakesUserId ?? null, role: 'NAKES' }

  return null
}
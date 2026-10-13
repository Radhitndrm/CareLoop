// Lapisan database untuk aktivasi pasien. Aturannya ada di `activation.ts` (murni);
// file ini hanya menambah/mengambil baris dan menegakkan aturan tersebut.
//
// Caregiver yang boleh memutuskan aktivasi: DOKTER/BIDAN (keputusan klinis) dan
// ADMIN (kebijakan organisasi). PERAWAT/KADER boleh melengkapi data dan membuat
// draft resep, tapi tidak boleh menaikkan status menjadi ACTIVE — itu keputusan
// klinis yang tidak boleh diambil dari UI alone (guardrail flow §3).
import type { AuthUserClaims } from '@careloop/shared'
import { AuditAction, PatientStatus } from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { badRequest, forbidden, notFound } from '../../lib/errors'
import { assertPatientInScope, type AuditContext, type PatientsPrismaClient } from './patients.service'
import {
  evaluateActivation,
  patientStatusTransitionError,
  type ActivationChecklist,
  type ActivationSubject,
} from './activation'

export type ActivationPrismaClient = PatientsPrismaClient & {
  familyContact: {
    count(args: any): Promise<number>
  }
  nakesContact: {
    create(args: any): Promise<any>
    findMany(args: any): Promise<any[]>
    count(args: any): Promise<number>
  }
  medication: {
    count(args: any): Promise<number>
  }
  schedule: {
    count(args: any): Promise<number>
  }
}

/**
 * Satu query untuk seluruh bahan checklist. Menghitung lewat `count` per syarat
 * lebih jelas daripada memuat seluruh koleksi, dan pasangannya sudah di-index.
 */
async function loadActivationSubject(
  client: ActivationPrismaClient,
  patientId: string,
): Promise<ActivationSubject | null> {
  const patient = await client.patient.findUnique({
    where: { id: patientId },
    select: {
      status: true,
      primaryPuskesmas: { select: { isActive: true } },
      healthConditions: true,
      emergencyPreference: true,
      address: true,
      districtCode: true,
      dateOfBirth: true,
      gender: true,
      user: { select: { fullName: true, phone: true, isVerified: true, consentPdpAt: true } },
    },
  })
  if (!patient) return null

  const [activeFamilyContacts, activeNakesContacts, approvedMedications, activeSchedules] =
    await Promise.all([
      client.familyContact.count({ where: { patientId, isActive: true } }),
      client.nakesContact.count({ where: { patientId, isActive: true } }),
      client.medication.count({ where: { patientId, status: 'APPROVED' } }),
      client.schedule.count({ where: { patientId, isActive: true, status: 'APPROVED' } }),
    ])

  return {
    status: patient.status,
    primaryPuskesmas: patient.primaryPuskesmas,
    consentPdpAt: patient.user.consentPdpAt,
    consentShareWithNakes: true,
    isVerified: patient.user.isVerified,
    phone: patient.user.phone,
    fullName: patient.user.fullName,
    dateOfBirth: patient.dateOfBirth,
    gender: patient.gender,
    address: patient.address,
    districtCode: patient.districtCode,
    healthConditions: patient.healthConditions,
    emergencyPreference: patient.emergencyPreference,
    activeFamilyContacts,
    activeNakesContacts,
    approvedMedications,
    activeSchedules,
  }
}

/** GET /v1/patients/:id/activation — checklist untuk UI dan untuk pesan 422. */
export async function getPatientActivation(
  client: ActivationPrismaClient,
  claims: Parameters<typeof assertPatientInScope>[1],
  patientId: string,
): Promise<ActivationChecklist> {
  await assertPatientInScope(client as PatientsPrismaClient, claims, patientId)

  const subject = await loadActivationSubject(client, patientId)
  if (!subject) throw notFound('Pasien tidak ditemukan')

  return evaluateActivation(subject)
}

/** Peran yang boleh menaikkan status pasien menjadi ACTIVE. */
export const ACTIVATION_AUTHORITY_ROLES = ['DOKTER', 'BIDAN'] as const

function assertCanDecide(claims: AuthUserClaims): void {
  if (claims.role === 'ADMIN') return
  if (claims.role === 'NAKES' && ACTIVATION_AUTHORITY_ROLES.includes(claims.nakesRole as any)) return
  throw forbidden('Hanya dokter, bidan, atau admin yang dapat mengaktifkan pasien')
}

export interface ChangePatientStatusParams {
  patientId: string
  to: PatientStatus
  reason?: string
  claims: AuthUserClaims
  audit: AuditContext
  now?: () => Date
}

export interface PatientStatusResult {
  id: string
  status: PatientStatus
  checklist: ActivationChecklist
}

/**
 * POST /v1/patients/:id/activate — satu-satunya jalan menuju ACTIVE.
 *
 * Checklist dihitung ulang di sini, bukan dipercaya dari klien: UI hanya menampilkan
 * checklist, keputusan tetap dihitung ulang di server (guardrail flow §3).
 */
export async function activatePatient(
  client: ActivationPrismaClient,
  params: ChangePatientStatusParams,
): Promise<PatientStatusResult> {
  await assertPatientInScope(client as PatientsPrismaClient, params.claims, params.patientId)
  assertCanDecide(params.claims)

  const subject = await loadActivationSubject(client, params.patientId)
  if (!subject) throw notFound('Pasien tidak ditemukan')

  const transitionError = patientStatusTransitionError(subject.status, params.to)
  if (transitionError) throw badRequest(transitionError)

  const checklist = evaluateActivation(subject)
  if (!checklist.ready) {
    throw badRequest('Pasien belum memenuhi syarat aktivasi', {
      blockers: checklist.blockers.map((check) => ({
        key: check.key,
        label: check.label,
        detail: check.detail,
        fixPath: check.fixPath,
      })),
    })
  }

  const now = params.now?.() ?? new Date()
  const updated = await client.patient.update({
    where: { id: params.patientId },
    data: { status: PatientStatus.ACTIVE, activatedAt: now, activatedById: params.claims.sub },
    select: { id: true, status: true },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_ACTIVATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { from: subject.status, to: PatientStatus.ACTIVE },
  })

  return { id: updated.id, status: updated.status, checklist }
}

/**
 * PATCH /v1/patients/:id/status — penangguhan (INACTIVE/BLOCKED) dan pemulihan.
 * Menuju ACTIVE tetap harus lewat `activatePatient` supaya checklist tidak bisa dilewati.
 */
export async function changePatientStatus(
  client: ActivationPrismaClient,
  params: ChangePatientStatusParams,
): Promise<PatientStatusResult> {
  await assertPatientInScope(client as PatientsPrismaClient, params.claims, params.patientId)
  assertCanDecide(params.claims)

  const subject = await loadActivationSubject(client, params.patientId)
  if (!subject) throw notFound('Pasien tidak ditemukan')

  if (params.to === PatientStatus.ACTIVE) {
    throw badRequest('Gunakan endpoint aktivasi agar seluruh prasyarat diperiksa')
  }

  const transitionError = patientStatusTransitionError(subject.status, params.to)
  if (transitionError) throw badRequest(transitionError)

  const updated = await client.patient.update({
    where: { id: params.patientId },
    data: {
      status: params.to,
      deactivatedReason: params.reason ?? null,
    },
    select: { id: true, status: true },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_STATUS_CHANGED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { from: subject.status, to: params.to, reason: params.reason ?? null },
  })

  return { id: updated.id, status: updated.status, checklist: evaluateActivation(subject) }
}
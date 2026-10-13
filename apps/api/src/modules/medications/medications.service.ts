// Tahap 2 alur: resep & jadwal obat.
//
// Pembagian tanggung jawab klinis (docs/API.md §3.2):
// - Perawat/bidan membuat DRAFT. Draft TIDAK boleh berjalan: tidak ada reminder,
//   tidak ada konfirmasi, tidak ada eskalasi.
// - Hanya DOKTER/BIDAN (atau ADMIN) yang menaikkan status ke APPROVED. Satu-satunya
//   jalan dari draft ke obat yang benar-benar diminum pasien.
//
// Gerbang klinis dipasang di route (requireClinicalRole). Service di sini tetap
// memeriksa status target supaya approve/ubah tidak bisa dijalankan pada baris
// yang sudah REJECTED atau di luar scope.
import type { PrismaClient } from '@prisma/client'
import type {
  ApproveMedicationInput,
  AuthUserClaims,
  CreateMedicationInput,
  CreateScheduleInput,
  MedicationStatus,
} from '@careloop/shared'
import {
  approveMedicationSchema,
  createMedicationSchema,
  createScheduleSchema,
  AuditAction,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { badRequest, conflict, invalidTransition, notFound } from '../../lib/errors'
import { nextFireAt, type ReminderScheduleInput } from '../reminders/next-fire-at'
import { assertPatientInScope, type AuditContext, type PatientsPrismaClient } from '../patients/patients.service'

export type MedicationsPrismaClient = PatientsPrismaClient & {
  medication: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
  }
  schedule: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    updateMany(args: any): Promise<any>
  }
  auditLog?: PrismaClient['auditLog']
}

export interface MedicationOutput {
  id: string
  patientId: string
  name: string
  genericName: string | null
  dosage: string | null
  form: string
  instructions: string | null
  isActive: boolean
  status: MedicationStatus
  startedAt: string
  endedAt: string | null
  approvedAt: string | null
  approvedByName: string | null
  schedules: Array<{
    id: string
    timeOfDay: string
    daysOfWeek: number[]
    dailyFrequency: number
    doseQty: string
    status: MedicationStatus
    isActive: boolean
    nextFireAt: string | null
  }>
}

const MEDICATION_SELECT = {
  id: true,
  patientId: true,
  name: true,
  genericName: true,
  dosage: true,
  form: true,
  instructions: true,
  isActive: true,
  status: true,
  startedAt: true,
  endedAt: true,
  approvedAt: true,
  approvedBy: { select: { fullName: true } },
  schedules: {
    select: {
      id: true,
      timeOfDay: true,
      daysOfWeek: true,
      dailyFrequency: true,
      doseQty: true,
      isActive: true,
      status: true,
    },
    orderBy: { timeOfDay: 'asc' },
  },
} as const

function toOutput(record: any): MedicationOutput {
  return {
    id: record.id,
    patientId: record.patientId,
    name: record.name,
    genericName: record.genericName,
    dosage: record.dosage,
    form: record.form,
    instructions: record.instructions,
    isActive: record.isActive,
    status: record.status,
    startedAt: record.startedAt.toISOString().slice(0, 10),
    endedAt: record.endedAt ? record.endedAt.toISOString().slice(0, 10) : null,
    approvedAt: record.approvedAt ? record.approvedAt.toISOString() : null,
    approvedByName: record.approvedBy?.fullName ?? null,
    schedules: (record.schedules ?? []).map((s: any) => ({
      id: s.id,
      timeOfDay: s.timeOfDay,
      daysOfWeek: s.daysOfWeek,
      dailyFrequency: s.dailyFrequency,
      doseQty: s.doseQty,
      status: s.status,
      isActive: s.isActive,
      // Jadwal yang belum disetujui tidak punya waktu tunjuk berikutnya — sengaja,
      // supaya UI tidak menampilkan "terjadwal" untuk resep yang belum aktif.
      nextFireAt:
        s.status === 'APPROVED' && s.isActive
          ? (nextFireAt(
              {
                timeOfDay: s.timeOfDay,
                daysOfWeek: s.daysOfWeek,
                dailyFrequency: s.dailyFrequency,
                startDate: record.startedAt,
                endDate: record.endedAt,
                timeWindowMinutes: 30,
              } as unknown as ReminderScheduleInput,
              { after: new Date() },
            )
              ?.toISOString() ?? null)
          : null,
    })),
  }
}

/**
 * POST /v1/patients/:id/medications — perawat/bidan membuat draft resep.
 * Draft tidak aktif: isActive false sampai dokter menyetujui.
 */
export async function draftMedication(
  client: MedicationsPrismaClient,
  params: {
    patientId: string
    input: CreateMedicationInput
    claims: AuthUserClaims
    audit: AuditContext
  },
): Promise<MedicationOutput> {
  const input = createMedicationSchema.parse(params.input)
  await assertPatientInScope(client, params.claims, params.patientId)

  if (input.endedAt && input.endedAt < input.startedAt) {
    throw badRequest('Tanggal selesai tidak boleh sebelum tanggal mulai')
  }

  const medication = await client.medication.create({
    data: {
      patientId: params.patientId,
      name: input.name,
      genericName: input.genericName ?? null,
      dosage: input.dosage ?? null,
      form: input.form,
      instructions: input.instructions ?? null,
      startedAt: new Date(input.startedAt),
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
      status: 'DRAFT',
      // Draft tidak boleh dipicu reminder meski jadwal dibuat.
      isActive: false,
    },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.MEDICATION_DRAFTED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'medication',
    resourceId: medication.id,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { name: medication.name, dosage: medication.dosage },
  })

  return loadMedicationOutput(client, medication.id)
}

/** POST /v1/patients/:id/schedules — jadwal untuk obat yang sudah ada. */
export async function createSchedule(
  client: MedicationsPrismaClient,
  params: {
    patientId: string
    input: CreateScheduleInput
    claims: AuthUserClaims
    audit: AuditContext
  },
): Promise<MedicationOutput> {
  const input = createScheduleSchema.parse(params.input)
  await assertPatientInScope(client, params.claims, params.patientId)

  const medication = await client.medication.findUnique({
    where: { id: input.medicationId },
    select: { id: true, patientId: true, status: true },
  })
  if (!medication || medication.patientId !== params.patientId) {
    throw notFound('Obat tidak ditemukan pada pasien ini')
  }

  if (medication.status === 'REJECTED') {
    throw invalidTransition('Obat ini sudah ditolak dokter dan tidak dapat dijadwalkan')
  }

  const created = await client.schedule.create({
    data: {
      patientId: params.patientId,
      medicationId: medication.id,
      timeOfDay: input.timeOfDay,
      daysOfWeek: input.daysOfWeek,
      dailyFrequency: input.dailyFrequency,
      doseQty: input.doseQty,
      startDate: new Date(input.startDate),
      timeWindowMinutes: input.timeWindowMinutes,
      // Jadwal mengikuti status obatnya. Obat yang sudah disahkan dokter tidak
      // perlu persetujuan kedua — menjadwalkannya saat itu juga sah, karena
      // keputusan klinis sudah diberikan pada obat induknya.
      status: medication.status,
      isActive: medication.status === 'APPROVED',
    },
    select: { id: true },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.SCHEDULE_CREATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'schedule',
    resourceId: created.id,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { medicationId: medication.id, timeOfDay: input.timeOfDay },
  })

  return loadMedicationOutput(client, medication.id)
}

export interface ApproveMedicationParams {
  medicationId: string
  input: ApproveMedicationInput
  claims: AuthUserClaims
  audit: AuditContext
}

/**
 * POST /v1/medications/:id/approve — satu-satunya jalan dari DRAFT ke obat aktif.
 *
 * Menaikkan status obat DAN seluruh jadwalnya dalam satu operasi, karena jadwal
 * yang tertinggal DRAFT sementara obatnya APPROVED akan membuat pasien
 * mendapat reminder obat yangHalf disetujui.
 */
export async function approveMedication(
  client: MedicationsPrismaClient,
  params: ApproveMedicationParams,
): Promise<MedicationOutput> {
  const input = approveMedicationSchema.parse(params.input)
  const approvedAt = new Date()

  const medication = await client.medication.findUnique({
    where: { id: params.medicationId },
    select: { id: true, patientId: true, status: true },
  })
  if (!medication) throw notFound('Obat tidak ditemukan')

  await assertPatientInScope(client, params.claims, medication.patientId)

  if (medication.status === 'APPROVED') {
    throw conflict('Obat ini sudah disetujui')
  }
  if (medication.status === 'REJECTED') {
    throw invalidTransition('Obat yang sudah ditolak tidak dapat disetujui ulang')
  }

  const isApproved = input.decision === 'APPROVED'

  await client.medication.update({
    where: { id: medication.id },
    data: {
      status: input.decision,
      isActive: isApproved,
      approvedById: params.claims.sub,
      approvedAt,
    },
  })

  // Jadwal ikut mengikuti keputusan dokter. Yang ditolak dimatikan, yang
  // disetujui diaktifkan supaya reminder mulai berjalan.
  await client.schedule.updateMany({
    where: { medicationId: medication.id },
    data: {
      status: input.decision,
      isActive: isApproved,
      approvedById: params.claims.sub,
      approvedAt,
    },
  })

  await tryCreateAuditLog(client as any, {
    action: isApproved ? AuditAction.MEDICATION_APPROVED : AuditAction.MEDICATION_REJECTED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'medication',
    resourceId: medication.id,
    patientId: medication.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { decision: input.decision, note: input.note ?? null },
  })

  return loadMedicationOutput(client, medication.id)
}

/** GET /v1/patients/:id/medications — daftar obat pasien beserta status persetujuan. */
export async function listMedications(
  client: MedicationsPrismaClient,
  params: { patientId: string; claims: AuthUserClaims; status?: string },
): Promise<MedicationOutput[]> {
  await assertPatientInScope(client, params.claims, params.patientId)

  const records = await client.medication.findMany({
    where: {
      patientId: params.patientId,
      ...(params.status ? { status: params.status } : {}),
    },
    select: MEDICATION_SELECT,
    orderBy: { createdAt: 'desc' },
  })

  return records.map(toOutput)
}

async function loadMedicationOutput(
  client: MedicationsPrismaClient,
  medicationId: string,
): Promise<MedicationOutput> {
  const record = await client.medication.findUnique({
    where: { id: medicationId },
    select: MEDICATION_SELECT,
  })
  if (!record) throw notFound('Obat tidak ditemukan')
  return toOutput(record)
}
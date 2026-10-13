// Alur farmasi: antrean obat, penyiapan, penyerahan, dan penyebab pemblokiran
// (docs/API.md §3.6).
//
// Pembagian tanggung jawab yang dijaga ketat di sini:
// - Pasien membuat permintaan untuk dirinya sendiri; tidak bisa untuk orang lain.
// - Dokter/bidan menyetujui atau menolak. Apotek TIDAK bisa — itu keputusan klinis.
// - Apotek hanya mengubah status penyiapan/penyerahan. Tidak boleh menyentuh
//   resep, dosis, atau ambang detak jantung.
// - Setiap perubahan status melewati reducePharmacy() lebih dulu, jadi transisi
//   tak valid ditolak sebelum menyentuh database.
import type { PrismaClient } from '@prisma/client'
import {
  AuditAction,
  MedicationRequestAction,
  MedicationRequestSource,
  MedicationRequestStatus,
  UserRole,
  isPharmacyNakesRole,
  isPrescribingNakesRole,
  createMedicationRequestSchema,
  medicationRequestDecisionSchema,
  medicationRequestQuerySchema,
  medicationRequestStatusSchema,
  dispensingRecordQuerySchema,
  type AuthUserClaims,
  type CreateMedicationRequestInput,
  type MedicationRequestDecisionInput,
  type MedicationRequestQueryInput,
  type MedicationRequestStatusInput,
  type DispensingRecordQueryInput,
  type MedicationRequestReason,
} from '@careloop/shared'
import { tryCreateAuditLog, type AuditLogInput } from '../../lib/audit'
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../../lib/errors'
import { pharmacyRefillConfig } from '../../lib/env'
import { assertPatientInScope, type AuditContext, type PatientsPrismaClient } from '../patients/patients.service'
import { buildScopedPatientWhere, resolveNakesScope } from '../dashboard/dashboard.service'
import {
  describeAllowed,
  isOverdue,
  PHARMACY_REASON_LABEL,
  reducePharmacy,
  type PharmacyState,
} from './state-machine'
import {
  notifyDoctorOfNewRequest,
  notifyMedicationReady,
  notifyOutOfStock,
  notifyRequestApproved,
  notifyRequestRejected,
  notifyRoutineRefill,
  notifySubstituted,
  type NotifyRequestContext,
} from './notify.service'

export type PharmacyPrismaClient = PatientsPrismaClient & {
  medicationRequest: {
    findMany(args: any): Promise<any[]>
    findFirst(args: any): Promise<any | null>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    count(args: any): Promise<number>
  }
  medication: {
    findMany(args: any): Promise<any[]>
    findFirst(args: any): Promise<any | null>
    findUnique(args: any): Promise<any | null>
    update(args: any): Promise<any>
  }
  medicationStock: {
    findUnique(args: any): Promise<any | null>
    findMany(args: any): Promise<any[]>
    upsert(args: any): Promise<any>
    update(args: any): Promise<any>
  }
  dispensingRecord: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    count(args: any): Promise<number>
  }
  medicationRequestEvent: {
    create(args: any): Promise<any>
    findMany(args: any): Promise<any[]>
  }
  notification: PrismaClient['notification']
  familyContact: { findMany(args: any): Promise<any[]> }
  nakesContact: { findMany(args: any): Promise<any[]> }
  user: { findUnique(args: any): Promise<any | null> }
  auditLog?: PrismaClient['auditLog']
  $transaction?(fn: (tx: any) => Promise<any>): Promise<any>
}

export interface PharmacyEventOutput {
  id: string
  fromStatus: PharmacyState | null
  toStatus: PharmacyState
  action: string
  actorName: string | null
  actorRole: string | null
  note: string | null
  createdAt: string
}

export interface MedicationRequestOutput {
  id: string
  patientId: string
  patientName: string
  patientPhone: string
  medicationId: string
  medicationName: string
  dosage: string | null
  form: string
  /** Jumlah yang diminta pasien (hari). */
  requestedQuantity: number
  /** Jumlah yang disetujui dokter bila berbeda; null = mengikuti permintaan. */
  approvedQuantity: number | null
  /** Jumlah efektif yang dipakai antrean farmasi. */
  effectiveQuantity: number
  source: string
  status: PharmacyState
  /** Turunan dari dueAt vs waktu sekarang — bukan status tersimpan. */
  isOverdue: boolean
  reasonCode: MedicationRequestReason | null
  reasonLabel: string | null
  reasonNotes: string | null
  dueAt: string
  doctorName: string | null
  doctorDecisionNote: string | null
  decidedAt: string | null
  blockedReason: string | null
  substituteName: string | null
  isSubstituteApproved: boolean
  /** Total hari yang sudah diserahkan untuk obat ini — sisa stok pasien. */
  quantityRemaining: number | null
  createdAt: string
  updatedAt: string
  events?: PharmacyEventOutput[]
}

const REQUEST_SELECT = {
  id: true,
  patientId: true,
  medicationId: true,
  requestedQuantity: true,
  approvedQuantity: true,
  source: true,
  status: true,
  reasonCode: true,
  reasonNotes: true,
  dueAt: true,
  doctorDecisionNote: true,
  decidedAt: true,
  blockedReason: true,
  substituteName: true,
  isSubstituteApproved: true,
  createdAt: true,
  updatedAt: true,
  // Nama & nomor pasien ada di tabel User (Patient adalah ekstensi 1:1 dari
  // User dan hanya menyimpan data klinis), jadi harus dibaca lewat relasi `user`.
  patient: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
  medication: { select: { id: true, name: true, dosage: true, form: true, daysSupply: true } },
  doctor: { select: { id: true, fullName: true } },
  dispensingRecord: { select: { pharmacist: { select: { fullName: true } } } },
} as const

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function toOutput(record: any, quantityRemaining: number | null, now: Date): MedicationRequestOutput {
  const reasonCode = (record.reasonCode ?? null) as MedicationRequestReason | null
  return {
    id: record.id,
    patientId: record.patientId,
    patientName: record.patient?.user?.fullName ?? '-',
    patientPhone: record.patient?.user?.phone ?? '',
    medicationId: record.medicationId,
    medicationName: record.medication?.name ?? '-',
    dosage: record.medication?.dosage ?? null,
    form: record.medication?.form ?? 'TABLET',
    requestedQuantity: record.requestedQuantity,
    approvedQuantity: record.approvedQuantity ?? null,
    effectiveQuantity: record.approvedQuantity ?? record.requestedQuantity,
    source: record.source,
    status: record.status,
    isOverdue: isOverdue(record.status, record.dueAt, now),
    reasonCode,
    reasonLabel: reasonCode ? PHARMACY_REASON_LABEL[reasonCode] : null,
    reasonNotes: record.reasonNotes ?? null,
    dueAt: isoDate(record.dueAt),
    doctorName: record.doctor?.fullName ?? null,
    doctorDecisionNote: record.doctorDecisionNote ?? null,
    decidedAt: record.decidedAt ? record.decidedAt.toISOString() : null,
    blockedReason: record.blockedReason ?? null,
    substituteName: record.substituteName ?? null,
    isSubstituteApproved: record.isSubstituteApproved ?? false,
    quantityRemaining,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

type Logger = { warn(obj: unknown, msg: string): void }

/** Status yang masih bisa diselesaikan — dipakai partial unique index & cek manual. */
const ACTIVE_STATUSES = [
  MedicationRequestStatus.PENDING_DOCTOR,
  MedicationRequestStatus.QUEUED,
  MedicationRequestStatus.PREPARING,
  MedicationRequestStatus.READY,
] as const

/** Baris audit untuk perubahan status — sumber tunggal jejak "siapa mengubah apa". */
async function recordEvent(
  client: PharmacyPrismaClient,
  params: {
    requestId: string
    patientId: string
    fromStatus: PharmacyState | null
    toStatus: PharmacyState
    action: MedicationRequestAction
    actorUserId: string | null
    actorRole: string | null
    note: string | null
  },
): Promise<void> {
  await client.medicationRequestEvent.create({
    data: {
      requestId: params.requestId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      action: params.action,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      note: params.note,
    },
  })
}

/**
 * Memuat satu request lengkap dengan sisa stok pasien & audit trail.
 * Dipakai setelah setiap mutasi supaya respons selalu mencerminkan kondisi terkini.
 */
async function loadRequest(
  client: PharmacyPrismaClient,
  requestId: string,
  options: { withEvents?: boolean; now?: Date } = {},
): Promise<MedicationRequestOutput> {
  const now = options.now ?? new Date()

  const record = await client.medicationRequest.findUnique({
    where: { id: requestId },
    select: REQUEST_SELECT,
  })
  if (!record) throw notFound('Permintaan obat tidak ditemukan')

  const stock = await client.medicationStock.findUnique({
    where: { patientId_medicationId: { patientId: record.patientId, medicationId: record.medicationId } },
    select: { quantityRemaining: true },
  })

  const output = toOutput(record, stock?.quantityRemaining ?? null, now)

  if (options.withEvents) {
    const events = await client.medicationRequestEvent.findMany({
      where: { requestId },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        action: true,
        note: true,
        createdAt: true,
        actorRole: true,
        actor: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    output.events = events.map((event: any) => ({
      id: event.id,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus,
      action: event.action,
      actorName: event.actor?.fullName ?? null,
      actorRole: event.actorRole ?? null,
      note: event.note ?? null,
      createdAt: event.createdAt.toISOString(),
    }))
  }

  return output
}

function notifyContext(record: any, quantityDays: number): NotifyRequestContext {
  return {
    patientId: record.patientId,
    patientName: record.patient.user.fullName,
    patientPhone: record.patient.user.phone,
    medicationName: record.medication.name,
    quantityDays,
    dueAt: record.dueAt,
  }
}

async function audit(
  client: PharmacyPrismaClient,
  context: AuditContext,
  action: AuditAction,
  resourceId: string,
  patientId: string,
  meta: Record<string, unknown>,
  logger?: Logger,
): Promise<void> {
  const input: AuditLogInput = {
    action,
    actorUserId: context.actorUserId,
    actorRole: context.actorRole,
    resourceType: 'medication_request',
    resourceId,
    patientId,
    ip: context.ip,
    userAgent: context.userAgent,
    meta,
  }
  if (logger) {
    await tryCreateAuditLog(client as any, input, logger as any)
  } else {
    await tryCreateAuditLog(client as any, input)
  }
}

/**
 * POST /v1/medication-requests — pasien mengajukan permintaan di luar jadwal.
 *
 * Sumber selalu PATIENT_REQUEST: permintaan rutin dibuat scheduler, bukan
 * dipanggil pasien (docs/API.md §3.6). pasienId diambil dari claim JWT sehingga
 * tidak mungkin mengajukan untuk orang lain.
 */
export async function createMedicationRequest(
  client: PharmacyPrismaClient,
  params: {
    input: CreateMedicationRequestInput
    claims: AuthUserClaims
    audit: AuditContext
    now?: Date
  },
  logger?: Logger,
): Promise<MedicationRequestOutput> {
  const input = createMedicationRequestSchema.parse(params.input)
  const now = params.now ?? new Date()
  const claims = params.claims

  if (claims.role !== UserRole.PATIENT && claims.role !== UserRole.FAMILY) {
    throw forbidden('Hanya pasien atau keluarga yang dapat mengajukan permintaan obat')
  }

  // Pasien dan keluarga menunjuk ke patientId yang sama dengan User.id.
  const patientId = claims.patientId ?? claims.sub

  const medication = await client.medication.findUnique({
    where: { id: input.medicationId },
    select: {
      id: true,
      patientId: true,
      name: true,
      status: true,
      isActive: true,
      daysSupply: true,
      startedAt: true,
      endedAt: true,
    },
  })

  // 404, bukan 403 — keberadaan obat milik orang lain tidak dikonfirmasi.
  if (!medication || medication.patientId !== patientId) {
    throw notFound('Obat tidak ditemukan pada akun Anda')
  }

  // Prescription gate: obat DRAFT/REJECTED tidak punya resep aktif yang bisa
  // dijalankan, jadi tidak mungkin patients meminta dispensing (AGENTS.md §2).
  if (medication.status !== 'APPROVED') {
    throw invalidTransition('Resep obat ini belum disetujui dokter sehingga tidak bisa diminta')
  }
  if (!medication.isActive) {
    throw invalidTransition('Pengambilan obat ini sedang dihentikan dokter')
  }
  if (medication.endedAt && medication.endedAt.getTime() < now.getTime()) {
    throw invalidTransition('Masa pemakaian obat ini sudah selesai')
  }

  const { maxDaysSupply, defaultDaysSupply } = pharmacyRefillConfig()
  if (input.requestedQuantity > maxDaysSupply) {
    throw badRequest(`Jumlah permintaan melebihi batas ${maxDaysSupply} hari`)
  }

  const stock = await client.medicationStock.findUnique({
    where: { patientId_medicationId: { patientId, medicationId: medication.id } },
    select: { quantityRemaining: true },
  })

  // Tidak mungkin meminta lebih dari sisa jatah + satu siklus penuh: permintaan
  // yang jauh melebihi jatah hanya menambah antrean sia-sia.
  const ceiling = (stock?.quantityRemaining ?? 0) + (medication.daysSupply ?? defaultDaysSupply)
  if (input.requestedQuantity > ceiling) {
    throw badRequest(
      `Jumlah melebihi jatah yang wajar. Sisa stok Anda ${stock?.quantityRemaining ?? 0} hari, jatah per pengambilan ${medication.daysSupply ?? defaultDaysSupply} hari.`,
    )
  }

  // Partial unique index MedicationRequest_active_key menolak lebih dulu bila
// pasien sudah punya request aktif untuk obat ini. mengecek di sini hanya
// untuk mengganti pesan teknis P2002 menjadi sesuatu yang bisa dibaca pasien.
const activeRequest = await client.medicationRequest.findFirst({
  where: { patientId, medicationId: medication.id, status: { in: ACTIVE_STATUSES } },
  select: { id: true, status: true },
})
if (activeRequest) {
  throw conflict('Anda sudah punya permintaan aktif untuk obat ini')
}

const created = await client.medicationRequest.create({
    data: {
      patientId,
      medicationId: medication.id,
      requestedQuantity: input.requestedQuantity,
      source: MedicationRequestSource.PATIENT_REQUEST,
      status: MedicationRequestStatus.PENDING_DOCTOR,
      reasonCode: input.reasonCode,
      reasonNotes: input.reasonNotes ?? null,
      // Jatuh tempo default 3 hari dari sekarang; dokter boleh menyesuaikan
      // lewat PATCH .../decision bila perlu lebih cepat.
      dueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    },
    select: REQUEST_SELECT,
  })

  await recordEvent(client, {
    requestId: created.id,
    patientId,
    fromStatus: null,
    toStatus: MedicationRequestStatus.PENDING_DOCTOR,
    action: MedicationRequestAction.CREATED,
    actorUserId: claims.sub,
    actorRole: claims.role,
    note: input.reasonNotes ?? PHARMACY_REASON_LABEL[input.reasonCode],
  })

  await audit(
    client,
    params.audit,
    AuditAction.MEDICATION_REQUEST_CREATED,
    created.id,
    patientId,
    {
      medicationId: medication.id,
      requestedQuantity: input.requestedQuantity,
      reasonCode: input.reasonCode,
    },
    logger,
  )

  await notifyDoctorOfNewRequest(client, notifyContext(created, input.requestedQuantity), logger)

  return loadRequest(client, created.id, { now })
}

/**
 * PATCH /v1/medication-requests/:id/decision — dokter menyetujui atau menolak.
 *
 * Gate klinis dipasang di route (requireClinicalRole DOKTER/BIDAN); service
 * tetap memeriksa status target supaya tidak ada approve kedua atas request yang
 * sudah diputuskan.
 */
export async function decideMedicationRequest(
  client: PharmacyPrismaClient,
  params: {
    requestId: string
    input: MedicationRequestDecisionInput
    claims: AuthUserClaims
    audit: AuditContext
    now?: Date
  },
  logger?: Logger,
): Promise<MedicationRequestOutput> {
  const input = medicationRequestDecisionSchema.parse(params.input)
  const now = params.now ?? new Date()
  const claims = params.claims

  // Gate klinis di service, bukan hanya di route — lihat catatan di
  // changeMedicationRequestStatus. Tanpa ini, pemanggil internal (seed,
  // script demo) bisa menyetujui permintaan tanpa dokter.
  if (claims.role !== UserRole.ADMIN && !isPrescribingNakesRole(claims.nakesRole)) {
    throw forbidden('Persetujuan permintaan obat hanya dapat dilakukan oleh dokter atau bidan')
  }

  const existing = await client.medicationRequest.findUnique({
    where: { id: params.requestId },
    select: REQUEST_SELECT,
  })
  if (!existing) throw notFound('Permintaan obat tidak ditemukan')

  const action =
    input.decision === 'APPROVED'
      ? MedicationRequestAction.APPROVED
      : MedicationRequestAction.REJECTED

  // rejectTransisi sebelum apa pun disentuh di database.
  const transition = reducePharmacy(existing.status, action)

  await assertPatientInScope(client, params.claims, existing.patientId)

  const effectiveQuantity = input.approvedQuantity ?? existing.requestedQuantity
  if (input.decision === 'APPROVED' && effectiveQuantity <= 0) {
    throw badRequest('Jumlah yang disetujui harus lebih besar dari nol')
  }

  const blockedReason = input.decision === 'REJECTED' ? (input.note ?? null) : existing.blockedReason

  await client.medicationRequest.update({
    where: { id: existing.id },
    data: {
      status: transition.to,
      approvedQuantity: input.decision === 'APPROVED' ? effectiveQuantity : null,
      doctorId: params.claims.sub,
      doctorDecisionNote: input.note ?? null,
      decidedAt: now,
      blockedReason,
    },
  })

  await recordEvent(client, {
    requestId: existing.id,
    patientId: existing.patientId,
    fromStatus: existing.status,
    toStatus: transition.to,
    action,
    actorUserId: params.claims.sub,
    actorRole: params.claims.role,
    note: input.note ?? null,
  })

  await audit(
    client,
    params.audit,
    input.decision === 'APPROVED'
      ? AuditAction.MEDICATION_REQUEST_APPROVED
      : AuditAction.MEDICATION_REQUEST_REJECTED,
    existing.id,
    existing.patientId,
    { decision: input.decision, approvedQuantity: effectiveQuantity, note: input.note ?? null },
    logger,
  )

  const notifyCtx = notifyContext(existing, effectiveQuantity)
  if (input.decision === 'APPROVED') {
    await notifyRequestApproved(client, notifyCtx, logger)
  } else {
    // `note` wajib sudah divalidasi zod — alasan sampai ke pasien & keluarga.
    await notifyRequestRejected(client, notifyCtx, input.note as string, logger)
  }

  return loadRequest(client, existing.id, { now })
}

/**
 * PATCH /v1/medication-requests/:id/status — seluruh aksi farmasi.
 *
 * Satu endpoint dengan `action` eksplisit (bukan PATCH status bebas) supaya
 * server selalu tahu aksi yang dimaksud dan bisa menolak yang tidak valid dengan
 * 422 + daftar aksi yang sah.
 */
export async function changeMedicationRequestStatus(
  client: PharmacyPrismaClient,
  params: {
    requestId: string
    input: MedicationRequestStatusInput
    claims: AuthUserClaims
    audit: AuditContext
    now?: Date
  },
  logger?: Logger,
): Promise<MedicationRequestOutput> {
  const input = medicationRequestStatusSchema.parse(params.input)
  const now = params.now ?? new Date()
  const claims = params.claims

  const existing = await client.medicationRequest.findUnique({
    where: { id: params.requestId },
    select: REQUEST_SELECT,
  })
  if (!existing) throw notFound('Permintaan obat tidak ditemukan')

  // Gerbang kewenangan farmasi tetap di service, bukan hanya di route: service ini juga
  // dipanggil dari seed & scheduler, yang tidak lewat preHandler. ADMIN tetap
  // lolos karena sudah melewati gate role di route.
  if (claims.role !== UserRole.ADMIN && !isPharmacyNakesRole(claims.nakesRole)) {
    throw forbidden('Tindakan ini hanya dapat dilakukan oleh petugas farmasi')
  }

  const action = input.action

  // CREATED bukan aksi transisi — hanya jejak awal yang dibuat createMedicationRequest.
  if (action === MedicationRequestAction.CREATED) {
    throw badRequest('CREATED bukan aksi yang dapat dipanggil')
  }
  // APPROVED/REJECTED milik dokter, bukan farmasi.
  if (action === MedicationRequestAction.APPROVED || action === MedicationRequestAction.REJECTED) {
    throw forbidden('Persetujuan permintaan obat hanya dapat dilakukan oleh dokter atau bidan')
  }

  const transition = reducePharmacy(existing.status, action)

  const effectiveQuantity = existing.approvedQuantity ?? existing.requestedQuantity

  await client.medicationRequest.update({
    where: { id: existing.id },
    data: {
      status: transition.to,
      blockedReason:
        action === MedicationRequestAction.MARK_OUT_OF_STOCK ||
        action === MedicationRequestAction.MARK_SUBSTITUTED
          ? (input.reason ?? null)
          : existing.blockedReason,
      substituteName:
        action === MedicationRequestAction.MARK_SUBSTITUTED
          ? (input.substituteName ?? null)
          : existing.substituteName,
      isSubstituteApproved:
        action === MedicationRequestAction.MARK_SUBSTITUTED
          ? false
          : existing.isSubstituteApproved,
    },
  })

  await recordEvent(client, {
    requestId: existing.id,
    patientId: existing.patientId,
    fromStatus: existing.status,
    toStatus: transition.to,
    action,
    actorUserId: params.claims.sub,
    actorRole: params.claims.role,
    note: input.reason ?? input.substituteName ?? null,
  })

  await audit(
    client,
    params.audit,
    actionToAuditAction(action),
    existing.id,
    existing.patientId,
    { from: existing.status, to: transition.to, action, reason: input.reason ?? null },
    logger,
  )

  const notifyCtx = notifyContext(existing, effectiveQuantity)

  switch (action) {
    case MedicationRequestAction.START_PREPARING:
      // Tidak ada notifikasi: pasien belum perlu tahu obat sedang diracik.
      break
    case MedicationRequestAction.MARK_READY:
      await notifyMedicationReady(client, notifyCtx, logger)
      break
    case MedicationRequestAction.MARK_OUT_OF_STOCK:
      await notifyOutOfStock(client, notifyCtx, input.reason as string, logger)
      break
    case MedicationRequestAction.MARK_SUBSTITUTED:
      await notifySubstituted(client, notifyCtx, input.substituteName as string, logger)
      break
    case MedicationRequestAction.DISPENSED:
      await applyDispensing(client, {
        existing,
        quantityDays: input.quantityDays as number,
        pharmacistId: params.claims.sub,
        now,
        audit: params.audit,
        logger,
      })
      break
    case MedicationRequestAction.RETURNED_TO_QUEUE:
      // Ready -> Queued: giliran pengambilan dipakai pasien lain lebih dulu, jadi
      // obatnya dikembalikan ke antrean untuk siklus berikutnya.
      break
    default:
      break
  }

  return loadRequest(client, existing.id, { now, withEvents: true })
}

function actionToAuditAction(action: MedicationRequestAction): AuditAction {
  switch (action) {
    case MedicationRequestAction.START_PREPARING:
      return AuditAction.MEDICATION_REQUEST_PREPARING
    case MedicationRequestAction.MARK_READY:
      return AuditAction.MEDICATION_REQUEST_READY
    case MedicationRequestAction.DISPENSED:
      return AuditAction.MEDICATION_REQUEST_DISPENSED
    case MedicationRequestAction.MARK_OUT_OF_STOCK:
      return AuditAction.MEDICATION_REQUEST_OUT_OF_STOCK
    case MedicationRequestAction.MARK_SUBSTITUTED:
      return AuditAction.MEDICATION_REQUEST_SUBSTITUTED
    default:
      return AuditAction.MEDICATION_REQUEST_READY
  }
}

/**
 * Efek samping penyerahan: catat siapa & berapa hari, perbarui sisa stok
 * pasien, dan geser tanggal ambil berikutnya (docs/API.md §3.6).
 */
async function applyDispensing(
  client: PharmacyPrismaClient,
  params: {
    existing: any
    quantityDays: number
    pharmacistId: string
    now: Date
    audit: AuditContext
    logger?: Logger
  },
): Promise<void> {
  const { existing, quantityDays, pharmacistId, now } = params
  const { maxDaysSupply } = pharmacyRefillConfig()

  if (quantityDays > maxDaysSupply) {
    throw badRequest(`Jumlah hari melebihi batas ${maxDaysSupply} hari`)
  }

  const nextPickupAt = new Date(now.getTime() + quantityDays * 24 * 60 * 60 * 1000)

  await client.dispensingRecord.create({
    data: {
      requestId: existing.id,
      pharmacistId,
      quantityDays,
      dispensedAt: now,
      nextPickupDate: nextPickupAt,
    },
  })

  await client.medicationStock.upsert({
    where: { patientId_medicationId: { patientId: existing.patientId, medicationId: existing.medicationId } },
    create: {
      patientId: existing.patientId,
      medicationId: existing.medicationId,
      quantityRemaining: quantityDays,
      lastRefillAt: now,
    },
    update: { quantityRemaining: quantityDays, lastRefillAt: now },
  })

  await client.medication.update({
    where: { id: existing.medicationId },
    data: { nextPickupAt },
  })

  await audit(
    client,
    params.audit,
    AuditAction.DISPENSING_RECORD_CREATED,
    existing.id,
    existing.patientId,
    { quantityDays, nextPickupDate: isoDate(nextPickupAt) },
    params.logger,
  )
}

/** GET /v1/medication-requests/:id — detail + audit trail. */
export async function getMedicationRequest(
  client: PharmacyPrismaClient,
  params: { requestId: string; claims: AuthUserClaims; now?: Date },
): Promise<MedicationRequestOutput> {
  const record = await client.medicationRequest.findUnique({
    where: { id: params.requestId },
    select: { patientId: true },
  })
  if (!record) throw notFound('Permintaan obat tidak ditemukan')

  // Pasien & keluarga hanya boleh melihat miliknya; nakes mengikuti scope wilayah.
  if (params.claims.role === UserRole.PATIENT || params.claims.role === UserRole.FAMILY) {
    const ownPatientId = params.claims.patientId ?? params.claims.sub
    if (record.patientId !== ownPatientId) throw notFound('Permintaan obat tidak ditemukan')
  } else {
    await assertPatientInScope(client, params.claims, record.patientId)
  }

  return loadRequest(client, params.requestId, { withEvents: true, now: params.now })
}

export interface MedicationRequestListResult {
  items: MedicationRequestOutput[]
  total: number
  summary: {
    queued: number
    preparing: number
    ready: number
    overdue: number
    pendingDoctor: number
  }
}

/**
 * GET /v1/medication-requests — antrean farmasi & daftar menunggu dokter.
 *
 * Filter `overdue` diterapkan di server: `dueAt < today` DAN status masih aktif.
 * Status final (DISPENSED/REJECTED/…) tidak pernah masuk hitungan terlambat
 * karena tidak ada lagi yang bisa dikejar.
 */
export async function listMedicationRequests(
  client: PharmacyPrismaClient,
  params: {
    query: MedicationRequestQueryInput
    claims: AuthUserClaims
    now?: Date
  },
): Promise<MedicationRequestListResult> {
  // req.query undefined ketika tidak ada query string sama sekali.
  const query = medicationRequestQuerySchema.parse(params.query ?? {})
  const now = params.now ?? new Date()

  const andClauses: any[] = []

  // Pasien & keluarga: patientId di-pin dari claim, bukan dari query string.
  // Kalau mereka tetap mengirim patientId orang lain, jawab 403 bukan diam-diam
  // mengabaikan — supaya percobaan accessing data orang terlihat jelas.
  if (params.claims.role === UserRole.PATIENT || params.claims.role === UserRole.FAMILY) {
    const ownPatientId = params.claims.patientId ?? params.claims.sub
    if (query.patientId && query.patientId !== ownPatientId) {
      throw forbidden('Di luar scope akses Anda')
    }
    andClauses.push({ patientId: ownPatientId })
  } else {
    // Scope nakes. `buildScopedPatientWhere` menghasilkan filter untuk model
    // Patient (districtCode, nakesContacts), jadi HARUS dibungkus relasi
    // `patient:` — menerapkannya langsung ke MedicationRequest tidak valid
    // dan Prisma akan menolaknya.
    const scope = await resolveNakesScope(client as any, params.claims)
    andClauses.push({ patient: buildScopedPatientWhere(scope) })

    if (query.patientId) {
      const { patient } = await assertPatientInScope(client, params.claims, query.patientId)
      andClauses.push({ patientId: patient.id })
    }
  }

  if (query.status) {
    andClauses.push({ status: query.status })
  }
  if (query.source) {
    andClauses.push({ source: query.source })
  }

  const activeStatuses = [
    MedicationRequestStatus.QUEUED,
    MedicationRequestStatus.PREPARING,
    MedicationRequestStatus.READY,
  ]
  const overdueWhere = { dueAt: { lt: startOfTodayUtc(now) }, status: { in: activeStatuses } }

  if (query.overdue === true) andClauses.push(overdueWhere)
  if (query.overdue === false) andClauses.push({ NOT: overdueWhere })

  if (query.search) {
    andClauses.push({
      OR: [
        { patient: { user: { fullName: { contains: query.search, mode: 'insensitive' } } } },
        { medication: { name: { contains: query.search, mode: 'insensitive' } } },
      ],
    })
  }

  const where = andClauses.length > 0 ? { AND: andClauses } : {}

  // Summary dihitung dengan filter yang sama TANPA filter status — supaya
  // tab "Antrean 12" tetap menampilkan hitungan saat user memfilter "Siap".
  const summaryWhereClauses = andClauses.filter((clause) => !('status' in clause))

  const [records, total, summaryRecords] = await Promise.all([
    client.medicationRequest.findMany({
      where,
      select: REQUEST_SELECT,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      take: query.limit,
      skip: query.offset,
    }),
    client.medicationRequest.count({ where }),
    client.medicationRequest.findMany({
      where: summaryWhereClauses.length > 0 ? { AND: summaryWhereClauses } : {},
      select: { status: true, dueAt: true },
    }),
  ])

  // Sisa stok per pasien+obat diambil terpisah — satu query untuk semua baris,
  // bukan N+1 per baris tabel.
  const stockRows = await client.medicationStock.findMany({
    where: { patientId: { in: [...new Set(records.map((r: any) => r.patientId))] } },
    select: { patientId: true, medicationId: true, quantityRemaining: true },
  })
  const stockByKey = new Map(
    stockRows.map((s: any) => [`${s.patientId}:${s.medicationId}`, s.quantityRemaining]),
  )

  const items = records.map((record: any) =>
    toOutput(record, stockByKey.get(`${record.patientId}:${record.medicationId}`) ?? null, now),
  )

  const todayUtc = startOfTodayUtc(now)
  const summary = {
    queued: summaryRecords.filter((r: any) => r.status === MedicationRequestStatus.QUEUED).length,
    preparing: summaryRecords.filter((r: any) => r.status === MedicationRequestStatus.PREPARING).length,
    ready: summaryRecords.filter((r: any) => r.status === MedicationRequestStatus.READY).length,
    pendingDoctor: summaryRecords.filter(
      (r: any) => r.status === MedicationRequestStatus.PENDING_DOCTOR,
    ).length,
    overdue: summaryRecords.filter(
      (r: any) => activeStatuses.includes(r.status) && r.dueAt < todayUtc,
    ).length,
  }

  return { items, total, summary }
}

function startOfTodayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** GET /v1/dispensing-records — riwayat penyerahan, searchable per pasien & tanggal. */
export async function listDispensingRecords(
  client: PharmacyPrismaClient,
  params: {
    query: DispensingRecordQueryInput
    claims: AuthUserClaims
  },
): Promise<{
  items: Array<{
    id: string
    requestId: string
    patientId: string
    patientName: string
    medicationName: string
    quantityDays: number
    dispensedAt: string
    nextPickupDate: string
    pharmacistName: string
  }>
  total: number
}> {
  const query = dispensingRecordQuerySchema.parse(params.query ?? {})

  const andClauses: any[] = []

  if (params.claims.role === UserRole.PATIENT || params.claims.role === UserRole.FAMILY) {
    andClauses.push({ request: { patientId: params.claims.patientId ?? params.claims.sub } })
  } else if (params.claims.role === UserRole.NAKES) {
    // Nakes tanpa patientId eksplisit tetap dibatasi ke scope wilayahnya, supaya
    // apotek di puskesmas A tidak bisa melihat riwayat farmasi puskesmas B.
    const scope = await resolveNakesScope(client as any, params.claims)
    andClauses.push({ request: { patient: buildScopedPatientWhere(scope) } })
    if (query.patientId) {
      const { patient } = await assertPatientInScope(client, params.claims, query.patientId)
      andClauses.push({ request: { patientId: patient.id } })
    }
  } else if (query.patientId) {
    andClauses.push({ request: { patientId: query.patientId } })
  }

  if (query.from || query.to) {
    andClauses.push({
      dispensedAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      },
    })
  }

  if (query.search) {
    andClauses.push({
      request: {
        patient: { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
      },
    })
  }

  const where = andClauses.length > 0 ? { AND: andClauses } : {}

  const [records, total] = await Promise.all([
    client.dispensingRecord.findMany({
      where,
      select: {
        id: true,
        requestId: true,
        quantityDays: true,
        dispensedAt: true,
        nextPickupDate: true,
        pharmacist: { select: { fullName: true } },
        request: {
          select: {
            patientId: true,
            patient: { select: { user: { select: { fullName: true } } } },
            medication: { select: { name: true } },
          },
        },
      },
      orderBy: { dispensedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    client.dispensingRecord.count({ where }),
  ])

  return {
    items: records.map((record: any) => ({
      id: record.id,
      requestId: record.requestId,
      patientId: record.request.patientId,
      patientName: record.request.patient.user.fullName,
      medicationName: record.request.medication.name,
      quantityDays: record.quantityDays,
      dispensedAt: record.dispensedAt.toISOString(),
      nextPickupDate: isoDate(record.nextPickupDate),
      pharmacistName: record.pharmacist.fullName,
    })),
    total,
  }
}

/**
 * POST /v1/medication-requests/generate-routine — scheduler harian.
 *
 * Membuat permintaan ROUTINE untuk setiap obat APPROVED yang `nextPickupAt`
 * sudah masuk lead time. Persetujuan dokter sudah melekat pada resepnya, jadi
 * request ini langsung QUEUED tanpa gate dokter (docs/API.md §3.6).
 *
 * Idempoten per hari: partial unique index MedicationRequest_active_key
 * mencegah permintaan yang sama dibuat dua kali, jadi scheduler yang jalan
 * ulang (atau endpoint manual dipanggil berulang) aman.
 */
export async function generateRoutineRequests(
  client: PharmacyPrismaClient,
  options: { now?: Date; logger?: Logger } = {},
): Promise<{ created: number; skipped: number }> {
  const now = options.now ?? new Date()
  const { leadDays, defaultDaysSupply } = pharmacyRefillConfig()
  const logger = options.logger

  const horizon = new Date(startOfTodayUtc(now).getTime() + leadDays * 24 * 60 * 60 * 1000)

  const candidates = await client.medication.findMany({
    where: {
      status: 'APPROVED',
      isActive: true,
      nextPickupAt: { not: null, lte: horizon },
    },
    select: {
      id: true,
      patientId: true,
      name: true,
      daysSupply: true,
      nextPickupAt: true,
      patient: { select: { fullName: true, phone: true } },
    },
  })

  let created = 0
  let skipped = 0

  for (const medication of candidates) {
    const quantityDays = medication.daysSupply ?? defaultDaysSupply

    try {
      const created0 = await client.medicationRequest.create({
        data: {
          patientId: medication.patientId,
          medicationId: medication.id,
          requestedQuantity: quantityDays,
          approvedQuantity: quantityDays,
          source: MedicationRequestSource.ROUTINE,
          // Persetujuan dokter melekat pada resep — langsung masuk antrean.
          status: MedicationRequestStatus.QUEUED,
          dueAt: medication.nextPickupAt as Date,
        },
        select: REQUEST_SELECT,
      })

      await recordEvent(client, {
        requestId: created0.id,
        patientId: medication.patientId,
        fromStatus: null,
        toStatus: MedicationRequestStatus.QUEUED,
        action: MedicationRequestAction.CREATED,
        actorUserId: null,
        actorRole: null,
        note: 'Permintaan rutin otomatis dari jadwal pengambilan',
      })

      created += 1
      await notifyRoutineRefill(
        client,
        notifyContext(created0, quantityDays),
        logger,
      )
    } catch (error: unknown) {
      // Partial unique index yang menolak: pasien sudah punya request aktif untuk
      // obat ini. Itu kondisi normal, bukan kegagalan scheduler.
      if (isUniqueViolation(error)) {
        skipped += 1
        continue
      }
      logger?.warn({ err: error, medicationId: medication.id }, 'gagal membuat permintaan rutin')
      skipped += 1
    }
  }

  return { created, skipped }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  )
}

/**
 * PATCH /v1/medications/:id — dokter menyetujui penggantian obat yang ditandai
 * apotek. Ini satu-satunya jalan keluar dari SUBSTITUTED; apotek tidak boleh
 * Apotek menandai SUBSTITUTED. Apotek tidak boleh mengubah resep — keputusan
 * penggantian obat tetap milik dokter (docs/API.md §3.6).
 */
export async function resolveSubstitution(
  client: PharmacyPrismaClient,
  params: {
    medicationId: string
    substituteApproved: boolean
    instruction?: string
    claims: AuthUserClaims
    audit: AuditContext
  },
  logger?: Logger,
): Promise<{ medicationId: string; isSubstituteApproved: boolean }> {
  const medication = await client.medication.findUnique({
    where: { id: params.medicationId },
    select: { id: true, patientId: true },
  })
  if (!medication) throw notFound('Obat tidak ditemukan')

  await assertPatientInScope(client, params.claims, medication.patientId)

  const pending = await client.medicationRequest.findMany({
    where: { medicationId: medication.id, status: MedicationRequestStatus.SUBSTITUTED },
    select: { id: true },
  })

  for (const request of pending) {
    await client.medicationRequest.update({
      where: { id: request.id },
      data: { isSubstituteApproved: params.substituteApproved },
    })
    await recordEvent(client, {
      requestId: request.id,
      patientId: medication.patientId,
      fromStatus: MedicationRequestStatus.SUBSTITUTED,
      toStatus: MedicationRequestStatus.SUBSTITUTED,
      action: MedicationRequestAction.RETURNED_TO_QUEUE,
      actorUserId: params.claims.sub,
      actorRole: params.claims.role,
      note: params.instruction ?? 'Dokter menyetujui penggantian obat',
    })
  }

  if (params.instruction) {
    await client.medication.update({
      where: { id: medication.id },
      data: { instructions: params.instruction },
    })
  }

  await audit(
    client,
    params.audit,
    AuditAction.MEDICATION_REQUEST_SUBSTITUTED,
    medication.id,
    medication.patientId,
    { substituteApproved: params.substituteApproved, requestCount: pending.length },
    logger,
  )

  return { medicationId: medication.id, isSubstituteApproved: params.substituteApproved }
}

export { describeAllowed, invalidTransition }
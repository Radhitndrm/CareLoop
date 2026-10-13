// Tahap 1 alur: pendaftaran & pengelolaan data dasar pasien oleh nakes.
//
// Space yang dijaga di sini:
// - Patient.id = User.id (schema.prisma). Akun pasien sengaja dibuat tanpa kata sandi
//   agar login hanya lewat OTP WhatsApp — jalur yang sudah ada di modules/auth.
// - NAKES hanya boleh menambah/membaca pasien di wilayah penugasannya. ADMIN bebas.
// - resolveNakesScope hanya mengenali pasien lewat districtCode atau NakesContact, jadi
//   pasien yang baru dibuat harus diikat ke puskesmassanya agar langsung masuk dashboard.
import type { PrismaClient } from '@prisma/client'
import type {
  AuthUserClaims,
  CreatePatientInput,
  HrThresholdsInput,
  LivingSituation,
  PatientListQueryInput,
  PatientStatus,
  UpdatePatientInput,
  UserRole,
} from '@careloop/shared'
import { createPatientSchema, hrThresholdsSchema, patientListQuerySchema, updatePatientSchema } from '@careloop/shared'
import { AuditAction } from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors'
import { buildScopedPatientWhere, resolveNakesScope, type NakesScope } from '../dashboard/dashboard.service'

export type PatientsPrismaClient = {
  user: {
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
  }
  patient: {
    findMany(args: any): Promise<any[]>
    findFirst(args: any): Promise<any | null>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    count(args: any): Promise<number>
  }
  puskesmas: {
    findUnique(args: any): Promise<any | null>
  }
  nakesContact: {
    create(args: any): Promise<any>
    findMany(args: any): Promise<any[]>
  }
  auditLog?: PrismaClient['auditLog']
  $transaction?(fn: (tx: any) => Promise<any>): Promise<any>
}

export interface PatientSummary {
  id: string
  fullName: string
  phone: string
  districtCode: string | null
  livingSituation: LivingSituation
  healthConditions: string[]
  riskLevel: string | null
  consentShareWithNakes: boolean
  /** Status operasional; hanya ACTIVE yang masuk scheduler. */
  status: PatientStatus
  primaryPuskesmasName: string | null
  createdAt: string
}

export interface PatientDetail extends PatientSummary {
  nik: string | null
  gender: string | null
  dateOfBirth: string | null
  address: string | null
  city: string | null
  province: string | null
  bpjsNumber: string | null
  hasNearbyFamily: boolean
  emergencyPreference: string
  smartwatchEnabled: boolean
  voiceEnabled: boolean
  hrMinBpm: number | null
  hrMaxBpm: number | null
  /** Nomor WhatsApp sudah diverifikasi lewat OTP? Prasyarat aktivasi. */
  isVerified: boolean
  /** Waktu persetujuan PDP; prasyarat aktivasi. */
  consentPdpAt: string | null
  activatedAt: string | null
  primaryPuskesmas: { id: string; name: string; isActive: boolean } | null
  nakesContacts: Array<{
    id: string
    nakesName: string
    nakesRole: string
    phone: string
    isPrimary: boolean
    isActive: boolean
  }>
}

export interface AuditContext {
  actorUserId?: string | null
  actorRole?: UserRole | null
  ip?: string | null
  userAgent?: string | null
}

const PATIENT_SELECT = {
  id: true,
  user: { select: { fullName: true, phone: true, isVerified: true, consentPdpAt: true } },
  nik: true,
  gender: true,
  dateOfBirth: true,
  address: true,
  districtCode: true,
  city: true,
  province: true,
  bpjsNumber: true,
  status: true,
  primaryPuskesmasId: true,
  primaryPuskesmas: { select: { id: true, name: true, isActive: true } },
  activatedAt: true,
  livingSituation: true,
  hasNearbyFamily: true,
  emergencyPreference: true,
  healthConditions: true,
  smartwatchEnabled: true,
  voiceEnabled: true,
  hrMinBpm: true,
  hrMaxBpm: true,
  riskLevel: true,
  consentShareWithNakes: true,
  createdAt: true,
} as const

/**
 * Jalankan dalam transaksi bila client mendukungnya (PrismaClient asli), atau
 * langsung jalankan callback bila tidak — dipakai agar unit test dengan mock
 * sederhana tidak perlu menyediakan $transaction.
 */
async function runTransaction(
  client: PatientsPrismaClient,
  fn: (tx: any) => Promise<any>,
): Promise<any> {
  if (typeof client.$transaction === 'function') return client.$transaction(fn)
  return fn(client)
}

function toSummary(record: any): PatientSummary {
  return {
    id: record.id,
    fullName: record.user.fullName,
    phone: record.user.phone,
    districtCode: record.districtCode,
    livingSituation: record.livingSituation,
    healthConditions: record.healthConditions,
    riskLevel: record.riskLevel,
    consentShareWithNakes: record.consentShareWithNakes,
    status: record.status,
    primaryPuskesmasName: record.primaryPuskesmas?.name ?? null,
    createdAt: record.createdAt.toISOString(),
  }
}

function toDetail(record: any): PatientDetail {
  return {
    ...toSummary(record),
    nik: record.nik,
    gender: record.gender,
    dateOfBirth: record.dateOfBirth ? record.dateOfBirth.toISOString().slice(0, 10) : null,
    address: record.address,
    city: record.city,
    province: record.province,
    bpjsNumber: record.bpjsNumber,
    hasNearbyFamily: record.hasNearbyFamily,
    emergencyPreference: record.emergencyPreference,
    smartwatchEnabled: record.smartwatchEnabled,
    voiceEnabled: record.voiceEnabled,
    hrMinBpm: record.hrMinBpm,
    hrMaxBpm: record.hrMaxBpm,
    isVerified: record.user.isVerified,
    consentPdpAt: record.user.consentPdpAt ? record.user.consentPdpAt.toISOString() : null,
    activatedAt: record.activatedAt ? record.activatedAt.toISOString() : null,
    primaryPuskesmas: record.primaryPuskesmas ?? null,
    nakesContacts: (record.nakesContacts ?? []).map((c: any) => ({
      id: c.id,
      nakesName: c.nakesName,
      nakesRole: c.nakesRole,
      phone: c.phone,
      isPrimary: c.isPrimary,
      isActive: c.isActive,
    })),
  }
}

/**
 * Pastikan pasien yang dituju ada di scope nakes. ADMIN selalu lolos.
 * NAKES tanpa penugasan pun tetap punya satu syarat (NakesContact langsung),
 * sehingga scope tidak pernah kosong diam-diam.
 */
export async function assertPatientInScope(
  client: PatientsPrismaClient,
  claims: AuthUserClaims,
  patientId: string,
): Promise<{ scope: NakesScope; patient: any }> {
  const scope = await resolveNakesScope(client as any, claims)
  const where = buildScopedPatientWhere(scope)

  const patient = await client.patient.findFirst({
    where: { AND: [where, { id: patientId }] },
    select: { id: true },
  })

  if (!patient) {
    // 404, bukan 403: keberadaan pasien di luar scope tidak ikut terkonfirmasi.
    throw notFound('Pasien tidak ditemukan')
  }

  return { scope, patient }
}

export interface CreatePatientParams {
  input: CreatePatientInput
  claims: AuthUserClaims
  audit: AuditContext
}

/**
 * POST /v1/patients — Nakes mendaftarkan pasien baru (Tahap 1 alur, docs/API.md §3.1).
 *
 * NAKES harus memilih puskesmas di dalam penugasannya; puskesmas di luar scope
 * ditolak 403 supaya tidak ada pasien "yatim" yang tak terlihat oleh siapa pun.
 */
export async function createPatient(
  client: PatientsPrismaClient,
  params: CreatePatientParams,
): Promise<PatientDetail> {
  const input = createPatientSchema.parse(params.input)
  const { claims } = params

  if (claims.role !== 'NAKES' && claims.role !== 'ADMIN') {
    throw forbidden('Hanya nakes atau admin yang dapat mendaftarkan pasien')
  }

  const scope = await resolveNakesScope(client as any, claims)

  if (!scope.isAdmin) {
    const puskesmasAllowed = scope.puskesmasIds.includes(input.puskesmasId)
    const districtAllowed =
      scope.districtCodes.length > 0 && scope.districtCodes.includes(input.districtCode)

    if (!puskesmasAllowed && !districtAllowed) {
      throw forbidden('Puskesmas ini di luar wilayah penugasan Anda')
    }
  }

  const puskesmas = await client.puskesmas.findUnique({
    where: { id: input.puskesmasId },
    select: { id: true, districtCode: true },
  })
  if (!puskesmas) throw notFound('Puskesmas tidak ditemukan')

  // NIK dan nomor HP unik. Dicek dulu supaya pesannya jelas, lalu ditangkap lagi
  // lewat unique constraint untuk menutup celah concurrent insert.
  const [phoneTaken, nikTaken] = await Promise.all([
    client.user.findUnique({ where: { phone: input.phone }, select: { id: true } }),
    input.nik
      ? client.patient.findUnique({ where: { nik: input.nik }, select: { id: true } })
      : Promise.resolve(null),
  ])
  if (phoneTaken) throw conflict('Nomor HP ini sudah terdaftar')
  if (nikTaken) throw conflict('NIK ini sudah terdaftar')

  const userId = crypto.randomUUID()

  // Identitas nakes yang mendaftar dipakai sebagai NakesContact otomatis di bawah,
  // supaya baris itu tidak perlu diisi dengan string kosong.
  const registeringNakes = await client.user.findUnique({
    where: { id: claims.sub },
    select: { fullName: true, phone: true, nakesRole: true },
  })

  const created = await runTransaction(client, async (tx: any) => {
    await tx.user.create({
      data: {
        id: userId,
        phone: input.phone,
        fullName: input.fullName,
        role: 'PATIENT',
        // Tanpa kata sandi: pasien hanya bisa masuk lewat OTP WhatsApp (modules/auth).
        passwordHash: null,
        isVerified: false,
        timezone: 'Asia/Jakarta',
        consentPdpAt: input.consentShareWithNakes ? new Date() : null,
      },
    })

    const patient = await tx.patient.create({
      data: {
        id: userId,
        nik: input.nik ?? null,
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        gender: input.gender ?? null,
        address: input.address ?? null,
        districtCode: puskesmas.districtCode ?? input.districtCode,
        city: input.city ?? null,
        province: input.province ?? null,
        livingSituation: input.livingSituation,
        hasNearbyFamily: input.hasNearbyFamily,
        emergencyPreference: input.emergencyPreference,
        healthConditions: input.healthConditions,
        bpjsNumber: input.bpjsNumber ?? null,
        smartwatchEnabled: input.smartwatchEnabled,
        voiceEnabled: input.voiceEnabled,
        consentShareWithNakes: input.consentShareWithNakes,
        // Pasien baru selalu mulai dari ONBOARDING. Menempelkan status ACTIVE di sini
        // akan membuat scheduler mengirim pengingat obat yang belum disahkan dokter,
        // jadi status naik hanya lewat POST /v1/patients/:id/activate.
        status: 'ONBOARDING',
        primaryPuskesmasId: puskesmas.id,
      },
    })

    // Pasien baru harus langsung terlihat oleh nakes yang mendaftarkannya: scope
    // nakes hanya mengenali pasien lewat districtCode atau NakesContact, sedangkan
    // pasien hasil create belum punya NakesContact.
    if (!scope.isAdmin) {
      await tx.nakesContact.create({
        data: {
          patientId: patient.id,
          nakesUserId: claims.sub,
          nakesName: registeringNakes?.fullName ?? 'Nakes',
          nakesRole: registeringNakes?.nakesRole ?? claims.nakesRole ?? 'PERAWAT',
          phone: registeringNakes?.phone ?? '',
          puskesmasId: puskesmas.id,
          isPrimary: true,
          isActive: true,
        },
      })
    }

    return tx.patient.findUniqueOrThrow({
      where: { id: patient.id },
      select: { ...PATIENT_SELECT, nakesContacts: { select: NAKES_CONTACT_SELECT } },
    })
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_CREATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: created.id,
    patientId: created.id,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: {
      fullName: created.user.fullName,
      districtCode: created.districtCode,
      status: created.status,
      primaryPuskesmasId: puskesmas.id,
    },
  })

  return toDetail(created)
}

const NAKES_CONTACT_SELECT = {
  id: true,
  nakesName: true,
  nakesRole: true,
  phone: true,
  isPrimary: true,
  isActive: true,
} as const

export interface ListPatientsParams {
  claims: AuthUserClaims
  query: PatientListQueryInput
}

export interface ListPatientsResult {
  items: PatientSummary[]
  total: number
  limit: number
  offset: number
}

/** GET /v1/patients — daftar pasien dalam scope, dengan filter & paginasi. */
export async function listPatients(
  client: PatientsPrismaClient,
  params: ListPatientsParams,
): Promise<ListPatientsResult> {
  const query = patientListQuerySchema.parse(params.query)
  const scope = await resolveNakesScope(client as any, params.claims)

  const clauses: any[] = [buildScopedPatientWhere(scope)]

  if (query.livingSituation) clauses.push({ livingSituation: query.livingSituation })
  if (query.district) clauses.push({ districtCode: query.district })
  if (query.disease) clauses.push({ healthConditions: { has: query.disease } })
  if (query.search) {
    clauses.push({
      OR: [
        { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { user: { phone: { contains: query.search } } },
      ],
    })
  }

  const where = { AND: clauses }

  const [records, total] = await Promise.all([
    client.patient.findMany({
      where,
      select: PATIENT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    }),
    client.patient.count({ where }),
  ])

  return {
    items: records.map(toSummary),
    total,
    limit: query.limit,
    offset: query.offset,
  }
}

/** GET /v1/patients/:id — detail pasien dalam scope. */
export async function getPatient(
  client: PatientsPrismaClient,
  claims: AuthUserClaims,
  patientId: string,
): Promise<PatientDetail> {
  await assertPatientInScope(client, claims, patientId)

  const record = await client.patient.findUnique({
    where: { id: patientId },
    select: { ...PATIENT_SELECT, nakesContacts: { select: NAKES_CONTACT_SELECT } },
  })
  if (!record) throw notFound('Pasien tidak ditemukan')

  return toDetail(record)
}

export interface UpdatePatientParams {
  patientId: string
  input: UpdatePatientInput
  claims: AuthUserClaims
  audit: AuditContext
}

/** PUT /v1/patients/:id — perbarui data dasar & riwayat penyakit. */
export async function updatePatient(
  client: PatientsPrismaClient,
  params: UpdatePatientParams,
): Promise<PatientDetail> {
  const input = updatePatientSchema.parse(params.input)
  await assertPatientInScope(client, params.claims, params.patientId)

  await client.patient.update({
    where: { id: params.patientId },
    data: {
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.districtCode !== undefined ? { districtCode: input.districtCode } : {}),
      ...(input.livingSituation !== undefined ? { livingSituation: input.livingSituation } : {}),
      ...(input.hasNearbyFamily !== undefined ? { hasNearbyFamily: input.hasNearbyFamily } : {}),
      ...(input.emergencyPreference !== undefined
        ? { emergencyPreference: input.emergencyPreference }
        : {}),
      ...(input.healthConditions !== undefined ? { healthConditions: input.healthConditions } : {}),
      ...(input.voiceEnabled !== undefined ? { voiceEnabled: input.voiceEnabled } : {}),
      ...(input.smartwatchEnabled !== undefined
        ? { smartwatchEnabled: input.smartwatchEnabled }
        : {}),
      ...(input.consentShareWithNakes !== undefined
        ? { consentShareWithNakes: input.consentShareWithNakes }
        : {}),
    },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_UPDATED,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { fields: Object.keys(input) },
  })

  return getPatient(client, params.claims, params.patientId)
}

export interface SetHrThresholdsParams {
  patientId: string
  input: HrThresholdsInput
  claims: AuthUserClaims
  audit: AuditContext
}

/**
 * PUT /v1/patients/:id/hr-thresholds — penetapan ambang detak jantung.
 * Route memasang requireClinicalRole, jadi service hanya menerima nakes yang
 * sudah lolos gerbang klinis dan scope.
 */
export async function setHrThresholds(
  client: PatientsPrismaClient,
  params: SetHrThresholdsParams,
): Promise<{ hrMinBpm: number | null; hrMaxBpm: number | null }> {
  const input = hrThresholdsSchema.parse(params.input)
  await assertPatientInScope(client, params.claims, params.patientId)

  if (input.hrMinBpm == null && input.hrMaxBpm == null) {
    throw badRequest('Isi minimal satu ambang, atau kirim null untuk keduanya')
  }

  const updated = await client.patient.update({
    where: { id: params.patientId },
    data: {
      hrMinBpm: input.hrMinBpm ?? null,
      hrMaxBpm: input.hrMaxBpm ?? null,
    },
    select: { hrMinBpm: true, hrMaxBpm: true },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PATIENT_HR_THRESHOLD_SET,
    actorUserId: params.audit.actorUserId,
    actorRole: params.audit.actorRole,
    resourceType: 'patient',
    resourceId: params.patientId,
    patientId: params.patientId,
    ip: params.audit.ip,
    userAgent: params.audit.userAgent,
    meta: { hrMinBpm: updated.hrMinBpm, hrMaxBpm: updated.hrMaxBpm },
  })

  return updated
}
export type MedicationListPrismaClient = {
  medication: {
    findMany(args: any): Promise<any[]>
  }
  medicationStock: {
    findMany(args: any): Promise<any[]>
  }
}

export interface OwnMedicationOutput {
  id: string
  name: string
  dosage: string | null
  form: string
  instructions: string | null
  /** Jatah per pengambilan; null = dokter belum mengisi, dipakai default env. */
  daysSupply: number | null
  /** Sisa stok yang tercatat — bahan menentukan jumlah yang wajar=request. */
  quantityRemaining: number | null
}

/**
 * GET /v1/patients/me/medications — obat yang sedang diminum pasien sendiri
 * (docs/API.md §3.6).
 *
 * Hanya obat berstatus APPROVED dan masih aktif: resep DRAFT belum boleh
 * berjalan, jadi tidak bisa jadi bahan permintaan. Ini yang membatasi pasien —
 * tidak ada endpoint untuk meminta obat bebas — hanya obat yang sudah diresepkan.
 */
export async function listOwnMedications(
  client: MedicationListPrismaClient,
  claims: AuthUserClaims,
): Promise<OwnMedicationOutput[]> {
  const patientId = claims.patientId ?? claims.sub

  const [medications, stocks] = await Promise.all([
    client.medication.findMany({
      where: { patientId, status: 'APPROVED', isActive: true },
      select: {
        id: true,
        name: true,
        dosage: true,
        form: true,
        instructions: true,
        daysSupply: true,
      },
      orderBy: { name: 'asc' },
    }),
    client.medicationStock.findMany({
      where: { patientId },
      select: { medicationId: true, quantityRemaining: true },
    }),
  ])

  const stockByMedication = new Map(stocks.map((s) => [s.medicationId, s.quantityRemaining]))

  return medications.map((medication: any) => ({
    id: medication.id,
    name: medication.name,
    dosage: medication.dosage,
    form: medication.form,
    instructions: medication.instructions,
    daysSupply: medication.daysSupply,
    quantityRemaining: stockByMedication.get(medication.id) ?? null,
  }))
}

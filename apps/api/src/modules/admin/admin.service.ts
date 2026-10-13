// Manajemen tenaga kesehatan (Fase B plan operasional).
//
// NakesRole ditetapkan di sini, bukan saat staf mendaftar sendiri, karena itu hal yang
// menentukan siapa yang boleh menyetujui resep. Akun dibuat oleh admin, jadi tidak
// mungkin ada yang mendaftarkan dirinya sendiri sebagai dokter.
//
// Alur yang didukung:
//   invite -> INVITED (kode aktivasi sekali pakai) -> ACTIVE (staf aktivasi, buat sandi)
//   ACTIVE -> SUSPENDED -> ACTIVE, atau -> DEACTIVATED (selesai)
//
// `staffStatus` adalah sumber kebenaran kelayakan login; `users.isActive` selalu
// disinkronkan dari sini dan tidak boleh diubah route lain.
import { randomInt } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { NakesRole, StaffStatus } from '@careloop/shared'
import {
  AuditAction,
  NakesRole as NakesRoleEnum,
  StaffStatus as StaffStatusEnum,
  inviteNakesAccountSchema,
  nakesAssignmentSchema,
  updateNakesAccountSchema,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { badRequest, conflict, notFound } from '../../lib/errors'
import { hashPassword, verifyPassword } from '../../lib/password'

export type StaffClient = {
  user: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    count(args: any): Promise<number>
  }
  nakesAssignment: {
    create(args: any): Promise<any>
    findMany(args: any): Promise<any[]>
    update(args: any): Promise<any>
    updateMany(args: any): Promise<any>
    delete(args: any): Promise<any>
  }
  nakesContact?: {
    updateMany(args: any): Promise<any>
  }
  puskesmas: {
    findUnique(args: any): Promise<any | null>
  }
  auditLog?: PrismaClient['auditLog']
  $transaction?(fn: (tx: any) => Promise<any>): Promise<any>
}

/** Masa berlaku kode aktivasi. Cukup beberapa hari; kode bisa di-generate ulang. */
export const ACTIVATION_CODE_TTL_SEC = 60 * 60 * 24 * 7

const STAFF_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  role: true,
  nakesRole: true,
  staffStatus: true,
  isActive: true,
  createdAt: true,
} as const

export interface AssignmentOutput {
  id: string
  puskesmasId: string | null
  puskesmasName: string | null
  districtCode: string | null
  scopeType: string
  isActive: boolean
  createdAt: string
  endedAt: string | null
  note: string | null
}

export interface StaffOutput {
  id: string
  fullName: string
  phone: string
  email: string | null
  role: string
  nakesRole: NakesRole
  staffStatus: StaffStatus
  isActive: boolean
  activatedAt: string | null
  createdAt: string
  assignments: AssignmentOutput[]
}

function toAssignment(record: any): AssignmentOutput {
  return {
    id: record.id,
    puskesmasId: record.puskesmasId ?? null,
    puskesmasName: record.puskesmas?.name ?? null,
    districtCode: record.districtCode ?? null,
    scopeType: record.scopeType,
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
    endedAt: record.endedAt ? record.endedAt.toISOString() : null,
    note: record.note ?? null,
  }
}

export function toStaff(record: any): StaffOutput {
  return {
    id: record.id,
    fullName: record.fullName,
    phone: record.phone,
    email: record.email ?? null,
    role: record.role,
    nakesRole: record.nakesRole,
    // Akun lama bisa punya staffStatus null; migration sudah menandai ACTIVE, tapi
    // fallback di sini menjaga tampilan tetap benar bila ada baris yang lolos.
    staffStatus: record.staffStatus ?? StaffStatusEnum.ACTIVE,
    isActive: record.isActive,
    activatedAt: record.activatedAt ? record.activatedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    assignments: (record.nakesAssignments ?? []).map(toAssignment),
  }
}

const ASSIGNMENT_SELECT = {
  id: true,
  puskesmasId: true,
  districtCode: true,
  scopeType: true,
  isActive: true,
  createdAt: true,
  endedAt: true,
  note: true,
  puskesmas: { select: { name: true } },
} as const

const WITH_ASSIGNMENTS = { nakesAssignments: { select: ASSIGNMENT_SELECT } }

async function runTx(client: StaffClient, fn: (tx: any) => Promise<any>): Promise<any> {
  if (typeof client.$transaction === 'function') return client.$transaction(fn)
  return fn(client)
}

/** Kode 6 digit. `randomInt` memakai CSPRNG, bukan `Math.random`. */
export function generateActivationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Kode aktivasi di-hash dengan bcrypt, sama seperti kata sandi. */
export async function hashActivationCode(code: string): Promise<string> {
  return hashPassword(code)
}

function activationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + ACTIVATION_CODE_TTL_SEC * 1000)
}

export interface InviteParams {
  input: unknown
  actorUserId: string
}

export interface InviteResult {
  account: StaffOutput
  /**
   * Hanya diisi ketika akun dibuat sebagai INVITED. Kode ini tidak pernah disimpan
   * plaintext dan tidak bisa diambil lagi — kalau hilang, admin generates ulang.
   */
  activationCode: string | null
  activationExpiresAt: string | null
}

/**
 * POST /v1/admin/nakes-accounts — buat akun nakes beserta peran klinis & penugasannya.
 *
 * Akun dan seluruh penugasannya ditulis dalam satu transaksi: akun tanpa penugasan
 * adalah nakes buta yang tidak boleh pernah ada, dan penugasan tanpa akun adalah
 * baris yatim.
 */
export async function inviteStaff(client: StaffClient, params: InviteParams): Promise<InviteResult> {
  const input = inviteNakesAccountSchema.parse(params.input)

  if (input.assignments.length === 0) {
    throw conflict('Setidaknya satu wilayah penugasan wajib diisi')
  }

  const existing = await client.user.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  })
  if (existing) throw conflict('Nomor HP ini sudah terdaftar')

  // Semua puskesmas yang dirujuk harus ada dan aktif sebelum akun dibuat, supaya
  // penugasan tidak pernah menunjuk ke puskesmas yang tidak bisa dipilih.
  for (const assignment of input.assignments) {
    if (!assignment.puskesmasId) continue
    const clinic = await client.puskesmas.findUnique({
      where: { id: assignment.puskesmasId },
      select: { id: true, isActive: true },
    })
    if (!clinic) throw notFound('Puskesmas tidak ditemukan')
    if (!clinic.isActive) throw badRequest('Puskesmas sedang tidak aktif')
  }

  const invited = !input.password
  const now = new Date()
  const code = invited ? generateActivationCode() : null
  const codeHash = code ? await hashActivationCode(code) : null

  const createdId = await runTx(client, async (tx: any) => {
    const user = await tx.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        fullName: input.fullName,
        role: 'NAKES',
        nakesRole: input.nakesRole,
        staffStatus: invited ? StaffStatusEnum.INVITED : StaffStatusEnum.ACTIVE,
        activationCodeHash: codeHash,
        activationCodeExpiresAt: codeHash ? activationExpiry(now) : null,
        activatedAt: invited ? null : now,
        // INVITED belum boleh login sama sekali.
        isActive: !invited,
        // INVITED belum memverifikasi nomor; verifikasi terjadi saat aktivasi.
        isVerified: !invited,
      },
      select: { id: true },
    })

    for (const assignment of input.assignments) {
      await tx.nakesAssignment.create({
        data: {
          nakesUserId: user.id,
          puskesmasId: assignment.puskesmasId ?? null,
          districtCode: assignment.districtCode ?? null,
          scopeType: assignment.puskesmasId ? 'PUSKESMAS' : 'DISTRICT',
          note: assignment.note ?? null,
          assignedById: params.actorUserId,
          isActive: true,
        },
      })
    }

    return user.id
  })

  await tryCreateAuditLog(client as any, {
    action: invited ? AuditAction.NAKES_ACCOUNT_INVITED : AuditAction.NAKES_ACCOUNT_CREATED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'user',
    resourceId: createdId,
    meta: {
      nakesRole: input.nakesRole,
      staffStatus: invited ? StaffStatusEnum.INVITED : StaffStatusEnum.ACTIVE,
      assignments: input.assignments,
    },
  })

  const account = await getStaff(client, createdId)
  return {
    account,
    activationCode: code,
    activationExpiresAt: codeHash ? activationExpiry(now).toISOString() : null,
  }
}

async function loadStaffOrThrow(client: StaffClient, staffId: string): Promise<any> {
  const record = await client.user.findUnique({
    where: { id: staffId },
    select: { ...STAFF_SELECT, activatedAt: true, ...WITH_ASSIGNMENTS },
  })
  if (!record || record.role !== 'NAKES') throw notFound('Akun tenaga kesehatan tidak ditemukan')
  return record
}

/** GET /v1/admin/nakes-accounts/:id — detail staf beserta penugasannya. */
export async function getStaff(client: StaffClient, staffId: string): Promise<StaffOutput> {
  return toStaff(await loadStaffOrThrow(client, staffId))
}

export interface ListParams {
  nakesRole?: string
  staffStatus?: string
  search?: string
  limit?: number
  offset?: number
}

export interface ListResult {
  items: StaffOutput[]
  total: number
}

/** GET /v1/admin/nakes-accounts — daftar nakes, peran klinis, status, dan penugasan. */
export async function listStaff(client: StaffClient, params: ListParams = {}): Promise<ListResult> {
  const where: any = { role: 'NAKES' }
  if (params.nakesRole) where.nakesRole = params.nakesRole
  if (params.staffStatus) where.staffStatus = params.staffStatus
  if (params.search) {
    const term = params.search.trim()
    where.OR = [
      { fullName: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term } },
    ]
  }

  const [records, total] = await Promise.all([
    client.user.findMany({
      where,
      select: { ...STAFF_SELECT, activatedAt: true, ...WITH_ASSIGNMENTS },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 50,
      skip: params.offset ?? 0,
    }),
    client.user.count({ where }),
  ])

  return { items: records.map(toStaff), total }
}

export interface RegenerateResult {
  activationCode: string
  activationExpiresAt: string
}

/**
 * POST /v1/admin/nakes-accounts/:id/activation-code — kode baru untuk staf yang
 * belum aktif. Kode lama langsung tidak berlaku karena hash-nya ditimpa.
 */
export async function regenerateActivationCode(
  client: StaffClient,
  params: { staffId: string; actorUserId: string },
): Promise<RegenerateResult> {
  const record = await loadStaffOrThrow(client, params.staffId)
  if (record.staffStatus === StaffStatusEnum.DEACTIVATED) {
    throw badRequest('Akun sudah dinonaktifkan permanen; buat akun baru')
  }

  const code = generateActivationCode()
  const expiresAt = activationExpiry()

  await client.user.update({
    where: { id: params.staffId },
    data: {
      activationCodeHash: await hashActivationCode(code),
      activationCodeExpiresAt: expiresAt,
      staffStatus: StaffStatusEnum.INVITED,
      isActive: false,
    },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.NAKES_ACCOUNT_STATUS_CHANGED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'user',
    resourceId: params.staffId,
    meta: { change: 'activation_code_regenerated', staffStatus: StaffStatusEnum.INVITED },
  })

  return { activationCode: code, activationExpiresAt: expiresAt.toISOString() }
}

export interface ActivateParams {
  phone: string
  code: string
  password: string
}

export interface ActivateResult {
  staffId: string
  fullName: string
}

/**
 * POST /v1/auth/activate — staf invited menukar kode sekali pakai dengan kata sandi.
 *
 * Verifikasi kode memakai bcrypt seperti kata sandi, dan kode yang sudah dipakai atau
 * kedaluwarsa ditolak tanpa pesan berbeda supaya tidak bisa dipakai untuk menebak.
 */
export async function activateStaff(client: StaffClient, params: ActivateParams): Promise<ActivateResult> {
  const record = await client.user.findUnique({
    where: { phone: params.phone },
    select: {
      id: true,
      fullName: true,
      role: true,
      staffStatus: true,
      activationCodeHash: true,
      activationCodeExpiresAt: true,
    },
  })

  const invalid = (): never => {
    throw badRequest('Kode aktivasi salah atau sudah kedaluwarsa')
  }

  if (!record || record.role !== 'NAKES') invalid()
  if (!record.activationCodeHash) invalid()
  if (record.staffStatus === StaffStatusEnum.DEACTIVATED) invalid()
  if (
    record.activationCodeExpiresAt &&
    record.activationCodeExpiresAt.getTime() <= Date.now()
  ) {
    invalid()
  }

  const matched = await verifyPassword(params.code, record.activationCodeHash)
  if (!matched) invalid()

  const now = new Date()
  await client.user.update({
    where: { id: record.id },
    data: {
      passwordHash: await hashPassword(params.password),
      staffStatus: StaffStatusEnum.ACTIVE,
      isActive: true,
      isVerified: true,
      activatedAt: now,
      // Kode sekali pakai: hash dihapus supaya tidak bisa dipakai ulang.
      activationCodeHash: null,
      activationCodeExpiresAt: null,
    },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.NAKES_ACCOUNT_ACTIVATED,
    resourceType: 'user',
    resourceId: record.id,
    meta: { staffStatus: StaffStatusEnum.ACTIVE },
  })

  return { staffId: record.id, fullName: record.fullName }
}

export interface UpdateParams {
  staffId: string
  input: unknown
  actorUserId: string
}

/**
 * PATCH /v1/admin/nakes-accounts/:id — ubah peran klinis atau status staf.
 *
 * `DEACTIVATED` bersifat final: staf yang berhenti tidak bisa dihidupkan lagi, dan
 * akses barunya dicabut seketika. Penugasan aktif ikut dimatikan supaya berhenti
 * tidak bisa menjadi jalan masuk data pasien.
 */
export async function updateStaff(client: StaffClient, params: UpdateParams): Promise<StaffOutput> {
  const input = updateNakesAccountSchema.parse(params.input)
  const record = await loadStaffOrThrow(client, params.staffId)

  const nextStatus = input.staffStatus ?? record.staffStatus
  const nextRole = input.nakesRole ?? record.nakesRole

  if (record.staffStatus === StaffStatusEnum.DEACTIVATED && input.staffStatus !== undefined) {
    throw badRequest('Akun yang sudah dinonaktifkan permanen tidak bisa diubah statusnya')
  }

  const now = new Date()
  await runTx(client, async (tx: any) => {
    await tx.user.update({
      where: { id: params.staffId },
      data: {
        nakesRole: nextRole,
        staffStatus: nextStatus,
        isActive: nextStatus === StaffStatusEnum.ACTIVE,
      },
    })

    // Berhenti/cuti -> SEMUA penugasan ikut ditutup, bukan hanya yang pertama: satu
    // penugasan yang tertinggal berarti staf masih punya wilayah walau sudah
    // ditangguhkan. Barisnya tidak dihapus (isActive=false + endedAt), sehingga klaim
    // "pasien ini pernah dipegang siapa" masih bisa dijawab.
    if (nextStatus !== StaffStatusEnum.ACTIVE) {
      await tx.nakesAssignment.updateMany({
        where: { nakesUserId: params.staffId, isActive: true },
        data: { isActive: false, endedAt: now },
      })
    }
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.NAKES_ACCOUNT_UPDATED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'user',
    resourceId: params.staffId,
    meta: {
      from: { nakesRole: record.nakesRole, staffStatus: record.staffStatus },
      to: { nakesRole: nextRole, staffStatus: nextStatus },
      reason: input.reason ?? null,
    },
  })

  return getStaff(client, params.staffId)
}

export interface AssignmentParams {
  staffId: string
  input: unknown
  actorUserId: string
}

export interface AssignmentResult {
  staff: StaffOutput
  assignment: AssignmentOutput
}

/** POST /v1/admin/nakes-accounts/:id/assignments — tambah penugasan wilayah. */
export async function addAssignment(
  client: StaffClient,
  params: AssignmentParams,
): Promise<AssignmentResult> {
  const input = nakesAssignmentSchema.parse(params.input)
  await loadStaffOrThrow(client, params.staffId)

  if (input.puskesmasId) {
    const clinic = await client.puskesmas.findUnique({
      where: { id: input.puskesmasId },
      select: { id: true, isActive: true },
    })
    if (!clinic) throw notFound('Puskesmas tidak ditemukan')
    if (!clinic.isActive) throw badRequest('Puskesmas sedang tidak aktif')
  }

  const created = await client.nakesAssignment.create({
    data: {
      nakesUserId: params.staffId,
      puskesmasId: input.puskesmasId ?? null,
      districtCode: input.districtCode ?? null,
      scopeType: input.puskesmasId ? 'PUSKESMAS' : 'DISTRICT',
      note: input.note ?? null,
      assignedById: params.actorUserId,
      isActive: true,
    },
    select: ASSIGNMENT_SELECT,
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.NAKES_ASSIGNMENT_CREATED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'nakes_assignment',
    resourceId: created.id,
    meta: { nakesUserId: params.staffId, assignment: input },
  })

  return { staff: await getStaff(client, params.staffId), assignment: toAssignment(created) }
}

export interface EndAssignmentParams {
  staffId: string
  assignmentId: string
  actorUserId: string
  reason?: string
}

/**
 * DELETE /v1/admin/nakes-accounts/:id/assignments/:assignmentId — tutup penugasan.
 *
 * Menonaktifkan (bukan menghapus) supaya riwayat siapa yang memegang wilayah mana
 * tetap bisa diaudit.
 */
export async function endAssignment(
  client: StaffClient,
  params: EndAssignmentParams,
): Promise<StaffOutput> {
  const record = await loadStaffOrThrow(client, params.staffId)
  const assignment = record.nakesAssignments?.find((a: any) => a.id === params.assignmentId)
  if (!assignment) throw notFound('Penugasan tidak ditemukan')
  if (!assignment.isActive) throw badRequest('Penugasan ini sudah tidak aktif')

  await client.nakesAssignment.update({
    where: { id: params.assignmentId },
    data: { isActive: false, endedAt: new Date() },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.NAKES_ASSIGNMENT_ENDED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'nakes_assignment',
    resourceId: params.assignmentId,
    meta: { nakesUserId: params.staffId, reason: params.reason ?? null },
  })

  return getStaff(client, params.staffId)
}

/** Peran klinis yang boleh dipilih admin ketika menambah staf. */
export const ASSIGNABLE_ROLES: NakesRole[] = [
  NakesRoleEnum.DOKTER,
  NakesRoleEnum.PERAWAT,
  NakesRoleEnum.BIDAN,
  NakesRoleEnum.KADER,
  NakesRoleEnum.FARMASI,
  NakesRoleEnum.LAINNYA,
]
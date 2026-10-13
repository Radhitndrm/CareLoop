// Master data puskesmas (Fase B plan operasional).
//
// Tujuan utamanya satu: operator tidak lagi mengetik UUID. Form publik (pendaftaran
// pasien, undangan staf) mengambil puskesmas dari daftar di sini, dan UUID tetap
// menjadi detail internal yang tidak pernah tampil di layar.
//
// Scope baca memakai aturan yang sudah ada di `resolveNakesScope`: NAKES hanya melihat
// puskesmas dalam penugasannya, ADMIN melihat semuanya. Tanpa pembatasan, operator
// bisa mendaftarkan pasien ke puskesmas lain lalu langsung kehilangan visibilitasnya.
import type { PrismaClient } from '@prisma/client'
import type { AuthUserClaims, FacilityType } from '@careloop/shared'
import {
  AuditAction,
  createPuskesmasSchema,
  updatePuskesmasSchema,
  type CreatePuskesmasInput,
  type UpdatePuskesmasInput,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { conflict, notFound } from '../../lib/errors'
import { resolveNakesScope } from '../dashboard/dashboard.service'

export type ClinicClient = {
  puskesmas: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    count(args: any): Promise<number>
  }
  auditLog?: PrismaClient['auditLog']
}

export interface Clinic {
  id: string
  name: string
  type: FacilityType
  districtCode: string | null
  address: string | null
  phone: string | null
  lat: number | null
  lng: number | null
  isActive: boolean
  createdAt: string
}

const SELECT = {
  id: true,
  name: true,
  type: true,
  districtCode: true,
  address: true,
  phone: true,
  lat: true,
  lng: true,
  isActive: true,
  createdAt: true,
} as const

function toClinic(record: any): Clinic {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    districtCode: record.districtCode ?? null,
    address: record.address ?? null,
    phone: record.phone ?? null,
    lat: record.lat == null ? null : Number(record.lat),
    lng: record.lng == null ? null : Number(record.lng),
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
  }
}

export interface ListParams {
  claims: AuthUserClaims
  search?: string
  district?: string
  /** `true` juga menampilkan yang nonaktif — khusus layar administrasi. */
  includeInactive?: boolean
}

export interface ListResult {
  items: Clinic[]
  total: number
}

/** Batasan scope untuk satu pemanggil, atau `null` bila admin (tanpa batas). */
async function scopeFilter(client: ClinicClient, claims: AuthUserClaims): Promise<any | null> {
  if (claims.role === 'ADMIN') return null

  const scope = await resolveNakesScope(client as any, claims)
  const or: any[] = []
  if (scope.puskesmasIds.length > 0) or.push({ id: { in: scope.puskesmasIds } })
  if (scope.districtCodes.length > 0) {
    or.push({ districtCode: { in: scope.districtCodes } })
  }

  // Staf tanpa penugasan melihat daftar kosong, bukan melihat semuanya.
  return or.length > 0 ? { OR: or } : { id: 'impossible-no-scope' }
}

/** GET /v1/puskesmas — daftar untuk dipilih operator. */
export async function list(client: ClinicClient, params: ListParams): Promise<ListResult> {
  const clauses: any[] = []
  if (!params.includeInactive) clauses.push({ isActive: true })
  if (params.search) {
    clauses.push({ name: { contains: params.search.trim(), mode: 'insensitive' } })
  }
  if (params.district) clauses.push({ districtCode: params.district.trim() })

  const scope = await scopeFilter(client, params.claims)
  if (scope) clauses.push(scope)

  const where = clauses.length > 0 ? { AND: clauses } : {}

  const [records, total] = await Promise.all([
    client.puskesmas.findMany({ where, select: SELECT, orderBy: { name: 'asc' }, take: 200 }),
    client.puskesmas.count({ where }),
  ])

  return { items: records.map(toClinic), total }
}

/** GET /v1/puskesmas/:id — detail satu puskesmas, dibatasi scope yang sama. */
export async function getById(
  client: ClinicClient,
  params: { claims: AuthUserClaims; id: string },
): Promise<Clinic> {
  const { items } = await list(client, { claims: params.claims, includeInactive: true })
  const found = items.find((item) => item.id === params.id)
  if (!found) throw notFound('Puskesmas tidak ditemukan')
  return found
}

export interface DistrictRow {
  code: string
  clinicCount: number
}

/**
 * GET /v1/puskesmas/districts — kode wilayah yang bisa dipilih operator.
 *
 * Diturunkan dari puskesmas yang terlihat oleh pemanggil, bukan dari tabel wilayah
 * terpisah: untuk MVP ini cukup, dan tidak berisiko menawarkan wilayah yang tidak
 * punya puskesmas sama sekali.
 */
export async function listDistricts(
  client: ClinicClient,
  params: { claims: AuthUserClaims },
): Promise<{ items: DistrictRow[] }> {
  const { items } = await list(client, { claims: params.claims })

  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item.districtCode) continue
    counts.set(item.districtCode, (counts.get(item.districtCode) ?? 0) + 1)
  }

  return {
    items: [...counts.entries()]
      .map(([code, clinicCount]) => ({ code, clinicCount }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  }
}

/**
 * Nama puskesmas tidak boleh duplikat dalam satu wilayah.
 *
 * Diperiksa di aplikasi, bukan lewat unique index, karena `districtCode` nullable:
 * PostgreSQL menganggap NULL berbeda dengan NULL, sehingga index tidak akan menangkap
 * dua puskesmas tanpa kode wilayah yang namanya sama.
 */
async function nameTaken(
  client: ClinicClient,
  name: string,
  districtCode: string | null,
  excludeId?: string,
): Promise<boolean> {
  const rows = await client.puskesmas.findMany({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(districtCode ? { districtCode } : { districtCode: null }),
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
    take: 1,
  })
  return rows.length > 0
}

async function assertNameFree(
  client: ClinicClient,
  name: string,
  districtCode: string | null,
  excludeId?: string,
): Promise<void> {
  if (await nameTaken(client, name, districtCode, excludeId)) {
    throw conflict(
      districtCode
        ? `Puskesmas dengan nama "${name}" sudah ada di wilayah ${districtCode}`
        : `Puskesmas dengan nama "${name}" sudah ada`,
    )
  }
}

/** POST /v1/admin/puskesmas — hanya admin pusat yang boleh menambah puskesmas. */
export async function create(
  client: ClinicClient,
  params: { input: CreatePuskesmasInput; actorUserId: string },
): Promise<Clinic> {
  const input = createPuskesmasSchema.parse(params.input)
  await assertNameFree(client, input.name, input.districtCode ?? null)

  const created = await client.puskesmas.create({
    data: {
      name: input.name,
      type: input.type,
      districtCode: input.districtCode ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      isActive: input.isActive,
    },
    select: SELECT,
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PUSKESMAS_CREATED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'puskesmas',
    resourceId: created.id,
    meta: { name: created.name, districtCode: created.districtCode },
  })

  return toClinic(created)
}

/**
 * PATCH /v1/admin/puskesmas/:id.
 *
 * `isActive: false` tidak menghapus puskesmas: pasien dan riwayat penugasan masih
 * menunjuk ke sana. Yang dinonaktifkan hanya kemunculannya di pilihan baru.
 */
export async function update(
  client: ClinicClient,
  params: { id: string; input: UpdatePuskesmasInput; actorUserId: string },
): Promise<Clinic> {
  const input = updatePuskesmasSchema.parse(params.input)

  const existing = await client.puskesmas.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, districtCode: true },
  })
  if (!existing) throw notFound('Puskesmas tidak ditemukan')

  const nextName = input.name ?? existing.name
  const nextDistrict =
    input.districtCode === undefined ? existing.districtCode : input.districtCode
  if (nextName !== existing.name || nextDistrict !== existing.districtCode) {
    await assertNameFree(client, nextName, nextDistrict ?? null, params.id)
  }

  await client.puskesmas.update({
    where: { id: params.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.districtCode !== undefined ? { districtCode: input.districtCode } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  })

  await tryCreateAuditLog(client as any, {
    action: AuditAction.PUSKESMAS_UPDATED,
    actorUserId: params.actorUserId,
    actorRole: 'ADMIN',
    resourceType: 'puskesmas',
    resourceId: params.id,
    meta: { name: nextName, districtCode: nextDistrict ?? null, changes: input },
  })

  const result = await client.puskesmas.findUnique({ where: { id: params.id }, select: SELECT })
  if (!result) throw notFound('Puskesmas tidak ditemukan')
  return toClinic(result)
}
// CL-111: Kontak Keluarga Aktif per Tier (area: safety / family).
// Layanan CRUD kontak keluarga per pasien dengan validasi prioritas tier,
// consent PDP, verifikasi nomor (hanya nomor aktif/terverifikasi yang menerima alert),
// dan pembatasan akses berbasis kepemilikan pasien (scoping CL-008 & audit CL-010).
import type { PrismaClient } from '@prisma/client'
import {
  AuditAction,
  type CreateFamilyContactInput,
  type UpdateFamilyContactInput,
  createFamilyContactSchema,
  updateFamilyContactSchema,
} from '@careloop/shared'
import { tryCreateAuditLog } from '../../lib/audit'
import { conflict, forbidden, notFound } from '../../lib/errors'
import { isUniqueViolation } from '../../lib/idempotency'

export type FamilyPrismaClient = {
  familyContact: {
    findMany(args: any): Promise<any[]>
    findUnique(args: any): Promise<any | null>
    findFirst(args: any): Promise<any | null>
    create(args: any): Promise<any>
    update(args: any): Promise<any>
    delete(args: any): Promise<any>
  }
  patient?: {
    findUnique(args: any): Promise<any | null>
  }
  auditLog?: PrismaClient['auditLog']
}

export interface FamilyContactOutput {
  id: string
  patientId: string
  name: string
  phone: string
  relationship: string
  tier: string
  priority: number
  isNearby: boolean
  canViewHealth: boolean
  canReceiveEmergency: boolean
  isActive: boolean
  verificationStatus: 'VERIFIED' | 'PENDING'
  createdAt: Date
  updatedAt: Date
}

function toContactOutput(record: any): FamilyContactOutput {
  return {
    id: record.id,
    patientId: record.patientId,
    name: record.name,
    phone: record.phone,
    relationship: record.relationship,
    tier: record.tier,
    priority: record.priority,
    isNearby: record.isNearby,
    canViewHealth: record.canViewHealth,
    canReceiveEmergency: record.canReceiveEmergency,
    isActive: record.isActive,
    verificationStatus: record.isActive ? 'VERIFIED' : 'PENDING',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Mengambil seluruh kontak keluarga milik pasien terurut berdasarkan tier dan prioritas. */
export async function listFamilyContacts(
  client: FamilyPrismaClient,
  patientId: string,
): Promise<FamilyContactOutput[]> {
  const contacts = await client.familyContact.findMany({
    where: { patientId },
    orderBy: [{ tier: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
  })

  return contacts.map(toContactOutput)
}

export interface CreateFamilyContactParams {
  patientId: string
  input: CreateFamilyContactInput
  actorUserId?: string | null
  actorRole?: any
  ip?: string | null
  userAgent?: string | null
}

/** Menambahkan kontak keluarga baru dengan consent dan status verifikasi awal. */
export async function createFamilyContact(
  client: FamilyPrismaClient,
  params: CreateFamilyContactParams,
): Promise<FamilyContactOutput> {
  const validated = createFamilyContactSchema.parse(params.input)

  // Cek duplikasi nomor HP pada pasien yang sama
  const existing = await client.familyContact.findFirst({
    where: {
      patientId: params.patientId,
      phone: validated.phone,
    },
  })
  if (existing) {
    throw conflict('Nomor HP kontak ini sudah terdaftar untuk pasien Anda')
  }

  let created: any
  try {
    // Sesuai kriteria: kontak baru berstatus belum diverifikasi (isActive: false)
    // sampai proses verifikasi nomor dilakukan, sehingga tidak langsung aktif menerima alert darurat
    created = await client.familyContact.create({
      data: {
        patientId: params.patientId,
        name: validated.name,
        phone: validated.phone,
        relationship: validated.relationship,
        tier: validated.tier,
        priority: validated.priority,
        isNearby: validated.isNearby,
        canViewHealth: validated.canViewHealth,
        canReceiveEmergency: validated.canReceiveEmergency,
        isActive: false, // Memerlukan verifikasi sebelum aktif menerima alert
      },
    })
  } catch (error) {
    if (isUniqueViolation(error, 'FamilyContact_patientId_phone_key')) {
      throw conflict('Nomor HP kontak ini sudah terdaftar untuk pasien Anda')
    }
    throw error
  }

  // Audit Log: penambahan kontak keluarga
  if (client.auditLog) {
    await tryCreateAuditLog(client as any, {
      action: AuditAction.FAMILY_CONTACT_ADDED,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      resourceType: 'family_contact',
      resourceId: created.id,
      patientId: params.patientId,
      ip: params.ip,
      userAgent: params.userAgent,
      meta: {
        name: created.name,
        phone: created.phone,
        tier: created.tier,
        priority: created.priority,
      },
    })

    // Catat consent PDP jika pasien memberikan persetujuan saat menambahkan kontak
    if (validated.consentGiven) {
      await tryCreateAuditLog(client as any, {
        action: AuditAction.PATIENT_CONSENT_GIVEN,
        actorUserId: params.actorUserId,
        actorRole: params.actorRole,
        resourceType: 'patient',
        resourceId: params.patientId,
        patientId: params.patientId,
        ip: params.ip,
        userAgent: params.userAgent,
        meta: {
          consentType: 'PDP_FAMILY_ALERT',
          contactPhone: created.phone,
          grantedAt: new Date().toISOString(),
        },
      })
    }
  }

  return toContactOutput(created)
}

export interface UpdateFamilyContactParams {
  contactId: string
  patientId?: string | null
  input: UpdateFamilyContactInput
  actorUserId?: string | null
  actorRole?: any
  ip?: string | null
  userAgent?: string | null
}

/** Memperbarui data kontak keluarga (tier, prioritas, status aktif, preferensi). */
export async function updateFamilyContact(
  client: FamilyPrismaClient,
  params: UpdateFamilyContactParams,
): Promise<FamilyContactOutput> {
  const validated = updateFamilyContactSchema.parse(params.input)

  const contact = await client.familyContact.findUnique({
    where: { id: params.contactId },
  })

  if (!contact) {
    throw notFound('Kontak keluarga tidak ditemukan')
  }

  // Penegakan scope kepemilikan pasien (CL-008): pasien lain dilarang mengedit
  if (params.patientId && contact.patientId !== params.patientId) {
    throw forbidden('Anda tidak memiliki akses ke kontak keluarga ini')
  }

  // Cek duplikasi nomor jika nomor diubah
  if (validated.phone && validated.phone !== contact.phone) {
    const existing = await client.familyContact.findFirst({
      where: {
        patientId: contact.patientId,
        phone: validated.phone,
      },
    })
    if (existing && existing.id !== contact.id) {
      throw conflict('Nomor HP baru sudah terdaftar pada kontak keluarga lain')
    }
  }

  const updated = await client.familyContact.update({
    where: { id: contact.id },
    data: {
      name: validated.name ?? undefined,
      phone: validated.phone ?? undefined,
      relationship: validated.relationship ?? undefined,
      tier: validated.tier ?? undefined,
      priority: validated.priority ?? undefined,
      isNearby: validated.isNearby ?? undefined,
      canViewHealth: validated.canViewHealth ?? undefined,
      canReceiveEmergency: validated.canReceiveEmergency ?? undefined,
      isActive: validated.isActive ?? undefined,
    },
  })

  if (client.auditLog) {
    await tryCreateAuditLog(client as any, {
      action: AuditAction.FAMILY_CONTACT_UPDATED,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      resourceType: 'family_contact',
      resourceId: updated.id,
      patientId: contact.patientId,
      ip: params.ip,
      userAgent: params.userAgent,
      meta: {
        updatedFields: Object.keys(validated),
      },
    })
  }

  return toContactOutput(updated)
}

export interface DeleteFamilyContactParams {
  contactId: string
  patientId?: string | null
  actorUserId?: string | null
  actorRole?: any
  ip?: string | null
  userAgent?: string | null
}

/** Menghapus kontak keluarga dengan pengecekan kepemilikan. */
export async function deleteFamilyContact(
  client: FamilyPrismaClient,
  params: DeleteFamilyContactParams,
): Promise<{ success: boolean }> {
  const contact = await client.familyContact.findUnique({
    where: { id: params.contactId },
  })

  if (!contact) {
    throw notFound('Kontak keluarga tidak ditemukan')
  }

  // Penegakan scope kepemilikan pasien (CL-008): akses silang ditolak 403
  if (params.patientId && contact.patientId !== params.patientId) {
    throw forbidden('Anda tidak memiliki akses ke kontak keluarga ini')
  }

  await client.familyContact.delete({
    where: { id: contact.id },
  })

  if (client.auditLog) {
    await tryCreateAuditLog(client as any, {
      action: AuditAction.FAMILY_CONTACT_REMOVED,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      resourceType: 'family_contact',
      resourceId: contact.id,
      patientId: contact.patientId,
      ip: params.ip,
      userAgent: params.userAgent,
      meta: {
        removedName: contact.name,
        removedPhone: contact.phone,
      },
    })
  }

  return { success: true }
}

export interface VerifyFamilyContactParams {
  contactId: string
  patientId?: string | null
  actorUserId?: string | null
  actorRole?: any
  ip?: string | null
  userAgent?: string | null
}

/** Memverifikasi nomor kontak sehingga isActive menjadi true dan siap menerima alert. */
export async function verifyFamilyContact(
  client: FamilyPrismaClient,
  params: VerifyFamilyContactParams,
): Promise<FamilyContactOutput> {
  const contact = await client.familyContact.findUnique({
    where: { id: params.contactId },
  })

  if (!contact) {
    throw notFound('Kontak keluarga tidak ditemukan')
  }

  if (params.patientId && contact.patientId !== params.patientId) {
    throw forbidden('Anda tidak memiliki akses ke kontak keluarga ini')
  }

  const updated = await client.familyContact.update({
    where: { id: contact.id },
    data: { isActive: true },
  })

  if (client.auditLog) {
    await tryCreateAuditLog(client as any, {
      action: AuditAction.FAMILY_CONTACT_UPDATED,
      actorUserId: params.actorUserId,
      actorRole: params.actorRole,
      resourceType: 'family_contact',
      resourceId: updated.id,
      patientId: contact.patientId,
      ip: params.ip,
      userAgent: params.userAgent,
      meta: {
        action: 'VERIFY_PHONE',
        isActive: true,
      },
    })
  }

  return toContactOutput(updated)
}

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { UserRole } from '@careloop/shared'
import type { AuthUserClaims } from '@careloop/shared'
import { authenticate, getAuthUser, requireCareTeamRole, requireRole } from '../../lib/auth'
import { auditContext } from '../../lib/audit'
import { prisma } from '../../lib/prisma'
import { badRequest, forbidden, notFound } from '../../lib/errors'
import { assertPatientInScope, type PatientsPrismaClient } from '../patients/patients.service'
import {
  listFamilyContacts,
  createFamilyContact,
  updateFamilyContact,
  deleteFamilyContact,
  verifyFamilyContact,
} from './family.service'

export {
  listFamilyContacts,
  createFamilyContact,
  updateFamilyContact,
  deleteFamilyContact,
  verifyFamilyContact,
}
export type {
  FamilyPrismaClient,
  FamilyContactOutput,
  CreateFamilyContactParams,
  UpdateFamilyContactParams,
  DeleteFamilyContactParams,
  VerifyFamilyContactParams,
} from './family.service'

const FAMILY_ROLES = [UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN]

/**
 * Pasien yang boleh disentuh oleh request ini.
 *
 * PATIENT: patients miliknya sendiri.
 * NAKES/ADMIN: harus patientId yang benar-benar ada di scope-nya. Sebelumnya
 * route ini mengirim `null` untuk peran non-pasien, dan service menganggap null
 * berarti "tanpa pembatasan" — sehingga NAKES bisa mengubah atau menghapus
 * kontak keluarga pasien mana pun. Sekarang scope diverifikasi sungguhan-sungguhan.
 */
async function resolveTargetPatient(
  claims: AuthUserClaims,
  patientIdParam: string,
): Promise<string> {
  if (claims.role === UserRole.PATIENT) {
    if (patientIdParam !== claims.sub) {
      throw forbidden('Anda hanya dapat mengelola kontak keluarga milik Anda sendiri')
    }
    return claims.sub
  }

  await assertPatientInScope(prisma as unknown as PatientsPrismaClient, claims, patientIdParam)
  return patientIdParam
}

/**
 * PatientId untuk create oleh nakes/admin. NAKES/ADMIN harus menyebut pasien
 * secara eksplisit lewat `/v1/patients/:id/family-contacts`; memakai claims.sub
 * akan menunjuk id akun nakes sehingga melanggar foreign key ke Patient.
 */
async function resolveCreatePatientId(
  claims: AuthUserClaims,
  patientIdParam?: string,
): Promise<string> {
  if (!patientIdParam) {
    throw badRequest('Sebut id pasien pada path: /v1/patients/:id/family-contacts')
  }

  await assertPatientInScope(prisma as unknown as PatientsPrismaClient, claims, patientIdParam)
  return patientIdParam
}

export function registerFamilyRoutes(app: FastifyInstance): void {
  // GET /v1/patients/me/family-contacts — daftar kontak keluarga milik pasien.
  // Hanya PASIEN: "/me" menunjuk akun pemanggil, dan akun nakes tidak punya
  // profil pasien. Nakes/admin memakai /v1/patients/:id/family-contacts.
  app.get(
    '/v1/patients/me/family-contacts',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT)] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const data = await listFamilyContacts(prisma, claims.sub)
      return { data }
    },
  )

  // POST /v1/patients/me/family-contacts — tambah kontak keluarga (pasien sendiri).
  app.post(
    '/v1/patients/me/family-contacts',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT)] },
    async (req: FastifyRequest, reply) => {
      const claims = getAuthUser(req)
      const { actorUserId, actorRole, ip, userAgent } = auditContext(req)

      const contact = await createFamilyContact(prisma, {
        patientId: claims.sub,
        input: req.body as any,
        actorUserId,
        actorRole,
        ip,
        userAgent,
      })

      return reply.code(201).send({ data: contact })
    },
  )

  // POST /v1/patients/:id/family-contacts — nakes/admin menambah kontak keluarga
  // pasien dalam scope-nya. Kontak baru berstatus belum verifikasi, sehingga belum
  // menerima alert darurat sampai nomornya dikonfirmasi.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/family-contacts',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const patientId = await resolveCreatePatientId(claims, req.params.id)
      const { actorUserId, actorRole, ip, userAgent } = auditContext(req)

      const contact = await createFamilyContact(prisma, {
        patientId,
        input: req.body as any,
        actorUserId,
        actorRole,
        ip,
        userAgent,
      })

      return reply.code(201).send({ data: contact })
    },
  )

  // PUT /v1/family-contacts/:id — update kontak (tier/prioritas/status aktif).
  app.put<{ Params: { id: string } }>(
    '/v1/family-contacts/:id',
    { preHandler: [authenticate, requireRole(...FAMILY_ROLES)] },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const claims = getAuthUser(req)
      const contact = await (prisma as any).familyContact.findUnique({
        where: { id: req.params.id },
        select: { patientId: true },
      })
      if (!contact) throw notFound('Kontak keluarga tidak ditemukan')

      const patientId = await resolveTargetPatient(claims, contact.patientId)
      const { actorUserId, actorRole, ip, userAgent } = auditContext(req)

      const updated = await updateFamilyContact(prisma, {
        contactId: req.params.id,
        patientId,
        input: req.body as any,
        actorUserId,
        actorRole,
        ip,
        userAgent,
      })

      return { data: updated }
    },
  )

  // DELETE /v1/family-contacts/:id — hapus kontak keluarga.
  app.delete<{ Params: { id: string } }>(
    '/v1/family-contacts/:id',
    { preHandler: [authenticate, requireRole(...FAMILY_ROLES)] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const claims = getAuthUser(req)
      const contact = await (prisma as any).familyContact.findUnique({
        where: { id: req.params.id },
        select: { patientId: true },
      })
      if (!contact) throw notFound('Kontak keluarga tidak ditemukan')

      const patientId = await resolveTargetPatient(claims, contact.patientId)
      const { actorUserId, actorRole, ip, userAgent } = auditContext(req)

      await deleteFamilyContact(prisma, {
        contactId: req.params.id,
        patientId,
        actorUserId,
        actorRole,
        ip,
        userAgent,
      })

      return reply.code(204).send()
    },
  )

  // POST /v1/family-contacts/:id/verify — verifikasi nomor kontak agar aktif menerima alert.
  app.post<{ Params: { id: string } }>(
    '/v1/family-contacts/:id/verify',
    { preHandler: [authenticate, requireRole(...FAMILY_ROLES)] },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const claims = getAuthUser(req)
      const contact = await (prisma as any).familyContact.findUnique({
        where: { id: req.params.id },
        select: { patientId: true },
      })
      if (!contact) throw notFound('Kontak keluarga tidak ditemukan')

      const patientId = await resolveTargetPatient(claims, contact.patientId)
      const { actorUserId, actorRole, ip, userAgent } = auditContext(req)

      const verified = await verifyFamilyContact(prisma, {
        contactId: req.params.id,
        patientId,
        actorUserId,
        actorRole,
        ip,
        userAgent,
      })

      return { data: verified }
    },
  )
}

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { UserRole } from '@careloop/shared'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import { auditContext } from '../../lib/audit'
import { prisma } from '../../lib/prisma'
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

export function registerFamilyRoutes(app: FastifyInstance): void {
  // GET /v1/patients/me/family-contacts — daftar kontak keluarga milik pasien (docs/API.md §3.7)
  app.get(
    '/v1/patients/me/family-contacts',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN)] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const patientId = claims.patientId ?? claims.sub
      const data = await listFamilyContacts(prisma, patientId)
      return { data }
    },
  )

  // POST /v1/patients/me/family-contacts — tambah kontak keluarga baru
  app.post(
    '/v1/patients/me/family-contacts',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN)] },
    async (req: FastifyRequest, reply) => {
      const claims = getAuthUser(req)
      const patientId = claims.patientId ?? claims.sub
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

  // PUT /v1/family-contacts/:id — update kontak (tier/prioritas/status aktif)
  app.put<{ Params: { id: string } }>(
    '/v1/family-contacts/:id',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN)] },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const claims = getAuthUser(req)
      const patientId = claims.role === UserRole.PATIENT ? claims.sub : null
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

  // DELETE /v1/family-contacts/:id — hapus kontak keluarga
  app.delete<{ Params: { id: string } }>(
    '/v1/family-contacts/:id',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN)] },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const claims = getAuthUser(req)
      const patientId = claims.role === UserRole.PATIENT ? claims.sub : null
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

  // POST /v1/family-contacts/:id/verify — verifikasi nomor kontak agar aktif menerima alert
  app.post<{ Params: { id: string } }>(
    '/v1/family-contacts/:id/verify',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.NAKES, UserRole.ADMIN)] },
    async (req: FastifyRequest<{ Params: { id: string } }>) => {
      const claims = getAuthUser(req)
      const patientId = claims.role === UserRole.PATIENT ? claims.sub : null
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

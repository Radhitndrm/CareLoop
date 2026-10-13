// Route puskesmas.
//
// Baca (`/v1/puskesmas*`) dibuka untuk tim medis: form pendaftaran pasien dan undangan
// staf memakai daftar ini, dan daftarnya sendiri sudah dibatasi scope di service —
// NAKES hanya melihat puskesmas dalam penugasannya.
//
// Tulis (`/v1/admin/puskesmas*`) khusus ADMIN. Puskesmas menentukan cakupan pasien dan
// siapa yang boleh punya penugasan, jadi tidak boleh bisa disunting oleh non-admin.
import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import * as clinics from './puskesmas.service'
import type { ClinicClient } from './puskesmas.service'

const CARE_TEAM: UserRole[] = [UserRole.NAKES, UserRole.ADMIN]

function db(): ClinicClient {
  return prisma as unknown as ClinicClient
}

export function registerPuskesmasRoutes(app: FastifyInstance): void {
  // `/districts` didaftarkan sebelum `/:id` supaya tidak tertangkap sebagai id.
  app.get(
    '/v1/puskesmas/districts',
    { preHandler: [authenticate, requireRole(...CARE_TEAM)] },
    async (req) => {
      const data = await clinics.listDistricts(db(), { claims: getAuthUser(req) })
      return { data: data.items }
    },
  )

  app.get(
    '/v1/puskesmas',
    { preHandler: [authenticate, requireRole(...CARE_TEAM)] },
    async (req) => {
      const query = req.query as { search?: string; district?: string; includeInactive?: string }
      const claims = getAuthUser(req)

      const result = await clinics.list(db(), {
        claims,
        search: query.search,
        district: query.district,
        // `includeInactive` hanya masuk akal di layar administrasi; NAKES tidak punya
        // alasan melihat puskesmas yang sudah dinonaktifkan.
        includeInactive: claims.role === UserRole.ADMIN && query.includeInactive === 'true',
      })

      return { data: result.items, meta: { total: result.total } }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/v1/puskesmas/:id',
    { preHandler: [authenticate, requireRole(...CARE_TEAM)] },
    async (req) => {
      const data = await clinics.getById(db(), { claims: getAuthUser(req), id: req.params.id })
      return { data }
    },
  )

  app.post(
    '/v1/admin/puskesmas',
    { preHandler: [authenticate, requireRole(UserRole.ADMIN)] },
    async (req, reply) => {
      const data = await clinics.create(db(), {
        input: req.body as any,
        actorUserId: getAuthUser(req).sub,
      })
      return reply.code(201).send({ data })
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/v1/admin/puskesmas/:id',
    { preHandler: [authenticate, requireRole(UserRole.ADMIN)] },
    async (req) => {
      const data = await clinics.update(db(), {
        id: req.params.id,
        input: req.body as any,
        actorUserId: getAuthUser(req).sub,
      })
      return { data }
    },
  )
}
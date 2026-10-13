// Route manajemen tenaga kesehatan (docs/API.md §3.15).
//
// Semua di sini khusus ADMIN: peran klinis dan batas wilayah menentukan siapa boleh
// menyetujui resep dan melihat pasien, jadi tidak boleh bisa diubah oleh staf sendiri.
import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import {
  addAssignment,
  endAssignment,
  getStaff,
  inviteStaff,
  listStaff,
  regenerateActivationCode,
  updateStaff,
  type StaffClient,
} from './admin.service'

export {
  activateStaff,
  addAssignment,
  endAssignment,
  generateActivationCode,
  getStaff,
  inviteStaff,
  listStaff,
  regenerateActivationCode,
  toStaff,
  updateStaff,
} from './admin.service'
export type {
  AssignmentOutput,
  InviteResult,
  StaffOutput,
} from './admin.service'

function db(): StaffClient {
  return prisma as unknown as StaffClient
}

const ADMIN_ONLY = { preHandler: [authenticate, requireRole(UserRole.ADMIN)] }

export function registerAdminRoutes(app: FastifyInstance): void {
  // POST /v1/admin/nakes-accounts — undang staf baru (dan penugasannya, atomik).
  app.post('/v1/admin/nakes-accounts', ADMIN_ONLY, async (req, reply) => {
    const data = await inviteStaff(db(), {
      input: req.body,
      actorUserId: getAuthUser(req).sub,
    })
    return reply.code(201).send({ data })
  })

  // GET /v1/admin/nakes-accounts — daftar staf + peran + status + penugasan.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/v1/admin/nakes-accounts',
    ADMIN_ONLY,
    async (req) => {
      const limit = Number(req.query?.limit ?? 50)
      const offset = Number(req.query?.offset ?? 0)
      const result = await listStaff(db(), {
        nakesRole: req.query?.nakesRole,
        staffStatus: req.query?.staffStatus,
        search: req.query?.search,
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
      })
      return { data: result.items, meta: { total: result.total } }
    },
  )

  app.get<{ Params: { id: string } }>('/v1/admin/nakes-accounts/:id', ADMIN_ONLY, async (req) => {
    const data = await getStaff(db(), req.params.id)
    return { data }
  })

  // PATCH /v1/admin/nakes-accounts/:id — ubah peran klinis / status staf.
  app.patch<{ Params: { id: string } }>(
    '/v1/admin/nakes-accounts/:id',
    ADMIN_ONLY,
    async (req) => {
      const data = await updateStaff(db(), {
        staffId: req.params.id,
        input: req.body,
        actorUserId: getAuthUser(req).sub,
      })
      return { data }
    },
  )

  // POST /v1/admin/nakes-accounts/:id/activation-code — kode sekali pakai yang baru.
  app.post<{ Params: { id: string } }>(
    '/v1/admin/nakes-accounts/:id/activation-code',
    ADMIN_ONLY,
    async (req) => {
      const data = await regenerateActivationCode(db(), {
        staffId: req.params.id,
        actorUserId: getAuthUser(req).sub,
      })
      return { data }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/v1/admin/nakes-accounts/:id/assignments',
    ADMIN_ONLY,
    async (req, reply) => {
      const data = await addAssignment(db(), {
        staffId: req.params.id,
        input: req.body,
        actorUserId: getAuthUser(req).sub,
      })
      return reply.code(201).send({ data })
    },
  )

  app.delete<{ Params: { id: string; assignmentId: string } }>(
    '/v1/admin/nakes-accounts/:id/assignments/:assignmentId',
    ADMIN_ONLY,
    async (req) => {
      const data = await endAssignment(db(), {
        staffId: req.params.id,
        assignmentId: req.params.assignmentId,
        actorUserId: getAuthUser(req).sub,
        reason: (req.query as { reason?: string } | undefined)?.reason,
      })
      return { data }
    },
  )
}
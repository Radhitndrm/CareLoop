import type { FastifyInstance } from 'fastify'
import { NakesRole, UserRole } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { authenticate, getAuthUser, requireCareTeamRole, requireClinicalRole } from '../../lib/auth'
import { auditContext } from '../../lib/audit'
import {
  approveMedication,
  createSchedule,
  draftMedication,
  listMedications,
  type MedicationsPrismaClient,
} from './medications.service'

export {
  approveMedication,
  createSchedule,
  draftMedication,
  listMedications,
}
export type {
  MedicationsPrismaClient,
  MedicationOutput,
  ApproveMedicationParams,
} from './medications.service'

// Tahap 2 alur (docs/API.md §3.2).
const CLINICAL_STAFF: UserRole[] = [UserRole.NAKES, UserRole.ADMIN]
const PRESCRIBERS: NakesRole[] = [NakesRole.DOKTER, NakesRole.BIDAN]

export function registerMedicationsRoutes(app: FastifyInstance): void {
  // POST /v1/patients/:id/medications — perawat/bidan membuat draft resep.
  // Semua nakes boleh; hasilnya DRAFT dan belum berjalan.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/medications',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const data = await draftMedication(prisma as unknown as MedicationsPrismaClient, {
        patientId: req.params.id,
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return reply.code(201).send({ data })
    },
  )

  // GET /v1/patients/:id/medications — daftar obat & status persetujuan.
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/v1/patients/:id/medications',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await listMedications(prisma as unknown as MedicationsPrismaClient, {
        patientId: req.params.id,
        claims,
        status: req.query?.status,
      })
      return { data }
    },
  )

  // POST /v1/patients/:id/schedules — tambah jadwal pada obat yang ada.
  app.post<{ Params: { id: string } }>(
    '/v1/patients/:id/schedules',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
      const claims = getAuthUser(req)
      const data = await createSchedule(prisma as unknown as MedicationsPrismaClient, {
        patientId: req.params.id,
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return reply.code(201).send({ data })
    },
  )

  // POST /v1/medications/:id/approve — persetujuan/penolakan dokter.
  // Diperkuat requireClinicalRole: perawat yang membuat draft tidak boleh
  // menyetakannya sendiri menjadi obat aktif (docs/API.md §3.2).
  app.post<{ Params: { id: string } }>(
    '/v1/medications/:id/approve',
    {
      preHandler: [
        authenticate,
        requireCareTeamRole(),
        requireClinicalRole(...PRESCRIBERS),
      ],
    },
    async (req) => {
      const claims = getAuthUser(req)
      const data = await approveMedication(prisma as unknown as MedicationsPrismaClient, {
        medicationId: req.params.id,
        input: req.body as any,
        claims,
        audit: auditContext(req),
      })
      return { data }
    },
  )
}
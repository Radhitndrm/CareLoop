// CL-209 & CL-210: Endpoint agregasi dan filter dashboard nakes (docs/API.md §3.8, AC-5.1, AC-5.3, FR-5.2).
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { dashboardFilterSchema, workQueueFilterSchema } from '@careloop/shared'
import { authenticate, getAuthUser, requireCareTeamRole } from '../../lib/auth'
import { prisma } from '../../lib/prisma'
import {
  getDashboardSummary,
  getDashboardAdherence,
  getDashboardRiskPatients,
  getDashboardAlerts,
  type DashboardFilterOptions,
} from './dashboard.service'
import { getWorkQueue, type WorkQueueOptions } from './work-queue.service'

export * from './ws'
export * from './dashboard.service'
export * from './work-queue.service'

export function registerDashboardRoutes(app: FastifyInstance): void {
  // GET /v1/dashboard/work-queue (docs/API.md §3.8)
  //
  // Berbeda dari /summary yang berupa statistik, endpoint ini mengembalikan daftar
  // pasien yang menunggu tindakan — dikelompokkan menurut tindakan yang diperlukan.
  app.get(
    '/v1/dashboard/work-queue',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = workQueueFilterSchema.parse(req.query ?? {})
      const options: WorkQueueOptions = { ...query, perBucketLimit: query.limit ?? 10 }
      const queue = await getWorkQueue(prisma, claims, options)
      return { data: queue.buckets, meta: { actionablePatients: queue.actionablePatients } }
    },
  )

  // GET /v1/dashboard/summary (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/summary',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardFilterSchema.parse(req.query ?? {})
      const summary = await getDashboardSummary(prisma, claims, query)
      return { data: summary }
    },
  )

  // GET /v1/dashboard/adherence (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/adherence',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardFilterSchema.parse(req.query ?? {})
      const adherence = await getDashboardAdherence(prisma, claims, query)
      return { data: adherence }
    },
  )

  // GET /v1/dashboard/risk-patients (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/risk-patients',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardFilterSchema.parse(req.query ?? {})
      const patients = await getDashboardRiskPatients(prisma, claims, query)
      return { data: patients }
    },
  )

  // GET /v1/dashboard/alerts (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/alerts',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardFilterSchema.parse(req.query ?? {})
      const alerts = await getDashboardAlerts(prisma, claims, query)
      return { data: alerts }
    },
  )
}

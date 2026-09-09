// CL-209: Endpoint agregasi dashboard nakes (docs/API.md §3.8, AC-5.1, AC-5.3).
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireRole, getAuthUser } from '../../lib/auth'
import { prisma } from '../../lib/prisma'
import {
  getDashboardSummary,
  getDashboardAdherence,
  getDashboardRiskPatients,
  getDashboardAlerts,
  type DashboardFilterOptions,
} from './dashboard.service'

export * from './ws'
export * from './dashboard.service'

const dashboardQuerySchema = z.object({
  district: z.string().optional(),
  disease: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  escalationStatus: z.string().optional(),
})

export function registerDashboardRoutes(app: FastifyInstance): void {
  // GET /v1/dashboard/summary (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/summary',
    { preHandler: [requireRole('NAKES', 'ADMIN')] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardQuerySchema.parse(req.query ?? {})
      const summary = await getDashboardSummary(prisma, claims, query)
      return { data: summary }
    },
  )

  // GET /v1/dashboard/adherence (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/adherence',
    { preHandler: [requireRole('NAKES', 'ADMIN')] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardQuerySchema.parse(req.query ?? {})
      const adherence = await getDashboardAdherence(prisma, claims, query)
      return { data: adherence }
    },
  )

  // GET /v1/dashboard/risk-patients (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/risk-patients',
    { preHandler: [requireRole('NAKES', 'ADMIN')] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardQuerySchema.parse(req.query ?? {})
      const patients = await getDashboardRiskPatients(prisma, claims, query)
      return { data: patients }
    },
  )

  // GET /v1/dashboard/alerts (docs/API.md §3.8)
  app.get(
    '/v1/dashboard/alerts',
    { preHandler: [requireRole('NAKES', 'ADMIN')] },
    async (req: FastifyRequest) => {
      const claims = getAuthUser(req)
      const query = dashboardQuerySchema.parse(req.query ?? {})
      const alerts = await getDashboardAlerts(prisma, claims, query)
      return { data: alerts }
    },
  )
}

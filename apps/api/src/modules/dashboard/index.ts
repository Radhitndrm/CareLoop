import type { FastifyInstance } from 'fastify'

export function registerDashboardRoutes(app: FastifyInstance): void {
  app.get('/v1/dashboard/summary', async () => {
    return {
      data: {
        totalPatients: 0,
        adherenceRate: 0,
        activeAlerts: 0,
      },
    }
  })
}

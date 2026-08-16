import type { FastifyInstance } from 'fastify'

export function registerRiskRoutes(app: FastifyInstance): void {
  app.get('/v1/patients/me/risk', async () => {
    return { data: { score: 0, level: 'LOW', factors: {} } }
  })
}

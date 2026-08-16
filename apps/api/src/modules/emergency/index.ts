import type { FastifyInstance } from 'fastify'

export function registerEmergencyRoutes(app: FastifyInstance): void {
  app.get('/v1/emergencies/active', async () => {
    return { data: [] }
  })
}

import type { FastifyInstance } from 'fastify'

export function registerFamilyRoutes(app: FastifyInstance): void {
  app.get('/v1/patients/me/family-contacts', async () => {
    return { data: [] }
  })
}

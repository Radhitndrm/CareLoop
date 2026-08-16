import type { FastifyInstance } from 'fastify'

export function registerFacilitiesRoutes(app: FastifyInstance): void {
  app.get('/v1/facilities/nearby', async () => {
    return { data: [] }
  })
}

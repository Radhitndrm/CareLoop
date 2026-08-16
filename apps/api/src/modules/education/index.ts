import type { FastifyInstance } from 'fastify'

export function registerEducationRoutes(app: FastifyInstance): void {
  app.get('/v1/education/topics', async () => {
    return { data: [] }
  })
}

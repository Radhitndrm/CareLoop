import type { FastifyInstance } from 'fastify'

export function registerExportRoutes(app: FastifyInstance): void {
  app.get('/v1/export/jobs', async () => {
    return { data: [] }
  })
}

import type { FastifyInstance } from 'fastify'

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get('/v1/auth/status', async () => {
    return { data: { status: 'ok', service: 'careloop-api' } }
  })
}

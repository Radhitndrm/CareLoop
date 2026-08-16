import type { FastifyInstance } from 'fastify'

export function registerRemindersRoutes(app: FastifyInstance): void {
  app.get('/v1/patients/me/reminders', async () => {
    return { data: [] }
  })
}

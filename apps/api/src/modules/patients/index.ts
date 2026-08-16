import type { FastifyInstance } from 'fastify'

export function registerPatientsRoutes(app: FastifyInstance): void {
  app.get('/v1/patients/me', async () => {
    return { data: { id: 'p_demo', fullName: 'Bu Ratna', livingSituation: 'ALONE' } }
  })
}

import type { FastifyInstance } from 'fastify'
import { complianceConfirmSchema } from '@careloop/shared'

export function registerComplianceRoutes(app: FastifyInstance): void {
  app.post('/v1/compliance/confirm', async (req, reply) => {
    const input = complianceConfirmSchema.parse(req.body)
    return reply.code(200).send({
      data: {
        scheduleId: input.scheduleId,
        status: 'CONFIRMED',
        confirmedAt: new Date().toISOString(),
        escalationCancelled: true,
      },
    })
  })
}

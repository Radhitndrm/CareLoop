import type { FastifyInstance } from 'fastify'
import { vitalIngestSchema } from '@careloop/shared'
import { evaluateAnomaly } from '../vitals/anomaly.rules'

export function registerVitalsRoutes(app: FastifyInstance): void {
  app.post('/v1/vitals', async (req, reply) => {
    const input = vitalIngestSchema.parse(req.body)

    const result = evaluateAnomaly(
      input.hrBpm !== undefined ? [{ recordedAt: new Date(input.recordedAt), hrBpm: input.hrBpm }] : [],
    )

    return reply.code(200).send({
      data: {
        vitalId: 'v_demo',
        isAnomalous: result.isAnomalous,
        anomalyReason: result.reason,
      },
    })
  })
}

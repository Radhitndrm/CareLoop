import type { FastifyInstance } from 'fastify'
import { vitalIngestSchema } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import {
  ingestVitalSign,
  sanitizeRawPayload,
  type VitalsPrismaClient,
  type IngestVitalResult,
} from './vitals.service'

export { ingestVitalSign, sanitizeRawPayload }
export type { VitalsPrismaClient, IngestVitalResult }

export function registerVitalsRoutes(app: FastifyInstance): void {
  // POST /v1/vitals — Ingest event vital dari smartwatch/mock (docs/API.md §3.4 / CL-201)
  app.post('/v1/vitals', async (req, reply) => {
    const input = vitalIngestSchema.parse(req.body)
    const result = await ingestVitalSign(prisma, input)

    return reply.code(200).send({
      data: {
        id: result.vitalSign.id,
        vitalId: result.vitalSign.id,
        status: result.isDuplicate ? 'DUPLICATE_IGNORED' : 'RECORDED',
        isAnomalous: result.vitalSign.isAnomalous,
        anomalyReason: result.vitalSign.anomalyReason,
        recordedAt: result.vitalSign.recordedAt.toISOString(),
      },
    })
  })
}

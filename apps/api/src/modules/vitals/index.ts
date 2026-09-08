import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { vitalIngestSchema } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { getEnv } from '../../lib/env'
import { notFound } from '../../lib/errors'
import { mockSmartwatchAdapter } from '../../integrations/smartwatch'
import {
  ingestVitalSign,
  sanitizeRawPayload,
  evaluatePatientVitalsAnomaly,
  extractPatientThresholds,
  type VitalsPrismaClient,
  type IngestVitalResult,
  type IngestVitalOptions,
} from './vitals.service'

export {
  ingestVitalSign,
  sanitizeRawPayload,
  evaluatePatientVitalsAnomaly,
  extractPatientThresholds,
}
export type { VitalsPrismaClient, IngestVitalResult, IngestVitalOptions }

const devMockAnomalySchema = z.object({
  patientId: z.string().uuid().optional(),
  type: z.enum(['HIGH_HR', 'LOW_HR', 'SPIKE', 'NORMAL']).default('HIGH_HR'),
  hrBpm: z.number().int().min(20).max(240).optional(),
  intervalSec: z.number().int().min(1).max(60).default(20),
})

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

  // POST /v1/dev/mock-anomaly — Memicu stream anomali sintetis untuk demo (CL-203 / AGENTS.md §8)
  app.post('/v1/dev/mock-anomaly', async (req, reply) => {
    // Guard: Endpoint ini strictly non-production
    if (process.env.NODE_ENV === 'production' || getEnv().NODE_ENV === 'production') {
      throw notFound('Route POST /v1/dev/mock-anomaly tidak ada')
    }

    const input = devMockAnomalySchema.parse(req.body ?? {})

    let targetPatientId = input.patientId
    if (!targetPatientId) {
      // Cari pasien pertama yang smartwatchEnabled
      const patient = await prisma.patient.findFirst({
        where: { smartwatchEnabled: true },
        select: { id: true },
      })

      if (!patient) {
        // Fallback ke pasien mana pun jika belum ada yang smartwatchEnabled (lalu aktifkan untuk demo)
        const anyPatient = await prisma.patient.findFirst({ select: { id: true } })
        if (!anyPatient) {
          throw notFound('Tidak ada data pasien yang terdaftar di database')
        }
        await prisma.patient.update({
          where: { id: anyPatient.id },
          data: { smartwatchEnabled: true },
        })
        targetPatientId = anyPatient.id
      } else {
        targetPatientId = patient.id
      }
    }

    // Buat deret bacaan sintetis menggunakan mock adapter
    const readings = mockSmartwatchAdapter.generateMockStream(targetPatientId, {
      type: input.type,
      hrBpm: input.hrBpm,
      intervalSec: input.intervalSec,
    })

    const results: IngestVitalResult[] = []
    for (const reading of readings) {
      const res = await ingestVitalSign(prisma, {
        patientId: reading.patientId,
        recordedAt: reading.recordedAt.toISOString(),
        source: reading.source,
        hrBpm: reading.hrBpm,
        spo2: reading.spo2,
        rawPayload: reading.rawPayload,
      })
      results.push(res)
    }

    const lastResult = results[results.length - 1]

    return reply.code(200).send({
      data: {
        triggered: true,
        patientId: targetPatientId,
        type: input.type,
        readingsCount: readings.length,
        isAnomalous: lastResult?.vitalSign.isAnomalous ?? false,
        anomalyReason: lastResult?.vitalSign.anomalyReason ?? null,
        vitalIds: results.map((r) => r.vitalSign.id),
      },
    })
  })
}

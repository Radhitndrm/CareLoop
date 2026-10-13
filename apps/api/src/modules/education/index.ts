import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { authenticate, requireRole } from '../../lib/auth'
import { FEATURE_STATUS, featureEnvelope } from '../feature-status'

export function registerEducationRoutes(app: FastifyInstance): void {
  // Kontrak endpoint sudah ada, kontennya belum — lihat
  // feature-status.ts untuk arti label PENDING.
  app.get(
    '/v1/education/topics',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN)] },
    async () => {
      const data: unknown[] = []
      return { data: featureEnvelope(FEATURE_STATUS.PENDING, data) }
    },
  )
}

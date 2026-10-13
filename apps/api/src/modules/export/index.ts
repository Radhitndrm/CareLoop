import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { authenticate, requireRole } from '../../lib/auth'
import { FEATURE_STATUS, featureEnvelope } from '../feature-status'

export function registerExportRoutes(app: FastifyInstance): void {
  // Daftar job export. Pembuatan job export belum ada, jadi
  // daftarnya kosong sungguhan dan diberi label PENDING.
  app.get(
    '/v1/export/jobs',
    { preHandler: [authenticate, requireRole(UserRole.ADMIN, UserRole.NAKES)] },
    async () => {
      const data: unknown[] = []
      return { data: featureEnvelope(FEATURE_STATUS.PENDING, data) }
    },
  )
}

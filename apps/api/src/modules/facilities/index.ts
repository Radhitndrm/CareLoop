import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { authenticate, requireRole } from '../../lib/auth'
import { FEATURE_STATUS, featureEnvelope } from '../feature-status'

export function registerFacilitiesRoutes(app: FastifyInstance): void {
  // Pencarian faskes terdekat. Tabel faskes belum diisi, jadi hasilnya kosong —
  // diberi label PENDING supaya tidak terbaca sebagai "tidak ada faskes di area ini".
  app.get(
    '/v1/facilities/nearby',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN)] },
    async () => {
      const data: unknown[] = []
      return { data: featureEnvelope(FEATURE_STATUS.PENDING, data) }
    },
  )
}

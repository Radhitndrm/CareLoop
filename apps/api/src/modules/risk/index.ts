import type { FastifyInstance } from 'fastify'
import { UserRole } from '@careloop/shared'
import { authenticate, getAuthUser, requireRole } from '../../lib/auth'
import { prisma } from '../../lib/prisma'
import { FEATURE_STATUS, featureEnvelope } from '../feature-status'

export function registerRiskRoutes(app: FastifyInstance): void {
  // Skor risiko milik pasien sendiri.
  //
  // Endpoint ini SENGAJA tidak mengembalikan angka nol: `score: 0 / level: LOW` akan
  // dibaca sebagai "pasien aman", padahal tidak ada perhitungan yang berjalan. Skor
  // yang sudah tersimpan di `patients` ditampilkan apa adanya dengan label MOCK, dan
  // `null` + PENDING kalau memang belum pernah dihitung.
  app.get(
    '/v1/patients/me/risk',
    { preHandler: [authenticate, requireRole(UserRole.PATIENT, UserRole.FAMILY)] },
    async (req) => {
      const claims = getAuthUser(req)
      const patient = await prisma.patient.findUnique({
        where: { id: claims.sub },
        select: {
          riskScore: true,
          riskLevel: true,
          riskPredictions: { orderBy: { computedOn: 'desc' }, take: 1 },
        },
      })

      const latest = patient?.riskPredictions?.[0] ?? null
      const data = {
        score: latest?.score ?? patient?.riskScore ?? null,
        level: latest?.level ?? patient?.riskLevel ?? null,
        factors: (latest?.factors as Record<string, unknown> | null) ?? {},
      }

      return {
        data: featureEnvelope(
          data.score === null ? FEATURE_STATUS.PENDING : FEATURE_STATUS.MOCK,
          data,
        ),
      }
    },
  )
}
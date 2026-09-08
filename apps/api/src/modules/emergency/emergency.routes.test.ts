import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
import { EmergencyStatus, EmergencyTrigger } from '@careloop/shared'

describe('Emergency Routes (CL-204)', () => {
  let app: FastifyInstance
  const dummyEmergencyId = '33333333-3333-4333-8333-333333333333'
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })
  })

  describe('GET /v1/emergencies/active', () => {
    it('mengembalikan daftar alert darurat aktif', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findMany').mockResolvedValue([
        {
          id: dummyEmergencyId,
          patientId: dummyPatientId,
          status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
          triggerType: EmergencyTrigger.ANOMALY_HR,
          hrBpm: 145,
          triggeredAt: new Date(),
          patient: {
            user: {
              id: 'user-1',
              fullName: 'Bu Siti Test',
              phone: '081234567890',
            },
          },
          escalationRun: {
            id: 'run-1',
            status: 'WAITING_PATIENT',
          },
        } as any,
      ])

      const res = await app.inject({
        method: 'GET',
        url: '/v1/emergencies/active',
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].id).toBe(dummyEmergencyId)
      expect(body.data[0].status).toBe(EmergencyStatus.PENDING_PATIENT_CONFIRM)
    })
  })

  describe('GET /v1/emergencies/:id', () => {
    it('mengembalikan detail alert jika ditemukan', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue({
        id: dummyEmergencyId,
        patientId: dummyPatientId,
        status: EmergencyStatus.PENDING_PATIENT_CONFIRM,
        triggerType: EmergencyTrigger.ANOMALY_HR,
        hrBpm: 145,
        triggeredAt: new Date(),
        patient: {
          user: {
            id: 'user-1',
            fullName: 'Bu Siti Test',
            phone: '081234567890',
          },
        },
        escalationRun: {
          id: 'run-1',
          status: 'WAITING_PATIENT',
          steps: [],
        },
      } as any)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/emergencies/${dummyEmergencyId}`,
      })

      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.data).toBeDefined()
      expect(body.data.id).toBe(dummyEmergencyId)
      expect(body.data.patient.user.fullName).toBe('Bu Siti Test')
    })

    it('mengembalikan 404 jika alert tidak ditemukan', async () => {
      vi.spyOn(prisma.emergencyAlert, 'findUnique').mockResolvedValue(null)

      const res = await app.inject({
        method: 'GET',
        url: `/v1/emergencies/${dummyEmergencyId}`,
      })

      expect(res.statusCode).toBe(404)
      const body = res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('NOT_FOUND')
    })
  })
})

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'

describe('POST /v1/dev/mock-anomaly (CL-203)', () => {
  let app: FastifyInstance
  const dummyPatientId = '11111111-1111-4111-8111-111111111111'

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://localhost:5432/careloop_test?schema=public'
    process.env.JWT_SECRET ??= 'test-secret-minimal-32-karakter-abcdefg'

    const { buildApp } = await import('../../app')
    app = await buildApp({ logger: false })
  })

  it('berhasil memicu anomali HIGH_HR sintetis untuk demo', async () => {
    vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
      id: dummyPatientId,
      smartwatchEnabled: true,
      healthConditions: [],
    } as any)

    vi.spyOn(prisma.vitalSign, 'findUnique').mockResolvedValue(null)
    vi.spyOn(prisma.vitalSign, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.vitalSign, 'create').mockImplementation(((args: any) =>
      Promise.resolve({
        id: `vital_${Math.random()}`,
        ...args.data,
        createdAt: new Date(),
      })) as any
    )

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/mock-anomaly',
      payload: {
        patientId: dummyPatientId,
        type: 'HIGH_HR',
        hrBpm: 145,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data).toBeDefined()
    expect(body.data.triggered).toBe(true)
    expect(body.data.patientId).toBe(dummyPatientId)
    expect(body.data.readingsCount).toBe(2)
    expect(body.data.vitalIds).toHaveLength(2)
  })

  it('berhasil memicu bacaan SPIKE tunggal (bukan anomali)', async () => {
    vi.spyOn(prisma.patient, 'findUnique').mockResolvedValue({
      id: dummyPatientId,
      smartwatchEnabled: true,
      healthConditions: [],
    } as any)

    vi.spyOn(prisma.vitalSign, 'findUnique').mockResolvedValue(null)
    vi.spyOn(prisma.vitalSign, 'findMany').mockResolvedValue([])
    vi.spyOn(prisma.vitalSign, 'create').mockImplementation(((args: any) =>
      Promise.resolve({
        id: `vital_spike_${Math.random()}`,
        ...args.data,
        createdAt: new Date(),
      })) as any
    )

    const res = await app.inject({
      method: 'POST',
      url: '/v1/dev/mock-anomaly',
      payload: {
        patientId: dummyPatientId,
        type: 'SPIKE',
        hrBpm: 150,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.triggered).toBe(true)
    expect(body.data.readingsCount).toBe(1)
    expect(body.data.isAnomalous).toBe(false)
  })

  it('guard: mengembalikan 404 jika di lingkungan production', async () => {
    const originalEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'

      const res = await app.inject({
        method: 'POST',
        url: '/v1/dev/mock-anomaly',
        payload: {
          type: 'HIGH_HR',
        },
      })

      expect(res.statusCode).toBe(404)
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})

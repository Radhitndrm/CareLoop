import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { notFound } from '../../lib/errors'
import {
  createEmergencyFromAnomaly,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
  type CreateEmergencyInput,
  type CreateEmergencyResult,
  type EmergencyExecutionDeps,
  type EmergencyPrismaClient,
} from './emergency.service'

export {
  createEmergencyFromAnomaly,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
}
export type {
  CreateEmergencyInput,
  CreateEmergencyResult,
  EmergencyExecutionDeps,
  EmergencyPrismaClient,
}

const emergencyParamsSchema = z.object({
  id: z.string().uuid(),
})

export function registerEmergencyRoutes(app: FastifyInstance): void {
  // GET /v1/emergencies/active — Mendapatkan daftar insiden darurat aktif (docs/API.md §3.5)
  app.get('/v1/emergencies/active', async (_req, reply) => {
    const activeEmergencies = await prisma.emergencyAlert.findMany({
      where: {
        status: {
          in: ['PENDING_PATIENT_CONFIRM', 'ESCALATING'],
        },
      },
      include: {
        patient: {
          include: {
            user: {
              select: { id: true, fullName: true, phone: true },
            },
          },
        },
        escalationRun: true,
      },
      orderBy: {
        triggeredAt: 'desc',
      },
    })

    return reply.code(200).send({ data: activeEmergencies })
  })

  // GET /v1/emergencies/:id — Detail alert darurat tertentu (docs/API.md §3.5)
  app.get('/v1/emergencies/:id', async (req, reply) => {
    const params = emergencyParamsSchema.parse(req.params)
    const alert = await prisma.emergencyAlert.findUnique({
      where: { id: params.id },
      include: {
        patient: {
          include: {
            user: {
              select: { id: true, fullName: true, phone: true },
            },
          },
        },
        escalationRun: {
          include: {
            steps: {
              orderBy: { sentAt: 'asc' },
            },
          },
        },
      },
    })

    if (!alert) {
      throw notFound(`Emergency alert dengan ID ${params.id} tidak ditemukan`)
    }

    return reply.code(200).send({ data: alert })
  })
}

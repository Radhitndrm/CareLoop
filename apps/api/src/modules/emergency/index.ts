import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { notFound } from '../../lib/errors'
import { emergencyPatientResponseSchema } from '@careloop/shared'
import {
  createEmergencyFromAnomaly,
  handlePatientEmergencyResponse,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
  type CreateEmergencyInput,
  type CreateEmergencyResult,
  type PatientEmergencyResponseInput,
  type PatientEmergencyResponseResult,
  type EmergencyExecutionDeps,
  type EmergencyPrismaClient,
} from './emergency.service'

export {
  createEmergencyFromAnomaly,
  handlePatientEmergencyResponse,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
}
export type {
  CreateEmergencyInput,
  CreateEmergencyResult,
  PatientEmergencyResponseInput,
  PatientEmergencyResponseResult,
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

  // Handler bersama untuk respons pasien terhadap insiden darurat (CL-205 / AC-4.2)
  const handleResponse = async (req: any, reply: any) => {
    const params = emergencyParamsSchema.parse(req.params)
    const body = emergencyPatientResponseSchema.parse(req.body ?? {})

    const result = await handlePatientEmergencyResponse(prisma, {
      emergencyId: params.id,
      response: body.response,
      notes: body.notes,
      actorUserId: (req.user as any)?.sub ?? null,
    })

    return reply.code(200).send({ data: result })
  }

  // POST /v1/emergencies/:id/patient-response (docs/API.md §3.5)
  app.post('/v1/emergencies/:id/patient-response', handleResponse)

  // POST /v1/emergencies/:id/respond (alias kontrak issue #32)
  app.post('/v1/emergencies/:id/respond', handleResponse)
}

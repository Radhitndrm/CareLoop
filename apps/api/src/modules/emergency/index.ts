import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { UserRole } from '@careloop/shared'
import { prisma } from '../../lib/prisma'
import { notFound } from '../../lib/errors'
import { authenticate, requireCareTeamRole, requireRole } from '../../lib/auth'
import { emergencyPatientResponseSchema } from '@careloop/shared'
import {
  createEmergencyFromAnomaly,
  handlePatientEmergencyResponse,
  handleEmergencyTimeout,
  formatEmergencyLocation,
  formatEmergencyFamilyAlertMessage,
  formatEmergencyNakesAlertMessage,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
  type CreateEmergencyInput,
  type CreateEmergencyResult,
  type PatientEmergencyResponseInput,
  type PatientEmergencyResponseResult,
  type HandleEmergencyTimeoutInput,
  type HandleEmergencyTimeoutResult,
  type EmergencyLocationResult,
  type EmergencyAlertFamilyMessageInput,
  type EmergencyAlertNakesMessageInput,
  type EmergencyExecutionDeps,
  type EmergencyPrismaClient,
} from './emergency.service'

export {
  createEmergencyFromAnomaly,
  handlePatientEmergencyResponse,
  handleEmergencyTimeout,
  formatEmergencyLocation,
  formatEmergencyFamilyAlertMessage,
  formatEmergencyNakesAlertMessage,
  getEmergencyTimeoutSec,
  formatPatientEmergencyConfirmationMessage,
  defaultEmergencyQueueAdapter,
}
export type {
  CreateEmergencyInput,
  CreateEmergencyResult,
  PatientEmergencyResponseInput,
  PatientEmergencyResponseResult,
  HandleEmergencyTimeoutInput,
  HandleEmergencyTimeoutResult,
  EmergencyLocationResult,
  EmergencyAlertFamilyMessageInput,
  EmergencyAlertNakesMessageInput,
  EmergencyExecutionDeps,
  EmergencyPrismaClient,
}

const emergencyParamsSchema = z.object({
  id: z.string().uuid(),
})

export function registerEmergencyRoutes(app: FastifyInstance): void {
  // GET /v1/emergencies/active — Daftar insiden darurat aktif (docs/API.md §3.5).
  // Care team saja: responsnya memuat lokasi GNSS, detak jantung, dan nomor
  // telepon keluarga pasien yang sedang dalam bahaya.
  app.get(
    '/v1/emergencies/active',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (_req, reply) => {
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
    },
  )

  // GET /v1/emergencies/:id — Detail alert darurat tertentu (docs/API.md §3.5)
  app.get(
    '/v1/emergencies/:id',
    { preHandler: [authenticate, requireCareTeamRole()] },
    async (req, reply) => {
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
    },
  )

  // Handler bersama untuk respons pasien terhadap insiden darurat (CL-205 / AC-4.2)
  const handleResponse = async (req: any, reply: any) => {
    const params = emergencyParamsSchema.parse(req.params)
    const body = emergencyPatientResponseSchema.parse(req.body ?? {})

    const result = await handlePatientEmergencyResponse(prisma, {
      emergencyId: params.id,
      response: body.response,
      notes: body.notes,
      actorUserId: (req.user as any)?.sub ?? null,
      locationLat: body.locationLat,
      locationLng: body.locationLng,
    })

    return reply.code(200).send({ data: result })
  }

  // POST /v1/emergencies/:id/patient-response (docs/API.md §3.5).
  // Dibuka untuk pasien & keluarga karena inilah cara mereka menjawab "Apakah
  // Anda aman?" — termasuk lewat WhatsApp, bukan hanya aplikasi.
  const RESPOND_ROLES = [UserRole.PATIENT, UserRole.FAMILY, UserRole.NAKES, UserRole.ADMIN]
  const respondGuards = { preHandler: [authenticate, requireRole(...RESPOND_ROLES)] }

  app.post('/v1/emergencies/:id/patient-response', respondGuards, handleResponse)

  // POST /v1/emergencies/:id/respond (alias kontrak issue #32)
  app.post('/v1/emergencies/:id/respond', respondGuards, handleResponse)

  // POST /v1/emergencies/:id/timeout — Memicu penanganan timeout darurat (CL-206)
  // Timeout menandai pasien tidak merespons → eskalasi keluarga dimulai. Dibuka
  // untuk pasien (timer di app bisa habis sebelum WA sampai) dan care team.
  app.post(
    '/v1/emergencies/:id/timeout',
    { preHandler: [authenticate, requireRole(...RESPOND_ROLES)] },
    async (req: any, reply: any) => {
      const params = emergencyParamsSchema.parse(req.params)
      const body = z.object({ notes: z.string().max(280).optional() }).parse(req.body ?? {})

      const result = await handleEmergencyTimeout(prisma, {
        emergencyId: params.id,
        notes: body.notes,
        actorUserId: (req.user as any)?.sub ?? null,
      })

      return reply.code(200).send({ data: result })
    },
  )
}

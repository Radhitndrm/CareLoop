import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { invalidTransition, notFound } from '../../lib/errors'
import { escalationRespondSchema } from '@careloop/shared'
import { handleEmergencyTimeout } from '../emergency/emergency.service'
import {
  ACTIVE_ESCALATION_STATUSES,
  startEscalationRun,
  transitionEscalationRun,
  resolveEscalationRun,
  handleEscalationRun,
  cancelEscalationRun,
  getActiveEscalationRun,
  getEscalationRunById,
  resolvePatientEscalationContext,
  isActiveStatus,
  isTerminalStatus,
  TERMINAL_ESCALATION_STATUSES,
} from './escalation.service'
import {
  handlePatientEscalationTimeout,
  handleEscalationTimeout,
  getPatientTimeoutSec,
  getTierTimeoutSec,
  formatFamilyAlertMessage,
  formatNakesEscalationAlertMessage,
  InMemoryEscalationQueueAdapter,
  MockEscalationNotifier,
} from './timeout.service'

export {
  ACTIVE_ESCALATION_STATUSES,
  TERMINAL_ESCALATION_STATUSES,
  isActiveStatus,
  isTerminalStatus,
  startEscalationRun,
  transitionEscalationRun,
  resolveEscalationRun,
  handleEscalationRun,
  cancelEscalationRun,
  getActiveEscalationRun,
  getEscalationRunById,
  resolvePatientEscalationContext,
  handlePatientEscalationTimeout,
  handleEscalationTimeout,
  getPatientTimeoutSec,
  getTierTimeoutSec,
  formatFamilyAlertMessage,
  formatNakesEscalationAlertMessage,
  InMemoryEscalationQueueAdapter,
  MockEscalationNotifier,
}
export type {
  EscalationPrismaClient,
  StartEscalationRunInput,
  TransitionEscalationRunInput,
  CreateEscalationStepInput,
  ResolveEscalationRunInput,
  HandleEscalationRunInput,
  CancelEscalationRunInput,
} from './escalation.service'

export type {
  EscalationTimeoutJobPayload,
  EscalationQueueAdapter,
  EscalationNotifier,
  FamilyAlertMessageInput,
  NakesAlertMessageInput,
  TimeoutExecutionDeps,
  TimeoutExecutionResult,
} from './timeout.service'

export { reduceEscalation, InvalidTransitionError } from './state-machine'
export type {
  EscalationState,
  EscalationEventType,
  EscalationRunContext,
  TransitionResult,
  NotifyTarget,
} from './state-machine'

const escalationParamsSchema = z.object({
  id: z.string().uuid(),
})

const escalationStepsParamsSchema = z.object({
  runId: z.string().uuid(),
})

export function registerEscalationRoutes(app: FastifyInstance): void {
  // GET /v1/escalations/active (docs/API.md §3.6)
  app.get('/v1/escalations/active', async () => {
    const activeRuns = await prisma.escalationRun.findMany({
      where: {
        status: { in: ACTIVE_ESCALATION_STATUSES as any },
      },
      include: {
        steps: {
          orderBy: { sentAt: 'asc' },
        },
        patient: {
          select: {
            id: true,
            nik: true,
            livingSituation: true,
            emergencyPreference: true,
            user: {
              select: { id: true, fullName: true, phone: true },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    return { data: activeRuns }
  })

  // GET /v1/escalations/:id (docs/API.md §3.6)
  app.get('/v1/escalations/:id', async (req, reply) => {
    const params = escalationParamsSchema.parse(req.params)
    const run = await getEscalationRunById(prisma as any, params.id)
    if (!run) {
      throw notFound(`Escalation run ${params.id} tidak ditemukan`)
    }
    return reply.code(200).send({ data: run })
  })

  // POST /v1/escalations/:id/respond (docs/API.md §3.6, AC-7.2)
  app.post('/v1/escalations/:id/respond', async (req: any, reply: any) => {
    const params = escalationParamsSchema.parse(req.params)
    const body = escalationRespondSchema.parse(req.body ?? {})

    const run = await prisma.escalationRun.findUnique({
      where: { id: params.id },
    })

    if (!run) {
      throw notFound(`Escalation run ${params.id} tidak ditemukan`)
    }

    if (isTerminalStatus(run.status)) {
      throw invalidTransition(`Run eskalasi sudah dalam status final (${run.status})`)
    }

    const actorUserId = (req.user as any)?.sub ?? null
    const actorRole = (req.user as any)?.role === 'NAKES' ? 'NAKES' : 'FAMILY'

    if (body.response === 'HANDLE') {
      const { run: updatedRun } = await handleEscalationRun(prisma as any, {
        runId: run.id,
        actorUserId: actorUserId ?? 'anonymous-actor',
        actorRole,
        notes: body.note,
      })

      return reply.code(200).send({
        data: {
          runId: updatedRun.id,
          status: updatedRun.status,
          resolvedBy: updatedRun.resolvedByUserId,
          resolutionType: updatedRun.resolutionType,
          remainingTiersCancelled: true,
        },
      })
    }

    // Response: LOOKING (ACK_LOOKING) -> catat langkah tanpa menyelesaikan run
    const now = new Date()
    await prisma.escalationStep.create({
      data: {
        runId: run.id,
        tier: run.currentTier,
        contactUserId: actorUserId,
        contactPhone: '-',
        channel: 'WHATSAPP',
        messageKey: 'respond.looking',
        sentAt: now,
        respondedAt: now,
        response: 'ACK_LOOKING',
      },
    })

    return reply.code(200).send({
      data: {
        runId: run.id,
        status: run.status,
        acknowledged: true,
      },
    })
  })

  // GET /v1/escalations/:runId/steps (docs/API.md §3.6)
  app.get('/v1/escalations/:runId/steps', async (req, reply) => {
    const params = escalationStepsParamsSchema.parse(req.params)
    const run = await prisma.escalationRun.findUnique({
      where: { id: params.runId },
      include: {
        steps: {
          orderBy: { sentAt: 'asc' },
        },
      },
    })

    if (!run) {
      throw notFound(`Escalation run ${params.runId} tidak ditemukan`)
    }

    return reply.code(200).send({ data: run.steps })
  })

  // POST /internal/jobs/escalation-timeout (docs/API.md §4)
  app.post('/internal/jobs/escalation-timeout', async (req: any, reply: any) => {
    const body = z
      .object({
        runId: z.string().uuid(),
        currentState: z.string().optional(),
      })
      .parse(req.body ?? {})

    const run = await prisma.escalationRun.findUnique({
      where: { id: body.runId },
      select: { id: true, status: true, context: true, patientId: true },
    })

    if (!run) {
      throw notFound('Escalation run tidak ditemukan')
    }

    if (body.currentState && run.status !== body.currentState) {
      return reply.code(422).send({
        error: {
          code: 'STATE_CHANGED',
          message: `Run sudah berubah dari ${body.currentState} menjadi ${run.status}`,
        },
      })
    }

    if (run.context === 'EMERGENCY' && run.status === 'WAITING_PATIENT') {
      const result = await handleEmergencyTimeout(prisma, { runId: run.id })
      return reply.code(200).send({
        data: {
          runId: run.id,
          newState: result.escalationStatus ?? run.status,
          emergencyResult: result,
        },
      })
    }

    const result = await handleEscalationTimeout(
      prisma as any,
      { notifier: new MockEscalationNotifier() },
      {
        runId: run.id,
        patientId: run.patientId,
        context: run.context,
        expectedStatus: run.status as any,
        scheduledAt: new Date().toISOString(),
      },
    )

    return reply.code(200).send({
      data: {
        runId: run.id,
        newState: result.newStatus,
        escalationResult: result,
      },
    })
  })
}

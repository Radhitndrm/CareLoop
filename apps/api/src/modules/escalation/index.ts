import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { notFound } from '../../lib/errors'
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
  getPatientTimeoutSec,
  formatFamilyAlertMessage,
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
  getPatientTimeoutSec,
  formatFamilyAlertMessage,
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

export function registerEscalationRoutes(app: FastifyInstance): void {
  app.get('/v1/escalations/active', async () => {
    const activeRuns = await prisma.escalationRun.findMany({
      where: {
        status: { in: ACTIVE_ESCALATION_STATUSES as any },
      },
      include: {
        steps: true,
        patient: {
          select: {
            id: true,
            nik: true,
            livingSituation: true,
            emergencyPreference: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    return { data: activeRuns }
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

    if (run.context === 'EMERGENCY') {
      const result = await handleEmergencyTimeout(prisma, { runId: run.id })
      return reply.code(200).send({
        data: {
          runId: run.id,
          newState: result.escalationStatus ?? run.status,
          emergencyResult: result,
        },
      })
    }

    const result = await handlePatientEscalationTimeout(
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

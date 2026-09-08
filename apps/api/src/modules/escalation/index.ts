import type { FastifyInstance } from 'fastify'
import { prisma } from '../../lib/prisma'
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
}

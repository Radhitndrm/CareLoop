import type { FastifyInstance } from 'fastify'

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
    return { data: [] }
  })
}

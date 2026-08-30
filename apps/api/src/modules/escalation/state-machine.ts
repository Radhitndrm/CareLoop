// State machine eskalasi bertingkat CareLoop.
// Alur: WAITING_PATIENT -> FAMILY_TIER_1 -> FAMILY_TIER_2 -> NAKES
// Ref: docs/ARCHITECTURE.md (state machine), docs/PRD.md (FR-7), docs/TESTING.md (ES-1..ES-12)
import type { EscalationEventType, EscalationRunStatus } from '@careloop/shared'

/** State run = kolom escalation_runs.status (satu sumber di packages/shared). */
export type EscalationState = EscalationRunStatus

export type { EscalationEventType }

export type NotifyTarget = 'FAMILY_TIER_1' | 'FAMILY_TIER_2' | 'NAKES'

/** Konteks keputusan transisi — beda dari enum EscalationContext (SCHEDULE|EMERGENCY). */
export interface EscalationRunContext {
  hasTier1: boolean
  hasTier2: boolean
  /** emergencyPreference = NAKES_FIRST (pasien tinggal sendiri / tanpa keluarga dekat) */
  nakesFirst: boolean
}

export interface TransitionResult {
  to: EscalationState
  notify: NotifyTarget[]
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: EscalationState,
    public readonly event: EscalationEventType,
  ) {
    super(`Invalid escalation transition: ${from} + ${event}`)
    this.name = 'InvalidTransitionError'
  }
}

export function reduceEscalation(
  state: EscalationState,
  event: EscalationEventType,
  ctx: EscalationRunContext,
): TransitionResult {
  switch (state) {
    case 'WAITING_PATIENT':
      return reduceWaitingPatient(event, ctx)
    case 'FAMILY_TIER_1':
      return reduceFamilyTier1(event, ctx)
    case 'FAMILY_TIER_2':
      return reduceFamilyTier2(event, ctx)
    case 'NAKES':
      return reduceNakes(event)
    case 'HANDLED':
    case 'RESOLVED':
    case 'TIMED_OUT':
      throw new InvalidTransitionError(state, event)
    default:
      return assertNever(state)
  }
}

function resolved(): TransitionResult {
  return { to: 'RESOLVED', notify: [] }
}

function handled(): TransitionResult {
  return { to: 'HANDLED', notify: [] }
}

function reduceWaitingPatient(event: EscalationEventType, ctx: EscalationRunContext): TransitionResult {
  switch (event) {
    case 'PATIENT_CONFIRMED':
      return resolved()
    case 'FAMILY_HANDLED':
    case 'NAKES_HANDLED':
      return handled()
    case 'TIMEOUT':
      if (ctx.nakesFirst) {
        if (ctx.hasTier2) return { to: 'FAMILY_TIER_2', notify: ['FAMILY_TIER_2', 'NAKES'] }
        return { to: 'NAKES', notify: ['NAKES'] }
      }
      if (ctx.hasTier1) return { to: 'FAMILY_TIER_1', notify: ['FAMILY_TIER_1'] }
      if (ctx.hasTier2) return { to: 'FAMILY_TIER_2', notify: ['FAMILY_TIER_2'] }
      return { to: 'NAKES', notify: ['NAKES'] }
    default:
      return assertNever(event)
  }
}

function reduceFamilyTier1(event: EscalationEventType, ctx: EscalationRunContext): TransitionResult {
  switch (event) {
    case 'PATIENT_CONFIRMED':
      return resolved()
    case 'FAMILY_HANDLED':
    case 'NAKES_HANDLED':
      return handled()
    case 'TIMEOUT':
      if (ctx.hasTier2) return { to: 'FAMILY_TIER_2', notify: ['FAMILY_TIER_2'] }
      return { to: 'NAKES', notify: ['NAKES'] }
    default:
      return assertNever(event)
  }
}

function reduceFamilyTier2(event: EscalationEventType, _ctx: EscalationRunContext): TransitionResult {
  switch (event) {
    case 'PATIENT_CONFIRMED':
      return resolved()
    case 'FAMILY_HANDLED':
    case 'NAKES_HANDLED':
      return handled()
    case 'TIMEOUT':
      return { to: 'NAKES', notify: ['NAKES'] }
    default:
      return assertNever(event)
  }
}

function reduceNakes(event: EscalationEventType): TransitionResult {
  switch (event) {
    case 'PATIENT_CONFIRMED':
      return resolved()
    case 'FAMILY_HANDLED':
    case 'NAKES_HANDLED':
      return handled()
    case 'TIMEOUT':
      return { to: 'TIMED_OUT', notify: [] }
    default:
      return assertNever(event)
  }
}

function assertNever(x: never): never {
  throw new Error(`Unexpected escalation value: ${String(x)}`)
}

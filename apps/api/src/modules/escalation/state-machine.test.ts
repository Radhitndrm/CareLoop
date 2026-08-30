import { describe, expect, it } from 'vitest'
import {
  InvalidTransitionError,
  reduceEscalation,
  type EscalationRunContext,
} from './state-machine'

const ctx: EscalationRunContext = { hasTier1: true, hasTier2: true, nakesFirst: false }

describe('reduceEscalation — state machine bertingkat', () => {
  it('ES-1: pasien konfirmasi di WAITING_PATIENT -> RESOLVED, tanpa notify', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'PATIENT_CONFIRMED', ctx)
    expect(r.to).toBe('RESOLVED')
    expect(r.notify).toEqual([])
  })

  it('ES-2: timeout WAITING_PATIENT dengan family T1 -> FAMILY_TIER_1, alert T1', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'TIMEOUT', ctx)
    expect(r.to).toBe('FAMILY_TIER_1')
    expect(r.notify).toEqual(['FAMILY_TIER_1'])
  })

  it('ES-3: family T1 handle -> HANDLED', () => {
    const r = reduceEscalation('FAMILY_TIER_1', 'FAMILY_HANDLED', ctx)
    expect(r.to).toBe('HANDLED')
  })

  it('ES-4: timeout T1 dengan family T2 -> FAMILY_TIER_2', () => {
    const r = reduceEscalation('FAMILY_TIER_1', 'TIMEOUT', ctx)
    expect(r.to).toBe('FAMILY_TIER_2')
    expect(r.notify).toEqual(['FAMILY_TIER_2'])
  })

  it('ES-5: timeout T2 -> NAKES', () => {
    const r = reduceEscalation('FAMILY_TIER_2', 'TIMEOUT', ctx)
    expect(r.to).toBe('NAKES')
    expect(r.notify).toEqual(['NAKES'])
  })

  it('ES-6: nakes handle -> HANDLED', () => {
    const r = reduceEscalation('NAKES', 'NAKES_HANDLED', ctx)
    expect(r.to).toBe('HANDLED')
  })

  it('ES-7: pasien ALONE tanpa T1/T2 -> langsung NAKES', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'TIMEOUT', {
      hasTier1: false,
      hasTier2: false,
      nakesFirst: false,
    })
    expect(r.to).toBe('NAKES')
    expect(r.notify).toEqual(['NAKES'])
  })

  it('ES-8: hanya punya T2 (keluarga jauh) -> skip T1, masuk T2', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'TIMEOUT', {
      hasTier1: false,
      hasTier2: true,
      nakesFirst: false,
    })
    expect(r.to).toBe('FAMILY_TIER_2')
    expect(r.notify).toEqual(['FAMILY_TIER_2'])
  })

  it('ES-9: nakesFirst (darurat, alone) -> T2 + NAKES paralel', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'TIMEOUT', {
      hasTier1: false,
      hasTier2: true,
      nakesFirst: true,
    })
    expect(r.to).toBe('FAMILY_TIER_2')
    expect(r.notify).toEqual(['FAMILY_TIER_2', 'NAKES'])
  })

  it('ES-9b: nakesFirst tanpa T2 -> langsung NAKES', () => {
    const r = reduceEscalation('WAITING_PATIENT', 'TIMEOUT', {
      hasTier1: false,
      hasTier2: false,
      nakesFirst: true,
    })
    expect(r.to).toBe('NAKES')
    expect(r.notify).toEqual(['NAKES'])
  })

  it('ES-10: transisi ilegal dari state final -> InvalidTransitionError', () => {
    expect(() => reduceEscalation('HANDLED', 'TIMEOUT', ctx)).toThrow(InvalidTransitionError)
    expect(() => reduceEscalation('RESOLVED', 'FAMILY_HANDLED', ctx)).toThrow(InvalidTransitionError)
    expect(() => reduceEscalation('TIMED_OUT', 'PATIENT_CONFIRMED', ctx)).toThrow(
      InvalidTransitionError,
    )
  })

  it('ES-11: pasien konfirmasi saat eskalasi di T1 -> RESOLVED', () => {
    const r = reduceEscalation('FAMILY_TIER_1', 'PATIENT_CONFIRMED', ctx)
    expect(r.to).toBe('RESOLVED')
  })

  it('ES-11b: pasien konfirmasi saat di NAKES -> RESOLVED', () => {
    const r = reduceEscalation('NAKES', 'PATIENT_CONFIRMED', ctx)
    expect(r.to).toBe('RESOLVED')
  })

  it('ES-12: nakes dapat handle bahkan saat di tier keluarga', () => {
    const r = reduceEscalation('FAMILY_TIER_2', 'NAKES_HANDLED', ctx)
    expect(r.to).toBe('HANDLED')
  })

  it('timeout di NAKES -> TIMED_OUT (escalation expired)', () => {
    const r = reduceEscalation('NAKES', 'TIMEOUT', ctx)
    expect(r.to).toBe('TIMED_OUT')
    expect(r.notify).toEqual([])
  })
})

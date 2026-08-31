// Smoke test kontrak data (CL-001): id seed & nilai enum harus diterima validator bersama.
import { describe, expect, it } from 'vitest'
import {
  Channel,
  ComplianceChannel,
  EscalationTier,
  complianceConfirmSchema,
  createScheduleSchema,
  vitalIngestSchema,
} from '@careloop/shared'
import { newId } from './id'

const SEED_SCHEDULE_ID = '00000000-0000-4000-8000-000000000301'
const SEED_PATIENT_ID = '00000000-0000-4000-8000-000000000003'
const SEED_MEDICATION_ID = '00000000-0000-4000-8000-000000000201'

describe('kontrak id — uuid-only', () => {
  it('menerima id seed demo', () => {
    expect(complianceConfirmSchema.parse({ scheduleId: SEED_SCHEDULE_ID }).scheduleId).toBe(
      SEED_SCHEDULE_ID,
    )
    expect(() =>
      vitalIngestSchema.parse({
        patientId: SEED_PATIENT_ID,
        recordedAt: '2026-08-16T02:30:00Z',
        source: 'MOCK',
        hrBpm: 130,
      }),
    ).not.toThrow()
  })

  it('menerima id yang dihasilkan newId()', () => {
    expect(() => complianceConfirmSchema.parse({ scheduleId: newId() })).not.toThrow()
  })

  it('menolak id gaya lama yang tidak uuid', () => {
    expect(() => complianceConfirmSchema.parse({ scheduleId: 'sch_metformin_pagi' })).toThrow()
  })
})

describe('kontrak enum', () => {
  it('channel konfirmasi memakai IN_APP (bukan MOBILE_APP)', () => {
    expect(complianceConfirmSchema.parse({ scheduleId: SEED_SCHEDULE_ID }).channel).toBe(
      Channel.IN_APP,
    )
    expect(() =>
      complianceConfirmSchema.parse({ scheduleId: SEED_SCHEDULE_ID, channel: 'MOBILE_APP' }),
    ).toThrow()
  })

  it('ComplianceChannel adalah subset Channel', () => {
    for (const value of Object.values(ComplianceChannel)) {
      expect(Object.values(Channel)).toContain(value)
    }
  })

  it('EscalationTier menyertakan NAKES', () => {
    expect(EscalationTier.NAKES).toBe('NAKES')
  })
})

describe('kontrak schedule', () => {
  it('daysOfWeek kosong dan dailyFrequency punya default', () => {
    const parsed = createScheduleSchema.parse({
      medicationId: SEED_MEDICATION_ID,
      timeOfDay: '08:00',
      doseQty: '1 tablet',
      startDate: '2026-07-01',
    })
    expect(parsed.daysOfWeek).toEqual([])
    expect(parsed.dailyFrequency).toBe(1)
  })
})

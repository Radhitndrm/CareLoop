import { describe, expect, it } from 'vitest'
import { VitalSource } from '@careloop/shared'
import { MockSmartwatchAdapter } from './mock.adapter'

describe('MockSmartwatchAdapter (CL-203)', () => {
  const adapter = new MockSmartwatchAdapter()
  const dummyPatientId = 'patient_uuid_123'
  const baseTime = new Date('2026-09-08T08:00:00.000Z')

  it('memiliki source MOCK', () => {
    expect(adapter.source).toBe(VitalSource.MOCK)
  })

  it('menghasilkan 2 bacaan berurutan dalam 60s untuk anomali HIGH_HR', () => {
    const readings = adapter.generateMockStream(dummyPatientId, {
      type: 'HIGH_HR',
      hrBpm: 145,
      intervalSec: 20,
      baseTime,
    })

    expect(readings).toHaveLength(2)
    expect(readings[0].patientId).toBe(dummyPatientId)
    expect(readings[0].source).toBe(VitalSource.MOCK)
    expect(readings[0].hrBpm).toBeGreaterThan(120)
    expect(readings[1].hrBpm).toBe(145)

    // Interval harus tepat 20 detik (dalam jendela 60s)
    const diffMs = readings[1].recordedAt.getTime() - readings[0].recordedAt.getTime()
    expect(diffMs).toBe(20_000)
    expect(diffMs).toBeLessThanOrEqual(60_000)
  })

  it('menghasilkan 2 bacaan berurutan dalam 60s untuk anomali LOW_HR', () => {
    const readings = adapter.generateMockStream(dummyPatientId, {
      type: 'LOW_HR',
      hrBpm: 44,
      intervalSec: 15,
      baseTime,
    })

    expect(readings).toHaveLength(2)
    expect(readings[0].hrBpm).toBeLessThan(50)
    expect(readings[1].hrBpm).toBe(44)

    const diffMs = readings[1].recordedAt.getTime() - readings[0].recordedAt.getTime()
    expect(diffMs).toBe(15_000)
  })

  it('menghasilkan 1 bacaan tunggal untuk tipe SPIKE', () => {
    const readings = adapter.generateMockStream(dummyPatientId, {
      type: 'SPIKE',
      hrBpm: 150,
      baseTime,
    })

    expect(readings).toHaveLength(1)
    expect(readings[0].hrBpm).toBe(150)
  })

  it('menghasilkan bacaan normal saat tipe NORMAL', () => {
    const readings = adapter.generateMockStream(dummyPatientId, {
      type: 'NORMAL',
      count: 3,
      baseTime,
    })

    expect(readings).toHaveLength(3)
    for (const r of readings) {
      expect(r.hrBpm).toBeGreaterThanOrEqual(50)
      expect(r.hrBpm).toBeLessThanOrEqual(120)
    }
  })

  it('fetchReadings mengembalikan stream vital', async () => {
    const readings = await adapter.fetchReadings(dummyPatientId)
    expect(Array.isArray(readings)).toBe(true)
    expect(readings.length).toBeGreaterThanOrEqual(1)
  })
})

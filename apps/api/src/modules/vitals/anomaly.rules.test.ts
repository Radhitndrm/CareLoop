import { describe, expect, it } from 'vitest'
import { evaluateAnomaly } from './anomaly.rules'

const t = (ms: number) => new Date(ms)

describe('evaluateAnomaly — aturan deteksi anomali HR', () => {
  it('AN-1: HR 145 dua bacaan dalam window -> anomaly hr>120', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(1000), hrBpm: 140 },
      { recordedAt: t(31000), hrBpm: 145 },
    ])
    expect(r.isAnomalous).toBe(true)
    expect(r.reason).toBe('hr>120')
  })

  it('AN-2: satu bacaan saja (spike) -> belum anomaly', () => {
    const r = evaluateAnomaly([{ recordedAt: t(1000), hrBpm: 145 }])
    expect(r.isAnomalous).toBe(false)
  })

  it('AN-3: HR 45 dua bacaan -> anomaly hr<50', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(1000), hrBpm: 47 },
      { recordedAt: t(20000), hrBpm: 45 },
    ])
    expect(r.isAnomalous).toBe(true)
    expect(r.reason).toBe('hr<50')
  })

  it('AN-4: HR dalam batas -> tidak anomaly', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(1000), hrBpm: 72 },
      { recordedAt: t(20000), hrBpm: 88 },
      { recordedAt: t(40000), hrBpm: 95 },
    ])
    expect(r.isAnomalous).toBe(false)
  })

  it('AN-5: dua bacaan abnormal tapi di luar window -> bukan streak, belum anomaly', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(1000), hrBpm: 145 },
      { recordedAt: t(90000), hrBpm: 142 },
    ])
    expect(r.isAnomalous).toBe(false)
  })

  it('AN-6: urutan masuk acak tetap terdeteksi (diurutkan)', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(40000), hrBpm: 135 },
      { recordedAt: t(1000), hrBpm: 141 },
    ])
    expect(r.isAnomalous).toBe(true)
  })

  it('AN-7: threshold custom pasien (misal max 130) dihormati', () => {
    const r = evaluateAnomaly(
      [
        { recordedAt: t(1000), hrBpm: 125 },
        { recordedAt: t(20000), hrBpm: 127 },
      ],
      { maxHr: 130 },
    )
    expect(r.isAnomalous).toBe(false)

    const r2 = evaluateAnomaly(
      [
        { recordedAt: t(1000), hrBpm: 135 },
        { recordedAt: t(20000), hrBpm: 133 },
      ],
      { maxHr: 130 },
    )
    expect(r2.isAnomalous).toBe(true)
  })

  it('bacaan tidak valid (NaN) dilewati tanpa crash', () => {
    const r = evaluateAnomaly([
      { recordedAt: t(1000), hrBpm: Number.NaN },
      { recordedAt: t(20000), hrBpm: 150 },
      { recordedAt: t(30000), hrBpm: 148 },
    ])
    expect(r.isAnomalous).toBe(true)
  })
})

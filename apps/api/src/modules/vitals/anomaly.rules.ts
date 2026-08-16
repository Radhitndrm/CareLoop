// Aturan deteksi anomali detak jantung (rule-based, bukan ML).
// Threshold default: HR < 50 atau > 120 bpm, bertahan >= 2 bacaan berurutan dalam 60 detik.
// Ref: docs/PRD.md (FR-4.2), docs/TESTING.md (AN-1..AN-7)

export interface AnomalyRuleConfig {
  minHr: number
  maxHr: number
  /** Waktu (ms) di mana 2 bacaan berurutan dianggap "menetap" */
  windowMs: number
}

export const DEFAULT_ANOMALY_RULE: AnomalyRuleConfig = {
  minHr: 50,
  maxHr: 120,
  windowMs: 60_000,
}

export interface HeartRateReading {
  recordedAt: Date
  hrBpm: number
}

export interface AnomalyResult {
  isAnomalous: boolean
  reason?: string
}

export function evaluateAnomaly(readings: HeartRateReading[], config?: Partial<AnomalyRuleConfig>): AnomalyResult {
  const cfg: AnomalyRuleConfig = { ...DEFAULT_ANOMALY_RULE, ...config }

  const sorted = [...readings]
    .filter((r) => Number.isFinite(r.hrBpm))
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())

  if (sorted.length < 2) {
    return { isAnomalous: false }
  }

  let outOfRange: HeartRateReading[] = []
  let streakStart = -1

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]
    const abnormal = r.hrBpm < cfg.minHr || r.hrBpm > cfg.maxHr

    if (!abnormal) {
      outOfRange = []
      streakStart = -1
      continue
    }

    if (outOfRange.length === 0) {
      outOfRange = [r]
      streakStart = r.recordedAt.getTime()
    } else {
      const withinWindow = r.recordedAt.getTime() - streakStart <= cfg.windowMs
      if (!withinWindow) {
        outOfRange = [r]
        streakStart = r.recordedAt.getTime()
      } else {
        outOfRange.push(r)
      }
    }

    if (outOfRange.length >= 2) {
      const reason =
        r.hrBpm > cfg.maxHr ? `hr>${cfg.maxHr}` : `hr<${cfg.minHr}`
      return { isAnomalous: true, reason }
    }
  }

  return { isAnomalous: false }
}

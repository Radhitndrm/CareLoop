import { VitalSource } from '@careloop/shared'

export interface VitalReading {
  patientId: string
  recordedAt: Date
  source: VitalSource
  hrBpm?: number
  spo2?: number
  systolic?: number
  diastolic?: number
  rawPayload?: Record<string, unknown>
}

export type MockAnomalyType = 'HIGH_HR' | 'LOW_HR' | 'SPIKE' | 'NORMAL'

export interface MockVitalOptions {
  type?: MockAnomalyType
  hrBpm?: number
  spo2?: number
  count?: number
  intervalSec?: number
  baseTime?: Date
}

/**
 * Abstraksi adapter smartwatch (AGENTS.md §8 / CL-203).
 * Memungkinkan pergantian provider (Mock, Google Fit, Apple HealthKit) tanpa mengubah logika ingest.
 */
export interface SmartwatchAdapter {
  readonly source: VitalSource
  fetchReadings(patientId: string, since?: Date): Promise<VitalReading[]>
  generateMockStream(patientId: string, options?: MockVitalOptions): VitalReading[]
}

import { VitalSource } from '@careloop/shared'
import type {
  SmartwatchAdapter,
  VitalReading,
  MockVitalOptions,
} from './types'

export class MockSmartwatchAdapter implements SmartwatchAdapter {
  readonly source: VitalSource = VitalSource.MOCK

  async fetchReadings(patientId: string, since?: Date): Promise<VitalReading[]> {
    // Simulasi pengambilan data periodik dari mock smartwatch
    return this.generateMockStream(patientId, {
      type: 'NORMAL',
      count: 1,
      baseTime: since ?? new Date(),
    })
  }

  /**
   * Menghasilkan deret data tanda vital sintetis untuk simulasi anomali/demo hackathon.
   */
  generateMockStream(patientId: string, options?: MockVitalOptions): VitalReading[] {
    const type = options?.type ?? 'HIGH_HR'
    const intervalMs = (options?.intervalSec ?? 20) * 1000
    const now = options?.baseTime ?? new Date()

    switch (type) {
      case 'HIGH_HR': {
        // 2 bacaan berturut-turut dalam 60s dengan HR tinggi (memicu AN-1: hr > 120)
        const targetHr = options?.hrBpm ?? 145
        const firstHr = Math.max(125, targetHr - 5)
        return [
          {
            patientId,
            recordedAt: new Date(now.getTime() - intervalMs),
            source: this.source,
            hrBpm: firstHr,
            spo2: options?.spo2 ?? 97,
            rawPayload: { simulated: true, mockType: 'HIGH_HR_STREAK_1' },
          },
          {
            patientId,
            recordedAt: now,
            source: this.source,
            hrBpm: targetHr,
            spo2: options?.spo2 ?? 96,
            rawPayload: { simulated: true, mockType: 'HIGH_HR_STREAK_2' },
          },
        ]
      }

      case 'LOW_HR': {
        // 2 bacaan berturut-turut dalam 60s dengan HR rendah (memicu AN-3: hr < 50)
        const targetHr = options?.hrBpm ?? 44
        const firstHr = Math.min(48, targetHr + 2)
        return [
          {
            patientId,
            recordedAt: new Date(now.getTime() - intervalMs),
            source: this.source,
            hrBpm: firstHr,
            spo2: options?.spo2 ?? 98,
            rawPayload: { simulated: true, mockType: 'LOW_HR_STREAK_1' },
          },
          {
            patientId,
            recordedAt: now,
            source: this.source,
            hrBpm: targetHr,
            spo2: options?.spo2 ?? 97,
            rawPayload: { simulated: true, mockType: 'LOW_HR_STREAK_2' },
          },
        ]
      }

      case 'SPIKE': {
        // Lonjakan sesaat tunggal (AN-2: spike tidak memicu anomali darurat)
        return [
          {
            patientId,
            recordedAt: now,
            source: this.source,
            hrBpm: options?.hrBpm ?? 148,
            spo2: options?.spo2 ?? 98,
            rawPayload: { simulated: true, mockType: 'SPIKE_SINGLE' },
          },
        ]
      }

      case 'NORMAL':
      default: {
        // Bacaan denyut nadi normal sehat (AN-4)
        const count = options?.count ?? 2
        const readings: VitalReading[] = []
        for (let i = count - 1; i >= 0; i--) {
          readings.push({
            patientId,
            recordedAt: new Date(now.getTime() - i * intervalMs),
            source: this.source,
            hrBpm: options?.hrBpm ?? (72 + i * 2),
            spo2: options?.spo2 ?? 99,
            rawPayload: { simulated: true, mockType: 'NORMAL' },
          })
        }
        return readings
      }
    }
  }
}

export const mockSmartwatchAdapter = new MockSmartwatchAdapter()

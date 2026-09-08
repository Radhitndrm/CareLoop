import { describe, expect, it, vi } from 'vitest'
import { VitalSource } from '@careloop/shared'
import {
  ingestVitalSign,
  sanitizeRawPayload,
  evaluatePatientVitalsAnomaly,
  extractPatientThresholds,
  type VitalsPrismaClient,
} from './vitals.service'

describe('sanitizeRawPayload (CL-201)', () => {
  it('menghapus metadata identitas perangkat dan rahasia sensitif', () => {
    const raw = {
      deviceId: 'watch-xyz-123',
      device_id: 'watch-xyz-456',
      serialNumber: 'SN99887766',
      macAddress: '00:1B:44:11:3A:B7',
      imei: '358291083912093',
      hardwareId: 'hw_rev_2',
      bluetoothAddress: 'AA:BB:CC:DD:EE:FF',
      ipAddress: '192.168.1.100',
      deviceModel: 'Apple Watch Series 8',
      firmwareVersion: '10.5.1',
      authToken: 'secret_bearer_token',
      // Data kesehatan sah yang harus dipertahankan:
      confidence: 98,
      sensorStatus: 'OK',
      activityType: 'RESTING',
    }

    const clean = sanitizeRawPayload(raw)

    expect(clean).toBeDefined()
    expect(clean).toEqual({
      confidence: 98,
      sensorStatus: 'OK',
      activityType: 'RESTING',
    })
    expect(clean?.deviceId).toBeUndefined()
    expect(clean?.serialNumber).toBeUndefined()
    expect(clean?.macAddress).toBeUndefined()
    expect(clean?.imei).toBeUndefined()
    expect(clean?.hardwareId).toBeUndefined()
    expect(clean?.authToken).toBeUndefined()
  })

  it('melakukan sanitasi bersarang (nested objects)', () => {
    const raw = {
      metrics: {
        sensorStatus: 'OPTIMAL',
        deviceSerial: 'SN12345',
      },
      readings: {
        signalQuality: 'HIGH',
      },
    }

    const clean = sanitizeRawPayload(raw)

    expect(clean).toEqual({
      metrics: {
        sensorStatus: 'OPTIMAL',
      },
      readings: {
        signalQuality: 'HIGH',
      },
    })
  })

  it('mengembalikan undefined jika input kosong, null, atau seluruh properti terhapus', () => {
    expect(sanitizeRawPayload(undefined)).toBeUndefined()
    expect(sanitizeRawPayload(null)).toBeUndefined()
    expect(sanitizeRawPayload({})).toBeUndefined()
    expect(sanitizeRawPayload({ deviceId: '123', serialNumber: '456' })).toBeUndefined()
  })
})

describe('ingestVitalSign (CL-201)', () => {
  const dummyPatientId = 'p_11111111-1111-4111-8111-111111111111'
  const recordedAtStr = '2026-09-08T08:00:00.000Z'

  function createMockPrisma(overrides?: {
    patient?: { id: string; smartwatchEnabled: boolean } | null
    existingVital?: any | null
    createdVital?: any | null
  }): VitalsPrismaClient {
    return {
      patient: {
        findUnique: vi.fn().mockResolvedValue(
          overrides && 'patient' in overrides
            ? overrides.patient
            : { id: dummyPatientId, smartwatchEnabled: true }
        ),
      } as any,
      vitalSign: {
        findUnique: vi.fn().mockResolvedValue(overrides?.existingVital ?? null),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({
            id: 'vital_new_123',
            ...args.data,
            isAnomalous: false,
            anomalyReason: null,
            createdAt: new Date(),
          })
        ),
      } as any,
    }
  }

  it('berhasil menyimpan vital sign baru saat pasien memenuhi syarat (smartwatchEnabled: true)', async () => {
    const mockPrisma = createMockPrisma()

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: recordedAtStr,
      source: VitalSource.MOCK,
      hrBpm: 75,
      spo2: 98,
      rawPayload: {
        deviceId: 'watch_abc',
        confidence: 95,
      },
    })

    expect(result.isDuplicate).toBe(false)
    expect(result.vitalSign.id).toBe('vital_new_123')
    expect(result.vitalSign.hrBpm).toBe(75)
    expect(result.vitalSign.spo2).toBe(98)
    expect(result.vitalSign.recordedAt.toISOString()).toBe(recordedAtStr)
    expect(result.vitalSign.rawPayload).toEqual({ confidence: 95 })

    expect(mockPrisma.vitalSign.create).toHaveBeenCalledWith({
      data: {
        patientId: dummyPatientId,
        recordedAt: new Date(recordedAtStr),
        source: VitalSource.MOCK,
        hrBpm: 75,
        spo2: 98,
        systolic: undefined,
        diastolic: undefined,
        rawPayload: { confidence: 95 },
        isAnomalous: false,
        anomalyReason: null,
      },
    })
  })

  it('AN-5: menolak dan melempar FORBIDDEN jika pasien mematikan smartwatch (smartwatchEnabled: false)', async () => {
    const mockPrisma = createMockPrisma({
      patient: { id: dummyPatientId, smartwatchEnabled: false },
    })

    await expect(
      ingestVitalSign(mockPrisma, {
        patientId: dummyPatientId,
        recordedAt: recordedAtStr,
        source: VitalSource.MOCK,
        hrBpm: 130,
      })
    ).rejects.toThrow('Pasien tidak mengaktifkan integrasi smartwatch')

    expect(mockPrisma.vitalSign.create).not.toHaveBeenCalled()
  })

  it('melempar NOT_FOUND jika pasien tidak ditemukan di database', async () => {
    const mockPrisma = createMockPrisma({
      patient: null,
    })

    await expect(
      ingestVitalSign(mockPrisma, {
        patientId: 'p_non_existent',
        recordedAt: recordedAtStr,
        source: VitalSource.MOCK,
      })
    ).rejects.toThrow('tidak ditemukan')

    expect(mockPrisma.vitalSign.create).not.toHaveBeenCalled()
  })

  it('AN-6: idempoten deduplikasi jika event dengan (recordedAt + source) sudah pernah ada', async () => {
    const existingRecord = {
      id: 'vital_existing_999',
      patientId: dummyPatientId,
      recordedAt: new Date(recordedAtStr),
      source: VitalSource.MOCK,
      hrBpm: 80,
      spo2: 99,
      systolic: null,
      diastolic: null,
      isAnomalous: false,
      anomalyReason: null,
      rawPayload: null,
    }

    const mockPrisma = createMockPrisma({
      existingVital: existingRecord,
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: recordedAtStr,
      source: VitalSource.MOCK,
      hrBpm: 80,
    })

    expect(result.isDuplicate).toBe(true)
    expect(result.vitalSign.id).toBe('vital_existing_999')
    // Memastikan tidak membuat baris kedua
    expect(mockPrisma.vitalSign.create).not.toHaveBeenCalled()
  })
})

describe('extractPatientThresholds (AN-7)', () => {
  it('mengekstrak custom maxHr dan minHr dari healthConditions pasien', () => {
    const conditions = ['hipertensi', 'maxHr:130', 'min_hr:45', 'diabetes']
    const result = extractPatientThresholds(conditions)

    expect(result.maxHr).toBe(130)
    expect(result.minHr).toBe(45)
  })

  it('mengembalikan objek kosong jika healthConditions null, kosong, atau tidak memuat pola threshold', () => {
    expect(extractPatientThresholds(null)).toEqual({})
    expect(extractPatientThresholds([])).toEqual({})
    expect(extractPatientThresholds(['hipertensi', 'asma'])).toEqual({})
  })
})

describe('evaluatePatientVitalsAnomaly & Sequential Anomaly Integration (CL-202)', () => {
  const dummyPatientId = 'p_11111111-1111-4111-8111-111111111111'
  const baseTime = new Date('2026-09-08T08:00:00.000Z')

  function createVitalsPrisma(options?: {
    patient?: any
    historyVitals?: Array<{ recordedAt: Date; hrBpm: number | null }>
  }): VitalsPrismaClient {
    return {
      patient: {
        findUnique: vi.fn().mockResolvedValue(
          options && 'patient' in options
            ? options.patient
            : { id: dummyPatientId, smartwatchEnabled: true, healthConditions: [] }
        ),
      } as any,
      vitalSign: {
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue(options?.historyVitals ?? []),
        create: vi.fn().mockImplementation((args: any) =>
          Promise.resolve({
            id: 'vital_created_id',
            ...args.data,
            createdAt: new Date(),
          })
        ),
      } as any,
    }
  }

  it('AN-2: bacaan tunggal abnormal (spike) tidak memicu anomali', async () => {
    const mockPrisma = createVitalsPrisma({
      historyVitals: [],
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 145,
    })

    expect(result.vitalSign.isAnomalous).toBe(false)
    expect(result.vitalSign.anomalyReason).toBeNull()
  })

  it('AN-1: 2 bacaan abnormal berurutan (HR > 120) dalam 60s memicu anomali hr>120', async () => {
    const prevTime = new Date(baseTime.getTime() - 25_000) // 25 detik sebelumnya (dalam jendela 60s)
    const mockPrisma = createVitalsPrisma({
      historyVitals: [{ recordedAt: prevTime, hrBpm: 140 }],
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 145,
    })

    expect(result.vitalSign.isAnomalous).toBe(true)
    expect(result.vitalSign.anomalyReason).toBe('hr>120')
  })

  it('AN-3: 2 bacaan detak jantung rendah berurutan (HR < 50) dalam 60s memicu anomali hr<50', async () => {
    const prevTime = new Date(baseTime.getTime() - 15_000)
    const mockPrisma = createVitalsPrisma({
      historyVitals: [{ recordedAt: prevTime, hrBpm: 46 }],
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 44,
    })

    expect(result.vitalSign.isAnomalous).toBe(true)
    expect(result.vitalSign.anomalyReason).toBe('hr<50')
  })

  it('AN-4: detak jantung normal tidak memicu anomali', async () => {
    const prevTime = new Date(baseTime.getTime() - 20_000)
    const mockPrisma = createVitalsPrisma({
      historyVitals: [{ recordedAt: prevTime, hrBpm: 75 }],
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 80,
    })

    expect(result.vitalSign.isAnomalous).toBe(false)
    expect(result.vitalSign.anomalyReason).toBeNull()
  })

  it('AN-5: 2 bacaan abnormal tetapi terpaut di luar jendela 60 detik tidak memicu anomali', async () => {
    const prevTime = new Date(baseTime.getTime() - 90_000) // 90 detik sebelumnya (di luar jendela 60s)
    const mockPrisma = createVitalsPrisma({
      historyVitals: [{ recordedAt: prevTime, hrBpm: 142 }],
    })

    const result = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 145,
    })

    expect(result.vitalSign.isAnomalous).toBe(false)
    expect(result.vitalSign.anomalyReason).toBeNull()
  })

  it('AN-7: menghormati custom threshold pasien (misal maxHr:130)', async () => {
    const prevTime = new Date(baseTime.getTime() - 20_000)
    const mockPrisma = createVitalsPrisma({
      patient: {
        id: dummyPatientId,
        smartwatchEnabled: true,
        healthConditions: ['maxHr:130'],
      },
      historyVitals: [{ recordedAt: prevTime, hrBpm: 125 }],
    })

    // HR 126 di bawah custom threshold 130 -> tidak anomali
    const result1 = await ingestVitalSign(mockPrisma, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 126,
    })
    expect(result1.vitalSign.isAnomalous).toBe(false)

    // Jika melebihi custom threshold 130 (misal 135 dan sebelumnya 132) -> anomali hr>130
    const mockPrismaHigh = createVitalsPrisma({
      patient: {
        id: dummyPatientId,
        smartwatchEnabled: true,
        healthConditions: ['maxHr:130'],
      },
      historyVitals: [{ recordedAt: prevTime, hrBpm: 132 }],
    })

    const result2 = await ingestVitalSign(mockPrismaHigh, {
      patientId: dummyPatientId,
      recordedAt: baseTime.toISOString(),
      source: VitalSource.MOCK,
      hrBpm: 135,
    })
    expect(result2.vitalSign.isAnomalous).toBe(true)
    expect(result2.vitalSign.anomalyReason).toBe('hr>130')
  })
})


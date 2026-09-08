import { describe, expect, it, vi } from 'vitest'
import { VitalSource } from '@careloop/shared'
import {
  ingestVitalSign,
  sanitizeRawPayload,
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

import { Prisma, type PrismaClient } from '@prisma/client'
import { VitalSource, type VitalIngestInput } from '@careloop/shared'
import { forbidden, notFound } from '../../lib/errors'
import { anomalyRuleConfig } from '../../lib/env'
import {
  evaluateAnomaly,
  type AnomalyRuleConfig,
  type AnomalyResult,
  type HeartRateReading,
} from './anomaly.rules'

export type VitalsPrismaClient = Pick<PrismaClient, 'vitalSign' | 'patient'>

export interface IngestVitalOptions {
  customRuleConfig?: Partial<AnomalyRuleConfig>
}

export interface IngestVitalResult {
  vitalSign: {
    id: string
    patientId: string
    recordedAt: Date
    source: VitalSource
    hrBpm: number | null
    spo2: number | null
    systolic: number | null
    diastolic: number | null
    isAnomalous: boolean
    anomalyReason: string | null
    rawPayload: unknown
  }
  isDuplicate: boolean
}

/**
 * Pola kunci metadata perangkat keras yang harus dibersihkan (drop) dari rawPayload
 * sebelum disimpan ke database untuk menjaga privasi perangkat (UU PDP / CL-201).
 */
const DROP_DEVICE_METADATA_PATTERN =
  /device_?id|serial|mac_?address|imei|hardware_?id|bluetooth|bssid|ssid|ip_?address|device_?model|manufacturer|firmware|build_?number|pass|otp|token|secret|auth|nik/i

/**
 * Sanitasi rawPayload: menghapus metadata identitas perangkat dan rahasia sensitif,
 * namun tetap mempertahankan metrik kesehatan seperti confidence, steps, sensorStatus, dll.
 */
export function sanitizeRawPayload(
  payload?: Record<string, unknown> | null
): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (DROP_DEVICE_METADATA_PATTERN.test(key)) {
      // Hapus / drop metadata perangkat
      continue
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = sanitizeRawPayload(value as Record<string, unknown>)
      if (nested && Object.keys(nested).length > 0) {
        sanitized[key] = nested
      }
    } else {
      sanitized[key] = value
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

/**
 * Ekstrak threshold custom pasien dari profil kondisi kesehatan (AN-7).
 * Contoh format di healthConditions: 'maxHr:130', 'min_hr:45', 'hr_max:140'.
 */
export function extractPatientThresholds(
  healthConditions?: string[] | null
): Partial<AnomalyRuleConfig> {
  if (!healthConditions || !Array.isArray(healthConditions)) return {}

  const config: Partial<AnomalyRuleConfig> = {}

  for (const condition of healthConditions) {
    if (typeof condition !== 'string') continue

    // Cocokkan pola seperti maxHr:130, max_hr:130, hr_max:130
    const maxMatch = condition.match(/(?:max_?hr|hr_?max)[:=](\d+)/i)
    if (maxMatch && maxMatch[1]) {
      config.maxHr = parseInt(maxMatch[1], 10)
    }

    // Cocokkan pola seperti minHr:45, min_hr:45, hr_min:45
    const minMatch = condition.match(/(?:min_?hr|hr_?min)[:=](\d+)/i)
    if (minMatch && minMatch[1]) {
      config.minHr = parseInt(minMatch[1], 10)
    }

    // Cocokkan pola seperti windowSec:60, window_sec:60
    const windowMatch = condition.match(/window_?sec[:=](\d+)/i)
    if (windowMatch && windowMatch[1]) {
      config.windowMs = parseInt(windowMatch[1], 10) * 1000
    }
  }

  return config
}

/**
 * Evaluasi anomali detak jantung pasien berdasarkan riwayat bacaan dalam database (CL-202).
 * Memeriksa apakah terjadi >= 2 bacaan berurutan di luar ambang batas dalam jendela 60 detik.
 */
export async function evaluatePatientVitalsAnomaly(
  prisma: VitalsPrismaClient,
  params: {
    patientId: string
    currentReading?: { recordedAt: Date; hrBpm?: number | null }
    ruleConfig?: Partial<AnomalyRuleConfig>
    healthConditions?: string[] | null
  }
): Promise<AnomalyResult> {
  if (
    params.currentReading?.hrBpm === undefined ||
    params.currentReading?.hrBpm === null ||
    !Number.isFinite(params.currentReading.hrBpm)
  ) {
    return { isAnomalous: false }
  }

  const baseConfig = anomalyRuleConfig()
  const patientConfig = extractPatientThresholds(params.healthConditions)
  const effectiveConfig: AnomalyRuleConfig = {
    ...baseConfig,
    ...patientConfig,
    ...params.ruleConfig,
  }

  const currentRecordedAt = params.currentReading.recordedAt
  const windowStart = new Date(currentRecordedAt.getTime() - effectiveConfig.windowMs)

  // Query bacaan vital historis pasien dalam jendela waktu windowMs
  const history = await prisma.vitalSign.findMany({
    where: {
      patientId: params.patientId,
      recordedAt: {
        gte: windowStart,
        lte: currentRecordedAt,
      },
      hrBpm: {
        not: null,
      },
    },
    orderBy: {
      recordedAt: 'asc',
    },
    select: {
      recordedAt: true,
      hrBpm: true,
    },
  })

  // Satukan data historis dan bacaan saat ini (hindari duplikasi waktu yang sama)
  const readings: HeartRateReading[] = history
    .filter(
      (h) =>
        h.hrBpm !== null &&
        Number.isFinite(h.hrBpm) &&
        h.recordedAt.getTime() !== currentRecordedAt.getTime()
    )
    .map((h) => ({
      recordedAt: h.recordedAt,
      hrBpm: h.hrBpm!,
    }))

  readings.push({
    recordedAt: currentRecordedAt,
    hrBpm: params.currentReading.hrBpm,
  })

  return evaluateAnomaly(readings, effectiveConfig)
}

/**
 * Ingest data tanda vital pasien (CL-201 / CL-202).
 * - Cek eligibilitas smartwatch pasien (AN-5).
 * - Sanitasi rawPayload (drop hardware device ID).
 * - Deduplikasi berbasis (patientId, source, recordedAt) agar idempoten (AN-6).
 * - Evaluasi anomali berurutan (≥ 2 bacaan dalam 60s) dengan database (CL-202).
 * - Simpan waktu UTC dan status anomali.
 */
export async function ingestVitalSign(
  prisma: VitalsPrismaClient,
  input: VitalIngestInput,
  options?: IngestVitalOptions
): Promise<IngestVitalResult> {
  // 1. Periksa keberadaan pasien dan status smartwatchEnabled (AN-5)
  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, smartwatchEnabled: true, healthConditions: true },
  })

  if (!patient) {
    throw notFound(`Pasien dengan ID ${input.patientId} tidak ditemukan`)
  }

  if (!patient.smartwatchEnabled) {
    // AN-5: Pasien matikan smartwatch -> ditolak / di-log, tidak trigger
    throw forbidden('Pasien tidak mengaktifkan integrasi smartwatch')
  }

  const recordedAtUtc = new Date(input.recordedAt)
  const cleanPayload = sanitizeRawPayload(input.rawPayload)

  // 2. Cek deduplikasi event (AN-6): recordedAt + source + patientId
  const existing = await prisma.vitalSign.findUnique({
    where: {
      patientId_source_recordedAt: {
        patientId: input.patientId,
        source: input.source,
        recordedAt: recordedAtUtc,
      },
    },
  })

  if (existing) {
    // AN-6: Duplikat event -> idempoten, kembalikan data yang sudah ada
    return {
      vitalSign: existing,
      isDuplicate: true,
    }
  }

  // 3. Evaluasi anomali detak jantung berurutan (CL-202 / AN-1..AN-4, AN-7)
  let isAnomalous = false
  let anomalyReason: string | null = null

  if (input.hrBpm !== undefined && input.hrBpm !== null) {
    const anomalyResult = await evaluatePatientVitalsAnomaly(prisma, {
      patientId: input.patientId,
      currentReading: {
        recordedAt: recordedAtUtc,
        hrBpm: input.hrBpm,
      },
      ruleConfig: options?.customRuleConfig,
      healthConditions: patient.healthConditions,
    })

    isAnomalous = anomalyResult.isAnomalous
    anomalyReason = anomalyResult.reason ?? null
  }

  // 4. Simpan data vital baru ke database
  try {
    const vitalSign = await prisma.vitalSign.create({
      data: {
        patientId: input.patientId,
        recordedAt: recordedAtUtc,
        source: input.source,
        hrBpm: input.hrBpm,
        spo2: input.spo2,
        systolic: input.systolic,
        diastolic: input.diastolic,
        rawPayload: cleanPayload ? (cleanPayload as Prisma.InputJsonValue) : Prisma.JsonNull,
        isAnomalous,
        anomalyReason,
      },
    })

    return {
      vitalSign,
      isDuplicate: false,
    }
  } catch (err) {
    // Race condition guard: jika ada request bersamaan yang baru saja membuat record
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const duplicateRecord = await prisma.vitalSign.findUnique({
        where: {
          patientId_source_recordedAt: {
            patientId: input.patientId,
            source: input.source,
            recordedAt: recordedAtUtc,
          },
        },
      })
      if (duplicateRecord) {
        return {
          vitalSign: duplicateRecord,
          isDuplicate: true,
        }
      }
    }
    throw err
  }
}

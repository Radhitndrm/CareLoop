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

import { createEmergencyFromAnomaly, type EmergencyExecutionDeps } from '../emergency/emergency.service'

export type VitalsPrismaClient = Pick<PrismaClient, 'vitalSign' | 'patient'>

export interface IngestVitalOptions {
  customRuleConfig?: Partial<AnomalyRuleConfig>
  triggerEmergency?: boolean
  emergencyDeps?: EmergencyExecutionDeps
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
  emergencyAlert?: any
  escalationRun?: any
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
 * Ambang detak jantung individual pasien, ditetapkan dokter (docs/API.md §3.4).
 *
 * Sebelumnya ambang ini disisipkan sebagai string di `healthConditions`
 * (mis. 'max_hr:130') lalu diparse regex. Format bebas seperti itu tidak bisa
 * dibedakan mana yang disahkan dokter, jadi digantikan kolom eksplisit
 * `Patient.hrMinBpm` / `Patient.hrMaxBpm`. Kolom kosong = pakai default sistem.
 */
export function patientHrThresholds(thresholds?: {
  hrMinBpm?: number | null
  hrMaxBpm?: number | null
}): Partial<AnomalyRuleConfig> {
  const config: Partial<AnomalyRuleConfig> = {}
  if (typeof thresholds?.hrMinBpm === 'number' && Number.isFinite(thresholds.hrMinBpm)) {
    config.minHr = thresholds.hrMinBpm
  }
  if (typeof thresholds?.hrMaxBpm === 'number' && Number.isFinite(thresholds.hrMaxBpm)) {
    config.maxHr = thresholds.hrMaxBpm
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
    /** Ambang per pasien dari Patient.hrMinBpm / hrMaxBpm (null = default sistem). */
    hrThresholds?: { hrMinBpm?: number | null; hrMaxBpm?: number | null }
  }
): Promise<AnomalyResult> {
  if (
    params.currentReading?.hrBpm === undefined ||
    params.currentReading.hrBpm === null ||
    !Number.isFinite(params.currentReading.hrBpm)
  ) {
    return { isAnomalous: false }
  }

  const baseConfig = anomalyRuleConfig()
  const patientConfig = patientHrThresholds(params.hrThresholds)
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
    select: {
      id: true,
      smartwatchEnabled: true,
      hrMinBpm: true,
      hrMaxBpm: true,
    },
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
      hrThresholds: { hrMinBpm: patient.hrMinBpm, hrMaxBpm: patient.hrMaxBpm },
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

    let emergencyAlert: any = undefined
    let escalationRun: any = undefined

    // 5. Jika terdeteksi anomali, picu EmergencyAlert + EscalationRun (CL-204 / AC-4.1)
    if (
      isAnomalous &&
      options?.triggerEmergency !== false &&
      Boolean((prisma as any).emergencyAlert)
    ) {
      const emergencyResult = await createEmergencyFromAnomaly(
        prisma as any,
        {
          patientId: input.patientId,
          hrBpm: input.hrBpm,
          triggeredAt: recordedAtUtc,
          anomalyReason,
        },
        options?.emergencyDeps,
      )
      emergencyAlert = emergencyResult.emergencyAlert
      escalationRun = emergencyResult.escalationRun
    }

    return {
      vitalSign,
      isDuplicate: false,
      emergencyAlert,
      escalationRun,
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

import { Prisma, type PrismaClient } from '@prisma/client'
import { VitalSource, type VitalIngestInput } from '@careloop/shared'
import { forbidden, notFound } from '../../lib/errors'

export type VitalsPrismaClient = Pick<PrismaClient, 'vitalSign' | 'patient'>

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
 * Ingest data tanda vital pasien (CL-201 / PRD §FR-4.2).
 * - Cek eligibilitas smartwatch pasien (AN-5).
 * - Sanitasi rawPayload (drop hardware device ID).
 * - Deduplikasi berbasis (patientId, source, recordedAt) agar idempoten (AN-6).
 * - Simpan waktu UTC.
 */
export async function ingestVitalSign(
  prisma: VitalsPrismaClient,
  input: VitalIngestInput
): Promise<IngestVitalResult> {
  // 1. Periksa keberadaan pasien dan status smartwatchEnabled (AN-5)
  const patient = await prisma.patient.findUnique({
    where: { id: input.patientId },
    select: { id: true, smartwatchEnabled: true },
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

  // 3. Simpan data vital baru ke database
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
        isAnomalous: false,
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

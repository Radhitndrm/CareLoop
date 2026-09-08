import { z } from 'zod'
import {
  ComplianceChannel,
  EscalationEventType,
  ExportStatus,
  FacilityType,
  Relationship,
  RiskLevel,
  VitalSource,
  FamilyTier,
} from '../enums'

/** Semua id domain adalah uuid v4 (docs/DATABASE.md §1) — termasuk data seed. */
export const uuidSchema = z.string().uuid()

/**
 * Login nakes/admin dengan kata sandi (docs/API.md §2).
 * Pasien & keluarga tidak lewat sini — mereka memakai OTP (CL-007).
 * Identifikasi boleh phone ATAU email, tepat salah satu.
 */
export const nakesLoginSchema = z
  .object({
    phone: z.string().trim().min(8).max(20).optional(),
    email: z.string().trim().email().optional(),
    password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(128),
  })
  .refine((input) => Boolean(input.phone) !== Boolean(input.email), {
    message: 'Isi salah satu: phone atau email',
    path: ['phone'],
  })
export type NakesLoginInput = z.infer<typeof nakesLoginSchema>

/** Nomor HP Indonesia: 08xxxxxxxxx atau +628xxxxxxxxx (docs/API.md §2). */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+62|62|0)8\d{7,12}$/, 'Nomor HP tidak valid (contoh: 081200000001)')

export const otpRequestSchema = z.object({ phone: phoneSchema })
export type OtpRequestInput = z.infer<typeof otpRequestSchema>

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().regex(/^\d{6}$/, 'Kode OTP terdiri dari 6 digit angka'),
})
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>

export const complianceConfirmSchema = z.object({
  scheduleId: uuidSchema,
  channel: z.nativeEnum(ComplianceChannel).default(ComplianceChannel.IN_APP),
})
export type ComplianceConfirmInput = z.infer<typeof complianceConfirmSchema>

export const complianceDeferSchema = z.object({
  scheduleId: uuidSchema,
  minutes: z.number().int().min(5).max(120).default(15),
})
export type ComplianceDeferInput = z.infer<typeof complianceDeferSchema>

export const emergencyPatientResponseSchema = z.object({
  response: z.enum(['SAFE', 'NEED_HELP']),
})
export type EmergencyPatientResponseInput = z.infer<typeof emergencyPatientResponseSchema>

export const escalationRespondSchema = z.object({
  response: z.enum(['HANDLE', 'LOOKING']),
  note: z.string().max(280).optional(),
})
export type EscalationRespondInput = z.infer<typeof escalationRespondSchema>

export const escalationEventSchema = z.nativeEnum(EscalationEventType)

export const createFamilyContactSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().regex(/^08\d{8,13}$/, 'Nomor HP harus format Indonesia (08...)'),
  relationship: z.nativeEnum(Relationship),
  tier: z.nativeEnum(FamilyTier),
  priority: z.number().int().min(1).max(99).default(1),
  isNearby: z.boolean().default(false),
  canViewHealth: z.boolean().default(false),
  canReceiveEmergency: z.boolean().default(true),
  consentGiven: z.boolean().default(true).optional(),
})
export type CreateFamilyContactInput = z.input<typeof createFamilyContactSchema>

export const updateFamilyContactSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().regex(/^08\d{8,13}$/, 'Nomor HP harus format Indonesia (08...)').optional(),
  relationship: z.nativeEnum(Relationship).optional(),
  tier: z.nativeEnum(FamilyTier).optional(),
  priority: z.number().int().min(1).max(99).optional(),
  isNearby: z.boolean().optional(),
  canViewHealth: z.boolean().optional(),
  canReceiveEmergency: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
export type UpdateFamilyContactInput = z.infer<typeof updateFamilyContactSchema>

export const createScheduleSchema = z.object({
  medicationId: uuidSchema,
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:mm'),
  /** ISO 1=Senin..7=Minggu. Array kosong / tidak diisi = setiap hari. */
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  dailyFrequency: z.number().int().min(1).max(6).default(1),
  doseQty: z.string().min(1).max(30),
  startDate: z.string().date(),
  timeWindowMinutes: z.number().int().min(5).max(240).default(30),
  isActive: z.boolean().default(true),
})
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>

export const vitalIngestSchema = z.object({
  patientId: uuidSchema,
  recordedAt: z.string().datetime(),
  source: z.nativeEnum(VitalSource),
  hrBpm: z.number().int().min(20).max(240).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  systolic: z.number().int().min(50).max(260).optional(),
  diastolic: z.number().int().min(30).max(160).optional(),
  rawPayload: z.record(z.unknown()).optional(),
})
export type VitalIngestInput = z.infer<typeof vitalIngestSchema>

export const exportJobSchema = z.object({
  format: z.enum(['CSV', 'JSON']).default('CSV'),
  filters: z
    .object({
      district: z.string().optional(),
      disease: z.string().optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    })
    .optional(),
})
export type ExportJobInput = z.infer<typeof exportJobSchema>

export const exportStatusSchema = z.nativeEnum(ExportStatus)

export const nearbyFacilityQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(1).max(50).default(10),
  type: z.nativeEnum(FacilityType).optional(),
})
export type NearbyFacilityQuery = z.infer<typeof nearbyFacilityQuerySchema>

export const riskPatientFilterSchema = z.object({
  district: z.string().optional(),
  disease: z.string().optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
})
export type RiskPatientFilter = z.infer<typeof riskPatientFilterSchema>

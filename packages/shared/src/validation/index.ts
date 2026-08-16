import { z } from 'zod'
import { EscalationEventType } from '../enums'

export const complianceConfirmSchema = z.object({
  scheduleId: z.string().uuid(),
  channel: z.enum(['MOBILE_APP', 'WHATSAPP']).default('MOBILE_APP'),
})
export type ComplianceConfirmInput = z.infer<typeof complianceConfirmSchema>

export const complianceDeferSchema = z.object({
  scheduleId: z.string().uuid(),
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
  relationship: z.enum([
    'ANAK',
    'PASANGAN',
    'SAUDARA',
    'CUCU',
    'TETANGGA',
    'KEPONAKAN',
    'LAINNYA',
  ]),
  tier: z.enum(['TIER_1', 'TIER_2']),
  priority: z.number().int().min(1).max(99).default(1),
  isNearby: z.boolean().default(false),
  canViewHealth: z.boolean().default(false),
  canReceiveEmergency: z.boolean().default(true),
})
export type CreateFamilyContactInput = z.infer<typeof createFamilyContactSchema>

export const createScheduleSchema = z.object({
  medicationId: z.string().uuid(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format HH:mm'),
  daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  doseQty: z.string().min(1).max(30),
  startDate: z.string().date(),
  timeWindowMinutes: z.number().int().min(5).max(240).default(30),
  isActive: z.boolean().default(true),
})
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>

export const vitalIngestSchema = z.object({
  patientId: z.string().uuid(),
  recordedAt: z.string().datetime(),
  source: z.enum(['GOOGLE_FIT', 'HEALTHKIT', 'MOCK']),
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

export const nearbyFacilityQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(1).max(50).default(10),
  type: z.enum(['PUSKESMAS', 'PUSKESMAS_PEMBANTU', 'RUMAH_SAKIT', 'KLINIK', 'APOTEK']).optional(),
})
export type NearbyFacilityQuery = z.infer<typeof nearbyFacilityQuerySchema>

export const riskPatientFilterSchema = z.object({
  district: z.string().optional(),
  disease: z.string().optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
})
export type RiskPatientFilter = z.infer<typeof riskPatientFilterSchema>

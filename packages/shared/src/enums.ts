export const UserRole = {
  PATIENT: 'PATIENT',
  FAMILY: 'FAMILY',
  NAKES: 'NAKES',
  ADMIN: 'ADMIN',
} as const
export type UserRole = (typeof UserRole)[keyof typeof UserRole]

export const LivingSituation = {
  ALONE: 'ALONE',
  WITH_FAMILY: 'WITH_FAMILY',
  FAR_FROM_FAMILY: 'FAR_FROM_FAMILY',
  OTHER: 'OTHER',
} as const
export type LivingSituation = (typeof LivingSituation)[keyof typeof LivingSituation]

export const Gender = { M: 'M', F: 'F' } as const
export type Gender = (typeof Gender)[keyof typeof Gender]

export const EmergencyPreference = {
  FAMILY_FIRST: 'FAMILY_FIRST',
  NAKES_FIRST: 'NAKES_FIRST',
} as const
export type EmergencyPreference = (typeof EmergencyPreference)[keyof typeof EmergencyPreference]

export const ComplianceStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CONFIRMED_LATE: 'CONFIRMED_LATE',
  MISSED: 'MISSED',
  TUNDA: 'TUNDA',
} as const
export type ComplianceStatus = (typeof ComplianceStatus)[keyof typeof ComplianceStatus]

export const VitalSource = {
  GOOGLE_FIT: 'GOOGLE_FIT',
  HEALTHKIT: 'HEALTHKIT',
  MOCK: 'MOCK',
} as const
export type VitalSource = (typeof VitalSource)[keyof typeof VitalSource]

export const EmergencyStatus = {
  PENDING_PATIENT_CONFIRM: 'PENDING_PATIENT_CONFIRM',
  ESCALATING: 'ESCALATING',
  RESOLVED_SAFE: 'RESOLVED_SAFE',
  HANDLED: 'HANDLED',
  TIMED_OUT: 'TIMED_OUT',
} as const
export type EmergencyStatus = (typeof EmergencyStatus)[keyof typeof EmergencyStatus]

export const EmergencyTrigger = {
  ANOMALY_HR: 'ANOMALY_HR',
  NO_RESPONSE_MED: 'NO_RESPONSE_MED',
  OTHER: 'OTHER',
} as const
export type EmergencyTrigger = (typeof EmergencyTrigger)[keyof typeof EmergencyTrigger]

export const EscalationContext = {
  SCHEDULE: 'SCHEDULE',
  EMERGENCY: 'EMERGENCY',
} as const
export type EscalationContext = (typeof EscalationContext)[keyof typeof EscalationContext]

export const EscalationRunStatus = {
  WAITING_PATIENT: 'WAITING_PATIENT',
  FAMILY_TIER_1: 'FAMILY_TIER_1',
  FAMILY_TIER_2: 'FAMILY_TIER_2',
  NAKES: 'NAKES',
  HANDLED: 'HANDLED',
  RESOLVED: 'RESOLVED',
  TIMED_OUT: 'TIMED_OUT',
} as const
export type EscalationRunStatus = (typeof EscalationRunStatus)[keyof typeof EscalationRunStatus]

export const EscalationTier = {
  TIER_1: 'TIER_1',
  TIER_2: 'TIER_2',
  NAKES: 'NAKES',
} as const
export type EscalationTier = (typeof EscalationTier)[keyof typeof EscalationTier]

export const FamilyTier = { TIER_1: 'TIER_1', TIER_2: 'TIER_2' } as const
export type FamilyTier = (typeof FamilyTier)[keyof typeof FamilyTier]

export const ResolutionType = {
  PATIENT_CONFIRMED: 'PATIENT_CONFIRMED',
  FAMILY_HANDLED: 'FAMILY_HANDLED',
  NAKES_HANDLED: 'NAKES_HANDLED',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
} as const
export type ResolutionType = (typeof ResolutionType)[keyof typeof ResolutionType]

export const Relationship = {
  ANAK: 'ANAK',
  PASANGAN: 'PASANGAN',
  SAUDARA: 'SAUDARA',
  CUCU: 'CUCU',
  TETANGGA: 'TETANGGA',
  KEPONAKAN: 'KEPONAKAN',
  LAINNYA: 'LAINNYA',
} as const
export type Relationship = (typeof Relationship)[keyof typeof Relationship]

export const NakesRole = {
  DOKTER: 'DOKTER',
  PERAWAT: 'PERAWAT',
  BIDAN: 'BIDAN',
  KADER: 'KADER',
  LAINNYA: 'LAINNYA',
} as const
export type NakesRole = (typeof NakesRole)[keyof typeof NakesRole]

export const Channel = {
  WHATSAPP: 'WHATSAPP',
  PUSH: 'PUSH',
  WEBSOCKET: 'WEBSOCKET',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
  VOICE: 'VOICE',
} as const
export type Channel = (typeof Channel)[keyof typeof Channel]

export const NotificationType = {
  REMINDER: 'REMINDER',
  ESCALATION: 'ESCALATION',
  EMERGENCY: 'EMERGENCY',
  REFILL: 'REFILL',
  EDUCATION: 'EDUCATION',
  SKRINING: 'SKRINING',
  RISK_UPDATE: 'RISK_UPDATE',
  OTHER: 'OTHER',
} as const
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType]

export const RiskLevel = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel]

export const ExportStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const
export type ExportStatus = (typeof ExportStatus)[keyof typeof ExportStatus]

export const FacilityType = {
  PUSKESMAS: 'PUSKESMAS',
  PUSKESMAS_PEMBANTU: 'PUSKESMAS_PEMBANTU',
  RUMAH_SAKIT: 'RUMAH_SAKIT',
  KLINIK: 'KLINIK',
  APOTEK: 'APOTEK',
} as const
export type FacilityType = (typeof FacilityType)[keyof typeof FacilityType]

export const ScreeningType = {
  DIABETES_RISK: 'DIABETES_RISK',
  HYPERTENSION: 'HYPERTENSION',
  GENERAL: 'GENERAL',
} as const
export type ScreeningType = (typeof ScreeningType)[keyof typeof ScreeningType]

export const MedicalForm = {
  TABLET: 'TABLET',
  KAPSUL: 'KAPSUL',
  SIRUP: 'SIRUP',
  INJEKSI: 'INJEKSI',
  LAINNYA: 'LAINNYA',
} as const
export type MedicalForm = (typeof MedicalForm)[keyof typeof MedicalForm]

export const NotificationStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
} as const
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus]

export const ReminderChannel = {
  WHATSAPP: 'WHATSAPP',
  PUSH: 'PUSH',
  VOICE: 'VOICE',
} as const
export type ReminderChannel = (typeof ReminderChannel)[keyof typeof ReminderChannel]

export const ReminderStatus = {
  SENT: 'SENT',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
} as const
export type ReminderStatus = (typeof ReminderStatus)[keyof typeof ReminderStatus]

export const EscalationStepResponse = {
  ACK_HANDLE: 'ACK_HANDLE',
  ACK_LOOKING: 'ACK_LOOKING',
  NONE: 'NONE',
} as const
export type EscalationStepResponse =
  (typeof EscalationStepResponse)[keyof typeof EscalationStepResponse]

export const ScreeningStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const
export type ScreeningStatus = (typeof ScreeningStatus)[keyof typeof ScreeningStatus]

export const MessageDirection = { IN: 'IN', OUT: 'OUT' } as const
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection]

export const NakesScopeType = {
  PUSKESMAS: 'PUSKESMAS',
  DISTRICT: 'DISTRICT',
  ALL: 'ALL',
} as const
export type NakesScopeType = (typeof NakesScopeType)[keyof typeof NakesScopeType]

// Subset Channel yang sah untuk konfirmasi kepatuhan (docs/DATABASE.md 3.8).
export const ComplianceChannel = {
  WHATSAPP: Channel.WHATSAPP,
  IN_APP: Channel.IN_APP,
  VOICE: Channel.VOICE,
} as const
export type ComplianceChannel = (typeof ComplianceChannel)[keyof typeof ComplianceChannel]

export const EscalationEventType = {
  PATIENT_CONFIRMED: 'PATIENT_CONFIRMED',
  TIMEOUT: 'TIMEOUT',
  FAMILY_HANDLED: 'FAMILY_HANDLED',
  NAKES_HANDLED: 'NAKES_HANDLED',
} as const
export type EscalationEventType = (typeof EscalationEventType)[keyof typeof EscalationEventType]

/** Action audit log yang wajib dicatat (docs/SECURITY.md §8.1). */
export const AuditAction = {
  AUTH_LOGIN: 'auth.login',
  AUTH_OTP_REQUEST: 'auth.otp.request',
  AUTH_OTP_VERIFY: 'auth.otp.verify',
  AUTH_REFRESH: 'auth.refresh',
  PATIENT_CREATED: 'patient.created',
  PATIENT_UPDATED: 'patient.updated',
  PATIENT_CONSENT_GIVEN: 'patient.consent.given',
  FAMILY_CONTACT_ADDED: 'family_contact.added',
  FAMILY_CONTACT_UPDATED: 'family_contact.updated',
  FAMILY_CONTACT_REMOVED: 'family_contact.removed',
  COMPLIANCE_CONFIRMED: 'compliance.confirmed',
  COMPLIANCE_DEFERRED: 'compliance.deferred',
  REMINDER_SENT: 'reminder.sent',
  REMINDER_FAILED: 'reminder.failed',
  EMERGENCY_TRIGGERED: 'emergency.triggered',
  EMERGENCY_RESOLVED: 'emergency.resolved',
  ESCALATION_STEP: 'escalation.step',
  ESCALATION_HANDLED: 'escalation.handled',
  EXPORT_JOB_CREATED: 'export.job.created',
  EXPORT_DOWNLOADED: 'export.downloaded',
} as const
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction]

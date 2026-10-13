export const UserRole = {
  PATIENT: 'PATIENT',
  FAMILY: 'FAMILY',
  NAKES: 'NAKES',
  ADMIN: 'ADMIN',
} as const
export type UserRole = (typeof UserRole)[keyof typeof UserRole]

/**
 * Lifecycle operasional pasien (docs/DATABASE.md §3.2).
 *
 * Hanya `ACTIVE` yang boleh masuk scheduler reminder/eskalasi. Pasien `ONBOARDING`
 * berarti data masih dikumpulkan — ia tidak boleh menerima pesan apa pun sebelum
 * seluruh prasyarat aktivasi terpenuhi (lihat `patients/activation.ts`).
 */
export const PatientStatus = {
  /** Terdaftar, onboarding belum selesai. Tidak menerima pesan apa pun. */
  ONBOARDING: 'ONBOARDING',
  /** Seluruh prasyarat terpenuhi; reminder dan eskalasi berjalan. */
  ACTIVE: 'ACTIVE',
  /** Ditangguhkan secara sukarela, misalnya sedang beristirahat di luar wilayah. */
  INACTIVE: 'INACTIVE',
  /** Diblokir karena alasan klinis atau administratif. */
  BLOCKED: 'BLOCKED',
} as const
export type PatientStatus = (typeof PatientStatus)[keyof typeof PatientStatus]

/** Status yang boleh diproses scheduler. Satu-satunya adalah `ACTIVE`. */
export const SCHEDULABLE_PATIENT_STATUSES: readonly PatientStatus[] = [PatientStatus.ACTIVE]

export function isSchedulablePatientStatus(status: string): boolean {
  return SCHEDULABLE_PATIENT_STATUSES.includes(status as PatientStatus)
}

/**
 * Lifecycle akun tenaga kesehatan (docs/DATABASE.md §3.1).
 *
 * Hanya `ACTIVE` yang boleh login. `INVITED` berarti admin sudah membuat akun tapi
 * staf belum mengaktifkan diri lewat kode sekali pakai. `SUSPENDED` untuk staf yang
 * sedang cuti atau dalam pemeriksaan, `DEACTIVATED` untuk staf yang berhenti.
 *
 * Hanya relevan untuk role NAKES — akun pasien dan keluarga tidak punya status staf.
 */
export const StaffStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DEACTIVATED: 'DEACTIVATED',
} as const
export type StaffStatus = (typeof StaffStatus)[keyof typeof StaffStatus]

export const LOGINABLE_STAFF_STATUSES: readonly StaffStatus[] = [StaffStatus.ACTIVE]

export function isLoginableStaffStatus(status: string | null | undefined): boolean {
  // null = akun lama yang belum pernah diberi status; dianggap aktif agar migrasi
  // tidak mengunci akun yang sedang dipakai.
  if (status === null || status === undefined) return true
  return LOGINABLE_STAFF_STATUSES.includes(status as StaffStatus)
}

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
  FARMASI: 'FARMASI',
  LAINNYA: 'LAINNYA',
} as const
export type NakesRole = (typeof NakesRole)[keyof typeof NakesRole]

/**
 * NakesRole yang berwenang menetapkan keputusan klinis: menyetujui resep dan
 * menetapkan ambang detak jantung (docs/API.md §3.2). BIDAN termasuk karena
 * prescribing berada di dalam lingkup praktik kebidanan.
 */
export const PRESCRIBING_NAKES_ROLES = [NakesRole.DOKTER, NakesRole.BIDAN] as const
export function isPrescribingNakesRole(role: NakesRole | null | undefined): boolean {
  if (!role) return false
  return (PRESCRIBING_NAKES_ROLES as readonly NakesRole[]).includes(role)
}

/**
 * NakesRole yang berwenang menjalankan alur farmasi: menyiapkan, menandai siap,
 * dan menyerahkan obat (docs/API.md §3.6). FARMASI **tidak** boleh menyetujui
 * permintaan obat maupun mengubah resep — itu keputusan klinis dokter/bidan.
 */
export const PHARMACY_NAKES_ROLES = [NakesRole.FARMASI] as const
export function isPharmacyNakesRole(role: NakesRole | null | undefined): boolean {
  if (!role) return false
  return (PHARMACY_NAKES_ROLES as readonly NakesRole[]).includes(role)
}

/** Tahap persetujuan resep. Hanya APPROVED yang boleh berjalan (reminder/eskalasi). */
export const MedicationStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const
export type MedicationStatus = (typeof MedicationStatus)[keyof typeof MedicationStatus]

/**
 * Asal permintaan obat. ROUTINE dibuat otomatis oleh scheduler ketika
 * `medications.nextPickupAt` mendekati jatuh tempo — persetujuan dokter sudah
 * melekat pada resepnya, jadi tidak perlu gate kedua. PATIENT_REQUEST adalah
 * permintaan di luar jadwal (ambil lebih awal, obat hilang/rusak, tambahan)
 * yang wajib lewat persetujuan dokter dulu (docs/API.md §3.6).
 */
export const MedicationRequestSource = {
  ROUTINE: 'ROUTINE',
  PATIENT_REQUEST: 'PATIENT_REQUEST',
} as const
export type MedicationRequestSource = (typeof MedicationRequestSource)[keyof typeof MedicationRequestSource]

/**
 * Status permintaan obat. `OVERDUE` sengaja TIDAK menjadi status tersimpan:
 * keterlambatan adalah kondisi turunan dari `dueAt` vs status aktif, sehingga
 * status asli (sudah disiapkan atau belum) tidak hilang saat tanggal lewat.
 * Lihat `isOverdue` di modules/pharmacy/pharmacy.service.ts.
 */
export const MedicationRequestStatus = {
  PENDING_DOCTOR: 'PENDING_DOCTOR',
  QUEUED: 'QUEUED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  DISPENSED: 'DISPENSED',
  REJECTED: 'REJECTED',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SUBSTITUTED: 'SUBSTITUTED',
} as const
export type MedicationRequestStatus = (typeof MedicationRequestStatus)[keyof typeof MedicationRequestStatus]

/**
 * Status yang masih bisa dioperasikan farmasi atau menunggu waktu pengambilan.
 */
export const ACTIVE_MEDICATION_REQUEST_STATUSES = [
  MedicationRequestStatus.PENDING_DOCTOR,
  MedicationRequestStatus.QUEUED,
  MedicationRequestStatus.PREPARING,
  MedicationRequestStatus.READY,
] as const

/**
 * Alasan pasien mengajukan permintaan di luar jadwal. MEDICATION_LOST dan
 * DAMAGED sebaiknya disertai catatan bebas agar apotek/dokter bisa menilai.
 */
export const MedicationRequestReason = {
  EARLY_PICKUP: 'EARLY_PICKUP',
  MEDICATION_LOST: 'MEDICATION_LOST',
  DAMAGED: 'DAMAGED',
  EXTRA: 'EXTRA',
  OTHER: 'OTHER',
} as const
export type MedicationRequestReason = (typeof MedicationRequestReason)[keyof typeof MedicationRequestReason]

/**
 * Aksi pada state machine permintaan obat. `CREATED` hanya untuk audit trail
 * baris pertama — bukan transisi antar-status (docs/API.md §3.6).
 */
export const MedicationRequestAction = {
  CREATED: 'CREATED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  START_PREPARING: 'START_PREPARING',
  MARK_READY: 'MARK_READY',
  DISPENSED: 'DISPENSED',
  MARK_OUT_OF_STOCK: 'MARK_OUT_OF_STOCK',
  MARK_SUBSTITUTED: 'MARK_SUBSTITUTED',
  RETURNED_TO_QUEUE: 'RETURNED_TO_QUEUE',
} as const
export type MedicationRequestAction = (typeof MedicationRequestAction)[keyof typeof MedicationRequestAction]

/** Alasan wajib untuk penolakan, stok kosong, dan penggantian obat. */
export const BLOCKED_REASON_MIN_LENGTH = 5

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
  PATIENT_STATUS_CHANGED: 'patient.status.changed',
  PATIENT_ACTIVATED: 'patient.activated',
  PATIENT_DEACTIVATED: 'patient.deactivated',
  PATIENT_CONSENT_GIVEN: 'patient.consent.given',
  PATIENT_HR_THRESHOLD_SET: 'patient.hr_threshold.set',
  FAMILY_CONTACT_ADDED: 'family_contact.added',
  FAMILY_CONTACT_UPDATED: 'family_contact.updated',
  FAMILY_CONTACT_REMOVED: 'family_contact.removed',
  MEDICATION_DRAFTED: 'medication.drafted',
  MEDICATION_APPROVED: 'medication.approved',
  MEDICATION_REJECTED: 'medication.rejected',
  SCHEDULE_CREATED: 'schedule.created',
  SCHEDULE_APPROVED: 'schedule.approved',
  MEDICATION_REQUEST_CREATED: 'medication_request.created',
  MEDICATION_REQUEST_APPROVED: 'medication_request.approved',
  MEDICATION_REQUEST_REJECTED: 'medication_request.rejected',
  MEDICATION_REQUEST_PREPARING: 'medication_request.preparing',
  MEDICATION_REQUEST_READY: 'medication_request.ready',
  MEDICATION_REQUEST_DISPENSED: 'medication_request.dispensed',
  MEDICATION_REQUEST_OUT_OF_STOCK: 'medication_request.out_of_stock',
  MEDICATION_REQUEST_SUBSTITUTED: 'medication_request.substituted',
  MEDICATION_REQUEST_GENERATED: 'medication_request.generated',
  DISPENSING_RECORD_CREATED: 'dispensing_record.created',
  NAKES_CONTACT_ADDED: 'nakes_contact.added',
  NAKES_CONTACT_REMOVED: 'nakes_contact.removed',
  NAKES_ACCOUNT_CREATED: 'nakes_account.created',
  NAKES_ACCOUNT_UPDATED: 'nakes_account.updated',
  NAKES_ACCOUNT_INVITED: 'nakes_account.invited',
  NAKES_ACCOUNT_ACTIVATED: 'nakes_account.activated',
  NAKES_ACCOUNT_STATUS_CHANGED: 'nakes_account.status.changed',
  NAKES_ASSIGNMENT_CREATED: 'nakes_assignment.created',
  NAKES_ASSIGNMENT_ENDED: 'nakes_assignment.ended',
  PUSKESMAS_CREATED: 'puskesmas.created',
  PUSKESMAS_UPDATED: 'puskesmas.updated',
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

import { z } from 'zod'
import {
  ComplianceChannel,
  ComplianceStatus,
  EmergencyPreference,
  EscalationEventType,
  ExportStatus,
  FacilityType,
  Gender,
  LivingSituation,
  MedicalForm,
  NakesRole,
  Relationship,
  RiskLevel,
  StaffStatus,
  VitalSource,
  FamilyTier,
  BLOCKED_REASON_MIN_LENGTH,
  MedicationRequestAction,
  MedicationRequestReason,
  MedicationRequestSource,
  MedicationRequestStatus,
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
  notes: z.string().max(280).optional(),
  locationLat: z.number().min(-90).max(90).optional(),
  locationLng: z.number().min(-180).max(180).optional(),
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
export type CreateScheduleInput = z.input<typeof createScheduleSchema>

// ---------------------------------------------------------------- pasien & klinis

/**
 * Pendaftaran pasien oleh nakes (Tahap 1 alur, docs/API.md §3.1).
 * NAKES wajib memilih puskesmas penugasan; ADMIN boleh patients yang punya districtCode.
 */
export const createPatientSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  nik: z
    .string()
    .trim()
    .regex(/^\d{16}$/, 'NIK harus 16 digit angka')
    .optional(),
  dateOfBirth: z.string().date().optional(),
  gender: z.nativeEnum(Gender).optional(),
  address: z.string().trim().max(300).optional(),
  districtCode: z.string().trim().min(1).max(20),
  puskesmasId: uuidSchema,
  city: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  livingSituation: z.nativeEnum(LivingSituation).default(LivingSituation.WITH_FAMILY),
  hasNearbyFamily: z.boolean().default(true),
  emergencyPreference: z
    .nativeEnum(EmergencyPreference)
    .default(EmergencyPreference.FAMILY_FIRST),
  /** Riwayat penyakit — dipakai juga untuk filter dashboard per penyakit. */
  healthConditions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  bpjsNumber: z.string().trim().max(30).optional(),
  voiceEnabled: z.boolean().default(false),
  smartwatchEnabled: z.boolean().default(false),
  consentShareWithNakes: z.boolean().default(true),
})
export type CreatePatientInput = z.input<typeof createPatientSchema>

export const updatePatientSchema = z.object({
  address: z.string().trim().max(300).optional(),
  districtCode: z.string().trim().min(1).max(20).optional(),
  livingSituation: z.nativeEnum(LivingSituation).optional(),
  hasNearbyFamily: z.boolean().optional(),
  emergencyPreference: z.nativeEnum(EmergencyPreference).optional(),
  healthConditions: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  voiceEnabled: z.boolean().optional(),
  smartwatchEnabled: z.boolean().optional(),
  consentShareWithNakes: z.boolean().optional(),
})
export type UpdatePatientInput = z.input<typeof updatePatientSchema>

/**
 * Ambang detak jantung individual — keputusan klinis, hanya DOKTER/BIDAN
 * (docs/API.md §3.4). Null berarti kembali ke default sistem (env).
 */
export const hrThresholdsSchema = z
  .object({
    hrMinBpm: z.number().int().min(20).max(200).nullable().optional(),
    hrMaxBpm: z.number().int().min(21).max(240).nullable().optional(),
  })
  .refine(
    (input) =>
      input.hrMinBpm == null ||
      input.hrMaxBpm == null ||
      input.hrMinBpm < input.hrMaxBpm,
    { message: 'hrMinBpm harus lebih kecil dari hrMaxBpm', path: ['hrMinBpm'] },
  )
export type HrThresholdsInput = z.input<typeof hrThresholdsSchema>

/** Draft resep oleh perawat/bidan (Tahap 2 alur, docs/API.md §3.2). */
export const createMedicationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  genericName: z.string().trim().max(120).optional(),
  dosage: z.string().trim().max(80).optional(),
  form: z.nativeEnum(MedicalForm).default(MedicalForm.TABLET),
  instructions: z.string().trim().max(500).optional(),
  startedAt: z.string().date(),
  endedAt: z.string().date().optional(),
  /**
   * Jatah obat dalam satuan hari per pengambilan (docs/API.md §3.6).
   * Dipakai scheduler untuk membuat permintaan rutin otomatis dan memvalidasi
   * jumlah yang diminta pasien. Kosong = pakai PHARMACY_DEFAULT_DAYS_SUPPLY.
   */
  daysSupply: z.number().int().min(1).max(365).optional(),
})
export type CreateMedicationInput = z.input<typeof createMedicationSchema>

export const approveMedicationSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(280).optional(),
})
export type ApproveMedicationInput = z.input<typeof approveMedicationSchema>

// ---------------------------------------------------------------- puskesmas & staf

/**
 * Create puskesmas (docs/API.md §3.16). Dipakai admin pusat; UUID tidak pernah
 * diinput operator — form web mencarinya dari daftar, bukan mengetik.
 */
export const createPuskesmasSchema = z.object({
  name: z.string().trim().min(3, 'Nama puskesmas minimal 3 karakter').max(150),
  type: z.nativeEnum(FacilityType).default(FacilityType.PUSKESMAS),
  districtCode: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(20).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  isActive: z.boolean().default(true),
})
export type CreatePuskesmasInput = z.input<typeof createPuskesmasSchema>

/** Update puskesmas; seluruh field opsional (PATCH semantik). */
export const updatePuskesmasSchema = createPuskesmasSchema.partial()
export type UpdatePuskesmasInput = z.input<typeof updatePuskesmasSchema>

/**
 * Penugasan wilayah staf. Setidaknya satu dari puskesmasId / districtCode wajib,
 * karena staf tanpa penugasan tidak boleh melihat pasien sama sekali.
 */
export const nakesAssignmentSchema = z
  .object({
    puskesmasId: uuidSchema.optional(),
    districtCode: z.string().trim().min(1).max(20).optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((input) => Boolean(input.puskesmasId) !== Boolean(input.districtCode), {
    message: 'Isi tepat satu: puskesmasId atau districtCode',
    path: ['puskesmasId'],
  })
export type NakesAssignmentInput = z.input<typeof nakesAssignmentSchema>

/**
 * Undangan staf. Dua jalur pembuatan akun:
 *   - `password` diisi   -> langsung ACTIVE, untuk seed atau admin yang sudah cukup
 *   - `password` kosong  -> INVITED, sistem mengembalikan kode aktivasi sekali pakai
 */
export const inviteNakesAccountSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().regex(/^08\d{8,13}$/, 'Nomor HP harus format Indonesia (08...)'),
  email: z.string().trim().email().optional(),
  nakesRole: z.nativeEnum(NakesRole),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(128).optional(),
  assignments: z.array(nakesAssignmentSchema).default([]),
})
export type InviteNakesAccountInput = z.input<typeof inviteNakesAccountSchema>

/** Ubah peran klinis / status staf oleh admin. Tidak pernah self-service. */
export const updateNakesAccountSchema = z.object({
  nakesRole: z.nativeEnum(NakesRole).optional(),
  staffStatus: z
    .nativeEnum(StaffStatus)
    .refine((value) => value !== StaffStatus.INVITED, {
      message: 'Untuk memindahkan staf ke INVITED, buat ulang undangan',
    })
    .optional(),
  reason: z.string().trim().max(200).optional(),
})
export type UpdateNakesAccountInput = z.input<typeof updateNakesAccountSchema>

/** Aktivasi akun staf invited dengan kode sekali pakai. */
export const staffActivationSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^[0-9]{6}$/, 'Kode aktivasi terdiri dari 6 digit angka'),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(128),
})
export type StaffActivationInput = z.input<typeof staffActivationSchema>

export const createNakesContactSchema = z.object({
  nakesName: z.string().trim().min(2).max(120),
  nakesUserId: uuidSchema.optional(),
  nakesRole: z.nativeEnum(NakesRole).default(NakesRole.PERAWAT),
  phone: z.string().regex(/^08\d{8,13}$/, 'Nomor HP harus format Indonesia (08...)'),
  puskesmasId: uuidSchema.optional(),
  isPrimary: z.boolean().default(false),
})
export type CreateNakesContactInput = z.input<typeof createNakesContactSchema>

/** Query timeline kepatuhan yang dilihat perawat/dokter (docs/API.md §3.3). */
export const complianceListQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z.nativeEnum(ComplianceStatus).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type ComplianceListQueryInput = z.infer<typeof complianceListQuerySchema>

/** Query pengecekan duplikasi sebelum mendaftarkan pasien baru (Fase C). */
export const patientLookupQuerySchema = z.object({
  phone: phoneSchema.optional(),
  nik: z.string().trim().regex(/^\d{16}$/, 'NIK terdiri dari 16 digit angka').optional(),
})
export type PatientLookupQueryInput = z.infer<typeof patientLookupQuerySchema>

export const patientListQuerySchema = z.object({
  district: z.string().trim().max(20).optional(),
  disease: z.string().trim().max(80).optional(),
  livingSituation: z.nativeEnum(LivingSituation).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type PatientListQueryInput = z.input<typeof patientListQuerySchema>

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

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((val) => (val === '' ? undefined : val))
  .optional()

const optionalDateString = z
  .string()
  .trim()
  .transform((val) => (val === '' ? undefined : val))
  .refine((val) => val === undefined || !Number.isNaN(Date.parse(val)), {
    message: 'Format tanggal tidak valid (YYYY-MM-DD atau ISO string)',
  })
  .optional()

export const dashboardFilterSchema = z
  .object({
    district: optionalTrimmedString,
    disease: optionalTrimmedString,
    from: optionalDateString,
    to: optionalDateString,
    escalationStatus: optionalTrimmedString,
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to)
      }
      return true
    },
    {
      message: 'Rentang tanggal tidak valid (from harus <= to)',
      path: ['to'],
    },
  )
export type DashboardFilterInput = z.infer<typeof dashboardFilterSchema>

/**
 * Filter work queue (Fase F): sama seperti dashboard, ditambah pilihan puskesmas dan
 * batas item per kelompok supaya respons tetap ringan di koneksi puskesmas yang lambat.
 */
export const workQueueFilterSchema = z
  .object({
    district: optionalTrimmedString,
    disease: optionalTrimmedString,
    from: optionalDateString,
    to: optionalDateString,
    escalationStatus: optionalTrimmedString,
    clinicId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) return new Date(data.from) <= new Date(data.to)
      return true
    },
    {
      message: 'Rentang tanggal tidak valid (from harus <= to)',
      path: ['to'],
    },
  )
export type WorkQueueFilterInput = z.infer<typeof workQueueFilterSchema>



// ---------------------------------------------------------------- farmasi (obatku)

/**
 * Permintaan obat oleh pasien di luar jadwal rutin (docs/API.md §3.6).
 * `patientId` sengaja TIDAK ada di body — diambil dari claim JWT, sehingga
 * pasien tidak pernah bisa mengajukan untuk orang lain.
 */
export const createMedicationRequestSchema = z
  .object({
    medicationId: uuidSchema,
    /** Jatah dalam satuan hari, mengikuti `medications.daysSupply` bila diisi. */
    requestedQuantity: z.number().int().min(1).max(365),
    reasonCode: z.nativeEnum(MedicationRequestReason),
    reasonNotes: z.string().trim().max(500).optional(),
  })
  .refine((input) => input.reasonCode !== MedicationRequestReason.OTHER || Boolean(input.reasonNotes), {
    message: 'Catatan alasan wajib diisi bila alasan "Lainnya"',
    path: ['reasonNotes'],
  })
export type CreateMedicationRequestInput = z.infer<typeof createMedicationRequestSchema>

/**
 * Keputusan dokter atas permintaan obat (docs/API.md §3.6).
 * `approvedQuantity` boleh diubah dokter dari jumlah yang diminta; `note`
 * wajib saat menolak karena alasan itu dikirim ke pasien & keluarga.
 */
export const medicationRequestDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    approvedQuantity: z.number().int().min(1).max(365).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((input) => input.decision !== 'REJECTED' || Boolean(input.note), {
    message: 'Alasan wajib diisi saat menolak permintaan obat',
    path: ['note'],
  })
export type MedicationRequestDecisionInput = z.infer<typeof medicationRequestDecisionSchema>

/**
 * Aksi farmasi atas antrean obat (docs/API.md §3.6). `reason` wajib untuk
 * stok kosong & penggantian; `quantityDays` wajib untuk penyerahan.
 *
 * Tidak ada flag "setujui dulu" untuk penggantian: apotek tidak pernah boleh
 * mengesahkan penggantian obat sendiri — itu keputusan dokter (PATCH
 * /v1/medications/:id). Karena itu `isSubstituteApproved` selalu false di
 * awal dan hanya bisa diubah oleh dokter.
 */
export const medicationRequestStatusSchema = z
  .object({
    action: z.nativeEnum(MedicationRequestAction),
    reason: z.string().trim().min(BLOCKED_REASON_MIN_LENGTH).max(500).optional(),
    substituteName: z.string().trim().min(2).max(120).optional(),
    quantityDays: z.number().int().min(1).max(365).optional(),
  })
  .superRefine((input, ctx) => {
    if (
      (input.action === MedicationRequestAction.MARK_OUT_OF_STOCK ||
        input.action === MedicationRequestAction.MARK_SUBSTITUTED) &&
      !input.reason
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Alasan wajib diisi untuk stok kosong atau penggantian obat',
      })
    }
    if (input.action === MedicationRequestAction.MARK_SUBSTITUTED && !input.substituteName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['substituteName'],
        message: 'Nama obat pengganti wajib diisi',
      })
    }
    if (input.action === MedicationRequestAction.DISPENSED && !input.quantityDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantityDays'],
        message: 'Jumlah hari jatah wajib diisi saat menyerahkan obat',
      })
    }
  })
// z.input, bukan z.infer: schema punya default (needsDoctorApproval), dan
// service dipanggil dari test/pemanggil internal yang tidak selalu mengirim
// field tersebut.
export type MedicationRequestStatusInput = z.input<typeof medicationRequestStatusSchema>

/** Filter antrean farmasi & daftar permintaan menunggu dokter (docs/API.md §3.6). */
export const medicationRequestQuerySchema = z.object({
  status: z.nativeEnum(MedicationRequestStatus).optional(),
  source: z.nativeEnum(MedicationRequestSource).optional(),
  patientId: uuidSchema.optional(),
  search: z.string().trim().max(120).optional(),
  overdue: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type MedicationRequestQueryInput = z.infer<typeof medicationRequestQuerySchema>

/** Riwayat penyerahan obat — pencarian per pasien dan rentang tanggal (docs/API.md §3.6). */
export const dispensingRecordQuerySchema = z
  .object({
    patientId: uuidSchema.optional(),
    search: z.string().trim().max(120).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: 'Rentang tanggal tidak valid (from harus <= to)',
    path: ['to'],
  })
export type DispensingRecordQueryInput = z.infer<typeof dispensingRecordQuerySchema>

/**
 * Penyesuaian resep oleh dokter setelah farmasi menandai obat diganti
 * (docs/API.md §3.6). Hanya dokter/bidan — apotek tidak boleh mengubah resep.
 */
export const medicationSubstitutionSchema = z.object({
  substituteApproved: z.boolean(),
  instruction: z.string().trim().max(500).optional(),
})
export type MedicationSubstitutionInput = z.infer<typeof medicationSubstitutionSchema>

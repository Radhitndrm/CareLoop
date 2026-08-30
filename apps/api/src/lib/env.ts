// Konfigurasi runtime terpusat (CL-005).
// Semua nilai configurable dibaca di sini — jangan hardcode timeout/threshold di dalam fungsi.
// Default timeout mengikuti docs/PRD.md (FR-3.1, FR-4.3, FR-7.2).
import 'dotenv/config'
import { z } from 'zod'

const csvList = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )

const seconds = (fallback: number) => z.coerce.number().int().min(1).max(86_400).default(fallback)

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),

    // Database
    DATABASE_URL: z.string().min(1, 'DATABASE_URL wajib diisi'),
    /** Koneksi langsung (non-pooler) untuk prisma migrate — dipakai Supabase. */
    DIRECT_URL: z.string().optional(),
    /** DB khusus integration test; wajib berbeda dari DATABASE_URL. */
    TEST_DATABASE_URL: z.string().optional(),

    // Queue & cache
    REDIS_URL: z.string().optional(),

    // Auth & kripto
    JWT_SECRET: z.string().min(32, 'JWT_SECRET minimal 32 karakter'),
    JWT_EXPIRES_IN: z.string().default('24h'),
    DATA_ENCRYPTION_KEY: z.string().optional(),

    // Integrasi keluar. PROVIDER_MODE=mock dipakai saat demo/offline.
    PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
    WHATSAPP_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_ID: z.string().optional(),
    WA_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WA_APP_SECRET: z.string().optional(),

    // HTTP
    CORS_ORIGINS: csvList,
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    // Waktu — backend selalu UTC, offset ini hanya default tampilan pasien (WIB).
    TZ_OFFSET: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/, 'TZ_OFFSET harus berformat +07:00')
      .default('+07:00'),

    // Timeout eskalasi (detik) — AGENTS.md §2: wajib configurable, bukan hardcode.
    ESCALATION_PATIENT_WAIT_SEC: seconds(1800), // FR-3.1 default 30 menit
    ESCALATION_FAMILY_TIER1_WAIT_SEC: seconds(900), // FR-7.2 default 15 menit
    ESCALATION_FAMILY_TIER2_WAIT_SEC: seconds(900), // FR-7.2 default 15 menit
    ESCALATION_NAKES_WAIT_SEC: seconds(1800),
    /** FR-4.3: konfirmasi pasien saat anomali darurat — spesifikasi 30–60 detik. */
    EMERGENCY_PATIENT_CONFIRM_SEC: z.coerce.number().int().min(30).max(60).default(45),
    /** FR-2.4: opsi "tunda". */
    COMPLIANCE_DEFER_MINUTES: z.coerce.number().int().min(5).max(120).default(15),

    // Aturan anomali HR (FR-4.2) — rule-based, bukan ML.
    ANOMALY_HR_MIN: z.coerce.number().int().min(20).max(200).default(50),
    ANOMALY_HR_MAX: z.coerce.number().int().min(21).max(240).default(120),
    ANOMALY_WINDOW_SEC: seconds(60),
  })
  .superRefine((value, ctx) => {
    if (value.ANOMALY_HR_MIN >= value.ANOMALY_HR_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANOMALY_HR_MIN'],
        message: 'ANOMALY_HR_MIN harus lebih kecil dari ANOMALY_HR_MAX',
      })
    }

    if (value.PROVIDER_MODE === 'live') {
      for (const key of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WA_WEBHOOK_VERIFY_TOKEN'] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} wajib diisi saat PROVIDER_MODE=live`,
          })
        }
      }
    }

    if (value.NODE_ENV === 'production' && value.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS wajib diisi di production (whitelist domain frontend)',
      })
    }

    if (value.TEST_DATABASE_URL && value.TEST_DATABASE_URL === value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TEST_DATABASE_URL'],
        message: 'TEST_DATABASE_URL harus berbeda dari DATABASE_URL',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

export class EnvValidationError extends Error {
  constructor(readonly issues: Array<{ key: string; message: string }>) {
    super(
      `Konfigurasi environment tidak valid:\n${issues
        .map((issue) => `  - ${issue.key}: ${issue.message}`)
        .join('\n')}`,
    )
    this.name = 'EnvValidationError'
  }
}

/** Memvalidasi sumber env. Melempar EnvValidationError dengan pesan yang bisa dibaca manusia. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (parsed.success) return parsed.data

  throw new EnvValidationError(
    parsed.error.issues.map((issue) => ({
      key: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  )
}

function loadEnv(): Env {
  try {
    return parseEnv()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    console.error('Periksa apps/api/.env — contoh lengkap ada di apps/api/.env.example')
    process.exit(1)
  }
}

export const env = loadEnv()

/** Timeout state machine eskalasi dalam milidetik (scheduler memakai ms). */
export const escalationTimeoutsMs = {
  waitingPatient: env.ESCALATION_PATIENT_WAIT_SEC * 1000,
  familyTier1: env.ESCALATION_FAMILY_TIER1_WAIT_SEC * 1000,
  familyTier2: env.ESCALATION_FAMILY_TIER2_WAIT_SEC * 1000,
  nakes: env.ESCALATION_NAKES_WAIT_SEC * 1000,
  emergencyPatientConfirm: env.EMERGENCY_PATIENT_CONFIRM_SEC * 1000,
} as const

/** Konfigurasi aturan anomali HR untuk evaluateAnomaly(). */
export const anomalyRuleConfig = {
  minHr: env.ANOMALY_HR_MIN,
  maxHr: env.ANOMALY_HR_MAX,
  windowMs: env.ANOMALY_WINDOW_SEC * 1000,
} as const

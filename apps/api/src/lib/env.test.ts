// CL-005: env terpusat harus menolak konfigurasi tidak valid dengan pesan jelas.
import { afterEach, describe, expect, it } from 'vitest'
import { EnvValidationError, getEnv, parseEnv, resetEnvCache } from './env'

const VALID = {
  DATABASE_URL: 'postgresql://careloop:careloop@localhost:5432/careloop?schema=public',
  JWT_SECRET: 'x'.repeat(32),
} satisfies NodeJS.ProcessEnv

function parse(overrides: NodeJS.ProcessEnv = {}) {
  return parseEnv({ ...VALID, ...overrides })
}

function issuesOf(overrides: NodeJS.ProcessEnv): Array<{ key: string; message: string }> {
  try {
    parse(overrides)
  } catch (err) {
    if (err instanceof EnvValidationError) return err.issues
    throw err
  }
  throw new Error('parseEnv seharusnya melempar EnvValidationError')
}

describe('parseEnv — konfigurasi minimal', () => {
  it('memakai default sesuai PRD saat var opsional kosong', () => {
    const env = parse()
    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(4000)
    expect(env.PROVIDER_MODE).toBe('mock')
    expect(env.TZ_OFFSET).toBe('+07:00')
    expect(env.RATE_LIMIT_MAX).toBe(120)
    expect(env.ESCALATION_PATIENT_WAIT_SEC).toBe(1800) // FR-3.1: 30 menit
    expect(env.ESCALATION_FAMILY_TIER1_WAIT_SEC).toBe(900) // FR-7.2: 15 menit
    expect(env.EMERGENCY_PATIENT_CONFIRM_SEC).toBe(45) // FR-4.3: 30–60 detik
    expect(env.ANOMALY_HR_MIN).toBe(50)
    expect(env.ANOMALY_HR_MAX).toBe(120)
  })

  it('mengubah CORS_ORIGINS menjadi array yang dirapikan', () => {
    expect(parse({ CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([])
    expect(parse({ CORS_ORIGINS: 'http://a.test, http://b.test ,' }).CORS_ORIGINS).toEqual([
      'http://a.test',
      'http://b.test',
    ])
  })

  it('mengubah angka dari string env menjadi number', () => {
    const env = parse({ PORT: '5000', ESCALATION_FAMILY_TIER1_WAIT_SEC: '600' })
    expect(env.PORT).toBe(5000)
    expect(env.ESCALATION_FAMILY_TIER1_WAIT_SEC).toBe(600)
  })
})

describe('parseEnv — env invalid ditolak dengan pesan jelas', () => {
  it('DATABASE_URL kosong', () => {
    expect(issuesOf({ DATABASE_URL: '' })).toEqual([
      { key: 'DATABASE_URL', message: 'DATABASE_URL wajib diisi' },
    ])
  })

  it('JWT_SECRET terlalu pendek', () => {
    expect(issuesOf({ JWT_SECRET: 'pendek' })).toEqual([
      { key: 'JWT_SECRET', message: 'JWT_SECRET minimal 32 karakter' },
    ])
  })

  it('TZ_OFFSET salah format', () => {
    expect(issuesOf({ TZ_OFFSET: '+7' })[0]?.key).toBe('TZ_OFFSET')
  })

  it('EMERGENCY_PATIENT_CONFIRM_SEC di luar rentang 30–60 detik', () => {
    expect(issuesOf({ EMERGENCY_PATIENT_CONFIRM_SEC: '120' })[0]?.key).toBe(
      'EMERGENCY_PATIENT_CONFIRM_SEC',
    )
  })

  it('PROVIDER_MODE=live tanpa kredensial WhatsApp', () => {
    const keys = issuesOf({ PROVIDER_MODE: 'live' }).map((i) => i.key)
    expect(keys).toEqual(['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WA_WEBHOOK_VERIFY_TOKEN'])
  })

  it('PROVIDER_MODE=live dengan kredensial lengkap diterima', () => {
    const env = parse({
      PROVIDER_MODE: 'live',
      WHATSAPP_TOKEN: 'token',
      WHATSAPP_PHONE_ID: 'phone',
      WA_WEBHOOK_VERIFY_TOKEN: 'verify',
    })
    expect(env.PROVIDER_MODE).toBe('live')
  })

  it('production tanpa CORS_ORIGINS', () => {
    expect(issuesOf({ NODE_ENV: 'production' })[0]?.key).toBe('CORS_ORIGINS')
  })

  it('production wajib menyertakan REDIS_URL dan DIRECT_URL', () => {
    const keys = issuesOf({ NODE_ENV: 'production', CORS_ORIGINS: 'https://careloop.dev' }).map(
      (i) => i.key,
    )
    expect(keys).toEqual(expect.arrayContaining(['REDIS_URL', 'DIRECT_URL']))

    const env = parse({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://careloop.dev',
      REDIS_URL: 'rediss://cache.example:6379',
      DIRECT_URL: VALID.DATABASE_URL,
    })
    expect(env.REDIS_URL).toBe('rediss://cache.example:6379')
  })

  it('REDIS_URL kosong di development tetap boleh (demo in-process)', () => {
    expect(parse({ NODE_ENV: 'development' }).REDIS_URL).toBeUndefined()
  })

  it('TEST_DATABASE_URL sama dengan DATABASE_URL', () => {
    expect(issuesOf({ TEST_DATABASE_URL: VALID.DATABASE_URL })[0]?.key).toBe('TEST_DATABASE_URL')
  })

  it('ANOMALY_HR_MIN tidak boleh >= ANOMALY_HR_MAX', () => {
    expect(issuesOf({ ANOMALY_HR_MIN: '130', ANOMALY_HR_MAX: '120' })[0]?.key).toBe(
      'ANOMALY_HR_MIN',
    )
  })

  it('pesan error menyebut setiap key yang bermasalah', () => {
    try {
      parse({ DATABASE_URL: '', JWT_SECRET: 'x' })
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError)
      expect((err as Error).message).toContain('DATABASE_URL')
      expect((err as Error).message).toContain('JWT_SECRET')
    }
  })
})

// Regresi CI: modul ini pernah memanggil process.exit(1) saat di-import, sehingga
// suite mati di runner yang tidak punya .env. Import harus bebas efek samping.
describe('getEnv — tanpa efek samping saat import', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
    resetEnvCache()
  })

  it('melempar EnvValidationError (bukan mematikan proses) saat env kosong', () => {
    resetEnvCache()
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET

    expect(() => getEnv()).toThrow(EnvValidationError)
  })

  it('mengembalikan env yang sama pada pemanggilan berikutnya (cache)', () => {
    resetEnvCache()
    process.env.DATABASE_URL = VALID.DATABASE_URL
    process.env.JWT_SECRET = VALID.JWT_SECRET

    expect(getEnv()).toBe(getEnv())
  })
})

// Unit test aturan aktivasi pasien (Fase A).
// Fungsi murni, jadi diuji tanpa database dan tanpa HTTP — inilah alasan aturan ini
// dipisah ke `activation.ts` (satu sumber kebenaran untuk UI, API, dan scheduler).
import { describe, expect, it } from 'vitest'
import { PatientStatus } from '@careloop/shared'
import {
  ACTIVATION_REQUIREMENT_KEYS,
  canTransitionPatientStatus,
  evaluateActivation,
  patientStatusTransitionError,
  type ActivationSubject,
} from './activation'

function subject(overrides: Partial<ActivationSubject> = {}): ActivationSubject {
  return {
    status: PatientStatus.ONBOARDING,
    primaryPuskesmas: { isActive: true },
    consentPdpAt: new Date('2026-08-01T00:00:00.000Z'),
    consentShareWithNakes: true,
    isVerified: true,
    phone: '081234567890',
    fullName: 'Bu Siti Test',
    dateOfBirth: new Date('1980-05-05T00:00:00.000Z'),
    gender: 'F',
    address: 'Jl. Merdeka No. 1',
    districtCode: '3471',
    healthConditions: ['DIABETES'],
    emergencyPreference: 'FAMILY_FIRST',
    activeFamilyContacts: 1,
    activeNakesContacts: 0,
    approvedMedications: 1,
    activeSchedules: 1,
    ...overrides,
  }
}

function keyOf(input: ActivationSubject, key: string) {
  const check = evaluateActivation(input).checks.find((c) => c.key === key)
  if (!check) throw new Error(`check ${key} tidak ditemukan`)
  return check
}

describe('evaluateActivation — kasus siap', () => {
  it('ready bila seluruh prasyarat terpenuhi', () => {
    const result = evaluateActivation(subject())

    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
    expect(result.checks.map((c) => c.key)).toEqual([...ACTIVATION_REQUIREMENT_KEYS])
  })

  it('semua check yang satisfied tidak punya detail', () => {
    for (const check of evaluateActivation(subject()).checks) {
      expect(check.detail).toBeNull()
    }
  })
})

describe('evaluateActivation — prasyarat yang gagal', () => {
  it('menandai puskesmas belum ditunjuk dan menautkan ke perbaikan', () => {
    const check = keyOf(subject({ primaryPuskesmas: null }), 'PUSKESMA')

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('Belum ada puskesmas')
  })

  it('menandai puskesmas non-aktif sebagai blocker', () => {
    const check = keyOf(subject({ primaryPuskesmas: { isActive: false } }), 'PUSKESMA')

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('tidak aktif')
  })

  it('butuh persetujuan PDP tercatat', () => {
    expect(keyOf(subject({ consentPdpAt: null }), 'CONSENT').satisfied).toBe(false)
  })

  it('butuh persetujuan berbagi dengan nakes, terpisah dari persetujuan PDP', () => {
    const check = keyOf(subject({ consentShareWithNakes: false }), 'CONSENT')

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('berbagi informasi')
  })

  it('butuh nomor WhatsApp terverifikasi', () => {
    const check = keyOf(subject({ isVerified: false }), 'VERIFIED')

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('OTP')
  })

  it('menampilkan seluruh field yang masih kosong sekaligus', () => {
    const check = keyOf(
      subject({
        fullName: null,
        gender: null,
        dateOfBirth: null,
        healthConditions: [],
      }),
      'MINIMUM_DATA',
    )

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('nama lengkap')
    expect(check.detail).toContain('tanggal lahir')
    expect(check.detail).toContain('jenis kelamin')
    expect(check.detail).toContain('kondisi penyakit')
  })

  it('tidak menganggap ruang kosong sebagai data terisi', () => {
    expect(keyOf(subject({ fullName: '   ' }), 'MINIMUM_DATA').satisfied).toBe(false)
  })

  it('menolak aktivasi tanpa satu pun kontak eskalasi', () => {
    const check = keyOf(
      subject({ activeFamilyContacts: 0, activeNakesContacts: 0 }),
      'ESCALATION_CONTACT',
    )

    expect(check.satisfied).toBe(false)
    expect(check.detail).toContain('kontak keluarga')
  })

  it('menerima kontak nakes sebagai tujuan eskalasi yang sah', () => {
    const check = keyOf(
      subject({ activeFamilyContacts: 0, activeNakesContacts: 2 }),
      'ESCALATION_CONTACT',
    )

    expect(check.satisfied).toBe(true)
  })

  it('butuh resep APPROVED; resep DRAFT tidak dihitung', () => {
    expect(keyOf(subject({ approvedMedications: 0 }), 'APPROVED_MEDICATION').satisfied).toBe(
      false,
    )
  })

  it('butuh jadwal obat aktif', () => {
    expect(keyOf(subject({ activeSchedules: 0 }), 'ACTIVE_SCHEDULE').satisfied).toBe(false)
  })
})

describe('evaluateActivation — agregat', () => {
  it('ready=false dan blockers berisi seluruh item yang gagal', () => {
    const result = evaluateActivation(
      subject({
        primaryPuskesmas: null,
        isVerified: false,
        activeFamilyContacts: 0,
        activeNakesContacts: 0,
        approvedMedications: 0,
        activeSchedules: 0,
      }),
    )

    expect(result.ready).toBe(false)
    expect(result.blockers.map((c) => c.key)).toEqual([
      'PUSKESMA',
      'VERIFIED',
      'ESCALATION_CONTACT',
      'APPROVED_MEDICATION',
      'ACTIVE_SCHEDULE',
    ])
  })

  it('tidak pernah melempar error walau data kosong total', () => {
    const result = evaluateActivation(
      subject({
        status: PatientStatus.ONBOARDING,
        primaryPuskesmas: null,
        consentPdpAt: null,
        consentShareWithNakes: false,
        isVerified: false,
        phone: null,
        fullName: null,
        dateOfBirth: null,
        gender: null,
        address: null,
        districtCode: null,
        healthConditions: [],
        activeFamilyContacts: 0,
        activeNakesContacts: 0,
        approvedMedications: 0,
        activeSchedules: 0,
      }),
    )

    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(ACTIVATION_REQUIREMENT_KEYS.length)
  })

  it('patient ACTIVE yang sebelumnya lengkap tetap ready', () => {
    const result = evaluateActivation(subject({ status: PatientStatus.ACTIVE }))

    expect(result.ready).toBe(true)
  })
})

describe('canTransitionPatientStatus', () => {
  it('ONBOARDING boleh aktif, nonaktif, atau diblokir', () => {
    expect(canTransitionPatientStatus('ONBOARDING', 'ACTIVE')).toBe(true)
    expect(canTransitionPatientStatus('ONBOARDING', 'INACTIVE')).toBe(true)
    expect(canTransitionPatientStatus('ONBOARDING', 'BLOCKED')).toBe(true)
  })

  it('ACTIVE tidak boleh langsung kembali ke ONBOARDING', () => {
    expect(canTransitionPatientStatus('ACTIVE', 'ONBOARDING')).toBe(false)
  })

  it('ACTIVE boleh ditangguhkan atau diblokir', () => {
    expect(canTransitionPatientStatus('ACTIVE', 'INACTIVE')).toBe(true)
    expect(canTransitionPatientStatus('ACTIVE', 'BLOCKED')).toBe(true)
  })

  it('BLOCKED hanya boleh dipulihkan lewat ONBOARDING atau INACTIVE', () => {
    expect(canTransitionPatientStatus('BLOCKED', 'ACTIVE')).toBe(false)
    expect(canTransitionPatientStatus('BLOCKED', 'ONBOARDING')).toBe(true)
    expect(canTransitionPatientStatus('BLOCKED', 'INACTIVE')).toBe(true)
  })

  it('menolak status di luar enum', () => {
    expect(canTransitionPatientStatus('ONBOARDING', 'AKTIF')).toBe(false)
    expect(canTransitionPatientStatus('HILANG', 'ACTIVE')).toBe(false)
  })
})

describe('patientStatusTransitionError', () => {
  it('null bila transisi sah', () => {
    expect(patientStatusTransitionError('ONBOARDING', 'ACTIVE')).toBeNull()
  })

  it('pesan yang menyebut asal dan tujuan bila transisi ditolak', () => {
    expect(patientStatusTransitionError('ACTIVE', 'ONBOARDING')).toContain('ACTIVE')
    expect(patientStatusTransitionError('ACTIVE', 'ONBOARDING')).toContain('ONBOARDING')
  })
})
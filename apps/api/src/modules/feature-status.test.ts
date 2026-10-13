// Test kontrak kejujuran fitur (Fase G).
//
// Before: `/v1/patients/me/risk` mengembalikan `score: 0, level: LOW` — angka nol yang
// secara klinis terbaca sebagai "pasien aman" padahal tidak ada perhitungan sama sekali.
// Test ini mengunci agar placeholder tidak pernah lagi terlihat seperti fitur jadi.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  FEATURE_STATUS,
  FEATURE_STATUS_DETAIL,
  FEATURE_STATUS_LABEL,
  featureEnvelope,
} from './feature-status'

describe('featureEnvelope', () => {
  it('menempelkan label dan penjelasan pada data', () => {
    const envelope = featureEnvelope(FEATURE_STATUS.PENDING, [] as unknown[])

    expect(envelope.status).toBe('PENDING')
    expect(envelope.statusLabel).toBe('Segera hadir')
    expect(envelope.statusDetail).toContain('Belum diimplementasikan')
    expect(envelope.data).toEqual([])
  })

  it('menjaga agar data tetap ada supaya UI tidak crash', () => {
    const envelope = featureEnvelope(FEATURE_STATUS.MOCK, { score: 82, level: 'HIGH' })

    expect(envelope.data).toEqual({ score: 82, level: 'HIGH' })
  })

  it('semua label punya penjelasan, kecuali AVAILABLE', () => {
    for (const status of Object.values(FEATURE_STATUS)) {
      expect(FEATURE_STATUS_LABEL[status]).toBeTruthy()
      if (status === 'AVAILABLE') {
        expect(FEATURE_STATUS_DETAIL[status]).toBe('')
      } else {
        expect(FEATURE_STATUS_DETAIL[status]).toBeTruthy()
      }
    }
  })

  it('PENDING dan MOCK selalu memuat larangan dipakai untuk keputusan klinis', () => {
    expect(FEATURE_STATUS_DETAIL.PENDING).toMatch(/jangan dipakai untuk keputusan klinis/i)
    expect(FEATURE_STATUS_DETAIL.MOCK).toMatch(/bukan data pasien sebenarnya/i)
  })

  it('FORBIDDEN menjelaskan bahwa itu keputusan sadar, bukan kegagalan', () => {
    expect(FEATURE_STATUS_LABEL.FORBIDDEN).toBe('Tidak tersedia untuk role ini')
  })
})

describe('envelope fitur pada respons API', () => {
  const envelopeSchema = z.object({
    status: z.enum(['AVAILABLE', 'MOCK', 'PENDING', 'FORBIDDEN']),
    statusLabel: z.string().min(1),
    statusDetail: z.string(),
    data: z.unknown(),
  })

  it('respons fitur selalu bisa diparse sebagai envelope fitur', () => {
    const parsed = envelopeSchema.safeParse(featureEnvelope(FEATURE_STATUS.PENDING, []))
    expect(parsed.success).toBe(true)
  })
})
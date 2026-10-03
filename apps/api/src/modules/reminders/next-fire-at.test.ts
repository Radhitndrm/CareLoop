// Unit test kalkulasi jadwal reminder (CL-105).
// Ref: docs/TESTING.md §7 RM-1 (zona pasien), RM-2 (daysOfWeek) + AC-1.1 (±2 menit).
import { describe, expect, it } from 'vitest'
import { nextFireAt } from './next-fire-at'

describe('nextFireAt — zona waktu pasien (RM-1 / AC-1.1)', () => {
  it('WIB (Asia/Jakarta, UTC+7): 08:00 WIB = 01:00 UTC, ±akurat menit', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta' },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(fire).not.toBeNull()
    expect(fire!.toISOString()).toBe('2024-01-01T01:00:00.000Z')
  })

  it('WITA (Asia/Makassar, UTC+8): 08:00 WITA = 00:00 UTC', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Makassar' },
      { after: '2023-12-31T20:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-01T00:00:00.000Z')
  })

  it('WIT (Asia/Jayapura, UTC+9): 08:00 WIT memotong hari sebelumnya di UTC', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jayapura' },
      { after: '2023-12-31T00:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2023-12-31T23:00:00.000Z')
  })

  it('jam sudah lewat hari ini -> fire besok', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta' },
      { after: '2024-01-01T02:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-02T01:00:00.000Z')
  })

  it('after tepat sama dengan jam fire -> strictly berikutnya (besok)', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta' },
      { after: '2024-01-01T01:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-02T01:00:00.000Z')
  })

  it('menit dijaga: 08:30 WIB = 01:30 UTC', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:30', timezone: 'Asia/Jakarta' },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-01T01:30:00.000Z')
  })
})

describe('nextFireAt — filter daysOfWeek (RM-2)', () => {
  it('Senin-Rabu aktif: after Kamis -> fire Senin minggu depan', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', daysOfWeek: [1, 2, 3] },
      { after: '2024-01-04T00:00:00Z' },
    )
    // 2024-01-04 = Kamis; hari aktif berikutnya Senin 2024-01-08.
    expect(fire!.toISOString()).toBe('2024-01-08T01:00:00.000Z')
  })

  it('Rabu-Jumat aktif, fire Rabu sudah lewat -> Jumat (bukan Kamis)', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', daysOfWeek: [3, 5] },
      { after: '2024-01-03T02:00:00Z' },
    )
    // 2024-01-03 = Rabu, 2024-01-04 = Kamis (nonaktif), 2024-01-05 = Jumat.
    expect(fire!.toISOString()).toBe('2024-01-05T01:00:00.000Z')
  })

  it('daysOfWeek kosong -> setiap hari termasuk Sabtu/Minggu', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', daysOfWeek: [] },
      { after: '2024-01-06T02:00:00Z' },
    )
    // 2024-01-06 = Sabtu, 2024-01-07 = Minggu.
    expect(fire!.toISOString()).toBe('2024-01-07T01:00:00.000Z')
  })

  it('daysOfWeek tidak diisi -> default setiap hari', () => {
    const fire = nextFireAt(
      { timeOfDay: '20:00', timezone: 'Asia/Jakarta' },
      { after: '2024-01-07T12:59:59Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-07T13:00:00.000Z') // Minggu 20:00 WIB
  })
})

describe('nextFireAt — batas startDate / endDate', () => {
  it('startDate di masa depan: slot sebelum start di-skip', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', startDate: '2024-01-03' },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-03T01:00:00.000Z')
  })

  it('endDate inklusif: fire terakhir dipakai', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', endDate: '2024-01-01' },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-01T01:00:00.000Z')
  })

  it('setelah endDate -> null (tidak ada slot valid)', () => {
    const fire = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', endDate: '2024-01-01' },
      { after: '2024-01-02T00:00:00Z' },
    )
    expect(fire).toBeNull()
  })

  it('date object diterima sebagai batas (dikonversi ke tanggal lokal pasien)', () => {
    const fire = nextFireAt(
      {
        timeOfDay: '08:00',
        timezone: 'Asia/Jakarta',
        startDate: new Date('2024-01-03T00:00:00Z'),
        endDate: new Date('2024-01-04T00:00:00Z'),
      },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(fire!.toISOString()).toBe('2024-01-03T01:00:00.000Z')
  })
})

describe('nextFireAt — validasi input', () => {
  it('timeOfDay tidak valid -> throw RangeError', () => {
    expect(() => nextFireAt({ timeOfDay: '25:00' })).toThrow(RangeError)
    expect(() => nextFireAt({ timeOfDay: '8:9' })).toThrow(RangeError)
    expect(() => nextFireAt({ timeOfDay: 'abc' })).toThrow(RangeError)
  })

  it('timezone default Asia/Jakarta bila tidak diisi', () => {
    const fire = nextFireAt({ timeOfDay: '08:00' }, { after: '2024-01-01T00:00:00Z' })
    expect(fire!.toISOString()).toBe('2024-01-01T01:00:00.000Z')
  })

  // schedules.end_date nullable: Prisma mengembalikan null, bukan undefined. Kalau null
  // diteruskan apa adanya, ia jadi epoch 1970 dan seluruh jadwal terbaca sudah berakhir.
  it('startDate/endDate null berarti tanpa batas, bukan epoch', () => {
    const tanpaBatas = nextFireAt(
      { timeOfDay: '08:00', timezone: 'Asia/Jakarta', startDate: null, endDate: null },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(tanpaBatas!.toISOString()).toBe('2024-01-01T01:00:00.000Z')

    const mulaiSaja = nextFireAt(
      {
        timeOfDay: '08:00',
        timezone: 'Asia/Jakarta',
        startDate: new Date('2024-01-03T00:00:00Z'),
        endDate: null,
      },
      { after: '2024-01-01T00:00:00Z' },
    )
    expect(mulaiSaja!.toISOString()).toBe('2024-01-03T01:00:00.000Z')
  })
})

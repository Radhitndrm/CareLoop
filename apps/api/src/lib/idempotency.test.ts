// CL-009: guard idempotensi. Pelanggaran unique disimulasikan dengan
// PrismaClientKnownRequestError agar suite tidak membutuhkan database.
import { describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { isUniqueViolation, runOnce } from './idempotency'

function uniqueViolation(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('duplicate', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  })
}

const WEBHOOK_KEY = 'sourceMessageId'
const VITAL_KEY = ['patientId', 'source', 'recordedAt'] as const

describe('isUniqueViolation', () => {
  it('mengenali P2002 dan mengabaikan error lain', () => {
    expect(isUniqueViolation(uniqueViolation(WEBHOOK_KEY))).toBe(true)
    expect(isUniqueViolation(new Error('koneksi putus'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(
      isUniqueViolation(
        new Prisma.PrismaClientKnownRequestError('missing', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      ),
    ).toBe(false)
  })

  it('mencocokkan constraint tertentu, termasuk kunci gabungan', () => {
    expect(isUniqueViolation(uniqueViolation(WEBHOOK_KEY), WEBHOOK_KEY)).toBe(true)
    expect(isUniqueViolation(uniqueViolation([...VITAL_KEY]), VITAL_KEY)).toBe(true)
    expect(isUniqueViolation(uniqueViolation(['patientId', 'source']), VITAL_KEY)).toBe(false)
  })

  it('constraint lain tidak dianggap duplikat yang diantisipasi', () => {
    expect(isUniqueViolation(uniqueViolation('phone'), WEBHOOK_KEY)).toBe(false)
  })

  it('mengenali nama index untuk partial unique index dari raw SQL (CL-002)', () => {
    const err = uniqueViolation('ComplianceLog_sourceMessageId_key')
    expect(isUniqueViolation(err, 'ComplianceLog_sourceMessageId_key')).toBe(true)
  })
})

describe('runOnce', () => {
  it('event pertama dibuat dan ditandai created', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'c1' })
    const findExisting = vi.fn()

    const result = await runOnce({ create, findExisting })

    expect(result).toEqual({ created: true, value: { id: 'c1' } })
    expect(findExisting).not.toHaveBeenCalled()
  })

  it('event ganda mengembalikan record lama tanpa membuat duplikat', async () => {
    const create = vi.fn().mockRejectedValue(uniqueViolation(WEBHOOK_KEY))
    const findExisting = vi.fn().mockResolvedValue({ id: 'c1', confirmedAt: '2026-08-31T02:00:00Z' })

    const result = await runOnce({ create, findExisting, constraint: WEBHOOK_KEY })

    expect(result.created).toBe(false)
    expect(result.value).toEqual({ id: 'c1', confirmedAt: '2026-08-31T02:00:00Z' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('webhook WhatsApp yang sama tiga kali hanya menulis sekali', async () => {
    const rows: Array<{ id: string; sourceMessageId: string }> = []
    const op = {
      constraint: WEBHOOK_KEY,
      create: async () => {
        if (rows.some((row) => row.sourceMessageId === 'wamid.123')) {
          throw uniqueViolation(WEBHOOK_KEY)
        }
        const row = { id: `c${rows.length + 1}`, sourceMessageId: 'wamid.123' }
        rows.push(row)
        return row
      },
      findExisting: async () => rows.find((row) => row.sourceMessageId === 'wamid.123') ?? null,
    }

    const hasil = [await runOnce(op), await runOnce(op), await runOnce(op)]

    expect(rows).toHaveLength(1)
    expect(hasil.map((r) => r.created)).toEqual([true, false, false])
    expect(hasil.every((r) => r.value.id === 'c1')).toBe(true)
  })

  it('event smartwatch ganda (patientId+source+recordedAt) juga tertahan', async () => {
    const create = vi.fn().mockRejectedValue(uniqueViolation([...VITAL_KEY]))
    const findExisting = vi.fn().mockResolvedValue({ id: 'v1', hrBpm: 47 })

    const result = await runOnce({ create, findExisting, constraint: VITAL_KEY })

    expect(result).toEqual({ created: false, value: { id: 'v1', hrBpm: 47 } })
  })

  it('error non-unique diteruskan apa adanya', async () => {
    const create = vi.fn().mockRejectedValue(new Error('koneksi database putus'))
    const findExisting = vi.fn()

    await expect(runOnce({ create, findExisting })).rejects.toThrow('koneksi database putus')
    expect(findExisting).not.toHaveBeenCalled()
  })

  it('pelanggaran unique dari constraint lain tidak ditelan', async () => {
    const create = vi.fn().mockRejectedValue(uniqueViolation('phone'))
    const findExisting = vi.fn()

    await expect(runOnce({ create, findExisting, constraint: WEBHOOK_KEY })).rejects.toMatchObject({
      code: 'P2002',
    })
    expect(findExisting).not.toHaveBeenCalled()
  })

  it('duplikat tanpa record pendamping dilempar, bukan disembunyikan', async () => {
    const create = vi.fn().mockRejectedValue(uniqueViolation(WEBHOOK_KEY))
    const findExisting = vi.fn().mockResolvedValue(null)

    await expect(runOnce({ create, findExisting, constraint: WEBHOOK_KEY })).rejects.toMatchObject({
      code: 'P2002',
    })
  })
})

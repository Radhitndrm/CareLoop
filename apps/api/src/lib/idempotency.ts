// CL-009: guard idempotensi untuk event yang bisa datang ganda — webhook WhatsApp
// (`sourceMessageId`/`providerMessageId`) dan event smartwatch (patientId+source+recordedAt).
//
// Penegakannya bertumpu pada unique index yang sudah ada di migrasi init (CL-002,
// docs/DATABASE.md §4). Database dipakai sebagai satu-satunya wasit supaya guard tetap
// benar walau API berjalan di beberapa proses sekaligus — cek "sudah ada?" di aplikasi
// saja akan bocor saat dua permintaan tiba bersamaan.
import { Prisma } from '@prisma/client'

export interface IdempotentResult<T> {
  /** false = event dengan kunci yang sama sudah pernah diproses sebelumnya. */
  created: boolean
  value: T
}

export interface IdempotentOperation<T> {
  create(): Promise<T>
  /** Dipanggil hanya saat unique constraint dilanggar, untuk mengambil record yang menang. */
  findExisting(): Promise<T | null>
  /**
   * Nama kolom atau index unik yang diantisipasi. Diisi agar pelanggaran unique dari
   * constraint lain tetap dilempar sebagai error, bukan diam-diam dianggap duplikat.
   */
  constraint?: string | readonly string[]
}

export function isUniqueViolation(error: unknown, constraint?: string | readonly string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false
  }
  if (!constraint) return true

  const meta = error.meta?.target
  const targets = Array.isArray(meta) ? meta.map(String) : typeof meta === 'string' ? [meta] : []
  const expected = typeof constraint === 'string' ? [constraint] : constraint

  return expected.every((name) => targets.includes(name))
}

/**
 * Jalankan `create` sekali. Bila database menolak karena kunci unik sudah terpakai,
 * event itu sudah pernah diproses: record yang sudah ada dikembalikan dengan
 * `created: false`, tanpa membuat duplikat dan tanpa melempar error ke pemanggil.
 */
export async function runOnce<T>(op: IdempotentOperation<T>): Promise<IdempotentResult<T>> {
  try {
    return { created: true, value: await op.create() }
  } catch (error) {
    if (!isUniqueViolation(error, op.constraint)) throw error

    const existing = await op.findExisting()
    if (existing === null) {
      // Constraint yang dilanggar ternyata bukan yang diantisipasi, atau record sempat
      // dihapus di antara dua langkah. Menelan error di sini akan menyembunyikan bug.
      throw error
    }

    return { created: false, value: existing }
  }
}

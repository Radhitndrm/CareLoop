// Hashing kata sandi terpusat — dipakai modul auth dan seed persona demo.
// bcrypt cost 12 sesuai docs/SECURITY.md §7 (tabel algoritma).
import bcrypt from 'bcryptjs'

export const BCRYPT_COST = 12

/**
 * Hash pembanding untuk akun yang tidak ditemukan atau belum punya kata sandi.
 * Dibandingkan tetap dijalankan agar durasi respons login tidak membocorkan
 * apakah sebuah nomor/email terdaftar (user enumeration lewat timing).
 * Nilainya hash dari string acak, bukan kata sandi yang bisa dipakai.
 */
const DUMMY_HASH = '$2a$12$fIFTWCEnAWopdBcskunaPeOpEJBASJwv6GfPF28Iu1DaKM872x76S'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

/**
 * Verifikasi kata sandi. `hash` boleh null/kosong (akun OTP-only) — hasilnya tetap
 * false, tetapi biaya komputasinya sama dengan verifikasi yang gagal biasa.
 */
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  const target = hash && hash.length > 0 ? hash : DUMMY_HASH
  const matched = await bcrypt.compare(plain, target)
  return Boolean(hash) && matched
}

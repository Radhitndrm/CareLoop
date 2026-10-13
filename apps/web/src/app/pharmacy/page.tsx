import { redirect } from 'next/navigation'

/**
 * Halaman antrean obat untuk petugas farmasi. Diarahkan ke /pharmacy/queue
 * supaya /pharmacy tidak menjadi URL tanpa isi.
 */
export default function PharmacyIndexPage() {
  redirect('/pharmacy/queue')
}
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-zinc-950">
      <main className="mx-auto max-w-3xl pt-12 text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30 mb-6">
          <svg
            className="h-9 w-9"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
          CareLoop Nakes
        </h1>
        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
          Ekosistem Kepatuhan Pengobatan &amp; Deteksi Darurat Pasien Kronis (SDG 3 Digital Health)
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3.5 text-base font-semibold text-white shadow-sm hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            Buka Dashboard Nakes
          </Link>
          <Link
            href="/login"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-6 py-3.5 text-base font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            Masuk Portal Petugas
          </Link>
        </div>

        <div className="mt-12 rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
            Fitur Utama Dashboard Nakes:
          </h3>
          <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              Ringkasan KPI Kepatuhan (Adherence Rate), Dosis Tepat Waktu, Terlambat, dan Terlewat.
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              Grafik deret waktu tren harian dan breakdown kepatuhan per jenis penyakit.
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              Identifikasi pasien berisiko tinggi (skor ≥ 70) dan lansia tinggal sendiri (alone).
            </li>
            <li className="flex items-center gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              Filter parameter (Wilayah, Penyakit, Rentang Tanggal, Eskalasi) tersimpan di URL query (bookmarkable).
            </li>
          </ul>
        </div>

        <footer className="mt-12 text-xs text-zinc-400">
          CareLoop — Data demo sintetis, bukan data pasien riil.
        </footer>
      </main>
    </div>
  );
}


import type { AtRiskPatient } from '../../lib/api'
import { Skeleton } from '../ui/skeleton'
import { EmptyState } from '../ui/empty-state'

export function RiskTable({
  patients,
  isLoading,
}: {
  patients: AtRiskPatient[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <Skeleton className="h-6 w-56 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white shadow-xs overflow-hidden dark:border-zinc-800 dark:bg-zinc-900">
      <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Daftar Pasien Berisiko Tinggi
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Pasien dengan skor risiko ≥ 70 atau kepatuhan rendah yang memerlukan intervensi nakes
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
          {patients.length} Pasien Terdeteksi
        </span>
      </div>

      {patients.length === 0 ? (
        <div className="p-8">
          <EmptyState
            title="Tidak Ada Pasien Berisiko Tinggi"
            description="Tidak ada pasien dalam scope binaan yang terdeteksi berisiko tinggi dengan filter yang dipilih."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/75 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
                <th className="py-3.5 px-6">Pasien</th>
                <th className="py-3.5 px-6">Wilayah</th>
                <th className="py-3.5 px-6">Situasi Tinggal</th>
                <th className="py-3.5 px-6">Kondisi / Penyakit</th>
                <th className="py-3.5 px-6">Skor Risiko</th>
                <th className="py-3.5 px-6">Kepatuhan 7 Hari</th>
                <th className="py-3.5 px-6">Dosis Terlewat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
              {patients.map((p) => {
                const adherencePct = Math.round(p.adherenceRate * 100)
                const isAlone = p.livingSituation === 'ALONE'

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-4 px-6 font-medium text-zinc-900 dark:text-zinc-100">
                      <div>{p.fullName}</div>
                      <div className="text-xs text-zinc-400 font-mono">{p.phone}</div>
                    </td>
                    <td className="py-4 px-6 text-zinc-600 dark:text-zinc-400">
                      {p.districtCode ? (
                        <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-mono text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {p.districtCode}
                        </span>
                      ) : (
                        <span className="text-zinc-400 italic text-xs">-</span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      {isAlone ? (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                          Tinggal Sendiri (Alone)
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">
                          {p.livingSituation || 'Bersama Keluarga'}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-1">
                        {p.healthConditions && p.healthConditions.length > 0 ? (
                          p.healthConditions.map((c) => (
                            <span
                              key={c}
                              className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                            >
                              {c}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-zinc-400 italic">Umum</span>
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-rose-600 dark:text-rose-400">
                          {p.riskScore}
                        </span>
                        <span className="text-xs text-zinc-400">/ 100</span>
                        <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/50 dark:text-rose-200">
                          {p.riskLevel}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`font-semibold ${
                          adherencePct >= 80
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : adherencePct >= 50
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {adherencePct}%
                      </span>
                    </td>
                    <td className="py-4 px-6 font-medium text-zinc-700 dark:text-zinc-300">
                      {p.missedDosesLastWeek > 0 ? (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold">
                          <span className="h-2 w-2 rounded-full bg-rose-500" />
                          {p.missedDosesLastWeek} dosis
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 text-xs">
                          Nol terlewat
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import type { DashboardSummary } from '../../lib/api'
import { Skeleton } from '../ui/skeleton'

export function KpiCards({
  summary,
  isLoading,
}: {
  summary: DashboardSummary | null
  isLoading: boolean
}) {
  if (isLoading || !summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    )
  }

  const adherencePercent = Math.round(summary.adherenceRate * 100)
  const isEmergency = summary.activeEmergencies > 0
  const isEscalation = summary.activeEscalations > 0

  const trend = summary.trends?.direction ?? 'STABLE'

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {/* 1. Tingkat Kepatuhan (Utama) */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-xs dark:border-emerald-950 dark:bg-emerald-950/20">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            Kepatuhan (Adherence)
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              trend === 'UP'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                : trend === 'DOWN'
                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {trend === 'UP' && '▲ Naik'}
            {trend === 'DOWN' && '▼ Turun'}
            {trend === 'STABLE' && '— Stabil'}
          </span>
        </div>
        <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-950 dark:text-emerald-100">
          {adherencePercent}%
        </p>
        <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-400">
          {summary.confirmedCount} tepat · {summary.confirmedLateCount} tunda/terlambat · {summary.missedCount} terlewat
        </p>
      </div>

      {/* 2. Total Pasien */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Total Pasien Binaan</p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          {summary.totalPatients}
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Dalam wilayah binaan nakes
        </p>
      </div>

      {/* 3. Pasien Berisiko Tinggi */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs dark:border-amber-950 dark:bg-amber-950/20">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          Pasien Berisiko Tinggi
        </p>
        <p className="mt-2 text-3xl font-bold tracking-tight text-amber-950 dark:text-amber-100">
          {summary.atRiskPatients}
        </p>
        <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400">
          Skor risiko ≥ 70 atau level HIGH
        </p>
      </div>

      {/* 4. Alert Darurat Aktif */}
      <div
        className={`rounded-2xl p-5 shadow-xs transition-colors ${
          isEmergency
            ? 'border-2 border-rose-500 bg-rose-50 dark:border-rose-600 dark:bg-rose-950/40 animate-pulse'
            : 'border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
        }`}
      >
        <div className="flex items-center justify-between">
          <p
            className={`text-sm font-medium ${
              isEmergency ? 'text-rose-900 dark:text-rose-200' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            Darurat Aktif
          </p>
          {isEmergency && (
            <span className="flex h-2.5 w-2.5 rounded-full bg-rose-600 animate-ping" />
          )}
        </div>
        <p
          className={`mt-2 text-3xl font-bold tracking-tight ${
            isEmergency ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          {summary.activeEmergencies}
        </p>
        <p
          className={`mt-1 text-xs ${
            isEmergency ? 'text-rose-700 dark:text-rose-300 font-medium' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {isEmergency ? 'Perlu tindakan nakes segera!' : 'Tidak ada darurat aktif'}
        </p>
      </div>

      {/* 5. Eskalasi Kepatuhan */}
      <div
        className={`rounded-2xl p-5 shadow-xs transition-colors ${
          isEscalation
            ? 'border border-orange-300 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/30'
            : 'border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
        }`}
      >
        <p
          className={`text-sm font-medium ${
            isEscalation ? 'text-orange-900 dark:text-orange-300' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          Eskalasi Aktif
        </p>
        <p
          className={`mt-2 text-3xl font-bold tracking-tight ${
            isEscalation ? 'text-orange-600 dark:text-orange-300' : 'text-zinc-900 dark:text-zinc-50'
          }`}
        >
          {summary.activeEscalations}
        </p>
        <p
          className={`mt-1 text-xs ${
            isEscalation ? 'text-orange-700 dark:text-orange-400' : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {isEscalation ? 'Dalam alur eskalasi bertingkat' : 'Keluarga & nakes siaga'}
        </p>
      </div>
    </div>
  )
}

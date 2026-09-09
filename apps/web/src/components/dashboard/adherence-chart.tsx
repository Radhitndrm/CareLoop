import type { DashboardAdherence } from '../../lib/api'
import { Skeleton } from '../ui/skeleton'

export function AdherenceChart({
  data,
  isLoading,
}: {
  data: DashboardAdherence | null
  isLoading: boolean
}) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-6 w-48 mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
          <Skeleton className="h-6 w-36 mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  const series = data.series || []
  const byDisease = data.byDisease || []

  // Menyiapkan titik koordinat SVG untuk grafik garis deret waktu
  const chartHeight = 180
  const chartWidth = 500
  const paddingX = 40
  const paddingY = 25

  let pathD = ''
  let points: Array<{ x: number; y: number; rate: number; date: string; confirmed: number; total: number }> = []

  if (series.length > 0) {
    const stepX = (chartWidth - paddingX * 2) / Math.max(series.length - 1, 1)

    points = series.map((item, idx) => {
      const x = paddingX + idx * stepX
      const y = chartHeight - paddingY - item.adherenceRate * (chartHeight - paddingY * 2)
      return {
        x,
        y: Math.max(paddingY, Math.min(chartHeight - paddingY, y)),
        rate: item.adherenceRate,
        date: item.date,
        confirmed: item.confirmed,
        total: item.total,
      }
    })

    pathD = points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`
    }, '')
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* 1. Grafik Tren Harian */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Tren Kepatuhan Harian
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Periode: {data.period.from} s.d. {data.period.to}
            </p>
          </div>
          <div className="mt-2 sm:mt-0 flex items-center gap-4 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Tepat Waktu (%)
            </span>
          </div>
        </div>

        {series.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-zinc-500">
            Tidak ada data jadwal obat pada periode tanggal ini.
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-56 overflow-visible"
            >
              {/* Garis Grid Horizontal */}
              {[0, 0.25, 0.5, 0.75, 1].map((lvl) => {
                const y = chartHeight - paddingY - lvl * (chartHeight - paddingY * 2)
                return (
                  <g key={lvl}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={chartWidth - paddingX}
                      y2={y}
                      stroke="currentColor"
                      strokeDasharray="4 4"
                      className="text-zinc-200 dark:text-zinc-800"
                    />
                    <text
                      x={paddingX - 8}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="9"
                      className="fill-zinc-400 dark:fill-zinc-500 font-mono"
                    >
                      {lvl * 100}%
                    </text>
                  </g>
                )
              })}

              {/* Area gradien di bawah garis */}
              {pathD && (
                <>
                  <defs>
                    <linearGradient id="adherenceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${pathD} L ${points[points.length - 1].x} ${chartHeight - paddingY} L ${points[0].x} ${chartHeight - paddingY} Z`}
                    fill="url(#adherenceGrad)"
                  />
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              )}

              {/* Titik data & Tooltip visual */}
              {points.map((pt, i) => (
                <g key={i} className="group cursor-pointer">
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="4"
                    className="fill-white stroke-emerald-600 dark:fill-zinc-900"
                    strokeWidth="2"
                  />
                  {/* Tanggal di sumbu X (hanya beberapa jika banyak) */}
                  {(series.length <= 7 || i % Math.ceil(series.length / 6) === 0) && (
                    <text
                      x={pt.x}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      fontSize="9"
                      className="fill-zinc-500 dark:fill-zinc-400"
                    >
                      {pt.date.slice(5)}
                    </text>
                  )}
                  {/* Tooltip hover */}
                  <title>{`${pt.date}: ${Math.round(pt.rate * 100)}% (${pt.confirmed}/${pt.total} jadwal)`}</title>
                </g>
              ))}
            </svg>
          </div>
        )}
      </div>

      {/* 2. Distribusi Kepatuhan per Penyakit */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Kepatuhan per Penyakit
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5">
          Tingkat konsumsi tepat waktu
        </p>

        {byDisease.length === 0 ? (
          <div className="flex h-44 items-center justify-center text-sm text-zinc-500">
            Tidak ada riwayat penyakit spesifik.
          </div>
        ) : (
          <div className="space-y-4">
            {byDisease.map((item) => {
              const percent = Math.round(item.adherenceRate * 100)
              return (
                <div key={item.disease}>
                  <div className="flex items-center justify-between text-sm font-medium mb-1">
                    <span className="text-zinc-800 dark:text-zinc-200">
                      {item.disease}
                    </span>
                    <span className="text-zinc-900 dark:text-zinc-100 font-bold">
                      {percent}%{' '}
                      <span className="text-xs font-normal text-zinc-400">
                        ({item.total} dosis)
                      </span>
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        percent >= 80
                          ? 'bg-emerald-500'
                          : percent >= 60
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

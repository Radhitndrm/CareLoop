'use client'

import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from 'lucide-react'
import type { DashboardSummary } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/feedback'
import { Meter } from '@/components/data-table'
import { SpotlightCard } from '@/components/stat-card'
import { cn } from '@/lib/utils'

const TREND_ICON = { UP: ArrowUpIcon, DOWN: ArrowDownIcon, STABLE: MinusIcon } as const
const TREND_TEXT = { UP: 'naik', DOWN: 'turun', STABLE: 'stabil' } as const

type Tone = 'success' | 'warning' | 'danger'

const BADGE_TONE = { success: 'success', warning: 'warning', danger: 'destructive' } as const

const FACT_TONE = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
} as const

function toneFor(percent: number): Tone {
  if (percent >= 80) return 'success'
  if (percent >= 50) return 'warning'
  return 'danger'
}

/**
 * Panel pembuka dashboard. Figure besar di kiri, rincian pecahanannya di kanan
 * — jadi selalu terisi sampai tepi, tidak ada ruang kosong di dalam kartu.
 */
export function HealthHero({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) {
    return (
      <div className="h-full rounded-xl bg-card p-7 ring-1 ring-foreground/10">
        <Skeleton className="mb-4 h-4 w-40" />
        <div className="hero-split">
          <Skeleton className="h-20 w-48" />
          <ul className="space-y-3.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="breakdown-row">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-12" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  const percent = Math.round(summary.adherenceRate * 100)
  const tone = toneFor(percent)
  const trend = summary.trends.direction
  const TrendIcon = TREND_ICON[trend] ?? MinusIcon

  const rows = [
    { label: 'Tepat waktu', value: summary.confirmedCount, tone: 'success' as const },
    { label: 'Diminum terlambat', value: summary.confirmedLateCount, tone: 'warning' as const },
    { label: 'Terlewat', value: summary.missedCount, tone: 'danger' as const },
    { label: 'Menunggu', value: summary.pendingCount, tone: 'muted' as const },
  ]
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  return (
    <div data-reveal className="reveal">
      <SpotlightCard>
        <div className="card-fold flex h-full flex-col rounded-xl bg-card p-7 ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="hero-label">Kondisi kepatuhan obat</p>
            <Badge variant={BADGE_TONE[tone]}>
              <TrendIcon aria-hidden="true" />
              Tren {TREND_TEXT[trend]}
            </Badge>
          </div>

          <div className="hero-split mt-5 flex-1">
            <div>
              <p className="hero-figure" data-tone={tone}>
                {percent}%
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                diminum tepat waktu pada periode aktif
              </p>
              <div className="mt-4">
                <Meter value={percent} tone={tone} />
              </div>
            </div>

            <ul className="space-y-3.5">
              {rows.map((row) => {
                const share = total > 0 ? (row.value / total) * 100 : 0
                return (
                  <li key={row.label} className="breakdown-row">
                    <span className={cn('breakdown-label', FACT_TONE[row.tone])}>{row.label}</span>
                    <Meter
                      value={share}
                      tone={row.tone === 'muted' ? 'default' : row.tone}
                      className="h-2"
                    />
                    <span className="breakdown-value">
                      {row.value}
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({Math.round(share)}%)
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </SpotlightCard>
    </div>
  )
}
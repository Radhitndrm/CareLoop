'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ActivityIcon, StethoscopeIcon, TrendingUpIcon } from 'lucide-react'
import type { DashboardAdherence } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { EmptyState } from '@/components/ui/empty-state'
import { Meter } from '@/components/data-table'

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: { confirmed?: number; total?: number } }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-menu">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">
        {Math.round((payload[0]?.value ?? 0) * 100)}% ({point?.confirmed ?? 0}/{point?.total ?? 0}{' '}
        jadwal)
      </p>
    </div>
  )
}

function TrendSkeleton() {
  return (
    <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
      <Skeleton className="mb-4 h-5 w-48" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

export function AdherenceTrendCard({
  data,
  isLoading,
}: {
  data: DashboardAdherence | null
  isLoading: boolean
}) {
  if (isLoading || !data) return <TrendSkeleton />

  const chartData = (data.series ?? []).map((item) => ({
    date: item.date.slice(5),
    rate: Math.round(item.adherenceRate * 1000) / 10,
    confirmed: item.confirmed,
    total: item.total,
  }))

  return (
    <Card data-reveal className="reveal h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUpIcon className="size-4 text-primary" aria-hidden="true" />
          Tren Kepatuhan Harian
        </CardTitle>
        <CardDescription>
          {data.period.from} s.d. {data.period.to} · persentase obat diminum tepat waktu
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <EmptyState
            icon={<ActivityIcon className="size-5" aria-hidden="true" />}
            title="Belum ada data jadwal"
            description="Tidak ada jadwal obat pada periode tanggal yang dipilih. Coba perluas rentang tanggal."
          />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="adherenceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={16}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)' }} />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  fill="url(#adherenceFill)"
                  dot={{ r: 3, fill: 'var(--card)', stroke: 'var(--chart-1)', strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function DiseaseMetersCard({
  data,
  isLoading,
}: {
  data: DashboardAdherence | null
  isLoading: boolean
}) {
  if (isLoading || !data) {
    return (
      <div className="rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <Skeleton className="mb-4 h-5 w-40" />
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const byDisease = data.byDisease ?? []

  return (
    <Card data-reveal className="reveal h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StethoscopeIcon className="size-4 text-primary" aria-hidden="true" />
          Kepatuhan per Penyakit
        </CardTitle>
        <CardDescription>Tingkat konsumsi tepat waktu</CardDescription>
      </CardHeader>
      <CardContent>
        {byDisease.length === 0 ? (
          <EmptyState
            icon={<StethoscopeIcon className="size-5" aria-hidden="true" />}
            title="Belum ada riwayat penyakit"
            description="Data penyakit pasien belum tercatat."
          />
        ) : (
          <ul className="space-y-4">
            {byDisease.map((item) => {
              const percent = Math.round(item.adherenceRate * 100)
              return (
                <li key={item.disease} className="breakdown-row">
                  <span className="breakdown-label truncate">{item.disease}</span>
                  <Meter
                    value={percent}
                    tone={percent >= 80 ? 'success' : percent >= 60 ? 'warning' : 'danger'}
                    className="h-2"
                  />
                  <span className="breakdown-value">{percent}%</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
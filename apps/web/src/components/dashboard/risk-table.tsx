import Link from 'next/link'
import { ShieldAlertIcon } from 'lucide-react'
import type { AtRiskPatient } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/feedback'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTableShell } from '@/components/data-table'
import { cn } from '@/lib/utils'

function adherenceTone(percent: number) {
  if (percent >= 80) return 'text-success'
  if (percent >= 50) return 'text-warning'
  return 'text-danger'
}

export function RiskTable({
  patients,
  isLoading,
}: {
  patients: AtRiskPatient[]
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <Skeleton className="mb-4 h-6 w-56" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <section data-reveal className="reveal space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-[-0.011em]">
            <ShieldAlertIcon className="size-4 text-warning" aria-hidden="true" />
            Daftar Pasien Berisiko Tinggi
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Skor risiko ≥ 70 atau kepatuhan rendah yang memerlukan intervensi nakes.
          </p>
        </div>
        <Badge variant={patients.length > 0 ? 'warning' : 'success'}>
          {patients.length} pasien terdeteksi
        </Badge>
      </div>

      <DataTableShell
        empty={patients.length === 0}
        toolbar={
          <>
            <span className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Prioritas tindak lanjut
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href="/patients">Lihat semua pasien</Link>
            </Button>
          </>
        }
      >
        {patients.length === 0 ? (
          <EmptyState
            icon={<ShieldAlertIcon className="size-5" aria-hidden="true" />}
            title="Tidak ada pasien berisiko tinggi"
            description="Tidak ada pasien dalam scope binaan yang terdeteksi berisiko tinggi dengan filter yang dipilih."
          />
        ) : (
          <div className="data-table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3.5">Pasien</th>
                  <th className="px-4 py-3.5">Wilayah</th>
                  <th className="px-4 py-3.5">Situasi Tinggal</th>
                  <th className="px-4 py-3.5">Kondisi</th>
                  <th className="px-4 py-3.5">Skor Risiko</th>
                  <th className="px-4 py-3.5">Kepatuhan 7 Hari</th>
                  <th className="px-4 py-3.5">Dosis Terlewat</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p) => {
                  const adherencePct = Math.round(p.adherenceRate * 100)
                  const isAlone = p.livingSituation === 'ALONE'

                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-4">
                        <Link
                          href={`/patients/${p.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {p.fullName}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">{p.phone}</p>
                      </td>
                      <td className="px-4 py-4">
                        {p.districtCode ? (
                          <Badge variant="neutral" className="font-mono">
                            {p.districtCode}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {isAlone ? (
                          <Badge variant="destructive">Tinggal Sendiri</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {p.livingSituation || 'Bersama Keluarga'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-1">
                          {p.healthConditions?.length ? (
                            p.healthConditions.map((c) => (
                              <Badge key={c} variant="info">
                                {c}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">Umum</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-danger tabular-nums">{p.riskScore}</span>
                          <span className="text-xs text-muted-foreground">/ 100</span>
                          <Badge variant="destructive">{p.riskLevel}</Badge>
                        </span>
                      </td>
                      <td className={cn('px-4 py-4 font-semibold tabular-nums', adherenceTone(adherencePct))}>
                        {adherencePct}%
                      </td>
                      <td className="px-4 py-4">
                        {p.missedDosesLastWeek > 0 ? (
                          <span className="font-semibold text-danger tabular-nums">
                            {p.missedDosesLastWeek} dosis
                          </span>
                        ) : (
                          <span className="text-xs text-success">Nol terlewat</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataTableShell>
    </section>
  )
}
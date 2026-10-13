import { ActivityIcon, BellRingIcon, ShieldAlertIcon, UsersIcon } from 'lucide-react'
import type { DashboardSummary } from '@/lib/api'
import { Skeleton } from '@/components/ui/feedback'
import { StatCard } from '@/components/stat-card'

/**
 * Empat angka pembuka. Kepatuhan sendiri sudah naik ke HealthHero, jadi di sini
 * hanya angka yang tidak ada di tempat lain — dua kolom supaya tinggi barisnya
 * nyambung dengan hero di sebelahnya.
 */
export function StatStrip({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="mb-3 h-4 w-20" />
            <Skeleton className="h-8 w-12" />
          </div>
        ))}
      </div>
    )
  }

  const isEmergency = summary.activeEmergencies > 0
  const isEscalation = summary.activeEscalations > 0

  return (
    <div className="grid grid-cols-2 gap-4">
      <StatCard
        title="Total pasien"
        value={summary.totalPatients}
        icon={<UsersIcon className="size-5" aria-hidden="true" />}
        tone="default"
        hint="Dalam wilayah binaan Anda"
      />
      <StatCard
        title="Berisiko tinggi"
        value={summary.atRiskPatients}
        icon={<ShieldAlertIcon className="size-5" aria-hidden="true" />}
        tone={summary.atRiskPatients > 0 ? 'warning' : 'muted'}
        hint="Skor risiko ≥ 70"
      />
      <StatCard
        title="Eskalasi aktif"
        value={summary.activeEscalations}
        icon={<ActivityIcon className="size-5" aria-hidden="true" />}
        tone={isEscalation ? 'warning' : 'default'}
        hint={isEscalation ? 'Sedang berjalan' : 'Semua selesai'}
      />
      <StatCard
        title="Darurat aktif"
        value={summary.activeEmergencies}
        icon={<BellRingIcon className="size-5" aria-hidden="true" />}
        tone={isEmergency ? 'danger' : 'muted'}
        hint={isEmergency ? 'Perlu tindakan' : 'Tidak ada'}
      />
    </div>
  )
}
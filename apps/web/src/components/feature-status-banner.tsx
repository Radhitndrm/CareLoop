'use client'

// Peringatan ketersediaan fitur.
//
// Endpoint yang belum diimplementasikan tetap menjawab, tapi dengan label status.
// Widget ini memastikan label itu sampai ke pengguna, bukan hanya ke integrator:
// "Segera hadir" jauh lebih aman daripada daftar kosong yang terlihat seperti
// "memang tidak ada data".
import { ConstructionIcon } from 'lucide-react'
import type { FeatureEnvelope } from '@/lib/api'
import { Alert } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'

const TONE: Record<string, 'warning' | 'neutral' | 'destructive'> = {
  PENDING: 'warning',
  MOCK: 'neutral',
  FORBIDDEN: 'destructive',
}

/** `null` = fitur tersedia, jadi tidak ada yang perlu ditampilkan. */
export function FeatureStatusBanner({
  envelope,
  featureName,
}: {
  envelope: FeatureEnvelope<unknown> | null
  featureName: string
}) {
  if (!envelope) return null
  if (envelope.status === 'AVAILABLE') return null

  return (
    <Alert variant="info" icon={<ConstructionIcon />}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{featureName}</span>
        <Badge variant={TONE[envelope.status] ?? 'neutral'}>{envelope.statusLabel}</Badge>
      </div>
      <p className="mt-1 text-sm">{envelope.statusDetail}</p>
    </Alert>
  )
}
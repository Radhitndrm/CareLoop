'use client'

// Antrean kerja (Fase F): daftar pasien yang menunggu tindakan nakes, bukan angka.
//
// Angka kepatuhan tidak bisa dikerjakan. Widget ini menjawab pertanyaan yang benar-benar
// dipakai pagi hari: "pasien mana yang perlu saya tangani, dan apa yang perlu diperbaiki?"
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  AlarmClockIcon,
  ClipboardListIcon,
  PhoneCallIcon,
  ShieldAlertIcon,
  UserRoundXIcon,
} from 'lucide-react'
import { getWorkQueue, type WorkQueueBucket } from '@/lib/api'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

const ICONS: Record<string, typeof ClipboardListIcon> = {
  INCOMPLETE: ClipboardListIcon,
  UNVERIFIED: PhoneCallIcon,
  NO_ESCALATION_CONTACT: UserRoundXIcon,
  NO_APPROVED_MEDICATION: ClipboardListIcon,
  NO_ACTIVE_SCHEDULE: AlarmClockIcon,
  ACTIVE_ESCALATION: AlarmClockIcon,
  OPEN_EMERGENCY: ShieldAlertIcon,
}

/** Kelompok keselamatan dibedakan: jumlah insiden, bukan daftar pasien. */
const SAFETY_KEYS = new Set(['ACTIVE_ESCALATION', 'OPEN_EMERGENCY'])

export function WorkQueuePanel() {
  const [buckets, setBuckets] = useState<WorkQueueBucket[]>([])
  const [actionable, setActionable] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      setIsLoading(true)
      try {
        const result = await getWorkQueue()
        if (!isCancelled) {
          setBuckets(result.buckets)
          setActionable(result.actionablePatients)
          setError(null)
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat antrean kerja')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [])

  const onboarding = buckets.filter((bucket) => !SAFETY_KEYS.has(bucket.key))
  const safety = buckets.filter((bucket) => SAFETY_KEYS.has(bucket.key))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Antrean Kerja</CardTitle>
        <CardDescription>
          {actionable > 0
            ? `${actionable} pasien menunggu tindak lanjut Anda.`
            : 'Tidak ada pasien yang menunggu tindak lanjut.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="danger" icon={<ShieldAlertIcon />}>
            {error}
          </Alert>
        ) : null}

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : buckets.length === 0 ? (
          <EmptyState
            icon={<ClipboardListIcon className="size-5" aria-hidden="true" />}
            title="Antrean kosong"
            description="Semua pasien dalam wilayah Anda sudah aktif dan tidak menunggu tindakan."
          />
        ) : (
          <>
            {onboarding.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {onboarding.map((bucket) => {
                  const Icon = ICONS[bucket.key] ?? ClipboardListIcon
                  return (
                    <li key={bucket.key} className="rounded-lg border border-border p-3">
                      <div className="flex items-center gap-2">
                        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm font-semibold">{bucket.label}</span>
                        <Badge variant="warning" className="ml-auto">
                          {bucket.count}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{bucket.description}</p>
                      <ul className="mt-2 space-y-1">
                        {bucket.items.map((item) => (
                          <li key={`${bucket.key}-${item.patientId}`} className="text-xs">
                            <Link
                              href={`/patients/${item.patientId}`}
                              className="font-medium underline underline-offset-2"
                            >
                              {item.fullName}
                            </Link>
                            <span className="text-muted-foreground"> — {item.reasons.join('; ')}</span>
                          </li>
                        ))}
                      </ul>
                      {bucket.count > bucket.items.length ? (
                        <Link
                          href="/patients"
                          className="mt-2 inline-block text-xs underline underline-offset-2"
                        >
                          Lihat {bucket.count - bucket.items.length} lainnya di Data Pasien
                        </Link>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}

            {safety.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {safety.map((bucket) => {
                  const Icon = ICONS[bucket.key] ?? ShieldAlertIcon
                  return (
                    <li
                      key={bucket.key}
                      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
                    >
                      <Icon className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-semibold">
                          {bucket.label}: {bucket.count}
                        </p>
                        <p className="text-xs text-muted-foreground">{bucket.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </>
        )}

      </CardContent>
    </Card>
  )
}
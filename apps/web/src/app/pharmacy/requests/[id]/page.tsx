'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, HistoryIcon, PackageIcon, TriangleAlertIcon } from 'lucide-react'
import {
  getMedicationRequest,
  type MedicationRequestAction,
  type MedicationRequestItem,
} from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PharmacyActionSheet } from '@/components/pharmacy/action-sheet'
import {
  actionsForStatus,
  ACTION_LABEL,
  formatDate,
  formatDateTime,
  SourceBadge,
  StatusBadge,
} from '@/components/pharmacy/status-badge'

export default function PharmacyRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [request, setRequest] = useState<MedicationRequestItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sheetAction, setSheetAction] = useState<MedicationRequestAction | null>(null)

  const load = useCallback(async () => {
    try {
      setRequest(await getMedicationRequest(id))
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat permintaan obat')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      try {
        const result = await getMedicationRequest(id)
        if (isCancelled) return
        setRequest(result)
        setError(null)
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat permintaan obat')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [id])

  if (isLoading) {
    return (
      <div className="space-y-7">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !request) {
    return (
      <Alert variant="danger" icon={<TriangleAlertIcon />}>
        <p>{error}</p>
        <Link
          href="/pharmacy/queue"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-2"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
          Kembali ke antrean
        </Link>
      </Alert>
    )
  }

  const actions = actionsForStatus(request.status)

  return (
    <>
      <PageHeader
        kicker="Antrean Obat"
        title={request.patientName}
        description={request.patientPhone}
        actions={
          <>
            <StatusBadge status={request.status} />
            <SourceBadge source={request.source} />
          </>
        }
      />

      {request.isOverdue ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          Lewat batas pengambilan {formatDate(request.dueAt)}. Sistem akan mengeskalasi ke keluarga
          lalu nakes bila tetap tidak diambil.
        </Alert>
      ) : null}

      <Card data-reveal className="reveal">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <PackageIcon className="size-4 text-primary" aria-hidden="true" />
            {request.medicationName}
          </CardTitle>
          <CardDescription>
            {request.dosage ?? 'Dosis tidak dicatat'} · {request.form.toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <InfoRow label="Jumlah diminta" value={`${request.requestedQuantity} hari`} />
            <InfoRow
              label="Jumlah disetujui"
              value={
                request.approvedQuantity !== null
                  ? `${request.approvedQuantity} hari`
                  : 'Menunggu dokter'
              }
            />
            <InfoRow label="Jatuh tempo" value={formatDate(request.dueAt)} />
            <InfoRow
              label="Sisa stok pasien"
              value={request.quantityRemaining !== null ? `${request.quantityRemaining} hari` : '—'}
            />
            {request.reasonLabel ? (
              <InfoRow label="Alasan permintaan" value={request.reasonLabel} />
            ) : null}
            {request.reasonNotes ? <InfoRow label="Catatan pasien" value={request.reasonNotes} /> : null}
            {request.doctorName ? (
              <InfoRow
                label="Diputuskan oleh"
                value={`${request.doctorName}${request.decidedAt ? ` · ${formatDateTime(request.decidedAt)}` : ''}`}
              />
            ) : null}
            {request.doctorDecisionNote ? (
              <InfoRow label="Catatan dokter" value={request.doctorDecisionNote} />
            ) : null}
            {request.blockedReason ? (
              <InfoRow label="Alasan diblokir" value={request.blockedReason} />
            ) : null}
            {request.substituteName ? (
              <InfoRow
                label="Obat pengganti"
                value={
                  request.isSubstituteApproved
                    ? `${request.substituteName} (disetujui dokter)`
                    : `${request.substituteName} (menunggu dokter)`
                }
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card data-reveal className="reveal">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4 text-primary" aria-hidden="true" />
            Riwayat Status
          </CardTitle>
          <CardDescription>Setiap perubahan status tercatat beserta pelaku dan waktunya.</CardDescription>
        </CardHeader>
        <CardContent>
          {(request.events ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada riwayat perubahan status.</p>
          ) : (
            <ol className="space-y-4">
              {(request.events ?? []).map((event) => (
                <li key={event.id} className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {ACTION_LABEL[event.action as MedicationRequestAction] ?? event.action}
                    </p>
                    {event.note ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{event.note}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">{event.actorName ?? 'Sistem'}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {actions.length > 0 ? (
        <Card data-reveal className="reveal">
          <CardContent className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                variant={
                  action === 'DISPENSED'
                    ? 'default'
                    : action === 'MARK_OUT_OF_STOCK' || action === 'MARK_SUBSTITUTED'
                      ? 'destructive'
                      : 'outline'
                }
                onClick={() => setSheetAction(action)}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/pharmacy/queue">
            <ArrowLeftIcon aria-hidden="true" />
            Kembali ke antrean obat
          </Link>
        </Button>
      </div>

      {sheetAction ? (
        <PharmacyActionSheet
          request={request}
          action={sheetAction}
          onCancel={() => setSheetAction(null)}
          onDone={() => {
            setSheetAction(null)
            void load()
          }}
        />
      ) : null}
    </>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  )
}
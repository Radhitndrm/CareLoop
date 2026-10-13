'use client'

import { useState } from 'react'
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  HeartPulseIcon,
  Loader2Icon,
  MapPinOffIcon,
  MapPinIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SirenIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEmergencyAlerts, type EmergencyAlertItem } from '@/hooks/use-emergency-alerts'
import { Alert } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function formatWibTime(isoString: string) {
  try {
    return (
      new Date(isoString).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Jakarta',
      }) + ' WIB'
    )
  } catch {
    return isoString
  }
}

function AlertRow({
  alert,
  isHandling,
  isHandled,
  isJustHandled,
  onHandle,
}: {
  alert: EmergencyAlertItem
  isHandling: boolean
  isHandled: boolean
  isJustHandled: boolean
  onHandle: (alert: EmergencyAlertItem) => void
}) {
  const hasLocation = Boolean(alert.location?.lat && alert.location?.lng)
  const mapsUrl = hasLocation
    ? `https://www.google.com/maps?q=${alert.location!.lat},${alert.location!.lng}`
    : null

  return (
    <li
      className={cn(
        'rounded-xl border p-3.5',
        isHandled ? 'border-border bg-muted/40' : 'border-danger-border bg-danger-surface/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">{alert.patientName}</p>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatWibTime(alert.triggeredAt)}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
          <span
            className={cn(
              'size-1.5 rounded-full',
              isHandled ? 'bg-success' : 'animate-ping bg-destructive',
            )}
          />
          {alert.triggerType === 'ANOMALY_HR'
            ? `Anomali${alert.hrBpm ? ` ${alert.hrBpm} bpm` : ''}`
            : alert.triggerType}
        </span>
        {alert.livingSituation === 'ALONE' ? (
          <Badge variant="warning">Tinggal sendiri</Badge>
        ) : null}
        {alert.districtCode ? (
          <Badge variant="neutral" className="font-mono">
            {alert.districtCode}
          </Badge>
        ) : null}
      </div>

      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2"
        >
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          Buka di Maps ({alert.location!.lat!.toFixed(3)}, {alert.location!.lng!.toFixed(3)})
        </a>
      ) : (
        <span className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPinOffIcon className="size-3.5 shrink-0" aria-hidden="true" />
          Lokasi tidak tersedia
        </span>
      )}

      <div className="mt-3">
        {isHandled ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <BadgeCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
            Sudah ditangani
          </span>
        ) : (
          <Button
            size="sm"
            className="w-full"
            disabled={isHandling}
            onClick={() => onHandle(alert)}
          >
            {isHandling ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <HeartPulseIcon aria-hidden="true" />
            )}
            {isHandling ? 'Memproses…' : 'Saya tangani'}
          </Button>
        )}
      </div>

      {isJustHandled ? (
        <p className="mt-2 inline-flex items-start gap-1 text-[11px] font-semibold text-success">
          <CircleCheckIcon className="mt-px size-3 shrink-0" aria-hidden="true" />
          Eskalasi darurat dihentikan.
        </p>
      ) : null}
    </li>
  )
}

/**
 * Kartu darurat di kolom kanan dashboard. Menempel selama barisnya masih
 * terlihat (`.sticky-cell`), jadi peringatan tidak keluar dari pandangan tanpa
 * menyisakan kolom kosong ketika memang tidak adaapa-apa.
 *
 * Isinya adaptif: tanpa alert aktif kartu ini menyusut jadi strip ringkas
 * "semua stabil" di bawah judul.
 */
export function EmergencyCard() {
  const {
    alerts,
    activeAlerts,
    isConnected,
    isLoading,
    handlingAlertId,
    handleEmergency,
    refreshAlerts,
  } = useEmergencyAlerts()

  const [handlingSuccessId, setHandlingSuccessId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const onHandleClick = async (alert: EmergencyAlertItem) => {
    setErrorMessage(null)
    try {
      await handleEmergency(alert)
      setHandlingSuccessId(alert.id)
      setTimeout(() => setHandlingSuccessId(null), 4000)
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Gagal mengirim respons penanganan')
    }
  }

  const hasActive = activeAlerts.length > 0

  return (
    <div className="flex flex-col gap-3" data-reveal>
      <Card size="sm" className="gap-0 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-lg',
                hasActive ? 'bg-danger-surface text-danger' : 'bg-success-surface text-success',
              )}
            >
              <SirenIcon className="size-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">Darurat</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => refreshAlerts()}
            disabled={isLoading}
            aria-label="Segarkan data alert"
            className="size-7"
          >
            <RefreshCwIcon className={cn('size-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Badge variant={hasActive ? 'destructive' : 'success'}>
            <span
              className={cn(
                'size-1.5 rounded-full',
                isConnected
                  ? 'animate-ping bg-success'
                  : 'bg-warning',
              )}
            />
            {hasActive ? `${activeAlerts.length} aktif` : 'Semua stabil'}
          </Badge>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <ShieldCheckIcon className="size-3" aria-hidden="true" />
            {isConnected ? 'Real-time' : 'Menyambung'}
          </span>
        </div>
      </Card>

      {errorMessage ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {errorMessage}
        </Alert>
      ) : null}

      {alerts.length > 0 ? (
        <Card size="sm" className="flex flex-col gap-3 p-3">
          <ul className="no-scrollbar max-h-[26rem] space-y-2.5 overflow-y-auto">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                isHandling={handlingAlertId === alert.id}
                isHandled={alert.isHandled || alert.status === 'HANDLED'}
                isJustHandled={handlingSuccessId === alert.id}
                onHandle={onHandleClick}
              />
            ))}
          </ul>
        </Card>
      ) : (
        <Card size="sm" className="p-4">
          <CardContent className="flex flex-col items-center gap-2 px-0 text-center">
            <CircleCheckIcon className="size-6 text-success" aria-hidden="true" />
            <p className="text-sm font-medium">Tidak ada peringatan</p>
            <p className="text-xs text-muted-foreground">
              Seluruh pasien dalam kondisi stabil. Anomali detak jantung dipantau real-time.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
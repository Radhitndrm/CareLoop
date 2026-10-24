'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  HeartPulseIcon,
  Loader2Icon,
  MessageCircleIcon,
  PhoneCallIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  TimerIcon,
} from 'lucide-react'
import {
  ApiError,
  getSimulatorMessages,
  getSimulatorThreads,
  resetSimulator,
  replySimulatorMessage,
  setSimulatorProviderFailure,
  triggerSimulatorScenario,
  type SimulatorMessage,
  type SimulatorScenario,
  type SimulatorThread,
} from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { cn } from '@/lib/utils'

const SCENARIOS: Array<{
  id: SimulatorScenario
  label: string
  hint: string
  icon: typeof TimerIcon
}> = [
  {
    id: 'REMINDER_CONFIRMED',
    label: 'A · Reminder → Sudah Minum',
    hint: 'Reminder terkirim, pasien menekan tombol, kepatuhan terkonfirmasi.',
    icon: CheckCircle2Icon,
  },
  {
    id: 'REMINDER_NO_RESPONSE',
    label: 'B · Tidak merespons → eskalasi',
    hint: 'Pasien diam, sistem pindah ke keluarga, keluarga menekan "Saya Tangani".',
    icon: TimerIcon,
  },
  {
    id: 'HEART_RATE_ANOMALY',
    label: 'C · Anomali denyut jantung',
    hint: 'Smartwatch mendeteksi anomali, pasien ditanya aman atau butuh bantuan.',
    icon: HeartPulseIcon,
  },
  {
    id: 'PROVIDER_FAILURE',
    label: 'D · Gagal kirim → retry',
    hint: 'Simulasi provider gagal, pengiriman dicatat gagal lalu diulang.',
    icon: AlertTriangleIcon,
  },
]

const STATUS_VARIANT: Record<string, 'neutral' | 'info' | 'success' | 'destructive'> = {
  SENT: 'neutral',
  DELIVERED: 'info',
  READ: 'success',
  FAILED: 'destructive',
}

function formatWib(iso: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function WhatsAppSimulatorPanel() {
  const [threads, setThreads] = useState<SimulatorThread[]>([])
  const [activePhone, setActivePhone] = useState<string | null>(null)
  const [messages, setMessages] = useState<SimulatorMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [failureSimulated, setFailureSimulated] = useState(false)

  const loadThreads = useCallback(async () => {
    const list = await getSimulatorThreads()
    setThreads(list)
    return list
  }, [])

  const loadMessages = useCallback(async (phone?: string | null) => {
    const { messages: list } = await getSimulatorMessages(phone ?? undefined)
    setMessages(list)
    return list
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await loadThreads()
      const target = activePhone ?? list[0]?.recipient.phone ?? null
      setActivePhone(target)
      await loadMessages(target)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal memuat data simulator')
    } finally {
      setLoading(false)
    }
  }, [activePhone, loadMessages, loadThreads])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const list = await getSimulatorThreads()
        const target = activePhone ?? list[0]?.recipient.phone ?? null
        const { messages: loaded } = await getSimulatorMessages(target ?? undefined)
        if (cancelled) return
        setThreads(list)
        setActivePhone(target)
        setMessages(loaded)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Gagal memuat data simulator')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    // Poll ringan supaya presenter tidak perlu klik saat state berubah di modul lain
    // (scheduler, webhook, timeout eskalasi yang jalan sendiri).
    const timer = setInterval(() => {
      if (cancelled) return
      void loadThreads().catch(() => undefined)
      void loadMessages(activePhone).catch(() => undefined)
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activePhone, loadMessages, loadThreads])

  async function runScenario(scenario: SimulatorScenario) {
    setBusyKey(scenario)
    setError(null)
    setNotice(null)
    try {
      const outcome = await triggerSimulatorScenario(scenario)
      setNotice(`${outcome.step} — hasil: ${JSON.stringify(outcome.summary)}`)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal menjalankan scenario')
    } finally {
      setBusyKey(null)
    }
  }

  async function pressButton(message: SimulatorMessage, buttonId: string) {
    setBusyKey(`${message.messageId}:${buttonId}`)
    setError(null)
    setNotice(null)
    try {
      const result = await replySimulatorMessage(message.messageId, buttonId)
      setNotice(`Balasan diproses · intent ${result.intent} · hasil ${result.outcome}`)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengirim balasan')
    } finally {
      setBusyKey(null)
    }
  }

  async function doReset() {
    setBusyKey('reset')
    setError(null)
    setNotice(null)
    try {
      const summary = await resetSimulator()
      setNotice(
        `Simulasi direset · ${summary.messagesCleared} pesan mock dihapus, ` +
          `${Object.values(summary.dbDeleted).reduce((a, b) => a + b, 0)} baris demo dibersihkan.`,
      )
      setConfirmingReset(false)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mereset simulasi')
    } finally {
      setBusyKey(null)
    }
  }

  async function toggleFailure() {
    const next = !failureSimulated
    setBusyKey('failure')
    try {
      await setSimulatorProviderFailure(next)
      setFailureSimulated(next)
      setNotice(
        next
          ? 'Simulasi kegagalan provider aktif. Trigger scenario D untuk melihat status Gagal.'
          : 'Simulasi kegagalan provider dimatikan. Silakan coba kirim ulang.',
      )
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengubah simulasi provider')
    } finally {
      setBusyKey(null)
    }
  }

  const activeThread = useMemo(
    () => threads.find((t) => t.recipient.phone === activePhone),
    [threads, activePhone],
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Scenario demo</CardTitle>
          <CardDescription>
            Setiap scenario memanggil service produksi yang sama — hanya waktu tunggunya yang
            dipendekkan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {SCENARIOS.map((scenario) => {
            const Icon = scenario.icon
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => void runScenario(scenario.id)}
                disabled={busyKey !== null}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent text-primary">
                  {busyKey === scenario.id ? (
                    <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Icon className="size-4" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{scenario.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {scenario.hint}
                  </span>
                </span>
              </button>
            )
          })}

          <div className="space-y-2 border-t pt-3">
            <Button
              variant={failureSimulated ? 'destructive' : 'outline'}
              size="sm"
              className="w-full"
              onClick={() => void toggleFailure()}
              disabled={busyKey !== null}
            >
              <PhoneCallIcon aria-hidden="true" />
              {failureSimulated ? 'Matikan kegagalan provider' : 'Simulasikan kegagalan provider'}
            </Button>

            {confirmingReset ? (
              <div className="space-y-2 rounded-lg border border-danger-border bg-danger-surface p-3">
                <p className="text-xs text-danger">
                  Reset menghapus seluruh percakapan mock dan baris demo (kepatuhan, eskalasi,
                  darurat). Data non-demo tidak disentuh.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => void doReset()}>
                    Ya, reset
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmingReset(false)}>
                    Batal
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setConfirmingReset(true)}
                disabled={busyKey !== null}
              >
                <RotateCcwIcon aria-hidden="true" />
                Reset simulasi
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCwIcon aria-hidden="true" />
              Muat ulang
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-[620px] flex-col">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MessageCircleIcon className="size-4" aria-hidden="true" />
              WhatsApp Simulator
            </CardTitle>
            <CardDescription>
              {activeThread
                ? `${activeThread.recipient.label} · ${activeThread.recipient.displayPhone}`
                : 'Belum ada percakapan. Jalankan salah satu scenario di sebelah kiri.'}
            </CardDescription>
          </div>
          {activeThread ? (
            <Badge variant={activeThread.hasUnanswered ? 'warning' : 'neutral'}>
              {activeThread.hasUnanswered ? 'Menunggu balasan' : 'Selesai'}
            </Badge>
          ) : null}
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {error ? (
            <Alert variant="danger" icon={<AlertTriangleIcon />}>
              <p className="font-medium">Balasan tidak diproses</p>
              <p className="mt-0.5">{error}</p>
            </Alert>
          ) : null}

          {notice ? (
            <Alert variant="success" icon={<CheckCircle2Icon />}>
              {notice}
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-2/3" />
              <Skeleton className="ml-auto h-14 w-1/2" />
              <Skeleton className="h-20 w-3/4" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyState
              icon={<MessageCircleIcon className="size-5" />}
              title="Belum ada pesan"
              description="Jalankan scenario A untuk melihat reminder obat masuk ke percakapan."
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              {messages.map((message) => (
                <MessageBubble
                  key={message.messageId}
                  message={message}
                  busyKey={busyKey}
                  onPress={(buttonId) => void pressButton(message, buttonId)}
                />
              ))}
            </div>
          )}

          {threads.length > 1 ? (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {threads.map((thread) => (
                <button
                  key={thread.recipient.phone}
                  type="button"
                  onClick={() => {
                    setActivePhone(thread.recipient.phone)
                    void loadMessages(thread.recipient.phone)
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    thread.recipient.phone === activePhone
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  {thread.recipient.label}
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function MessageBubble({
  message,
  busyKey,
  onPress,
}: {
  message: SimulatorMessage
  busyKey: string | null
  onPress: (buttonId: string) => void
}) {
  const outbound = message.direction === 'OUTBOUND'

  return (
    <div className={cn('flex flex-col gap-1.5', outbound ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-line shadow-sm',
          outbound
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm border border-border bg-card',
        )}
      >
        <p>{message.body}</p>

        {message.buttons.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {message.buttons.map((button) => (
              <button
                key={button.id}
                type="button"
                disabled={!button.actionable || busyKey !== null}
                title={button.disabledReason ?? undefined}
                onClick={() => onPress(button.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                  button.actionable
                    ? outbound
                      ? 'border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25'
                      : 'border-border bg-muted hover:bg-muted/70'
                    : 'cursor-not-allowed border-border/60 bg-muted/40 text-muted-foreground line-through',
                )}
              >
                {busyKey === `${message.messageId}:${button.id}` ? (
                  <Loader2Icon className="mr-1 inline size-3 animate-spin" aria-hidden="true" />
                ) : null}
                {button.title}
              </button>
            ))}
          </div>
        ) : null}

        {message.error ? (
          <p className="mt-2 text-xs font-medium opacity-90">Gagal dikirim: {message.error}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[11px] text-muted-foreground">
          {outbound ? 'CareLoop' : (message.from ?? 'Penerima')} · {formatWib(message.createdAt)} WIB
        </span>
        <Badge variant={STATUS_VARIANT[message.status] ?? 'neutral'} className="h-5 text-[10px]">
          {message.statusLabel}
        </Badge>
      </div>
    </div>
  )
}
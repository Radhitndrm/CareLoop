'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  CalendarClockIcon,
  ClipboardListIcon,
  Loader2Icon,
  PackageCheckIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import {
  generateRoutineRequests,
  getMedicationRequests,
  type MedicationRequestAction,
  type MedicationRequestItem,
  type MedicationRequestStatus,
} from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTableShell } from '@/components/data-table'
import { StatCard } from '@/components/stat-card'
import { PharmacyActionSheet } from '@/components/pharmacy/action-sheet'
import {
  formatDate,
  primaryAction,
  RemainingStock,
  SourceBadge,
  StatusBadge,
  ACTION_LABEL,
} from '@/components/pharmacy/status-badge'

type Tab = 'QUEUE' | 'PREPARING' | 'READY' | 'OVERDUE'

const TABS: Array<{ key: Tab; label: string; status?: MedicationRequestStatus; overdue?: boolean }> = [
  { key: 'QUEUE', label: 'Antrean', status: 'QUEUED' },
  { key: 'PREPARING', label: 'Disiapkan', status: 'PREPARING' },
  { key: 'READY', label: 'Siap diambil', status: 'READY' },
  { key: 'OVERDUE', label: 'Terlambat', overdue: true },
]

export default function PharmacyQueuePage() {
  const [items, setItems] = useState<MedicationRequestItem[]>([])
  const [summary, setSummary] = useState({
    queued: 0,
    preparing: 0,
    ready: 0,
    overdue: 0,
    pendingDoctor: 0,
  })
  const [tab, setTab] = useState<Tab>('QUEUE')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{
    request: MedicationRequestItem
    action: MedicationRequestAction
  } | null>(null)

  const load = useCallback(async () => {
    try {
      const activeTab = TABS.find((t) => t.key === tab)
      const result = await getMedicationRequests({
        status: activeTab?.status,
        overdue: activeTab?.overdue,
        search: search.trim() || undefined,
        limit: 100,
      })
      setItems(result.items)
      setSummary(result.summary)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat antrean obat')
    } finally {
      setIsLoading(false)
    }
  }, [tab, search])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      try {
        const activeTab = TABS.find((t) => t.key === tab)
        const result = await getMedicationRequests({
          status: activeTab?.status,
          overdue: activeTab?.overdue,
          search: search.trim() || undefined,
          limit: 100,
        })
        if (isCancelled) return
        setItems(result.items)
        setSummary(result.summary)
        setError(null)
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat antrean obat')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [tab, search])

  const runGenerate = async () => {
    setBusyId('generate')
    try {
      await generateRoutineRequests()
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal membuat permintaan rutin')
    } finally {
      setBusyId(null)
    }
  }

  const countFor = (key: Tab): number => {
    if (key === 'QUEUE') return summary.queued
    if (key === 'PREPARING') return summary.preparing
    if (key === 'READY') return summary.ready
    return summary.overdue
  }

  return (
    <>
      <PageHeader
        title="Antrean Obat"
        description="Persiapan & penyerahan obat pasien. Permintaan baru dari pasien masuk setelah disetujui dokter."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/pharmacy/dispensing">Riwayat Penyerahan</Link>
            </Button>
            <Button onClick={runGenerate} disabled={busyId === 'generate'}>
              {busyId === 'generate' ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : (
                <CalendarClockIcon aria-hidden="true" />
              )}
              Buat Jitter Rutin
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TABS.map((t) => (
          <StatCard
            key={t.key}
            title={t.label}
            value={countFor(t.key)}
            tone={t.key === 'OVERDUE' && countFor(t.key) > 0 ? 'danger' : 'default'}
            icon={<ClipboardListIcon className="size-5" aria-hidden="true" />}
          />
        ))}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="space-y-4">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
              <Badge variant={countFor(t.key) > 0 ? 'warning' : 'neutral'}>{countFor(t.key)}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableShell
        empty={items.length === 0 && !isLoading}
        toolbar={
          <>
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-[-0.011em]">
              <PackageCheckIcon className="size-4 text-primary" aria-hidden="true" />
              {TABS.find((t) => t.key === tab)?.label}
            </h2>
            <div className="relative w-full sm:w-72">
              <SearchIcon
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari pasien atau obat…"
                className="h-9 pl-9"
                aria-label="Cari antrean obat"
              />
            </div>
          </>
        }
      >
        {error ? (
          <div className="p-4">
            <Alert variant="danger" icon={<TriangleAlertIcon />}>
              {error}
            </Alert>
          </div>
        ) : null}

        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PackageCheckIcon className="size-5" aria-hidden="true" />}
            title="Antrean kosong"
            description="Belum ada permintaan obat pada status ini. Permintaan rutin dibuat otomatis tiga hari sebelum tanggal ambil."
          />
        ) : (
          <div className="data-table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3.5">Pasien</th>
                  <th className="px-4 py-3.5">Obat</th>
                  <th className="px-4 py-3.5">Jumlah</th>
                  <th className="px-4 py-3.5">Sumber</th>
                  <th className="px-4 py-3.5">Jatuh Tempo</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const main = primaryAction(item.status)
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-3.5">
                        <Link href={`/pharmacy/requests/${item.id}`} className="font-medium hover:underline">
                          {item.patientName}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">{item.patientPhone}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        {item.medicationName}
                        {item.dosage ? (
                          <span className="ml-1 text-xs text-muted-foreground">{item.dosage}</span>
                        ) : null}
                        <div className="mt-0.5">
                          <RemainingStock days={item.quantityRemaining} />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">{item.effectiveQuantity} hari</td>
                      <td className="px-4 py-3.5">
                        <SourceBadge source={item.source} />
                        {item.reasonLabel ? (
                          <p className="mt-1 text-xs text-muted-foreground">{item.reasonLabel}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        {formatDate(item.dueAt)}
                        {item.isOverdue ? (
                          <span className="mt-0.5 block text-xs font-semibold text-danger">
                            Terlambat diambil
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {main ? (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="xs"
                              disabled={busyId === item.id}
                              onClick={() => setSheet({ request: item, action: main })}
                            >
                              {ACTION_LABEL[main]}
                            </Button>
                            {item.status !== 'READY' ? (
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={busyId === item.id}
                                onClick={() => setSheet({ request: item, action: 'MARK_OUT_OF_STOCK' })}
                              >
                                Stok kosong
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <Link
                            href={`/pharmacy/requests/${item.id}`}
                            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                          >
                            Lihat
                          </Link>
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

      {sheet ? (
        <PharmacyActionSheet
          request={sheet.request}
          action={sheet.action}
          onCancel={() => setSheet(null)}
          onDone={() => {
            setSheet(null)
            void load()
          }}
        />
      ) : null}
    </>
  )
}
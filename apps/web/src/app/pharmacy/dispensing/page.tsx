'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeftIcon, HistoryIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getDispensingRecords, type DispensingRecord } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { DataTableShell } from '@/components/data-table'
import { formatDate, formatDateTime } from '@/components/pharmacy/status-badge'

interface Filters {
  search: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { search: '', from: '', to: '' }

export default function DispensingHistoryPage() {
  // `draft` mengikuti yang diketik pengguna; `applied` hanya berubah saat form
  // disubmit. Pemisahan ini mencegah pemanggilan API ulang tiap ketikan.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS)
  const [records, setRecords] = useState<DispensingRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      try {
        const result = await getDispensingRecords({
          search: applied.search || undefined,
          from: applied.from || undefined,
          to: applied.to || undefined,
        })
        if (isCancelled) return
        setRecords(result)
        setError(null)
      } catch (err: unknown) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat riwayat penyerahan')
        }
      } finally {
        if (!isCancelled) setIsLoading(false)
      }
    }

    void fetchData()
    return () => {
      isCancelled = true
    }
  }, [applied])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setIsLoading(true)
    setApplied(draft)
  }

  const reset = () => {
    setDraft(EMPTY_FILTERS)
    setIsLoading(true)
    setApplied(EMPTY_FILTERS)
  }

  return (
    <>
      <PageHeader
        kicker="Antrean Obat"
        title="Riwayat Penyerahan"
        description="Setiap penyerahan obat beserta petugas, jumlah jatah, dan tanggal ambil berikutnya."
      />

      <DataTableShell
        empty={records.length === 0 && !isLoading}
        toolbar={
          <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-2">
            <Input
              value={draft.search}
              onChange={(e) => setDraft((prev) => ({ ...prev, search: e.target.value }))}
              placeholder="Cari nama pasien…"
              aria-label="Cari pasien"
              className="h-9 min-w-48 flex-1"
            />
            <Input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((prev) => ({ ...prev, from: e.target.value }))}
              aria-label="Tanggal mulai"
              className="h-9 w-auto"
            />
            <span className="text-xs text-muted-foreground">s/d</span>
            <Input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((prev) => ({ ...prev, to: e.target.value }))}
              aria-label="Tanggal akhir"
              className="h-9 w-auto"
            />
            <Button type="submit" size="sm">
              Cari
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              Reset
            </Button>
          </form>
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
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            icon={<HistoryIcon className="size-5" aria-hidden="true" />}
            title="Belum ada riwayat"
            description="Riwayat akan muncul di sini setelah petugas menyerahkan obat pertama kali."
          />
        ) : (
          <div className="data-table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3.5">Tanggal</th>
                  <th className="px-4 py-3.5">Pasien</th>
                  <th className="px-4 py-3.5">Obat</th>
                  <th className="px-4 py-3.5">Jumlah</th>
                  <th className="px-4 py-3.5">Ambil Berikutnya</th>
                  <th className="px-4 py-3.5">Petugas</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatDateTime(record.dispensedAt)}
                    </td>
                    <td className="px-4 py-3.5 font-medium">{record.patientName}</td>
                    <td className="px-4 py-3.5">{record.medicationName}</td>
                    <td className="px-4 py-3.5 tabular-nums text-muted-foreground">
                      {record.quantityDays} hari
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatDate(record.nextPickupDate)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{record.pharmacistName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataTableShell>

      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/pharmacy/queue">
            <ArrowLeftIcon aria-hidden="true" />
            Kembali ke antrean obat
          </Link>
        </Button>
      </div>
    </>
  )
}
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ClipboardCheckIcon,
  ExternalLinkIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from 'lucide-react'
import { useAuth } from '@/lib/auth'
import {
  decideMedicationRequest,
  getMedicationRequests,
  type MedicationRequestItem,
} from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, Skeleton } from '@/components/ui/feedback'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/components/pharmacy/status-badge'

export default function DoctorRequestsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<MedicationRequestItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // useSyncExternalStore di lib/auth membuat `user` tersedia pada render pertama,
  // jadi tidak perlu penanda "auth sudah selesai dimuat" seperti di modul lain.
  const canDecide =
    user?.role === 'ADMIN' || user?.nakesRole === 'DOKTER' || user?.nakesRole === 'BIDAN'

  const load = useCallback(async () => {
    if (!canDecide) {
      setIsLoading(false)
      return
    }
    try {
      const result = await getMedicationRequests({ status: 'PENDING_DOCTOR', limit: 100 })
      setItems(result.items)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal memuat permintaan obat')
    } finally {
      setIsLoading(false)
    }
  }, [canDecide])

  useEffect(() => {
    let isCancelled = false

    async function fetchData() {
      if (!canDecide) {
        setIsLoading(false)
        return
      }
      try {
        const result = await getMedicationRequests({ status: 'PENDING_DOCTOR', limit: 100 })
        if (isCancelled) return
        setItems(result.items)
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
  }, [canDecide])

  if (!canDecide) {
    return (
      <Alert variant="warning" icon={<TriangleAlertIcon />}>
        <p>
          Halaman ini khusus dokter dan bidan. Petugas farmasi memproses antrean di halaman Antrean
          Obat.
        </p>
        <Link
          href="/dashboard"
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline underline-offset-2"
        >
          Kembali ke dashboard
        </Link>
      </Alert>
    )
  }

  return (
    <>
      <PageHeader
        title="Permintaan Obat"
        description="Permintaan di luar jadwal rutin wajib disetujui sebelum masuk antrean farmasi."
        actions={<Badge variant={items.length > 0 ? 'warning' : 'success'}>{items.length} menunggu</Badge>}
      />

      {error ? (
        <Alert variant="danger" icon={<TriangleAlertIcon />}>
          {error}
        </Alert>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ClipboardCheckIcon className="size-5" aria-hidden="true" />}
              title="Tidak ada permintaan menunggu"
              description="Semua permintaan obat sudah diputuskan. Permintaan baru akan muncul di sini dan memberi notifikasi WhatsApp."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <DecisionCard key={item.id} item={item} onDecided={load} />
          ))}
        </div>
      )}
    </>
  )
}

function noteRequiredHint(item: MedicationRequestItem): string {
  return item.source === 'PATIENT_REQUEST'
    ? 'mis. Setuju sebagian, sisanya sesuai jadwal'
    : 'opsional bila menyetujui'
}

function DecisionCard({
  item,
  onDecided,
}: {
  item: MedicationRequestItem
  onDecided: () => void
}) {
  const [quantity, setQuantity] = useState(String(item.requestedQuantity))
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState<'APPROVED' | 'REJECTED' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    setError(null)
    if (decision === 'REJECTED' && note.trim().length === 0) {
      setError('Alasan wajib diisi saat menolak permintaan.')
      return
    }
    setIsSaving(decision)
    try {
      await decideMedicationRequest(item.id, {
        decision,
        ...(decision === 'APPROVED' ? { approvedQuantity: Number(quantity) } : {}),
        ...(decision === 'REJECTED' ? { note: note.trim() } : {}),
      })
      onDecided()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan keputusan')
    } finally {
      setIsSaving(null)
    }
  }

  return (
    <Card data-reveal className="reveal">
      <CardHeader className="border-b border-border">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <UserRoundIcon className="size-4 text-primary" aria-hidden="true" />
              {item.patientName}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {item.patientPhone}
              </span>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {item.medicationName} {item.dosage ?? ''} · diminta {item.requestedQuantity} hari
              {item.quantityRemaining !== null ? ` · sisa stok ${item.quantityRemaining} hari` : ''}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.reasonLabel ?? 'Permintaan'} — {item.reasonNotes || 'tanpa catatan'} · dibuat{' '}
              {formatDateTime(item.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <Badge variant="neutral">Jatuh tempo {formatDate(item.dueAt)}</Badge>
            <Link
              href={`/patients/${item.patientId}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Lihat profil pasien
              <ExternalLinkIcon className="size-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`qty-${item.id}`}>Jumlah yang disetujui (hari)</Label>
            <Input
              id={`qty-${item.id}`}
              type="number"
              min={1}
              max={365}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`note-${item.id}`}>Catatan dokter</Label>
            <Input
              id={`note-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteRequiredHint(item)}
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Catatan wajib diisi bila menolak — alasan ini dikirim ke pasien dan keluarga.
        </p>

        {error ? (
          <Alert variant="danger" icon={<TriangleAlertIcon />} className="mt-3">
            {error}
          </Alert>
        ) : null}
      </CardContent>

      <CardFooter className="justify-end gap-2">
        <Button
          variant="destructive"
          disabled={isSaving !== null}
          onClick={() => decide('REJECTED')}
        >
          {isSaving === 'REJECTED' ? 'Menyimpan…' : 'Tolak'}
        </Button>
        <Button disabled={isSaving !== null} onClick={() => decide('APPROVED')}>
          {isSaving === 'APPROVED' ? 'Menyimpan…' : 'Setujui & Masukkan Antrean'}
        </Button>
      </CardFooter>
    </Card>
  )
}
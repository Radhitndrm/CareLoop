import type { MedicationRequestAction, MedicationRequestItem } from '@/lib/api'
import { Badge, type BadgeProps } from '@/components/ui/badge'

export const STATUS_LABEL: Record<string, string> = {
  PENDING_DOCTOR: 'Menunggu dokter',
  QUEUED: 'Masuk antrean',
  PREPARING: 'Sedang disiapkan',
  READY: 'Siap diambil',
  DISPENSED: 'Sudah diserahkan',
  REJECTED: 'Ditolak dokter',
  OUT_OF_STOCK: 'Stok kosong',
  SUBSTITUTED: 'Diganti obatnya',
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING_DOCTOR: 'warning',
  QUEUED: 'neutral',
  PREPARING: 'info',
  READY: 'success',
  DISPENSED: 'success',
  REJECTED: 'destructive',
  OUT_OF_STOCK: 'warning',
  SUBSTITUTED: 'info',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  )
}

/**
 * Aksi yang ditawarkan sesuai status. Status final (DISPENSED/REJECTED/
 * OUT_OF_STOCK/SUBSTITUTED) sengaja tidak punya tombol — semua transisi sudah
 * divalidasi state machine di backend, jadi UI tidak perlu menawarinya.
 */
export function actionsForStatus(status: MedicationRequestItem['status']): MedicationRequestAction[] {
  switch (status) {
    case 'QUEUED':
    case 'PREPARING':
    case 'READY':
      return ['START_PREPARING', 'MARK_READY', 'DISPENSED', 'MARK_OUT_OF_STOCK', 'MARK_SUBSTITUTED']
    default:
      return []
  }
}

export const ACTION_LABEL: Record<MedicationRequestAction, string> = {
  APPROVED: 'Setujui',
  REJECTED: 'Tolak',
  START_PREPARING: 'Mulai siapkan',
  MARK_READY: 'Siap diambil',
  DISPENSED: 'Sudah diserahkan',
  MARK_OUT_OF_STOCK: 'Stok kosong',
  MARK_SUBSTITUTED: 'Diganti',
  RETURNED_TO_QUEUE: 'Kembalikan ke antrean',
}

/** Aksi utama per status — tombol besar di kolom Aksi tabel antrean. */
export function primaryAction(status: MedicationRequestItem['status']): MedicationRequestAction | null {
  switch (status) {
    case 'QUEUED':
      return 'START_PREPARING'
    case 'PREPARING':
      return 'MARK_READY'
    case 'READY':
      return 'DISPENSED'
    default:
      return null
  }
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })
}

export function SourceBadge({ source }: { source: MedicationRequestItem['source'] }) {
  const rutin = source === 'ROUTINE'
  return <Badge variant={rutin ? 'neutral' : 'info'}>{rutin ? 'Rutin' : 'Disetujui dokter'}</Badge>
}

/** Sisa stok obat pasien — membantu apotek menilai apakah jumlah wajar. */
export function RemainingStock({ days }: { days: number | null }) {
  if (days === null) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={`text-xs font-medium ${days <= 3 ? 'text-warning' : 'text-muted-foreground'}`}>
      sisa {days} hari
    </span>
  )
}
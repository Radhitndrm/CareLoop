'use client'

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  CircleCheckIcon,
  LoaderCircleIcon,
  PackageCheckIcon,
  PackageIcon,
  PackageXIcon,
  RepeatIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import {
  changeMedicationRequestStatus,
  type MedicationRequestAction,
  type MedicationRequestItem,
} from '@/lib/api'
import { ACTION_LABEL } from './status-badge'
import { Alert } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface Props {
  request: MedicationRequestItem
  action: MedicationRequestAction
  onDone: () => void
  onCancel: () => void
}

/**
 * Alasan wajib untuk stok kosong & penggantian, jumlah hari wajib untuk
 * diserahkan. Aturan ini divalidasi ulang di backend (zod), form di sini
 * hanya agar petugas tidak sampai mengetik alasan yang sia-sia.
 */
function requiresReason(action: MedicationRequestAction): boolean {
  return action === 'MARK_OUT_OF_STOCK' || action === 'MARK_SUBSTITUTED'
}

const PROMPT: Record<MedicationRequestAction, string> = {
  APPROVED: '',
  REJECTED: '',
  START_PREPARING: 'Tandai obat ini sedang disiapkan?',
  MARK_READY: 'Tandai obat siap diambil? Pasien dan keluarga akan diberi tahu lewat WhatsApp.',
  DISPENSED: 'Serahkan obat ini?',
  MARK_OUT_OF_STOCK: 'Tandai stok obat kosong. Alasan wajib diisi.',
  MARK_SUBSTITUTED: 'Tandai obat diganti. Alasan & nama obat pengganti wajib diisi.',
  RETURNED_TO_QUEUE: 'Kembalikan obat ini ke antrean?',
}

const ACTION_ICON: Record<MedicationRequestAction, LucideIcon> = {
  APPROVED: CircleCheckIcon,
  REJECTED: CircleCheckIcon,
  START_PREPARING: LoaderCircleIcon,
  MARK_READY: PackageCheckIcon,
  DISPENSED: PackageCheckIcon,
  MARK_OUT_OF_STOCK: PackageXIcon,
  MARK_SUBSTITUTED: RepeatIcon,
  RETURNED_TO_QUEUE: PackageIcon,
}

export function PharmacyActionSheet({ request, action, onDone, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const [substituteName, setSubstituteName] = useState('')
  const [quantityDays, setQuantityDays] = useState(String(request.effectiveQuantity))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needReason = requiresReason(action)
  const needSubstitute = action === 'MARK_SUBSTITUTED'
  const needQuantity = action === 'DISPENSED'

  const ActionIcon = ACTION_ICON[action]
  const quantityValid = !needQuantity || Number(quantityDays) >= 1
  const canSubmit =
    !isSaving &&
    quantityValid &&
    (!needReason || reason.trim().length >= 5) &&
    (!needSubstitute || substituteName.trim().length >= 2)

  const submit = async () => {
    if (!canSubmit) return
    setIsSaving(true)
    setError(null)
    try {
      await changeMedicationRequestStatus(request.id, {
        action,
        ...(needReason ? { reason: reason.trim() } : {}),
        ...(needSubstitute ? { substituteName: substituteName.trim() } : {}),
        ...(needQuantity ? { quantityDays: Number(quantityDays) } : {}),
      })
      onDone()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan perubahan status')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onCancel()}>
      <SheetContent className="w-[min(92vw,30rem)]">
        <SheetHeader icon={<ActionIcon className="size-4" />}>
          <SheetTitle>{ACTION_LABEL[action]}</SheetTitle>
          <SheetDescription>{PROMPT[action]}</SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
        <div className="rounded-xl bg-muted px-3 py-2.5 text-sm">
          <p className="font-medium">{request.patientName}</p>
          <p className="text-xs text-muted-foreground">
            {request.medicationName} {request.dosage ?? ''} · {request.effectiveQuantity} hari
          </p>
        </div>

        {needQuantity ? (
          <div className="space-y-2">
            <Label htmlFor="pharmacy-quantity">Jumlah hari yang diserahkan</Label>
            <Input
              id="pharmacy-quantity"
              type="number"
              min={1}
              max={365}
              value={quantityDays}
              onChange={(e) => setQuantityDays(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tanggal ambil berikutnya dihitung dari jumlah ini.
            </p>
          </div>
        ) : null}

        {needSubstitute ? (
          <div className="space-y-2">
            <Label htmlFor="pharmacy-substitute">Nama obat pengganti</Label>
            <Input
              id="pharmacy-substitute"
              value={substituteName}
              onChange={(e) => setSubstituteName(e.target.value)}
              placeholder="mis. Glucophage XR 500 mg"
            />
            <p className="text-xs text-muted-foreground">
              Penggantian tetap menunggu persetujuan dokter sebelum dipakai.
            </p>
          </div>
        ) : null}

        {needReason ? (
          <div className="space-y-2">
            <Label htmlFor="pharmacy-reason">
              Alasan <span className="text-danger">*</span>
            </Label>
            <Textarea
              id="pharmacy-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={
                needSubstitute
                  ? 'mis. Merek generik habis, diganti merek patent'
                  : 'mis. Stok metformin habis di gudang'
              }
            />
            <p className="text-xs text-muted-foreground">
              Alasan ini dibaca pasien lewat WhatsApp dan diteruskan ke dokter.
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="danger" icon={<TriangleAlertIcon />}>
            {error}
          </Alert>
        ) : null}
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" onClick={onCancel}>
            Batal
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {isSaving ? 'Menyimpan…' : ACTION_LABEL[action]}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
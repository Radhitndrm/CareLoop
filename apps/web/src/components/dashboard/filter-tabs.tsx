'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FilterIcon, RotateCcwIcon, SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const DISEASE_TABS = [
  { value: '', label: 'Semua penyakit' },
  { value: 'DIABETES', label: 'Diabetes' },
  { value: 'HYPERTENSION', label: 'Hipertensi' },
  { value: 'JANTUNG', label: 'Jantung' },
  { value: 'ASMA', label: 'Asma' },
] as const

const ESCALATION_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'WAITING_PATIENT', label: 'Menunggu Pasien' },
  { value: 'FAMILY_TIER_1', label: 'Tier 1 (Keluarga Dekat)' },
  { value: 'FAMILY_TIER_2', label: 'Tier 2 (Keluarga Jauh)' },
  { value: 'NAKES', label: 'Tier 3 (Nakes / Faskes)' },
  { value: 'HANDLED', label: 'Sudah Ditangani' },
]

/**
 * Filter dashboard (AC-5.2) — tetap sepenuhnya tersimpan di URL query string
 * supaya halaman ini bisa di-bookmark dan dibagikan.
 *
 * Tab cepat untuk penyakit yang paling sering dipakai; sisanya (wilayah, rentang
 * tanggal, status eskalasi) diletakkan di panel geser supaya baris utama tetap tipis.
 */
export function FilterTabs({ isLoading }: { isLoading?: boolean }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(false)

  const disease = searchParams.get('disease') || ''
  const district = searchParams.get('district') || ''
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''
  const escalationStatus = searchParams.get('escalationStatus') || ''

  const advancedCount = [district, from, to, escalationStatus].filter(Boolean).length
  const hasAnyFilter = Boolean(disease || advancedCount)

  const push = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    const query = next.toString()
    router.push(query ? `/dashboard?${query}` : '/dashboard')
  }

  const reset = () => router.push('/dashboard')

  return (
    <div className="reveal flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div
        className="tab-row no-scrollbar max-w-full overflow-x-auto"
        role="tablist"
        aria-label="Filter cepat penyakit"
      >
        {DISEASE_TABS.map((tab) => {
          const active = disease === tab.value
          return (
            <button
              key={tab.value || 'all'}
              type="button"
              role="tab"
              disabled={isLoading}
              aria-selected={active}
              onClick={() => push({ disease: tab.value })}
              className={cn('tab-row-item', active && 'is-active')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex shrink-0 items-center gap-2 pb-2 md:pb-0">
        {hasAnyFilter ? (
          <Button variant="ghost" size="sm" onClick={reset} disabled={isLoading}>
            <RotateCcwIcon aria-hidden="true" />
            Reset
          </Button>
        ) : null}

        <Button
          variant={advancedCount > 0 ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setIsOpen(true)}
        >
          {advancedCount > 0 ? <FilterIcon aria-hidden="true" /> : <SlidersHorizontalIcon aria-hidden="true" />}
          Filter lanjutan
          {advancedCount > 0 ? <Badge variant="warning">{advancedCount}</Badge> : null}
        </Button>
      </div>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="w-[min(92vw,28rem)]">
          <SheetHeader icon={<SlidersHorizontalIcon className="size-4" />}>
            <SheetTitle>Filter lanjutan</SheetTitle>
            <SheetDescription>
              Semua pilihan ikut tersimpan di URL — halaman ini bisa di-bookmark dan dibagikan.
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              push({
                district: String(data.get('district') ?? ''),
                from: String(data.get('from') ?? ''),
                to: String(data.get('to') ?? ''),
                escalationStatus: String(data.get('escalationStatus') ?? ''),
              })
              setIsOpen(false)
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <SheetBody className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="advanced-district">Kode wilayah / distrik</Label>
              <Input
                id="advanced-district"
                name="district"
                defaultValue={district}
                placeholder="Contoh: 347101"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="advanced-from">Dari tanggal</Label>
                <Input id="advanced-from" name="from" type="date" defaultValue={from} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="advanced-to">Sampai tanggal</Label>
                <Input id="advanced-to" name="to" type="date" defaultValue={to} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="advanced-escalation">Status eskalasi</Label>
              <NativeSelect
                id="advanced-escalation"
                name="escalationStatus"
                defaultValue={escalationStatus}
              >
                {ESCALATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            </SheetBody>

            <SheetFooter>
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                Batal
              </Button>
              <Button type="submit">Terapkan</Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
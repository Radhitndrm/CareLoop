import Link from 'next/link'
import { HeartPulseIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('brand-mark', className)} aria-hidden="true">
      <HeartPulseIcon className="size-5" strokeWidth={2.4} />
    </span>
  )
}

/**
 * Satu-satunya representasi brand di navbar. Teks disembunyikan di layar
 * sangat sempit supaya tidak berdesakan dengan tombol menu — bukan dengan
 * merender lockup kedua yang berbeda.
 */
export function BrandLockup({ caption }: { caption?: string }) {
  return (
    <Link href="/dashboard" className="brand-lockup" aria-label="CareLoop, beranda">
      <BrandMark />
      <span className="hidden min-w-0 sm:block">
        <span className="brand-name block">CareLoop</span>
        <span className="brand-caption block truncate">
          {caption ?? 'Monitoring Kepatuhan & Darurat'}
        </span>
      </span>
    </Link>
  )
}
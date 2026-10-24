import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center',
        className,
      )}
      aria-hidden="true"
    >
      <Image
        src="/logo.png"
        alt="CareLoop"
        width={58}
        height={40}
        className="h-10 w-auto object-contain transition-transform duration-200"
        priority
      />
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
    <Link
      href="/dashboard"
      className="brand-lockup group shrink-0 flex items-center gap-2.5"
      aria-label="CareLoop, beranda"
    >
      <BrandMark />
      <span className="hidden min-w-0 sm:flex sm:flex-col justify-center">
        <span className="brand-name block leading-tight font-semibold text-foreground group-hover:text-primary transition-colors">
          CareLoop
        </span>
        <span className="brand-caption hidden xl:block truncate text-xs text-muted-foreground max-w-50">
          {caption ?? 'Monitoring Kepatuhan & Darurat'}
        </span>
      </span>
    </Link>
  )
}

'use client'

import * as React from 'react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close

/**
 * Panel geser untuk form ubah/tambah data. Berbeda dengan `Dialog`, yang
 * dipakai khusus untuk konfirmasi singkat tanpa isian.
 *
 * Permukaannya sengaja mengikuti kartu: melayang dari tepi, sudut membulat,
 * cincin tipis, dan cahaya sudut yang sama.
 */
function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'left' | 'right'
}) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]',
          'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 data-open:duration-200 data-closed:duration-150',
        )}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'sheet-panel fixed top-3 bottom-3 z-50 flex w-[min(92vw,32rem)] flex-col bg-card text-card-foreground ring-1 ring-foreground/10',
          'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          'data-open:duration-300 data-closed:duration-200 [animation-timing-function:cubic-bezier(.22,1,.36,1)]',
          side === 'left'
            ? 'left-3 right-auto data-open:slide-in-from-left data-closed:slide-out-to-left'
            : 'right-3 left-auto data-open:slide-in-from-right data-closed:slide-out-to-right',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute top-4 right-4 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none">
          <XIcon className="size-4" />
          <span className="sr-only">Tutup</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

/** Kepala panel: ikon well + judul + keterangan, menempel di atas. */
function SheetHeader({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<'div'> & { icon?: React.ReactNode }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        'flex shrink-0 items-start gap-3 border-b border-border bg-muted/40 px-6 py-5 pr-14',
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Isi panel yang bisa digulir. */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('flex-1 overflow-y-auto px-6 py-6', className)}
      {...props}
    />
  )
}

/** Kaki panel: tombol aksi, menempel di bawah — sama dengan `CardFooter`. */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/50 px-6 py-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn('text-lg font-semibold tracking-[-0.015em]', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn('mt-1 text-sm leading-relaxed text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
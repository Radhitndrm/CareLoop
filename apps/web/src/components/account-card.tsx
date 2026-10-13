'use client'

import Link from 'next/link'
import { LogInIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { accountRoleLabel, hasClinicalAuthority } from '@/lib/nakes-role'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase()
}

/**
 * Kartu identitas petugas, di kolom kanan ringkasan dashboard. Menampilkan
 * siapa yang sedang masuk; aksi keluar akun ada di navbar.
 */
export function AccountCard() {
  const { user, isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <Card size="sm" className="p-4">
        <CardContent className="flex items-center gap-3 px-0">
          <span className="size-11 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!isAuthenticated || !user) {
    return (
      <Card size="sm" className="p-4">
        <CardContent className="flex items-center gap-3 px-0">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <LogInIcon className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Belum masuk</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Data belum termuat</p>
          </div>
          <Button asChild size="sm">
            <Link href="/login">Masuk</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const clinical = hasClinicalAuthority(user)

  return (
    <Card size="sm" data-reveal className="p-4">
      <CardContent className="px-0">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-full text-[13px] font-semibold',
              clinical
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/10 text-primary ring-1 ring-primary/25',
            )}
          >
            {initials(user.fullName || 'Nakes')}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">{user.fullName}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  clinical ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              />
              <span className="truncate">{accountRoleLabel(user)}</span>
            </p>
          </div>
        </div>

        {user.email ? (
          <p className="mt-3 truncate border-t border-border pt-3 text-xs text-muted-foreground">
            {user.email}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
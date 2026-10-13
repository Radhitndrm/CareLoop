'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOutIcon, MenuIcon, ShieldCheckIcon } from 'lucide-react'
import { BrandLockup } from '@/components/brand'
import { NavLinks, type NavItem } from '@/components/nav-links'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useAuth } from '@/lib/auth'
import { accountRoleLabel } from '@/lib/nakes-role'

type TopbarProps = {
  nav: NavItem[]
  roleLabel: string
}

function MobileNav({ nav, roleLabel }: TopbarProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="shell-icon-button lg:hidden"
          aria-label="Buka menu navigasi"
        >
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(90vw,21rem]">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigasi utama</SheetTitle>
          <SheetDescription>Pilih halaman yang ingin dibuka.</SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-4 py-5">
          <BrandLockup />
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto py-4">
          <NavLinks items={nav} orientation="vertical" showGroups />
        </div>

        <div className="border-t border-border px-4 py-4">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Masuk sebagai {roleLabel}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Navbar penuh tiga zona: brand · menu · akun.
 *
 * Zona kiri dan kanan sama-sama `flex-1` supaya menu berada tepat di tengah
 * dan tetap simetris berapa pun panjangnya.
 */
export function Topbar({ nav, roleLabel }: TopbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, isAuthenticated, isLoading, logout } = useAuth()

  // Di ringkasan dashboard, identitas petugas sudah tampil sebagai kartu di
  // kolom kanan; navbar hanya memegang aksi keluar akun.
  const hasAccountCard = pathname === '/dashboard'

  const handleLogout = () => {
    logout()
    router.push('/login')
  }

  return (
    <header className="app-topbar">
      <div className="topbar-inner mx-auto w-full max-w-[1440px] px-4 md:px-6 lg:px-8">
        {/* Zona kiri */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <MobileNav nav={nav} roleLabel={roleLabel} />
          <BrandLockup />
        </div>

        {/* Zona tengah */}
        <div className="hidden min-w-0 flex-none justify-center lg:flex">
          <NavLinks items={nav} className="no-scrollbar max-w-full overflow-x-auto py-1" />
        </div>

        <span className="mx-1 hidden h-6 w-px shrink-0 bg-border lg:block" aria-hidden="true" />

        {/* Zona kanan */}
        <div className="flex flex-1 items-center justify-end gap-2.5">
          {!isLoading && !hasAccountCard && isAuthenticated && user ? (
            <span className="topbar-pill">
              <ShieldCheckIcon aria-hidden="true" />
              <span className="hidden md:inline">{accountRoleLabel(user)}</span>
            </span>
          ) : null}

          {!isLoading && isAuthenticated ? (
            <Button
              variant="outline"
              size="icon"
              className="shell-icon-button"
              onClick={handleLogout}
              aria-label="Keluar akun"
              title="Keluar akun"
            >
              <LogOutIcon aria-hidden="true" />
            </Button>
          ) : !isLoading ? (
            <Button asChild size="sm">
              <Link href="/login">Masuk</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  )
}
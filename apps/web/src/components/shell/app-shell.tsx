import type { ReactNode } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'
import { Topbar } from '@/components/shell/topbar'
import type { NavItem } from '@/components/nav-links'

export function AppShell({
  nav,
  roleLabel,
  children,
}: {
  nav: NavItem[]
  roleLabel: string
  children: ReactNode
}) {
  return (
    <div className="app-workspace flex min-h-screen w-full flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3"
      >
        Lewati ke konten utama
      </a>

      <Topbar nav={nav} roleLabel={roleLabel} />

      <main
        id="main-content"
        className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-7 md:px-7 md:py-8 lg:px-8"
      >
        <div className="space-y-7">{children}</div>
      </main>

      <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap justify-between gap-2 border-t px-4 py-5 text-xs text-muted-foreground md:px-7 lg:px-8">
        <span>CareLoop · Kepatuhan pengobatan &amp; deteksi darurat (SDG 3 Digital Health).</span>
        <span className="flex items-center gap-1">
          Data sintetis untuk demo
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </span>
      </footer>
    </div>
  )
}
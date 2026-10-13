'use client'

import type { ReactNode } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { useWorkspaceNav } from '@/hooks/use-workspace-nav'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { nav, roleLabel } = useWorkspaceNav()

  return (
    <AppShell nav={nav} roleLabel={roleLabel}>
      {children}
    </AppShell>
  )
}
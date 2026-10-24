'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ActivityIcon,
  BellRingIcon,
  Building2Icon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  PillIcon,
  UsersIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ICONS = {
  dashboard: LayoutDashboardIcon,
  patients: UsersIcon,
  requests: ClipboardListIcon,
  pharmacy: PillIcon,
  emergency: BellRingIcon,
  nakes: ActivityIcon,
  clinics: Building2Icon,
  simulator: MessageCircleIcon,
} as const

export type NavIcon = keyof typeof ICONS

export type NavItem = {
  href: string
  label: string
  icon: NavIcon
  exact?: boolean
  group?: string
}

export function isNavItemActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href)
}

export function NavLinks({
  items,
  orientation = 'horizontal',
  onNavigate,
  showGroups = false,
  className,
}: {
  items: NavItem[]
  orientation?: 'horizontal' | 'vertical'
  onNavigate?: () => void
  showGroups?: boolean
  className?: string
}) {
  const pathname = usePathname()

  if (items.length === 0) return null

  // Label kelompok hanya bermakna di panel vertikal (drawer layar sempit).
  const groupStarts =
    showGroups && orientation === 'vertical'
      ? new Set(
          items
            .filter((item, index) => item.group && item.group !== items[index - 1]?.group)
            .map((item) => item.href),
        )
      : new Set<string>()

  return (
    <nav
      aria-label="Menu utama"
      className={cn(
        orientation === 'vertical' ? 'flex flex-col gap-1' : 'flex flex-row items-center gap-1',
        className,
      )}
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon]
        const active = isNavItemActive(pathname, item)
        return (
          <Fragment key={item.href}>
            {groupStarts.has(item.href) && item.group ? (
              <p className="nav-group-label">{item.group}</p>
            ) : null}
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={onNavigate}
              className={cn('topbar-nav-item', active && 'is-active')}
            >
              <span className="topbar-nav-icon" aria-hidden="true">
                <Icon className="size-[15px] shrink-0" />
              </span>
              <span className="nav-item-label">{item.label}</span>
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}
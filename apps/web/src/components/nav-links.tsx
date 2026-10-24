'use client'

import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ActivityIcon,
  BellRingIcon,
  Building2Icon,
  ChevronDownIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PillIcon,
  UsersIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  maxVisible = 5,
}: {
  items: NavItem[]
  orientation?: 'horizontal' | 'vertical'
  onNavigate?: () => void
  showGroups?: boolean
  className?: string
  maxVisible?: number
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

  // Jika horizontal dan jumlah item melebihi batas, pisahkan ke dropdown overflow ("...").
  const isHorizontal = orientation === 'horizontal'
  const hasOverflow = isHorizontal && items.length > maxVisible
  const visibleItems = hasOverflow ? items.slice(0, maxVisible) : items
  const overflowItems = hasOverflow ? items.slice(maxVisible) : []
  const hasActiveOverflow = overflowItems.some((item) => isNavItemActive(pathname, item))

  return (
    <nav
      aria-label="Menu utama"
      className={cn(
        orientation === 'vertical' ? 'flex flex-col gap-1' : 'flex flex-row items-center gap-1',
        className,
      )}
    >
      {visibleItems.map((item) => {
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

      {/* Menu dropdown titik tiga / Lainnya untuk item yang meluap */}
      {hasOverflow && overflowItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'topbar-nav-item cursor-pointer gap-1.5',
                hasActiveOverflow && 'is-active',
              )}
              aria-label="Menu navigasi lainnya"
              title="Menu lainnya"
            >
              <span className="topbar-nav-icon" aria-hidden="true">
                <MoreHorizontalIcon className="size-[15px] shrink-0" />
              </span>
              <span className="nav-item-label hidden xl:inline">Lainnya</span>
              <ChevronDownIcon className="size-3 opacity-60" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 p-1.5">
            {overflowItems.map((item, idx) => {
              const Icon = ICONS[item.icon]
              const active = isNavItemActive(pathname, item)
              const prevItem = overflowItems[idx - 1]
              const showHeader = item.group && item.group !== prevItem?.group
              return (
                <Fragment key={item.href}>
                  {showHeader ? (
                    <>
                      {idx > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel>{item.group}</DropdownMenuLabel>
                    </>
                  ) : null}
                  <DropdownMenuItem asChild>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors',
                        active
                          ? 'bg-primary/10 text-primary font-semibold'
                          : 'text-foreground/80 hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-6 place-items-center rounded-md',
                          active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        <Icon className="size-3.5 shrink-0" />
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {active ? (
                        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                      ) : null}
                    </Link>
                  </DropdownMenuItem>
                </Fragment>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </nav>
  )
}

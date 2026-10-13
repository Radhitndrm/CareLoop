import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Meter({
  value,
  tone,
  className,
}: {
  value: number
  tone?: 'default' | 'success' | 'warning' | 'danger'
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const accent =
    tone === 'danger'
      ? 'var(--destructive)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'success'
          ? 'var(--success)'
          : 'var(--primary)'

  return (
    <span
      className={cn('meter', className)}
      style={
        {
          '--meter-value': `${clamped}%`,
          '--meter-accent': accent,
        } as CSSProperties
      }
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span className="meter-fill" style={{ width: `${clamped}%` }} />
    </span>
  )
}

export function DataTableShell({
  toolbar,
  footer,
  empty,
  children,
  className,
}: {
  toolbar?: ReactNode
  footer?: ReactNode
  empty?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('data-table', className)}>
      {toolbar ? <div className="data-table-toolbar">{toolbar}</div> : null}
      {empty ? <div className="data-table-empty flex flex-col items-center justify-center">{children}</div> : children}
      {footer ? <div className="data-table-footer">{footer}</div> : null}
    </div>
  )
}
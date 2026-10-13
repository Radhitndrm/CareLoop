import * as React from 'react'
import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}

function Alert({
  className,
  variant = 'info',
  icon,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'info' | 'success' | 'warning' | 'danger'
  icon?: React.ReactNode
}) {
  const tone = {
    info: 'border-info-border bg-info-surface text-info',
    success: 'border-success-border bg-success-surface text-success',
    warning: 'border-warning-border bg-warning-surface text-warning',
    danger: 'border-danger-border bg-danger-surface text-danger',
  }[variant]

  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm',
        tone,
        className,
      )}
      {...props}
    >
      {icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export { Skeleton, Alert }
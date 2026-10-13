import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  kicker = 'CareLoop workspace',
  title,
  description,
  actions,
  className,
}: {
  kicker?: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      data-reveal
      className={cn(
        'page-heading reveal flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="page-kicker">
          <span aria-hidden="true" />
          {kicker}
        </p>
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
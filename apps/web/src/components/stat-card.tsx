'use client'

import type { PointerEvent, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type StatCardTone = 'default' | 'success' | 'warning' | 'danger' | 'muted'

export function SpotlightCard({ className, children }: { className?: string; children: ReactNode }) {
  function track(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || !event.currentTarget) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = event.currentTarget.getBoundingClientRect()
    event.currentTarget.style.setProperty('--spot-x', `${event.clientX - rect.left}px`)
    event.currentTarget.style.setProperty('--spot-y', `${event.clientY - rect.top}px`)
  }

  return (
    <div className={cn('spotlight-card', className)} onPointerMove={track}>
      {children}
      <span className="spotlight-glow" aria-hidden="true" />
    </div>
  )
}

export function StatCard({
  title,
  value,
  hint,
  icon,
  tone = 'default',
  className,
}: {
  title: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: StatCardTone
  className?: string
}) {
  return (
    <div data-reveal data-tone={tone} className={cn('stat-card-shell reveal', className)}>
      <SpotlightCard>
        <div className="stat-card card-fold flex h-full flex-col">
          <div className="stat-heading">
            <p className="stat-label">{title}</p>
          </div>
          <div className="stat-body relative">
            <p className="stat-value">{value}</p>
            {hint ? <p className="stat-hint">{hint}</p> : null}
          </div>
          {icon ? <span className="stat-icon-well">{icon}</span> : null}
        </div>
      </SpotlightCard>
    </div>
  )
}
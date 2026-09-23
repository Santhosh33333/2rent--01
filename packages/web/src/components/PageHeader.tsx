import { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
  backTo?: string
  className?: string
}

export function PageHeader({ title, subtitle, action, className = '' }: PageHeaderProps) {
  return (
    <header className={`page-header flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-7 sm:mb-9 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-[1.75rem] leading-tight sm:text-4xl font-extrabold text-surface-900 dark:text-surface-50 font-display tracking-[-0.045em]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-surface-600 dark:text-surface-300 mt-2 text-sm sm:text-[0.9375rem] leading-relaxed max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

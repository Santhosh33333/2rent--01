import { ReactNode } from 'react'

interface StatCardProps {
  title: string
  value: string | number
  icon?: ReactNode
  change?: string
  changeType?: 'positive' | 'negative' | 'neutral'
  gradient?: 'primary' | 'accent' | 'success' | 'warning' | 'info'
  loading?: boolean
}

const gradientMap = {
  primary: 'from-primary-500/20 to-primary-600/10 text-primary-600 dark:text-primary-400',
  accent: 'from-accent-500/20 to-accent-600/10 text-accent-600 dark:text-accent-400',
  success: 'from-emerald-500/20 to-emerald-600/10 text-emerald-600 dark:text-emerald-400',
  warning: 'from-amber-500/20 to-amber-600/10 text-amber-600 dark:text-amber-400',
  info: 'from-sky-500/20 to-sky-600/10 text-sky-600 dark:text-sky-400',
}

export function StatCard({
  title,
  value,
  icon,
  change,
  changeType = 'neutral',
  gradient = 'primary',
  loading = false,
}: StatCardProps) {
  const changeColor = {
    positive: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    negative: 'text-red-600 dark:text-red-400 bg-red-500/10',
    neutral: 'text-surface-600 dark:text-surface-400 bg-surface-500/10',
  }[changeType]

  return (
    <div className="glass-card p-5 group hover:shadow-glow transition-all duration-300 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-surface-500 dark:text-surface-400 truncate">
            {title}
          </p>
          {loading ? (
            <div className="skeleton h-8 w-20 mt-2 rounded-md" />
          ) : (
            <p className="mt-2 text-3xl font-bold text-surface-900 dark:text-white tracking-tight">
              {value}
            </p>
          )}
          {change && !loading && (
            <span
              className={`inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${changeColor}`}
            >
              {change}
            </span>
          )}
        </div>
        {icon && (
          <div
            className={`flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br ${gradientMap[gradient]} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  )
}
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react'

interface BalanceCardProps {
  label: string
  amount: number
  currency?: string
  icon?: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
  loading?: boolean
}

export function BalanceCard({
  label,
  amount,
  currency = '₹',
  icon,
  trend,
  trendValue,
  loading = false,
}: BalanceCardProps) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null
  const trendColor =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-surface-500 dark:text-surface-400'

  return (
    <div className="glass-card p-5 group hover:shadow-glow transition-all duration-300 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-surface-500 dark:text-surface-400">{label}</p>
          {loading ? (
            <div className="skeleton h-9 w-28 mt-2 rounded-md" />
          ) : (
            <p className="mt-2 text-3xl font-bold text-surface-900 dark:text-white tracking-tight">
              {currency}
              {amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
          {trendValue && !loading && (
            <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trendColor}`}>
              {TrendIcon && <TrendIcon className="w-3.5 h-3.5" />}
              {trendValue}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500/20 to-accent-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
          {icon || <Wallet className="w-6 h-6 text-primary-600 dark:text-primary-400" />}
        </div>
      </div>
    </div>
  )
}
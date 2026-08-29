import { Shield, ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react'

interface TrustScoreDisplayProps {
  score: number
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

const tierConfig = {
  excellent: { min: 90, icon: ShieldCheck, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/20', label: 'Excellent' },
  great: { min: 80, icon: ShieldCheck, color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/20', label: 'Great' },
  good: { min: 70, icon: Shield, color: 'text-primary-600 dark:text-primary-400', bg: 'bg-primary-500/20', label: 'Good' },
  fair: { min: 50, icon: ShieldAlert, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/20', label: 'Fair' },
  low: { min: 0, icon: ShieldOff, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/20', label: 'Low' },
}

function getTier(score: number) {
  const tiers = Object.entries(tierConfig).sort((a, b) => b[1].min - a[1].min)
  for (const [, config] of tiers) {
    if (score >= config.min) return config
  }
  return tierConfig.low
}

const sizeClasses = {
  sm: { bar: 'h-1.5', icon: 'w-4 h-4', text: 'text-xs', badge: 'text-xs px-1.5 py-0.5' },
  md: { bar: 'h-2.5', icon: 'w-5 h-5', text: 'text-sm', badge: 'text-xs px-2 py-0.5' },
  lg: { bar: 'h-3.5', icon: 'w-6 h-6', text: 'text-base', badge: 'text-sm px-2.5 py-1' },
}

export function TrustScoreDisplay({ score, size = 'md', showLabel = true }: TrustScoreDisplayProps) {
  const tier = getTier(score)
  const Icon = tier.icon
  const s = sizeClasses[size]
  const clampedScore = Math.min(Math.max(score, 0), 100)

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-shrink-0 w-10 h-10 rounded-xl ${tier.bg} flex items-center justify-center`}>
        <Icon className={`${s.icon} ${tier.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          {showLabel && (
            <span className={`${s.text} font-medium text-surface-700 dark:text-surface-300`}>
              Trust Score
            </span>
          )}
          <span className={`${s.badge} rounded-full font-semibold ${tier.bg} ${tier.color}`}>
            {tier.label}
          </span>
        </div>
        <div className={`w-full bg-surface-200 dark:bg-surface-700 rounded-full ${s.bar}`}>
          <div
            className={`${s.bar} rounded-full bg-gradient-to-r ${tier.color.replace('text', 'from')} ${tier.color.replace('text', 'to')} transition-all duration-700 ease-out`}
            style={{ width: `${clampedScore}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className={`${s.text} font-semibold ${tier.color}`}>{clampedScore}/100</span>
        </div>
      </div>
    </div>
  )
}
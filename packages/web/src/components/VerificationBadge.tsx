import { CheckCircle, XCircle, Clock, AlertTriangle, ShieldCheck } from 'lucide-react'

type VerificationStatus = 'verified' | 'pending' | 'not-started' | 'rejected' | 'expired'

interface VerificationBadgeProps {
  status: VerificationStatus
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

const configMap: Record<VerificationStatus, { icon: typeof CheckCircle; color: string; text: string }> = {
  verified: { icon: ShieldCheck, color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20', text: 'Verified' },
  pending: { icon: Clock, color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20', text: 'Pending' },
  'not-started': { icon: XCircle, color: 'text-surface-500 dark:text-surface-400 bg-surface-500/10 border-surface-500/20', text: 'Not Started' },
  rejected: { icon: AlertTriangle, color: 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20', text: 'Rejected' },
  expired: { icon: Clock, color: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/20', text: 'Expired' },
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-sm gap-1.5',
  lg: 'px-3 py-1.5 text-base gap-2',
}

const iconSizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-5 h-5' }

export function VerificationBadge({ status, label, size = 'md' }: VerificationBadgeProps) {
  const config = configMap[status]
  const Icon = config.icon

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium border ${sizeClasses[size]} ${config.color}`}
    >
      <Icon className={iconSizes[size]} />
      {label || config.text}
    </span>
  )
}
import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`}>
      <div className="empty-state-icon animate-float">
        <Icon className="w-10 h-10 text-surface-400 dark:text-surface-500" />
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-desc">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

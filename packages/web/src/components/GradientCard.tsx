import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

interface GradientCardProps {
  children?: ReactNode
  className?: string
  variant?: 'primary' | 'accent' | 'mesh'
}

export function GradientCard({ children, className = '', variant = 'primary' }: GradientCardProps) {
  const variantClasses = {
    primary: 'card-gradient-primary',
    accent: 'card-gradient-accent',
    mesh: 'card-gradient-mesh',
  }

  return (
    <div className={`${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  )
}

interface FeatureCardProps {
  icon: LucideIcon
  title: string
  description: string
  gradient?: string
  className?: string
}

export function FeatureCard({ icon: Icon, title, description, gradient = 'from-primary-500 to-primary-600', className = '' }: FeatureCardProps) {
  return (
    <div className={`glass-card group cursor-pointer ${className}`}>
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4
        group-hover:scale-110 transition-transform duration-300 shadow-lg`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1.5 font-display">{title}</h3>
      <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">{description}</p>
    </div>
  )
}

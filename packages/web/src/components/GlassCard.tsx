import { ReactNode } from 'react'

interface GlassCardProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'elevated' | 'static'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  onClick?: () => void
}

export function GlassCard({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  hover = true,
  onClick,
}: GlassCardProps) {
  const paddingClasses = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  }

  const variantClasses = {
    default: hover ? 'glass-card' : 'glass-card-static',
    elevated: 'glass-elevated',
    static: 'glass-card-static',
  }

  return (
    <div
      className={`${variantClasses[variant]} ${paddingClasses[padding]} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

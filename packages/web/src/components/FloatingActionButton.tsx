import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

interface FloatingActionButtonProps {
  icon: LucideIcon
  label?: string
  onClick?: () => void
  to?: string
  variant?: 'primary' | 'accent'
  className?: string
  children?: ReactNode
}

export function FloatingActionButton({
  icon: Icon,
  label,
  onClick,
  variant = 'primary',
  className = '',
  children,
}: FloatingActionButtonProps) {
  const variantClasses = {
    primary: 'bg-primary-600 hover:bg-primary-500 shadow-lg shadow-primary-600/30 hover:shadow-primary-500/50',
    accent: 'bg-accent-500 hover:bg-accent-400 shadow-lg shadow-accent-500/30 hover:shadow-accent-400/50',
  }

  return (
    <button
      onClick={onClick}
      className={`fixed bottom-24 md:bottom-8 right-4 md:right-8 z-40
        flex items-center gap-2.5 px-5 py-3.5 rounded-2xl
        text-white font-semibold text-sm
        transition-all duration-300 ease-out
        hover:-translate-y-0.5 active:translate-y-0
        ${variantClasses[variant]} ${className}`}
    >
      <Icon className="w-5 h-5" />
      {label && <span>{label}</span>}
      {children}
    </button>
  )
}

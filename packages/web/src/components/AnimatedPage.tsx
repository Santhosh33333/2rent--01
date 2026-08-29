import { ReactNode } from 'react'

interface AnimatedPageProps {
  children: ReactNode
  className?: string
  delay?: number
}

export function AnimatedPage({ children, className = '', delay = 0 }: AnimatedPageProps) {
  return (
    <div
      className={`animate-fade-in-up ${className}`}
      style={delay > 0 ? { animationDelay: `${delay}ms`, animationFillMode: 'both' } : undefined}
    >
      {children}
    </div>
  )
}

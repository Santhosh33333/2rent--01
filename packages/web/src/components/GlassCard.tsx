import { type ReactNode } from 'react'
import { Tilt } from './motion/Tilt'

interface GlassCardProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'elevated' | 'static'
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  onClick?: () => void
  /**
   * Prism surface. On by default because this component is what almost every
   * in-app card is built from, so setting it here lifts every screen at once
   * instead of requiring the same edit in dozens of pages. Set false for
   * surfaces that already carry their own colour or artwork - a gradient wallet
   * card, a media card - where a second surface treatment would fight it.
   */
  prism?: boolean
  /** Real 3D tilt on hover. Opt-in: in a long list it costs more than it gives. */
  tilt?: boolean
}

export function GlassCard({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  hover = true,
  onClick,
  prism = true,
  tilt = false,
}: GlassCardProps) {
  const paddingClasses = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  }

  const base =
    variant === 'elevated'
      ? 'glass-elevated'
      : variant === 'static' || !hover
        ? 'glass-card-static'
        : 'glass-card'

  // `prism-ring` draws its gradient border with a masked pseudo-element, so it
  // needs a positioned ancestor; the card is `overflow-hidden` via prism-card.
  const surface = prism ? 'prism-card prism-ring' : ''
  const interactive = onClick
    ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent'
    : ''

  const inner = (
    <div
      className={`${base} ${surface} ${interactive} ${paddingClasses[padding]} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )

  if (tilt) {
    return (
      <Tilt max={6} lift={10} scale={1.01} className="h-full">
        {inner}
      </Tilt>
    )
  }

  return inner
}
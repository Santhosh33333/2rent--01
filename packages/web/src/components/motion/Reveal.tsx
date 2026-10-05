import { type ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'motion/react'

/**
 * Scroll-triggered entrance. Motion values and transforms only, so it never
 * forces a React re-render while scrolling, and it collapses to a plain fade
 * when the user has asked for reduced motion.
 */

type Direction = 'up' | 'down' | 'left' | 'right' | 'none'

const OFFSET: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 24 },
  down: { x: 0, y: -24 },
  left: { x: 28, y: 0 },
  right: { x: -28, y: 0 },
  none: { x: 0, y: 0 },
}

export interface RevealProps {
  children: ReactNode
  className?: string
  /** Seconds. */
  delay?: number
  /** Seconds. */
  duration?: number
  from?: Direction
  /** Play as soon as mounted rather than on scroll. */
  immediate?: boolean
  as?: 'div' | 'section' | 'li' | 'article'
}

export function Reveal({
  children,
  className,
  delay = 0,
  duration = 0.6,
  from = 'up',
  immediate = false,
  as = 'div',
}: RevealProps) {
  const reduce = useReducedMotion()
  const { x, y } = OFFSET[from]
  const MotionTag = motion[as]

  if (reduce) {
    const Tag = as
    return <Tag className={className}>{children}</Tag>
  }

  const variants: Variants = {
    hidden: { opacity: 0, x, y, filter: 'blur(6px)' },
    shown: {
      opacity: 1,
      x: 0,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration, delay, ease: [0.16, 1, 0.3, 1] },
    },
  }

  return (
    <MotionTag
      className={className}
      variants={variants}
      initial="hidden"
      {...(immediate ? { animate: 'shown' } : { whileInView: 'shown', viewport: { once: true, amount: 0.25 } })}
    >
      {children}
    </MotionTag>
  )
}

/**
 * Parent for a list that should cascade in. Children use RevealChild so the
 * stagger is orchestrated by one parent rather than by N independent timers.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.06,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  stagger?: number
  delay?: number
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, amount: 0.2 }}
      variants={{ shown: { transition: { staggerChildren: stagger, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  )
}

const childVariants: Variants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(5px)' },
  shown: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
}

export function RevealChild({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div className={className} variants={childVariants}>
      {children}
    </motion.div>
  )
}
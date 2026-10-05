import { type PointerEvent, type ReactNode, useRef } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'

/**
 * A card that leans toward the pointer in 3D.
 *
 * The tilt is driven entirely by motion values and springs, never by React
 * state: a useState here would re-render the subtree on every pointer move.
 * On touch the pointer never enters, so it stays a flat card, and under
 * prefers-reduced-motion the 3D is dropped entirely.
 */

export interface TiltProps {
  children: ReactNode
  className?: string
  /** Maximum rotation in degrees on each axis. */
  max?: number
  /** How far the card lifts toward the viewer, in px. */
  lift?: number
  /** Scale on hover. */
  scale?: number
  /** Adds a moving highlight that tracks the pointer. */
  glare?: boolean
}

export function Tilt({
  children,
  className,
  max = 8,
  lift = 14,
  scale = 1.015,
  glare = false,
}: TiltProps) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement | null>(null)

  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const hovering = useMotionValue(0)

  const spring = { stiffness: 260, damping: 24, mass: 0.6 }
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), spring)
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), spring)
  const translateZ = useSpring(useTransform(hovering, [0, 1], [0, lift]), spring)
  const cardScale = useSpring(useTransform(hovering, [0, 1], [1, scale]), spring)

  // Glare follows the pointer across the card as a percentage.
  const glareX = useTransform(px, (v) => `${v * 100}%`)
  const glareY = useTransform(py, (v) => `${v * 100}%`)
  const glareOpacity = useTransform(hovering, [0, 1], [0, 0.5])

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{
        rotateX,
        rotateY,
        translateZ,
        scale: cardScale,
        transformPerspective: 1000,
        transformStyle: 'preserve-3d',
        willChange: 'transform',
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        const el = ref.current
        if (!el || e.pointerType === 'touch') return
        const rect = el.getBoundingClientRect()
        px.set((e.clientX - rect.left) / rect.width)
        py.set((e.clientY - rect.top) / rect.height)
      }}
      onPointerEnter={(e: PointerEvent<HTMLDivElement>) => {
        if (e.pointerType !== 'touch') hovering.set(1)
      }}
      onPointerLeave={() => {
        hovering.set(0)
        px.set(0.5)
        py.set(0.5)
      }}
    >
      {children}
      {glare && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-soft-light"
          style={{
            opacity: glareOpacity,
            background: useTransform(
              [glareX, glareY],
              ([x, y]) =>
                `radial-gradient(320px circle at ${x} ${y}, rgba(255,255,255,0.9), transparent 62%)`
            ),
          }}
        />
      )}
    </motion.div>
  )
}
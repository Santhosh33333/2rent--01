import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
}

const W = 640
const H = 180

/**
 * Pointer-drawn signature pad.
 *
 * Emits a PNG data URL. `toDataURL` is used rather than a blob so the value can
 * be posted as JSON and stored directly on the acceptance record without a
 * second upload step.
 *
 * Sizing is fixed in device pixels so the exported image is stable regardless
 * of screen density.
 */
export function SignaturePad({ onChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const prepare = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ratio = window.devicePixelRatio || 1
    // Only resize on first paint; resizing mid-stroke would clear the ink.
    if (canvas.width === W * ratio) return canvas
    canvas.width = W * ratio
    canvas.height = H * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1c1917'
    return canvas
  }, [])

  useEffect(() => {
    prepare()
  }, [prepare])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const canvas = prepare()
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = pos(e)
    drawing.current = true
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasInk(true)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(canvas.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = prepare()
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, W, H)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full touch-none rounded-xl border-2 border-dashed border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900"
        style={{ height: H }}
        aria-label="Signature pad"
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-stone-500 dark:text-stone-400">
          {hasInk ? 'Signature captured.' : 'Draw your signature above, or use the typed option.'}
        </p>
        {hasInk && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            className="text-xs font-semibold text-stone-600 underline disabled:opacity-50 dark:text-stone-300"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

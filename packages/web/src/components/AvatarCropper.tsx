import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw, X, ZoomIn } from 'lucide-react'
import toast from 'react-hot-toast'
import { getErrorMessage } from '../lib/error'

/** Side of the (square) crop viewport, in CSS pixels. */
const VIEW = 288
/** Side of the rendered avatar, in pixels. */
const OUT = 1024
const MAX_ZOOM = 4
const MIN_ZOOM = 1

interface Props {
  /** The freshly-picked image; the dialog decodes it on mount. */
  file: File
  onCancel: () => void
  /** Receives the cropped + downscaled JPEG once the user confirms. */
  onDone: (blob: Blob) => void
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * Let the member frame their own profile photo before it uploads.
 *
 * The previous flow centre-cropped silently, so a face near an edge was cut
 * off with no way to fix it. This shows the square the avatar becomes, with a
 * zoom slider and drag-to-pan, and only hands back the final pixels on confirm.
 */
export function AvatarCropper({ file, onCancel, onDone }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const drag = useRef<{ id: number; startX: number; startY: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    let cancelled = false
    img.onload = () => {
      if (cancelled) return
      imgRef.current = img
      setDims({ w: img.naturalWidth, h: img.naturalHeight })
      setSrc(url)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      if (!cancelled) {
        toast.error('Could not read that image. Try another file.')
        onCancel()
      }
    }
    img.src = url
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
    }
  }, [file, onCancel])

  const baseScale = dims ? VIEW / Math.min(dims.w, dims.h) : 0
  const scale = baseScale * zoom
  const dispW = dims ? dims.w * scale : 0
  const dispH = dims ? dims.h * scale : 0
  const maxX = Math.max(0, (dispW - VIEW) / 2)
  const maxY = Math.max(0, (dispH - VIEW) / 2)

  const moveTo = (x: number, y: number) => setOffset({ x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) })

  const changeZoom = (next: number) => {
    const z = clamp(next, MIN_ZOOM, MAX_ZOOM)
    const nextScale = baseScale * z
    const nx = dims ? Math.max(0, (dims.w * nextScale - VIEW) / 2) : 0
    const ny = dims ? Math.max(0, (dims.h * nextScale - VIEW) / 2) : 0
    setZoom(z)
    setOffset((o) => ({ x: clamp(o.x, -nx, nx), y: clamp(o.y, -ny, ny) }))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    moveTo(d.ox + (e.clientX - d.startX), d.oy + (e.clientY - d.startY))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLImageElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  const confirm = async () => {
    const img = imgRef.current
    if (!img || !dims || scale <= 0) return
    setBusy(true)
    try {
      const imageLeft = VIEW / 2 - dispW / 2 + offset.x
      const imageTop = VIEW / 2 - dispH / 2 + offset.y
      const srcW = VIEW / scale
      const srcH = VIEW / scale
      const srcX = clamp((0 - imageLeft) / scale, 0, Math.max(0, dims.w - srcW))
      const srcY = clamp((0 - imageTop) / scale, 0, Math.max(0, dims.h - srcH))

      const canvas = document.createElement('canvas')
      canvas.width = OUT
      canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Your browser cannot process images.')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUT, OUT)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob) throw new Error('Could not process that image. Try another file.')
      onDone(blob)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not process that image.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Adjust your photo">
      <div className="w-full max-w-sm glass-card-static p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">Adjust your photo</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden rounded-3xl bg-black ring-1 ring-white/10"
          style={{ width: VIEW, height: VIEW }}
        >
          {src && dims ? (
            <img
              src={src}
              alt=""
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: dispW,
                height: dispH,
                maxWidth: 'none',
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                cursor: 'grab',
                touchAction: 'none',
                userSelect: 'none',
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/60">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <ZoomIn className="h-4 w-4 shrink-0 text-surface-500" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full accent-primary-500"
          />
          <button
            type="button"
            onClick={() => changeZoom(MIN_ZOOM)}
            aria-label="Reset zoom"
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-surface-500">Drag to reposition. Zoom to fill the frame.</p>

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-outline flex-1">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy || !dims} className="btn-primary flex-1">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4" /> Use photo</>}
          </button>
        </div>
      </div>
    </div>
  )
}

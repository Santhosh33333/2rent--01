import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import { RefreshCw, Star, X, Heart, MessageCircle, ShieldCheck, SlidersHorizontal, MapPin } from 'lucide-react'
import {
  fetchDiscover,
  sendSwipe,
  type DiscoverFilters,
  type DiscoverProfile,
  type SwipeType,
} from './datingApi'
import { Tilt } from '../../components/motion/Tilt'

/**
 * Swipe discovery.
 *
 * The drag is driven by motion values rather than React state. The previous
 * version kept the pointer offset in `useState` and wrote to it from a
 * `pointermove` listener, which re-rendered the whole card stack on every frame
 * of the drag and re-attached the listener each time the offset changed. The
 * transform now lives outside React entirely, so only the commit at the end of
 * the gesture touches state.
 */

const SWIPE_DISTANCE = 110

export function DiscoverPage() {
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [queue, setQueue] = useState<DiscoverProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [match, setMatch] = useState<DiscoverProfile | null>(null)

  /**
   * Per-request filters. Empty by default, which now means "use my saved
   * preferences" rather than "no filtering" - the server falls back to the saved
   * record for every field that is not sent here.
   *
   * This used to be a hardcoded `{}` passed straight into the request, which is
   * why the feed ignored everything the user had chosen.
   */
  const [filters, setFilters] = useState<DiscoverFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  /** Eligible candidates before the limit, so "no matches" reads differently to "5 shown". */
  const [totalEligible, setTotalEligible] = useState(0)

  // Offsets as motion values: mutated on every pointermove, read only by the
  // transform, never by React.
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const dragging = useMotionValue(0)

  // Springs for the snap-back and the fly-off, so the card has weight.
  const springX = useSpring(x, { stiffness: 320, damping: 32, mass: 0.7 })
  const springY = useSpring(y, { stiffness: 320, damping: 32, mass: 0.7 })

  const rotate = useTransform(x, [-SWIPE_DISTANCE * 2, 0, SWIPE_DISTANCE * 2], [-16, 0, 16])
  const likeOpacity = useTransform(x, [20, SWIPE_DISTANCE], [0, 1])
  const passOpacity = useTransform(x, [-SWIPE_DISTANCE, -20], [1, 0])
  // The intent stamps also grow slightly, which is what makes the gesture feel
  // like it is committing rather than just reporting a position.
  const likeScale = useTransform(likeOpacity, [0, 1], [0.85, 1])
  const passScale = useTransform(passOpacity, [0, 1], [0.85, 1])

  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const page = await fetchDiscover(filters, signal)
        setQueue(page.results)
        setTotalEligible(page.totalEligible)
      } catch (e) {
        if ((e as { code?: string })?.code === 'ERR_CANCELED') return
        setError('Could not load profiles. Check your connection and try again.')
      } finally {
        setLoading(false)
      }
    },
    [filters],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const applyFilters = useCallback((next: DiscoverFilters) => {
    setFilters(next)
    setShowFilters(false)
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({})
    setShowFilters(false)
  }, [])

  const resetOffsets = useCallback(() => {
    x.set(0)
    y.set(0)
    dragging.set(0)
  }, [x, y, dragging])

  const act = useCallback(
    async (type: SwipeType) => {
      const current = queue[0]
      if (!current || busy) return
      setBusy(true)
      setQueue((q) => q.slice(1))
      resetOffsets()
      try {
        const res = await sendSwipe(current.id, type)
        if (res.isMatch) setMatch(current)
      } catch {
        setError('That action did not go through.')
      } finally {
        setBusy(false)
      }
    },
    [queue, busy, resetOffsets],
  )

  /** Commits a gesture: past the threshold it fires, otherwise it snaps back. */
  const commit = useCallback(
    (dx: number, dy: number) => {
      if (dx > SWIPE_DISTANCE) void act('LIKE')
      else if (dx < -SWIPE_DISTANCE) void act('PASS')
      else {
        x.set(0)
        y.set(0)
      }
      dragging.set(0)
      // Keep dy referenced so a vertical drag without a decision is discarded
      // rather than latched onto the next render.
      void dy
    },
    [act, x, y, dragging],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return
      x.set(e.clientX - dragStart.current.x)
      y.set(e.clientY - dragStart.current.y)
    }
    const onUp = () => {
      if (!dragStart.current) return
      commit(x.get(), y.get())
      dragStart.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [commit, x, y])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') void act('PASS')
    if (e.key === 'ArrowRight') void act('LIKE')
  }

  const current = queue[0]
  const next = queue[1]
  // Age arrives computed from the server. It used to be derived here from a
  // date of birth the response also carried, which meant shipping every other
  // person's birth date to every viewer to display one integer. The server no
  // longer sends it, so there is nothing to fall back to.
  const age = current?.age ?? null
  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== '',
  ).length

  return (
    <div className="relative -mx-4 -my-6 min-h-[calc(100dvh-2rem)] overflow-hidden bg-slate-950 text-white">
      {/* One aurora behind the whole deck, so the screen has depth without the
          cards each carrying their own colour. */}
      <div className="prism-aurora animate-prism-drift opacity-50" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/40 via-transparent to-slate-950" aria-hidden />

      <header className="relative z-10 mx-auto flex max-w-md items-center justify-between px-4 py-5">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Discover</h1>
          <p className="text-xs text-white/60">
            {loading
              ? 'Finding people…'
              : totalEligible > queue.length
                ? `${queue.length} of ${totalEligible} for you`
                : `${queue.length} nearby`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Filter this feed"
            aria-expanded={showFilters}
            className="prism-ring relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15 active:scale-95"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            {activeFilterCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => load()}
            aria-label="Refresh profiles"
            className="prism-ring flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15 active:scale-95"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="relative z-10 mx-auto max-w-md px-4 pb-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Just for this feed</p>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-white/70 hover:text-white transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs text-white/60">City</span>
              <input
                type="text"
                value={filters.city ?? ''}
                placeholder="Any city"
                onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
                onBlur={() => applyFilters(filters)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs text-white/60">Age from</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={100}
                  value={filters.minAge ?? ''}
                  placeholder="18"
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      minAge: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  onBlur={() => applyFilters(filters)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs text-white/60">Age to</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={100}
                  value={filters.maxAge ?? ''}
                  placeholder="100"
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      maxAge: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  onBlur={() => applyFilters(filters)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </label>
            </div>

            <p className="mt-3 text-xs text-white/50">
              Leave these empty to use your saved preferences.
            </p>
            <button
              type="button"
              onClick={() => navigate('/preferences')}
              className="mt-3 w-full rounded-xl border border-white/15 py-2 text-sm text-white/80 transition hover:bg-white/5"
            >
              Edit saved preferences
            </button>
          </div>
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-md px-4 pb-32">
        {error && (
          <p className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        {loading && !current ? (
          <div className="flex h-[58vh] items-center justify-center">
            <span className="text-sm text-white/50">Loading profiles…</span>
          </div>
        ) : !current ? (
          <div className="flex h-[58vh] flex-col items-center justify-center gap-5 text-center">
            <div className="prism-card prism-ring flex h-20 w-20 items-center justify-center rounded-full">
              <Heart className="h-8 w-8 text-violet-300" aria-hidden />
            </div>
            <div>
              <p className="font-display text-lg font-semibold">You&apos;ve seen everyone</p>
              <p className="mt-1 text-sm text-white/60">
                {activeFilterCount > 0
                  ? 'Nobody matches these filters. Try widening them.'
                  : 'Check back later, or widen your saved preferences.'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {activeFilterCount > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5 active:scale-95"
                >
                  Clear these filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/preferences')}
                  className="rounded-full border border-white/20 px-6 py-3 text-sm font-medium text-white/80 transition hover:bg-white/5 active:scale-95"
                >
                  Edit preferences
                </button>
              )}
              <button
                type="button"
                onClick={() => load()}
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition active:scale-95"
              >
                Check again
              </button>
            </div>
          </div>
        ) : (
          <div
            className="relative h-[58vh] select-none"
            onKeyDown={onKeyDown}
            tabIndex={0}
            role="application"
            aria-label="Profile deck. Use the left and right arrow keys to pass or like."
          >
            {/* The next card sits behind, smaller and dimmer, so the deck reads as
                a stack rather than as a single sliding image. */}
            {next && (
              <motion.div
                aria-hidden
                className="absolute inset-0 overflow-hidden rounded-3xl bg-white/5"
                initial={false}
                animate={reduce ? {} : { scale: 0.95, y: 12, opacity: 0.5 }}
              />
            )}

            <motion.div
              onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
                dragStart.current = { x: e.clientX, y: e.clientY }
                dragging.set(1)
              }}
              style={{
                x: springX,
                y: springY,
                rotate,
                cursor: dragging.get() ? 'grabbing' : 'grab',
              }}
              className="absolute inset-0 touch-none overflow-hidden rounded-3xl shadow-2xl will-change-transform"
            >
              {current.avatarUrl ? (
                <img
                  src={current.avatarUrl}
                  alt={current.fullName}
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-900 to-slate-900">
                  <span className="font-display text-6xl font-bold text-white/15">
                    {current.fullName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

              {/* Intent stamps. Opacity is a transform-linked motion value, so
                  they cost no renders during the drag. */}
              <motion.span
                style={{ opacity: likeOpacity, scale: likeScale }}
                className="pointer-events-none absolute left-6 top-6 rotate-[-12deg] rounded-2xl border-4 border-emerald-400 px-4 py-1 text-2xl font-bold tracking-wider text-emerald-400"
              >
                LIKE
              </motion.span>
              <motion.span
                style={{ opacity: passOpacity, scale: passScale }}
                className="pointer-events-none absolute right-6 top-6 rotate-[12deg] rounded-2xl border-4 border-rose-400 px-4 py-1 text-2xl font-bold tracking-wider text-rose-400"
              >
                PASS
              </motion.span>

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-5 pt-16">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-2xl font-bold">
                    {current.fullName}
                    {age !== null && <span className="font-normal text-white/70">, {age}</span>}
                  </h2>
                  {current.mobileVerified && (
                    <span
                      title="Verified"
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300"
                    >
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      Verified
                    </span>
                  )}
                </div>
                {current.city && <p className="mt-0.5 text-sm text-white/70">{current.city}</p>}
                {/* Distance is a band, never a precise figure - and it is absent
                    entirely when either side has not shared a location. Showing
                    "unknown" rather than nothing, so its absence is not read as
                    "close by". */}
                {current.distance && (
                  <p className="mt-1 inline-flex items-center gap-1 text-sm text-white/70">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {current.distance} away
                  </p>
                )}
                {current.reasons && current.reasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {current.reasons.map((reason) => (
                      <span
                        key={reason.code}
                        className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/85"
                      >
                        {reason.label}
                      </span>
                    ))}
                  </div>
                )}
                {current.bio && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/85">
                    {current.bio}
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </main>

      {current && !loading && (
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-slate-950/85 px-4 py-4 backdrop-blur-lg">
          <div className="mx-auto flex max-w-md items-center justify-center gap-3">
            <Tilt max={12} lift={12} scale={1.06}>
              <button
                type="button"
                aria-label="Pass"
                onClick={() => act('PASS')}
                disabled={busy}
                className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 disabled:opacity-40"
              >
                <X className="h-6 w-6" aria-hidden />
              </button>
            </Tilt>
            <Tilt max={12} lift={14} scale={1.06}>
              <button
                type="button"
                aria-label="Super like"
                onClick={() => act('SUPER_LIKE')}
                disabled={busy}
                className="flex h-14 w-14 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/10 text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-40"
              >
                <Star className="h-6 w-6" aria-hidden />
              </button>
            </Tilt>
            <Tilt max={12} lift={12} scale={1.06}>
              <button
                type="button"
                aria-label="Like"
                onClick={() => act('LIKE')}
                disabled={busy}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-lg shadow-rose-500/30 transition hover:from-rose-500 hover:to-rose-600 disabled:opacity-40"
              >
                <Heart className="h-7 w-7" aria-hidden />
              </button>
            </Tilt>
          </div>
        </nav>
      )}

      {match && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="It is a match"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-slate-950/95 px-6 text-center backdrop-blur-sm"
        >
          <div className="prism-aurora animate-prism-breathe opacity-70" aria-hidden />
          <div className="relative z-10 flex flex-col items-center gap-6">
            <h2 className="prism-text font-display text-3xl font-bold">It&apos;s a match</h2>
            <p className="text-white/70">You and {match.fullName} liked each other.</p>
            {match.avatarUrl ? (
              <motion.div
                initial={reduce ? false : { scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 240, damping: 18 }}
              >
                <img
                  src={match.avatarUrl}
                  alt={match.fullName}
                  className="prism-ring h-28 w-28 rounded-full object-cover"
                />
              </motion.div>
            ) : null}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setMatch(null)
                  navigate('/messages')
                }}
                className="prism-ring inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-primary-600 px-8 py-3 font-semibold text-white transition active:scale-95"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Start chat
              </button>
              <button
                type="button"
                onClick={() => setMatch(null)}
                className="rounded-full border border-white/20 px-8 py-3 font-medium text-white/80 transition hover:bg-white/5 active:scale-95"
              >
                Keep browsing
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}

export default DiscoverPage

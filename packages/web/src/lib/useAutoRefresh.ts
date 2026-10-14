import { useEffect, useRef } from 'react'

/**
 * Re-runs `fn` on an interval (default every minute) and whenever the tab
 * regains focus.
 *
 * Admin verification queues are push-less: a payment submitted while the page is
 * open, or a row another admin just decided, only appears after a reload. The
 * queues used to load once on mount, which is the "it runs one time, then never
 * again" report. Polling closes that gap without a manual refresh.
 *
 * Two safeguards keep it cheap and race-free:
 *   - ticks are skipped while the tab is hidden, so a background tab is silent;
 *   - a tick never overlaps the previous one, so a slow request cannot stack up
 *     behind the next interval.
 */
export function useAutoRefresh(fn: () => void | Promise<void>, intervalMs = 60_000): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let inFlight = false
    const tick = () => {
      if (inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      void Promise.resolve(fnRef.current()).finally(() => {
        inFlight = false
      })
    }
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    const id = window.setInterval(tick, intervalMs)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.clearInterval(id)
    }
  }, [intervalMs])
}

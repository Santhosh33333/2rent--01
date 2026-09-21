import { useCallback, useEffect, useRef, useState } from 'react'

export type GeoStatus =
  | 'idle'
  | 'locating'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'unsupported'
  | 'error'

export interface GeoFix {
  lat: number
  lon: number
  accuracy?: number
  ts: number
}

const FIX_CACHE_KEY = 'Sidebud-geo-fix'
const FIX_TTL_MS = 10 * 60 * 1000

function readCachedFix(): GeoFix | null {
  try {
    const raw = localStorage.getItem(FIX_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeoFix
    if (!parsed || !Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lon)) return null
    if (Date.now() - parsed.ts > FIX_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedFix(fix: GeoFix) {
  try {
    localStorage.setItem(FIX_CACHE_KEY, JSON.stringify(fix))
  } catch {
    // private mode — fix still works for this session
  }
}

export function geoStatusMessage(status: GeoStatus): string | null {
  switch (status) {
    case 'denied':
      return 'Location is blocked. Enter a place manually or allow location in your browser settings.'
    case 'unavailable':
      return 'Could not get your location (GPS unavailable). Enter a place manually.'
    case 'unsupported':
      return 'This device has no location support. Enter a place manually.'
    case 'error':
      return 'Location lookup failed. Enter a place manually or retry.'
    default:
      return null
  }
}

interface UseGeolocation {
  status: GeoStatus
  fix: GeoFix | null
  requestFix: () => void
  clearFix: () => void
}

/**
 * Permission-aware one-shot locator. Never traps the user: every failure
 * state tells them to type manually instead. Fixes are cached briefly so
 * mounting several location fields does not re-prompt or re-fix GPS.
 */
export function useGeolocation(auto = false): UseGeolocation {
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [fix, setFix] = useState<GeoFix | null>(null)
  const busyRef = useRef(false)

  const requestFix = useCallback(() => {
    if (busyRef.current) return
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported')
      return
    }
    busyRef.current = true
    setStatus('locating')

    const onSuccess = (pos: GeolocationPosition) => {
      busyRef.current = false
      const next: GeoFix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        ts: Date.now(),
      }
      writeCachedFix(next)
      setFix(next)
      setStatus('ready')
    }
    const onFailure = (err: GeolocationPositionError) => {
      busyRef.current = false
      if (err.code === err.PERMISSION_DENIED) setStatus('denied')
      else if (err.code === err.POSITION_UNAVAILABLE) setStatus('unavailable')
      else setStatus('error')
    }

    // If permission was already denied, report it without re-prompting.
    const perms = (
      navigator as Navigator & {
        permissions?: { query: (opts: { name: string }) => Promise<{ state: string }> }
      }
    ).permissions
    if (perms?.query) {
      perms
        .query({ name: 'geolocation' })
        .then((r) => {
          if (r.state === 'denied') {
            busyRef.current = false
            setStatus('denied')
            return
          }
          navigator.geolocation.getCurrentPosition(onSuccess, onFailure, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 60000,
          })
        })
        .catch(() => {
          navigator.geolocation.getCurrentPosition(onSuccess, onFailure, {
            enableHighAccuracy: true,
            timeout: 12000,
            maximumAge: 60000,
          })
        })
    } else {
      navigator.geolocation.getCurrentPosition(onSuccess, onFailure, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
      })
    }
  }, [])

  const clearFix = useCallback(() => {
    setFix(null)
    setStatus('idle')
  }, [])

  useEffect(() => {
    if (auto) {
      const cached = readCachedFix()
      if (cached) {
        setFix(cached)
        setStatus('ready')
      } else {
        requestFix()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  return { status, fix, requestFix, clearFix }
}

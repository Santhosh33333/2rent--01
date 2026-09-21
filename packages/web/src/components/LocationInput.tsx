import { useEffect, useRef, useState } from 'react'
import { Loader2, Crosshair, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../lib/api'
import { useGeolocation, geoStatusMessage } from '../lib/geolocation'

interface Suggestion {
  placeId: string
  lat: number
  lon: number
  displayName: string
}

interface LocationInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  optional?: boolean
  // When true (default) the field fills itself: fresh cache instantly,
  // otherwise the device GPS + reverse-geocode. Manual typing always wins.
  autoDetect?: boolean
}

const LOCATION_CACHE_KEY = 'Sidebud-last-location'
// A resolved place NAME stays valid far longer than a GPS fix: once we know
// it, every location field reuses it silently instead of re-prompting.
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CachedLocation {
  lat: number
  lon: number
  displayName: string
  ts: number
}

function readCachedLocation(): CachedLocation | null {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedLocation
    if (!parsed || typeof parsed.displayName !== 'string' || Date.now() - parsed.ts > LOCATION_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedLocation(lat: number, lon: number, displayName: string) {
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ lat, lon, displayName, ts: Date.now() }))
  } catch {
    // storage unavailable (private mode) — detection still works per mount
  }
}

export function LocationInput({ label, value, onChange, placeholder, required, optional, autoDetect = true }: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const skipNextSearch = useRef(false)
  const autoDoneRef = useRef(false)
  // Set when the next GPS fix should fill this field (auto-mount or the
  // crosshair button). Manual typing always wins and clears the intent.
  const wantFillRef = useRef(false)
  const geo = useGeolocation()
  // Refs so mount-once effects always call the latest handler.
  const valueRef = useRef(value)
  valueRef.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      clearTimeout(debounceRef.current)
    }
  }, [])

  const search = async (q: string) => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    if (q.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    setSearching(true)
    try {
      const res = await api.get('/location/autocomplete', { params: { q, limit: 5 } })
      const results: Suggestion[] = res.data?.data?.results || []
      setSuggestions(results)
      setOpen(results.length > 0)
      setActiveIndex(-1)
    } catch {
      // Autocomplete is best-effort; keep manual entry usable.
    } finally {
      setSearching(false)
    }
  }

  const handleChange = (next: string) => {
    onChange(next)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(next), 400)
  }

  const pick = (s: Suggestion) => {
    skipNextSearch.current = true
    onChange(s.displayName)
    setSuggestions([])
    setOpen(false)
  }

  const resolveAndFill = async (lat: number, lon: number, silent: boolean) => {
    setLocating(true)
    try {
      const res = await api.get('/location/reverse', {
        params: { lat, lon },
      })
      const result = res.data?.data?.result
      const name =
        result?.displayName && !String(result.displayName).startsWith(String(lat).slice(0, 5))
          ? (result.displayName as string)
          : (result?.displayName as string) || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
      skipNextSearch.current = true
      onChangeRef.current(name)
      writeCachedLocation(lat, lon, name)
      if (!silent) toast.success('Current location detected')
    } catch {
      const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`
      onChangeRef.current(fallback)
      writeCachedLocation(lat, lon, fallback)
      if (!silent) toast.success('Current location coordinates detected')
    } finally {
      setLocating(false)
    }
  }

  // GPS fix arrived: fill only when this field asked for it and is empty.
  useEffect(() => {
    if (!geo.fix || !wantFillRef.current || valueRef.current) return
    wantFillRef.current = false
    resolveAndFill(geo.fix.lat, geo.fix.lon, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.fix])

  const useMyLocation = () => {
    wantFillRef.current = true
    geo.requestFix()
  }

  // Automatic fill on mount when the field starts empty: instant when we
  // have a fresh cached fix, otherwise one GPS attempt. The browser asks
  // for permission at most once per origin; afterwards this is silent, and
  // every failure state tells the user to type instead of trapping them.
  useEffect(() => {
    if (!autoDetect || autoDoneRef.current) return
    autoDoneRef.current = true
    if (valueRef.current) return
    const cached = readCachedLocation()
    if (cached) {
      skipNextSearch.current = true
      onChangeRef.current(cached.displayName)
      return
    }
    wantFillRef.current = true
    geo.requestFix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      pick(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
        {label} {required && '*'} {optional && <span className="text-surface-400">(optional)</span>}
      </label>
      <div className="relative">
        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400 pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="input pl-12 pr-24 py-3.5"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searching && <Loader2 className="w-4 h-4 text-surface-400 animate-spin" />}
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating || geo.status === 'locating'}
            title="Use my current location"
            className="p-2 rounded-xl text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors disabled:opacity-50"
          >
            {locating || geo.status === 'locating' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {(() => {
        const msg = geoStatusMessage(geo.status)
        if (!msg || locating || geo.status === 'locating') return null
        return <p className="mt-1.5 text-xs text-surface-500 dark:text-surface-400">{msg}</p>
      })()}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 left-0 right-0 mt-1 glass-card overflow-hidden shadow-lg">
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={`w-full text-left px-4 py-3 flex items-start gap-3 text-sm transition-colors ${
                  i === activeIndex
                    ? 'bg-primary-50 dark:bg-primary-500/10 text-surface-900 dark:text-white'
                    : 'hover:bg-surface-50 dark:hover:bg-surface-800 text-surface-700 dark:text-surface-300'
                }`}
              >
                <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-surface-400" />
                <span className="line-clamp-2">{s.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Loader2, Crosshair, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../lib/api'
import { useGeolocation, geoStatusMessage } from '../lib/geolocation'

interface AddressParts {
  neighbourhood?: string
  suburb?: string
  road?: string
  city?: string
  town?: string
  village?: string
  county?: string
  state?: string
  postcode?: string
  country?: string
}

interface Suggestion {
  placeId: string
  lat: number
  lon: number
  displayName: string
  address?: AddressParts
}

/**
 * "city" collapses a place to its city name (used by profile setup, where the
 * field really is a city). "address" keeps the street/suburb detail (used by
 * event, booking and request locations).
 */
type LocationMode = 'address' | 'city'

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
  mode?: LocationMode
  // Hard ceiling for the string handed back to the form. The server rejects a
  // city longer than 100 chars with a 422 "Invalid value", so a full
  // reverse-geocoded address used to fail profile setup. Everything composed
  // here is cut to this length on a comma boundary.
  maxLength?: number
}

const LOCATION_CACHE_KEY = 'Sidebud-last-location'
// A resolved place NAME stays valid far longer than a GPS fix: once we know
// it, every location field reuses it silently instead of re-prompting.
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_LENGTH = 100

interface CachedLocation {
  lat: number
  lon: number
  displayName: string
  city?: string
  area?: string
  ts: number
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function looksLikeCoordinates(value: string | undefined | null): boolean {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(collapse(value || ''))
}

/**
 * Cut a label to `limit` characters without slicing a word in half. The label
 * is a comma-separated address, so whole segments are dropped from the end
 * (e.g. "Ratna Nagar, Chennai, Tamil Nadu, 600035, India" -> the first
 * segments that fit). A single over-long segment is hard-sliced as a last
 * resort so the field is never empty.
 */
function cutToLimit(value: string, limit: number): string {
  const clean = collapse(value)
  if (clean.length <= limit) return clean
  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean)
  let out = ''
  for (const part of parts) {
    const next = out ? `${out}, ${part}` : part
    if (next.length > limit) break
    out = next
  }
  return out || clean.slice(0, limit).trim()
}

/**
 * Build a short, human-readable place label from a geocoder result.
 *
 * This is the fix for the profile-setup "value error": the reverse-geocoder
 * returns a full display name (street, ward, zone, city, district, state,
 * postcode, country) that easily exceeds the server's 100-char city limit, so
 * saving the profile was rejected with 422 "Invalid value" — while a bare
 * coordinate pair happened to fit and was accepted. A city is collapsed to the
 * city name, and every other mode is collapsed to the useful address parts,
 * all capped at `limit`.
 */
function composeLocation(
  displayName: string | undefined,
  address: AddressParts | undefined,
  mode: LocationMode,
  limit: number,
): string {
  const city = address?.city || address?.town || address?.village || address?.county
  const area = address?.neighbourhood || address?.suburb
  if (mode === 'city') {
    const label = city || area || (displayName ? displayName.split(',')[0] : '')
    return cutToLimit(label, limit)
  }
  const pieces = [address?.road, area, city, address?.state].filter(Boolean) as string[]
  const label = pieces.length ? Array.from(new Set(pieces)).join(', ') : displayName || ''
  return cutToLimit(label, limit)
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

function writeCachedLocation(lat: number, lon: number, displayName: string, city?: string, area?: string) {
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ lat, lon, displayName, city, area, ts: Date.now() }))
  } catch {
    // storage unavailable (private mode) — detection still works per mount
  }
}

export function LocationInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  optional,
  autoDetect = true,
  mode = 'address',
  maxLength = DEFAULT_MAX_LENGTH,
}: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
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
      setSuggestions([])
      setOpen(false)
      setSearchError('Place search is unavailable right now')
    } finally {
      setSearching(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    onChange(next)
    setSearchError(null)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(next), 300)
  }

  const pick = (s: Suggestion) => {
    // A chosen suggestion replaces the raw typed text with a clean, short
    // label so the value always fits the field it is written to.
    onChange(composeLocation(s.displayName, s.address, mode, maxLength))
    setSuggestions([])
    setOpen(false)
    setSearchError(null)
  }

  const fillFromCoordinates = async (lat: number, lon: number, silent: boolean) => {
    setLocating(true)
    try {
      const res = await api.get('/location/reverse', { params: { lat, lon } })
      const result = res.data?.data?.result
      const city = result?.address?.city || result?.address?.town || result?.address?.village || result?.address?.county
      const area = result?.address?.neighbourhood || result?.address?.suburb
      const label = composeLocation(result?.displayName, result?.address, mode, maxLength)
      setSearchError(null)
      if (label) {
        onChangeRef.current(label)
        writeCachedLocation(lat, lon, label, city, area)
        if (!silent) toast.success('Current location detected')
      }
    } catch {
      // A city field must never be filled with raw coordinates: that is the
      // "location comes as a number" complaint. Ask the person to type instead.
      if (mode === 'city') {
        setSearchError('Could not read a place name for that location')
      } else {
        const fallback = `${lat.toFixed(4)}, ${lon.toFixed(4)}`
        onChangeRef.current(fallback)
        writeCachedLocation(lat, lon, fallback)
        if (!silent) toast.success('Current location coordinates detected')
      }
    } finally {
      setLocating(false)
    }
  }
  // GPS fix arrived: fill only when this field asked for it and is empty.
  useEffect(() => {
    if (!geo.fix || !wantFillRef.current || valueRef.current) return
    wantFillRef.current = false
    fillFromCoordinates(geo.fix.lat, geo.fix.lon, true)
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
      // A cached coordinate pair is useless to a city field — re-resolve it
      // rather than writing "13.0339" as the city.
      if (!(mode === 'city' && looksLikeCoordinates(cached.displayName))) {
        const label = mode === 'city'
          ? cutToLimit(cached.city || cached.area || cached.displayName.split(',')[0] || '', maxLength)
          : cutToLimit(cached.displayName, maxLength)
        if (label) {
          onChangeRef.current(label)
          return
        }
      }
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
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={maxLength}
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
      {searchError && (
        <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {searchError} — you can still type the location yourself.
        </p>
      )}
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

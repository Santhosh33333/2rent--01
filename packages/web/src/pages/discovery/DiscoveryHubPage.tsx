import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, GripVertical, Loader2, MapPin, Navigation, Search, SlidersHorizontal, Sparkles, Star } from 'lucide-react'
import { DISCOVERY_CATEGORIES, QUICK_ACTIONS, type DiscoveryCategoryKey } from '../../lib/discoveryData'
import { api, assetUrl } from '../../lib/api'
import { useGeolocation, geoStatusMessage } from '../../lib/geolocation'
import { getErrorMessage } from '../../lib/error'

const STORAGE_KEY = 'Sidebud.discovery-order'
const RADII = [1, 5, 10, 25]

interface NearbyPartner {
  id: string
  userId: string | null
  name: string
  avatarUrl: string | null
  city: string | null
  services: string[]
  rating: number
  completedJobs: number
  distanceKm?: number
}

function NearbyPartners() {
  const geo = useGeolocation(true)
  const [partners, setPartners] = useState<NearbyPartner[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [radius, setRadius] = useState(10)
  const [loadedWithoutLocation, setLoadedWithoutLocation] = useState(false)

  const fetchNearby = async (lat?: number, lon?: number) => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string | number> = { limit: 12, radiusKm: radius }
      if (lat !== undefined && lon !== undefined) {
        params.lat = lat
        params.lon = lon
      }
      const res = await api.get('/discovery/nearby-partners', { params })
      const data = res.data?.data || res.data
      setPartners(Array.isArray(data?.partners) ? data.partners : [])
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load nearby partners'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (geo.fix) fetchNearby(geo.fix.lat, geo.fix.lon)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.fix, radius])

  const geoMsg = geoStatusMessage(geo.status)

  return (
    <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Navigation className="w-4 h-4 text-emerald-500" />
          <h2 className="font-semibold">Partners near you</h2>
        </div>
        <div className="flex items-center gap-1">
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRadius(r)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                radius === r
                  ? 'bg-emerald-500 text-white'
                  : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>

      {loading && partners.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-surface-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Finding partners nearby…
        </div>
      ) : error ? (
        <div className="py-4 text-center">
          <p className="text-sm text-surface-500">{error}</p>
          <button
            type="button"
            onClick={() => (geo.fix ? fetchNearby(geo.fix.lat, geo.fix.lon) : geo.requestFix())}
            className="mt-2 text-sm font-semibold text-primary-600 dark:text-primary-400"
          >
            Retry
          </button>
        </div>
      ) : partners.length === 0 ? (
        <div className="py-4 text-center text-sm text-surface-500">
          {geoMsg ? (
            <>
              <p>{geoMsg}</p>
              <div className="mt-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => geo.requestFix()}
                  className="font-semibold text-primary-600 dark:text-primary-400"
                >
                  Enable location
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoadedWithoutLocation(true)
                    fetchNearby()
                  }}
                  className="font-semibold text-surface-600 dark:text-surface-300"
                >
                  Browse all
                </button>
              </div>
            </>
          ) : (
            'No available partners in this area yet.'
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {partners.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-surface-200 p-3 dark:border-surface-700">
              {p.avatarUrl ? (
                <img src={assetUrl(p.avatarUrl) || ''} alt={p.name} className="w-12 h-12 rounded-2xl object-cover shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold shrink-0">
                  {(p.name || 'P').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{p.name}</p>
                <p className="text-xs text-surface-500 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {p.distanceKm !== undefined ? `${p.distanceKm} km away` : p.city || 'Nearby'}
                </p>
                <p className="text-xs text-surface-500 flex items-center gap-1 mt-0.5">
                  <Star className="w-3 h-3 text-amber-500" />
                  {Number(p.rating || 0).toFixed(1)} · {p.completedJobs} jobs · {p.services.join(' + ') || 'services'}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <Link
                  to={`/bookings/create${p.services.includes('carry') && !p.services.includes('walking') ? '?type=CARRY' : ''}`}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white text-center"
                >
                  Book
                </Link>
                {p.userId && (
                  <Link
                    to={`/messages/${p.userId}`}
                    className="rounded-lg bg-surface-100 px-3 py-1.5 text-xs font-semibold text-surface-700 text-center dark:bg-surface-800 dark:text-surface-200"
                  >
                    Message
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {loadedWithoutLocation && partners.length > 0 && (
        <p className="mt-2 text-xs text-surface-400">Showing all partners — enable location for distances.</p>
      )}
    </div>
  )
}

export function DiscoveryHubPage() {
  const [query, setQuery] = useState('')
  const [customOrder, setCustomOrder] = useState<DiscoveryCategoryKey[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        return JSON.parse(saved) as DiscoveryCategoryKey[]
      } catch {
        return []
      }
    }
    return DISCOVERY_CATEGORIES.map((category) => category.key)
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customOrder))
  }, [customOrder])

  const orderedCategories = useMemo(() => {
    const map = new Map(DISCOVERY_CATEGORIES.map((category) => [category.key, category]))
    return customOrder
      .map((key) => map.get(key))
      .filter(Boolean) as typeof DISCOVERY_CATEGORIES
  }, [customOrder])

  const filteredCategories = orderedCategories.filter((category) => {
    const haystack = `${category.label} ${category.summary}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  const moveCategory = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= customOrder.length) return
    const updated = [...customOrder]
    ;[updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]]
    setCustomOrder(updated)
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary-500 font-semibold">Discover</p>
          <h1 className="text-2xl font-bold font-display tracking-tight">Explore your ecosystem</h1>
        </div>
        <Link to="/search" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-primary-500/25">
          <Search className="w-4 h-4" />
          Search
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories, activities, and communities..."
          className="input pl-12 py-3.5"
        />
      </div>

      <NearbyPartners />

      <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary-500" />
          <h2 className="font-semibold">Quick actions</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.key} to={action.route} className="rounded-full bg-surface-100 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700">
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <h2 className="font-semibold">Customize category order</h2>
          </div>
          <span className="text-xs text-surface-500">Pinned first</span>
        </div>

        <div className="space-y-2">
          {filteredCategories.map((category) => (
            <div key={category.key} className="flex items-center gap-3 rounded-2xl border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-800/60">
              <GripVertical className="w-4 h-4 text-surface-400" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <category.icon className="w-4 h-4 text-primary-500" />
                  <span className="font-medium">{category.label}</span>
                </div>
                <p className="mt-1 text-xs text-surface-500">{category.summary}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => moveCategory(customOrder.indexOf(category.key), -1)} className="rounded-lg bg-surface-100 px-2 py-1 text-xs dark:bg-surface-700">↑</button>
                <button onClick={() => moveCategory(customOrder.indexOf(category.key), 1)} className="rounded-lg bg-surface-100 px-2 py-1 text-xs dark:bg-surface-700">↓</button>
                <Link to={`/discover/${category.key}`} className="ml-2 inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white">
                  Open <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {filteredCategories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-surface-300 p-6 text-center text-sm text-surface-500">
            No category matches this search.
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredCategories.map((category) => (
          <Link key={category.key} to={`/discover/${category.key}`} className="group rounded-3xl border border-surface-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md dark:border-surface-800 dark:bg-surface-900">
            <div className={`inline-flex rounded-2xl bg-gradient-to-br ${category.accent} p-3 text-white`}>
              <category.icon className="w-5 h-5" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{category.label}</h3>
            <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">{category.summary}</p>
            <div className="mt-4 flex items-center justify-between text-sm font-medium text-primary-600 dark:text-primary-400">
              <span>Open section</span>
              <ChevronRight className="w-4 h-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

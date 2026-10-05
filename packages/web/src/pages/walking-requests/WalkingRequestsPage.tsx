import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Dog, MapPin, IndianRupee, Plus, AlertTriangle,
  Clock, Search, Footprints
} from 'lucide-react'
import { api } from '../../lib/api'
import { formatINR } from '../../lib/format'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { FloatingActionButton } from '../../components/FloatingActionButton'
import { getErrorMessage } from '../../lib/error'

/**
 * Shape of a row from GET /walking-requests.
 *
 * This used to declare `type`, `location`, `date` and `reward` with a numeric
 * `id` and lowercase statuses. None of those exist: the backend returns the raw
 * WalkingRequest model, so every one of those reads was `undefined` and the
 * page threw on the first render. The interface now matches the model.
 *
 * `fare` is a Prisma Decimal and arrives as a STRING ("112.75"), so it is typed
 * as string | number and coerced at the point of display.
 */
interface WalkingRequest {
  id: string
  status: string
  startLocation: string
  endLocation: string
  startTime: string
  durationMinutes: number | null
  fare: string | number | null
  requester?: { id: string; fullName: string | null } | null
}

/**
 * Keyed by the statuses the controller actually writes. `status` is a free-form
 * String column, not an enum, so an unrecognised value is possible and must not
 * be indexed into blindly — `statusConfig[r.status].badge` is exactly the kind
 * of access that turns one unexpected row into a blank page for everyone.
 */
const STATUS_META: Record<string, { label: string; badge: string }> = {
  OPEN: { label: 'Open', badge: 'badge-success' },
  ACCEPTED: { label: 'Accepted', badge: 'badge-warning' },
  COMPLETED: { label: 'Completed', badge: 'badge-neutral' },
  CANCELLED: { label: 'Cancelled', badge: 'badge-danger' },
}

const UNKNOWN_STATUS = { label: 'Unknown', badge: 'badge-neutral' }

const statusMeta = (status: string) => STATUS_META[status] ?? UNKNOWN_STATUS

/**
 * Filter tabs carry the exact backend status they match. The previous version
 * compared a lowercase tab key against the uppercase column value, so every
 * tab except "All" silently returned nothing.
 */
const FILTERS = [
  { key: 'all', label: 'All', status: null },
  { key: 'open', label: 'Open', status: 'OPEN' },
  { key: 'accepted', label: 'Accepted', status: 'ACCEPTED' },
  { key: 'completed', label: 'Completed', status: 'COMPLETED' },
  { key: 'cancelled', label: 'Cancelled', status: 'CANCELLED' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

const FILTER_STATUS: Record<string, string | null> = Object.fromEntries(
  FILTERS.map(f => [f.key, f.status]),
)

/**
 * date-fns `format` throws RangeError on an invalid Date, and a single malformed
 * row inside a list takes the whole page down with it. Every date on this page
 * goes through here, so an unparseable value degrades to a dash instead.
 */
function safeDate(value: string | null | undefined, pattern: string): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return format(d, pattern)
  } catch {
    return '—'
  }
}

/** "Koramangala → Indiranagar", collapsing the case where both ends match. */
function routeLabel(r: WalkingRequest): string {
  const from = r.startLocation?.trim() || 'Unknown start'
  const to = r.endLocation?.trim() || 'Unknown end'
  return from === to ? from : `${from} → ${to}`
}

export function WalkingRequestsPage() {
  const [requests, setRequests] = useState<WalkingRequest[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestController = useRef<AbortController | null>(null)

  const fetchRequests = useCallback(async () => {
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    try {
      setLoading(true)
      setError(null)
      const res = await api.get('/walking-requests', { signal: controller.signal, timeout: 15000 })
      const data = res.data?.data || res.data || []
      if (!controller.signal.aborted) setRequests(Array.isArray(data) ? data : (data.items || []))
    } catch (err: unknown) {
      if (!controller.signal.aborted) setError(getErrorMessage(err, 'Could not load walking requests.'))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
      if (requestController.current === controller) requestController.current = null
    }
  }, [])

  useEffect(() => {
    void fetchRequests()
    return () => requestController.current?.abort()
  }, [fetchRequests])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="skeleton h-8 w-48 rounded-2xl" />
          <div className="skeleton h-10 w-36 rounded-2xl" />
        </div>
        <div className="skeleton h-12 rounded-2xl" />
        {[1, 2, 3].map(i => (
          <div key={i} className="glass-card-static p-5">
            <div className="flex justify-between">
              <div className="space-y-2"><div className="skeleton h-5 w-40 rounded-xl" /><div className="skeleton h-4 w-32 rounded-xl" /></div>
              <div className="space-y-2"><div className="skeleton h-5 w-20 rounded-xl" /><div className="skeleton h-5 w-16 rounded-full" /></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load requests"
        description={error}
        action={<button onClick={fetchRequests} className="btn-primary btn-sm">Retry</button>}
      />
    )
  }

  const filtered = requests.filter(r => {
    const wantStatus = FILTER_STATUS[filter]
    if (wantStatus && r.status !== wantStatus) return false
    // Search both ends of the route plus the requester's name. The old code
    // called .toLowerCase() straight on `location` and `type`, which threw a
    // TypeError the moment the user typed in the box.
    const q = search.trim().toLowerCase()
    if (!q) return true
    const haystack = [r.startLocation, r.endLocation, r.requester?.fullName]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Walking Requests"
        subtitle="Find or create walking opportunities"
        action={
          <Link to="/walking-requests/create" className="btn-gradient btn-sm">
            <Plus className="w-4 h-4" /> Create Request
          </Link>
        }
      />

      {/* Search & Filters */}
      <AnimatedPage delay={50}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            placeholder="Search by location or type..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-12 py-3.5"
          />
        </div>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f.key
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      {/* Request List */}
      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Footprints}
            title={search ? 'No requests found' : 'No walking requests yet'}
            description={search ? 'Try a different search' : 'Create a new walking request to get started'}
            action={
              !search ? (
                <Link to="/walking-requests/create" className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Create Request
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4">
            {filtered.map(req => (
              <Link
                key={req.id}
                to={`/walking-requests/${req.id}`}
                className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
                      <Dog className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold font-display text-surface-900 dark:text-white capitalize group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                        Walking Request
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <MapPin className="w-3 h-3" /> {routeLabel(req)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <Clock className="w-3 h-3" /> {safeDate(req.startTime, 'MMM d, yyyy · h:mm a')}
                        </span>
                        {req.durationMinutes ? (
                          <span className="flex items-center gap-1 text-xs text-surface-500">
                            <Footprints className="w-3 h-3" /> {req.durationMinutes} min
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                      <span className="flex items-center gap-1 text-sm font-bold text-surface-900 dark:text-white">
                        <IndianRupee className="w-3.5 h-3.5 text-emerald-500" />
                        {formatINR(req.fare)}
                      </span>
                    <span className={statusMeta(req.status).badge}>
                      {statusMeta(req.status).label}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </AnimatedPage>

      <FloatingActionButton icon={Plus} label="New Request" to="/walking-requests/create" />
    </div>
  )
}

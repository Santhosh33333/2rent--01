import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Dog, MapPin, IndianRupee, Plus, AlertTriangle,
  Clock, Search, CheckCircle, Hourglass, Footprints
} from 'lucide-react'
import { api } from '../../lib/api'
import { formatINR } from '../../lib/format'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { FloatingActionButton } from '../../components/FloatingActionButton'

interface Request {
  id: number
  type: 'walking' | 'companionship'
  location: string
  date: string
  status: 'open' | 'accepted' | 'completed'
  reward: number
}

const statusConfig = {
  open: { label: 'Open', icon: Hourglass, badge: 'badge-success' },
  accepted: { label: 'Accepted', icon: CheckCircle, badge: 'badge-warning' },
  completed: { label: 'Completed', icon: CheckCircle, badge: 'badge-neutral' },
}

export function WalkingRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([])
  const [filter, setFilter] = useState<'all' | 'open' | 'accepted' | 'completed'>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await api.get('/walking-requests')
        const data = res.data?.data || res.data || []
        setRequests(Array.isArray(data) ? data : (data.items || []))
      } catch {
        setError('Failed to load walking requests')
      } finally {
        setLoading(false)
      }
    }
    fetchRequests()
  }, [])

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
        action={<button onClick={() => window.location.reload()} className="btn-primary btn-sm">Retry</button>}
      />
    )
  }

  const filtered = requests.filter(r => {
    if (filter !== 'all' && r.status !== filter) return false
    if (search && !r.location.toLowerCase().includes(search.toLowerCase()) && !r.type.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const filters = ['all', 'open', 'accepted', 'completed'] as const

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
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
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
                        {req.type} Request
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <MapPin className="w-3 h-3" /> {req.location}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <Clock className="w-3 h-3" /> {format(new Date(req.date), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2">
                      <span className="flex items-center gap-1 text-sm font-bold text-surface-900 dark:text-white">
                        <IndianRupee className="w-3.5 h-3.5 text-emerald-500" />
                        {formatINR(req.reward)}
                      </span>
                    <span className={statusConfig[req.status].badge}>
                      {statusConfig[req.status].label}
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

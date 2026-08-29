import { useState, useEffect } from 'react'
import {
  Package, Navigation, IndianRupee, Clock, CheckCircle,
  AlertTriangle, RefreshCw, Truck
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { EmptyState } from '../../components/EmptyState'

type JobTab = 'available' | 'active' | 'completed'

interface CarryJob {
  _id: string
  description: string
  pickupLocation: { address: string; lat?: number; lng?: number }
  dropLocation: { address: string; lat?: number; lng?: number }
  status: string
  price: number
  distance: number
  createdAt: string
  requester?: { fullName?: string; phone?: string }
}

const TABS: { key: JobTab; label: string }[] = [
  { key: 'available', label: 'Available' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
]

export function CarryBuddyJobsPage() {
  const [activeTab, setActiveTab] = useState<JobTab>('available')
  const [jobs, setJobs] = useState<CarryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  useEffect(() => {
    const fetchJobs = async () => {
      setLoading(true)
      setError(null)
      try {
        const endpoint = activeTab === 'available'
          ? '/carry-buddy/requests'
          : '/carry-buddy/my-requests'
        const res = await api.get(endpoint)
        const root = res.data
        const data = (Array.isArray(root) ? root : (root?.data?.items ?? root?.data ?? [])) || []
        const filtered = activeTab === 'completed'
          ? data.filter((j: CarryJob) => j.status === 'completed')
          : activeTab === 'active'
          ? data.filter((j: CarryJob) => j.status === 'active' || j.status === 'in_progress')
          : data.filter((j: CarryJob) => j.status === 'pending' || j.status === 'available')
        setJobs(filtered)
      } catch {
        setError('Failed to load jobs')
      } finally {
        setLoading(false)
      }
    }
    fetchJobs()
  }, [activeTab])

  const handleAccept = async (jobId: string) => {
    setAcceptingId(jobId)
    try {
      await api.post(`/carry-buddy/${jobId}/accept`)
      setJobs((prev) => prev.filter((j) => j._id !== jobId))
    } catch {
      // silently fail — user can retry
    } finally {
      setAcceptingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><CheckCircle className="w-3 h-3" /> Done</span>
      case 'active':
      case 'in_progress':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400"><Truck className="w-3 h-3" /> In Progress</span>
      case 'pending':
      case 'available':
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400"><Clock className="w-3 h-3" /> Pending</span>
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">{status}</span>
    }
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertTriangle className="w-10 h-10 text-danger-400" /></div>
        <h3 className="empty-state-title">Failed to load jobs</h3>
        <p className="empty-state-desc">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-6">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
            <Package className="w-6 h-6 text-amber-500" />
            Carry Jobs
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Browse and manage your carry buddy deliveries</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="flex gap-1 p-1 rounded-2xl bg-surface-100 dark:bg-surface-800/50">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.key
                  ? 'bg-white dark:bg-surface-700 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={200}>
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="glass-card-static p-5">
                <div className="flex items-start gap-4">
                  <div className="skeleton w-11 h-11 rounded-xl flex-shrink-0" />
                  <div className="flex-1 space-y-3">
                    <div className="skeleton h-4 w-2/3 rounded-xl" />
                    <div className="skeleton h-3 w-1/2 rounded-xl" />
                    <div className="flex gap-2">
                      <div className="skeleton h-3 w-16 rounded-full" />
                      <div className="skeleton h-3 w-12 rounded-full" />
                    </div>
                  </div>
                  <div className="skeleton h-8 w-20 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Package}
            title={`No ${activeTab} jobs`}
            description={
              activeTab === 'available'
                ? 'Check back later for new carry jobs in your area'
                : activeTab === 'active'
                ? 'You have no active deliveries right now'
                : 'Completed jobs will appear here'
            }
          />
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <GlassCard key={job._id} variant="elevated" padding="lg">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 flex-shrink-0">
                    <Package className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-surface-900 dark:text-white truncate">{job.description || 'Package Delivery'}</h3>
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                          {new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      {getStatusBadge(job.status)}
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                        <span className="truncate">{job.pickupLocation?.address ?? 'Pickup location'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-400">
                        <div className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
                        <span className="truncate">{job.dropLocation?.address ?? 'Drop location'}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-4">
                      <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-surface-400">
                        <span className="flex items-center gap-1">
                          <Navigation className="w-3 h-3" />
                          {job.distance ? `${job.distance.toFixed(1)} km` : '—'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(job.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-lg font-bold text-amber-600 dark:text-amber-400 flex items-center">
                          <IndianRupee className="w-4 h-4" />{job.price}
                        </p>
                        {activeTab === 'available' && (
                          <button
                            onClick={() => handleAccept(job._id)}
                            disabled={acceptingId === job._id}
                            className="btn-primary btn-sm px-4 py-2 text-xs disabled:opacity-50"
                          >
                            {acceptingId === job._id ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              'Accept'
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

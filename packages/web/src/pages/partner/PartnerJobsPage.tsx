import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, MapPin, Clock, CheckCircle, XCircle, Navigation,
  Search, Footprints, Package, ArrowRight, User, Loader2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { EmptyState } from '../../components/EmptyState'

interface Job {
  id: string
  serviceType: string
  startLocation: string
  endLocation?: string
  status: string
  scheduledAt: string
  partnerEarning?: number
  userName?: string
  user?: { fullName?: string }
}

type TabType = 'available' | 'active' | 'completed'

const statusConfig: Record<string, { label: string; badge: string }> = {
  OPEN: { label: 'Available', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  PARTNER_ACCEPTED: { label: 'Accepted', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  OTP_GENERATED: { label: 'OTP Generated', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  IN_PROGRESS: { label: 'In Progress', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  COMPLETED: { label: 'Completed', badge: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

export function PartnerJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeTab, setActiveTab] = useState<TabType>('available')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [acceptingId, setAcceptingId] = useState<string | null>(null)

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        let endpoint = '/partner/nearby-bookings'
        if (activeTab === 'active') endpoint = '/partner/bookings?status=IN_PROGRESS,OTP_GENERATED,PARTNER_ACCEPTED'
        else if (activeTab === 'completed') endpoint = '/partner/bookings?status=COMPLETED'

        const res = await api.get(endpoint)
        const raw = res.data?.data || res.data || {}
        setJobs(Array.isArray(raw) ? raw : raw.items || [])
      } catch {
        toast.error('Failed to load jobs')
      } finally {
        setLoading(false)
      }
    }
    fetchJobs()
  }, [activeTab])

  const handleAccept = async (id: string) => {
    setAcceptingId(id)
    try {
      await api.post(`/partner/bookings/${id}/accept`)
      setJobs((prev) => prev.filter((j) => j.id !== id))
      toast.success('Job accepted!')
    } catch {
      toast.error('Failed to accept job')
    } finally {
      setAcceptingId(null)
    }
  }

  const handleReject = async (id: string) => {
    try {
      await api.post(`/partner/bookings/${id}/reject`)
      setJobs((prev) => prev.filter((j) => j.id !== id))
      toast.success('Job rejected')
    } catch {
      toast.error('Failed to reject job')
    }
  }

  const filtered = jobs.filter((j) => {
    const q = search.toLowerCase()
    return !q || (j.startLocation || '').toLowerCase().includes(q) || (j.userName || j.user?.fullName || '').toLowerCase().includes(q)
  })

  const tabs: { key: TabType; label: string; icon: typeof ClipboardList }[] = [
    { key: 'available', label: 'Available', icon: Footprints },
    { key: 'active', label: 'Active', icon: ClipboardList },
    { key: 'completed', label: 'Completed', icon: CheckCircle },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="flex gap-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10 w-28 rounded-xl" />)}</div>
        <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="glass-card-static p-5"><div className="flex items-start gap-4"><div className="skeleton w-12 h-12 rounded-2xl" /><div className="flex-1 space-y-2"><div className="skeleton h-5 w-32 rounded-xl" /><div className="skeleton h-3 w-48 rounded-xl" /></div></div></div>)}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-3">
            <ClipboardList className="w-7 h-7 text-emerald-500" />
            Jobs
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Accept and manage booking requests</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setLoading(true) }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={75}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input type="text" placeholder="Search by location..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-12 py-3.5" />
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={activeTab === 'available' ? 'No available jobs' : activeTab === 'active' ? 'No active jobs' : 'No completed jobs'}
            description={search ? 'Try a different search' : activeTab === 'available' ? 'Check back later for new requests' : 'Jobs will appear here'}
          />
        ) : (
          <div className="grid gap-4">
            {filtered.map((job) => (
              <GlassCard key={job.id} variant="elevated" padding="none" className="overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0 ${
                        job.serviceType === 'WALKING'
                          ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/20'
                          : 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20'
                      }`}>
                        {job.serviceType === 'WALKING' ? <Footprints className="w-5 h-5 text-white" /> : <Package className="w-5 h-5 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-bold font-display text-surface-900 dark:text-white capitalize">
                          {job.serviceType === 'WALKING' ? 'Walking Buddy' : 'CarryBuddy'}
                        </h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          <span className="flex items-center gap-1 text-xs text-surface-500"><MapPin className="w-3 h-3" /> {job.startLocation || 'Pickup'}</span>
                          {job.endLocation && job.endLocation !== job.startLocation && <span className="flex items-center gap-1 text-xs text-surface-500"><Navigation className="w-3 h-3" /> {job.endLocation}</span>}
                          <span className="flex items-center gap-1 text-xs text-surface-500">
                            <Clock className="w-3 h-3" />
                            {job.scheduledAt ? new Date(job.scheduledAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'ASAP'}
                          </span>
                        </div>
                        {(job.userName || job.user?.fullName) && (
                          <span className="flex items-center gap-1 text-xs text-surface-400 mt-1"><User className="w-3 h-3" /> {job.userName || job.user?.fullName}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-2 flex-shrink-0">
                      {job.partnerEarning !== undefined && (
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{job.partnerEarning}</span>
                      )}
                      <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${statusConfig[job.status]?.badge || ''}`}>
                        {statusConfig[job.status]?.label || job.status}
                      </span>
                    </div>
                  </div>
                </div>

                {activeTab === 'available' && (
                  <div className="flex border-t border-surface-200 dark:border-surface-700/50">
                    <button onClick={() => handleReject(job.id)} className="flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium text-surface-500 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                    <div className="w-px bg-surface-200 dark:bg-surface-700/50" />
                    <button onClick={() => handleAccept(job.id)} disabled={acceptingId === job.id} className="flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors disabled:opacity-50">
                      {acceptingId === job.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                      Accept
                    </button>
                  </div>
                )}

                {(activeTab === 'active' || activeTab === 'completed') && (
                  <div className="border-t border-surface-200 dark:border-surface-700/50 p-3">
                    <Link to={`/bookings/${job.id}`} className="flex items-center justify-center gap-2 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors">
                      View Details <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

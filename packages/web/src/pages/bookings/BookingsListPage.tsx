import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Footprints, Package, MapPin, ArrowRight, Clock, Search, Plus
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { EmptyState } from '../../components/EmptyState'
import { FloatingActionButton } from '../../components/FloatingActionButton'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

interface Booking {
  id: string
  serviceType: string
  startLocation: string
  endLocation: string
  status: string
  scheduledAt: string
  partnerName?: string
  estimatedAmount?: number
  finalAmount?: number
  partner?: {
    user: { fullName?: string }
  }
}

type TabType = 'ACTIVE' | 'PAST' | 'CANCELLED' | 'ALL'

const statusConfig: Record<string, { label: string; badge: string }> = {
  PENDING: { label: 'Pending', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  CONFIRMED: { label: 'Confirmed', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  PARTNER_ACCEPTED: { label: 'Partner Found', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  OTP_GENERATED: { label: 'OTP Generated', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  IN_PROGRESS: { label: 'In Progress', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  COMPLETED: { label: 'Completed', badge: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  PAYMENT_PENDING: { label: 'Payment Pending', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
}

const activeStatuses = ['PENDING', 'CONFIRMED', 'PARTNER_ACCEPTED', 'OTP_GENERATED', 'IN_PROGRESS', 'PAYMENT_PENDING']
const pastStatuses = ['COMPLETED']

export function BookingsListPage() {
  const [activeTab, setActiveTab] = useState<TabType>('ACTIVE')
  const [search, setSearch] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])

  const { loading, error, retry } = useAsync(
    async () => {
      const res = await api.get('/bookings')
      const raw = res.data?.data || res.data || {}
      const data = Array.isArray(raw) ? raw : raw.items || []
      setBookings(data.map((b: any) => ({ ...b, partnerName: b?.partner?.user?.fullName })))
      return data
    },
    true
  )

  const filtered = bookings.filter((b) => {
    let matchesTab = false
    if (activeTab === 'ACTIVE') matchesTab = activeStatuses.includes(b.status)
    else if (activeTab === 'PAST') matchesTab = pastStatuses.includes(b.status)
    else if (activeTab === 'CANCELLED') matchesTab = b.status === 'CANCELLED'
    else matchesTab = true

    const matchesSearch = search
      ? (b.startLocation || '').toLowerCase().includes(search.toLowerCase()) ||
        (b.endLocation || '').toLowerCase().includes(search.toLowerCase()) ||
        (b.partnerName || b.partner?.user?.fullName || '').toLowerCase().includes(search.toLowerCase())
      : true

    return matchesTab && matchesSearch
  })

  const tabs: { key: TabType; label: string }[] = [
    { key: 'ACTIVE', label: 'Active' },
    { key: 'PAST', label: 'Past' },
    { key: 'CANCELLED', label: 'Cancelled' },
    { key: 'ALL', label: 'All' },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="flex gap-2">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-10 w-24 rounded-xl" />)}</div>
        <div className="skeleton h-12 rounded-2xl" />
        <SkeletonLoader lines={5} variant="list" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={Footprints}
        title="Failed to load bookings"
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white font-display tracking-tight">My Bookings</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-1.5 text-sm">Manage all your bookings</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={75}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            placeholder="Search bookings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-12 py-3.5"
          />
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Footprints}
            title={search ? 'No bookings match' : activeTab === 'ACTIVE' ? 'No active bookings' : 'No bookings found'}
            description={search ? 'Try a different search' : 'Book a walk or delivery to get started'}
            action={
              !search ? (
                <Link to="/bookings/create" className="btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> Create Booking
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4">
            {filtered.map((booking) => (
              <Link
                key={booking.id}
                to={`/bookings/${booking.id}`}
                className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300 block"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0 ${
                      booking.serviceType === 'WALKING'
                        ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/20'
                        : 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20'
                    }`}>
                      {booking.serviceType === 'WALKING'
                        ? <Footprints className="w-5 h-5 text-white" />
                        : <Package className="w-5 h-5 text-white" />
                      }
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold font-display text-surface-900 dark:text-white capitalize">
                        {booking.serviceType === 'WALKING' ? 'Walking Buddy' : 'CarryBuddy'}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <MapPin className="w-3 h-3" /> {booking.startLocation || 'Pickup'}
                        </span>
                        {booking.endLocation && booking.endLocation !== booking.startLocation && (
                          <>
                            <ArrowRight className="w-3 h-3 text-surface-400" />
                            <span className="text-xs text-surface-500">{booking.endLocation}</span>
                          </>
                        )}
                        <span className="flex items-center gap-1 text-xs text-surface-500">
                          <Clock className="w-3 h-3" />
                          {booking.scheduledAt
                            ? new Date(booking.scheduledAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : 'ASAP'}
                        </span>
                      </div>
                      {booking.partnerName && (
                        <p className="text-xs text-surface-400 mt-1">Partner: {booking.partnerName}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-2 flex-shrink-0">
                    {(booking.finalAmount ?? booking.estimatedAmount) !== undefined && (
                      <span className="text-sm font-bold text-surface-900 dark:text-white">₹{(booking.finalAmount ?? booking.estimatedAmount ?? 0).toLocaleString('en-IN')}</span>
                    )}
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${statusConfig[booking.status]?.badge || ''}`}>
                      {statusConfig[booking.status]?.label || booking.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </AnimatedPage>

      <FloatingActionButton icon={Plus} label="New Booking" onClick={() => window.location.href = '/bookings/create'} />
    </div>
  )
}

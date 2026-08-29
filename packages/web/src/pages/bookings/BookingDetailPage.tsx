import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Footprints, Package, MapPin, Navigation, Clock, Calendar, Star,
  CreditCard, CheckCircle, XCircle, User, Loader2, AlertTriangle
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface Booking {
  id: string
  serviceType: string
  startLocation: string
  endLocation: string
  status: string
  scheduledAt: string
  durationMinutes: number
  estimatedAmount?: number
  finalAmount?: number
  totalPrice?: number
  platformFee: number
  partnerEarning: number
  partnerName?: string
  partnerRating?: number
  partnerPhone?: string
  paymentStatus?: string
  paymentId?: string
  paymentMethod?: 'ONLINE' | 'CASH'
  notes?: string
  createdAt: string
}

const statusTimeline = [
  { key: 'PENDING', label: 'Booking Created' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'PARTNER_ACCEPTED', label: 'Partner Assigned' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'COMPLETED', label: 'Completed' },
]

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

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!id) return
    const fetchBooking = async () => {
      try {
        const res = await api.get(`/bookings/${id}`)
        const data = res.data?.data || res.data
        setBooking({
          ...data,
          partnerName: data?.partner?.user?.fullName,
          partnerRating: data?.partner?.averageRating ?? data?.partner?.user?.rating,
          partnerPhone: data?.partner?.user?.phone,
        })
        if (data?.notes) {
          try { const n = JSON.parse(data.notes); if (n.paymentMethod) setBooking(prev => prev ? { ...prev, paymentMethod: n.paymentMethod } : null) } catch {}
        }
      } catch {
        toast.error('Failed to load booking details')
      } finally {
        setLoading(false)
      }
    }
    fetchBooking()
  }, [id])

  const handleCancel = async () => {
    if (!id) return
    setCancelling(true)
    try {
      await api.post(`/bookings/${id}/cancel`)
      setBooking((prev) => prev ? { ...prev, status: 'CANCELLED' } : null)
      toast.success('Booking cancelled')
    } catch {
      toast.error('Failed to cancel booking')
    } finally {
      setCancelling(false)
    }
  }

  const canCancel = booking && ['PENDING', 'CONFIRMED'].includes(booking.status)
  const canRate = booking?.status === 'COMPLETED'
  const canTrack = booking?.status === 'IN_PROGRESS'

  const timelineIndex = statusTimeline.findIndex((s) => s.key === booking?.status)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <SkeletonLoader variant="card" />
        <SkeletonLoader variant="list" lines={4} />
      </div>
    )
  }

  if (!booking) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-12 h-12 text-surface-400 mx-auto mb-4" />
        <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white mb-2">Booking not found</h2>
        <button onClick={() => navigate('/bookings')} className="btn-primary btn-sm mt-4">View Bookings</button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <AnimatedPage>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-3">
              Booking #{booking.id?.slice(-8)}
            </h1>
            <span className={`inline-block mt-2 text-xs px-3 py-1 rounded-full font-semibold ${statusConfig[booking.status]?.badge || ''}`}>
              {statusConfig[booking.status]?.label || booking.status}
            </span>
          </div>
        </div>
      </AnimatedPage>

      {booking.status === 'PARTNER_ACCEPTED' && (
        <AnimatedPage delay={50}>
          <div className="p-4 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 text-white flex items-center justify-between gap-3">
            <div>
              <p className="font-bold text-sm">🎉 Partner Accepted!</p>
              <p className="text-xs text-white/80 mt-0.5">Your partner has been assigned. Payment was made from your wallet.</p>
            </div>
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-4">Status Timeline</h3>
          <div className="space-y-0">
            {statusTimeline.map((s, i) => {
              const isActive = i <= timelineIndex
              const isCurrent = i === timelineIndex
              return (
                <div key={s.key} className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      isActive
                        ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
                    } ${isCurrent ? 'ring-4 ring-primary-500/20' : ''}`}>
                      {isActive ? <CheckCircle className="w-4 h-4" /> : <div className="w-2 h-2 rounded-full bg-current" />}
                    </div>
                    {i < statusTimeline.length - 1 && (
                      <div className={`w-0.5 h-8 ${i < timelineIndex ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'}`} />
                    )}
                  </div>
                  <div className="pb-4">
                    <p className={`text-sm font-medium ${isCurrent ? 'text-primary-600 dark:text-primary-400' : isActive ? 'text-surface-900 dark:text-white' : 'text-surface-400'}`}>
                      {s.label}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={200}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-4 flex items-center gap-2">
            {booking.serviceType === 'WALKING'
              ? <Footprints className="w-5 h-5 text-emerald-500" />
              : <Package className="w-5 h-5 text-amber-500" />
            }
            Service Details
          </h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
              <MapPin className="w-4 h-4 text-emerald-500" />
              <div>
                <p className="text-xs text-surface-500">Pickup</p>
                <p className="text-sm font-medium text-surface-900 dark:text-white">{booking.startLocation}</p>
              </div>
            </div>
            {booking.endLocation && booking.endLocation !== booking.startLocation && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <Navigation className="w-4 h-4 text-primary-500" />
                <div>
                  <p className="text-xs text-surface-500">Destination</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{booking.endLocation}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <Calendar className="w-4 h-4 text-sky-500" />
                <div>
                  <p className="text-xs text-surface-500">Date</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">
                    {booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <Clock className="w-4 h-4 text-violet-500" />
                <div>
                  <p className="text-xs text-surface-500">Time</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">
                    {booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
                  </p>
                </div>
              </div>
            </div>
            {booking.durationMinutes != null && booking.durationMinutes > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <Clock className="w-4 h-4 text-amber-500" />
                <div>
                  <p className="text-xs text-surface-500">Duration</p>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{booking.durationMinutes} minutes</p>
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      </AnimatedPage>

      {booking.partnerName && (
        <AnimatedPage delay={250}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-primary-500" />
              Partner
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-bold">
                {booking.partnerName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-surface-900 dark:text-white">{booking.partnerName}</p>
                {booking.partnerRating !== undefined && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span className="text-xs text-surface-500">{booking.partnerRating.toFixed(1)}</span>
                  </div>
                )}
              </div>
              {booking.partnerPhone && (
                <a href={`tel:${booking.partnerPhone}`} className="btn-outline btn-sm">
                  Call
                </a>
              )}
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary-500" />
            Price Breakdown
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-surface-500">Estimated Price</span>
              <span className="font-medium text-surface-900 dark:text-white">₹{(booking.finalAmount ?? booking.estimatedAmount ?? 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-surface-500">Platform Fee</span>
              <span className="font-medium text-surface-900 dark:text-white">₹{(booking.platformFee || 0).toLocaleString('en-IN')}</span>
            </div>
            {booking.partnerEarning !== undefined && (
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Partner Earning</span>
                <span className="font-medium text-emerald-600 dark:text-emerald-400">₹{booking.partnerEarning.toLocaleString('en-IN')}</span>
              </div>
            )}
            <div className="h-px bg-surface-200 dark:bg-surface-700" />
            <div className="flex justify-between">
              <span className="text-sm font-bold text-surface-900 dark:text-white">Total</span>
              <span className="text-lg font-bold text-primary-600 dark:text-primary-400">₹{(booking.finalAmount ?? booking.estimatedAmount ?? 0).toLocaleString('en-IN')}</span>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      {booking.paymentStatus && (
        <AnimatedPage delay={325}>
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-500" />
              Payment Info
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-500">Status</span>
                <span className={`font-medium ${booking.paymentStatus === 'PAID' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {booking.paymentStatus}
                </span>
              </div>
              {booking.paymentMethod && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Payment Method</span>
                  <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${booking.paymentMethod === 'ONLINE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                    {booking.paymentMethod === 'ONLINE' ? '💳 Online (Razorpay)' : '💵 Cash to Partner'}
                  </span>
                </div>
              )}
              {booking.paymentId && (
                <div className="flex justify-between text-sm">
                  <span className="text-surface-500">Payment ID</span>
                  <span className="font-medium text-surface-900 dark:text-white text-xs">{booking.paymentId}</span>
                </div>
              )}
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      <AnimatedPage delay={350}>
        <div className="flex gap-3">
          {canTrack && (
            <Link to={`/bookings/${id}/tracking`} className="flex-1 btn-gradient flex items-center justify-center gap-2">
              <Navigation className="w-4 h-4" /> Track
            </Link>
          )}
          {canRate && (
            <Link to={`/bookings/${id}/rate`} className="flex-1 btn-gradient flex items-center justify-center gap-2">
              <Star className="w-4 h-4" /> Rate Partner
            </Link>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex-1 btn-outline text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 border-danger-200 dark:border-danger-800/30 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Cancel
            </button>
          )}
        </div>
      </AnimatedPage>
    </div>
  )
}

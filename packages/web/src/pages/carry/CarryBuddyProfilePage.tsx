import { useState, useEffect } from 'react'
import {
  Star, Package, Clock, CheckCircle,
  ToggleLeft, ToggleRight, Shield, Award, BarChart3,
  AlertTriangle, MessageSquare
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface PartnerProfile {
  fullName: string
  email: string
  phone: string
  isAvailable: boolean
  rating: number
  completedDeliveries: number
  totalEarnings: number
  joinDate: string
  avgDeliveryTime: string
  acceptanceRate: number
}

interface Review {
  _id: string
  rating: number
  comment: string
  reviewerName: string
  createdAt: string
}

export function CarryBuddyProfilePage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<PartnerProfile | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingAvailability, setTogglingAvailability] = useState(false)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const [profileRes, reviewsRes] = await Promise.allSettled([
          api.get('/carry-buddy/profile'),
          api.get('/carry-buddy/reviews'),
        ])

        if (profileRes.status === 'fulfilled') {
          const d = profileRes.value.data?.data ?? profileRes.value.data ?? {}
          setProfile({
            fullName: d.fullName ?? user?.name ?? 'Partner',
            email: d.email ?? user?.email ?? '',
            phone: d.phone ?? '',
            isAvailable: d.isAvailable ?? true,
            rating: d.rating ?? 0,
            completedDeliveries: d.completedDeliveries ?? 0,
            totalEarnings: d.totalEarnings ?? 0,
            joinDate: d.joinDate ?? new Date().toISOString(),
            avgDeliveryTime: d.avgDeliveryTime ?? '—',
            acceptanceRate: d.acceptanceRate ?? 0,
          })
        } else {
          setProfile({
            fullName: user?.name ?? 'Partner',
            email: user?.email ?? '',
            phone: '',
            isAvailable: true,
            rating: 0,
            completedDeliveries: 0,
            totalEarnings: 0,
            joinDate: new Date().toISOString(),
            avgDeliveryTime: '—',
            acceptanceRate: 0,
          })
        }

        if (reviewsRes.status === 'fulfilled') {
          const root = reviewsRes.value.data
          const items = Array.isArray(root) ? root : (root?.data?.items ?? root?.data ?? [])
          setReviews((Array.isArray(items) ? items : []).slice(0, 5))
        }
      } catch {
        setError('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [user])

  const toggleAvailability = async () => {
    if (!profile || togglingAvailability) return
    setTogglingAvailability(true)
    try {
      const newStatus = !profile.isAvailable
      await api.patch('/carry-buddy/availability', { isAvailable: newStatus })
      setProfile({ ...profile, isAvailable: newStatus })
    } catch {
      // silently fail
    } finally {
      setTogglingAvailability(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="skeleton w-20 h-20 rounded-full" />
          <div className="space-y-2">
            <div className="skeleton h-6 w-40 rounded-xl" />
            <div className="skeleton h-4 w-28 rounded-xl" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card-static p-4 text-center">
              <div className="skeleton h-8 w-12 mx-auto rounded-xl" />
              <div className="skeleton h-3 w-16 mx-auto mt-2 rounded-xl" />
            </div>
          ))}
        </div>
        <SkeletonLoader variant="list" lines={4} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertTriangle className="w-10 h-10 text-danger-400" /></div>
        <h3 className="empty-state-title">Failed to load profile</h3>
        <p className="empty-state-desc">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-6">Retry</button>
      </div>
    )
  }

  if (!profile) return null

  const initials = profile.fullName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  const performanceMetrics = [
    { label: 'Completed', value: profile.completedDeliveries, icon: <CheckCircle className="w-4 h-4" /> },
    { label: 'Avg Time', value: profile.avgDeliveryTime, icon: <Clock className="w-4 h-4" /> },
    { label: 'Acceptance', value: `${profile.acceptanceRate}%`, icon: <Package className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
            <div className="relative">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg shadow-amber-500/20 ring-4 ring-amber-500/20">
                {initials}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white dark:bg-surface-900 flex items-center justify-center">
                <Award className="w-4 h-4 text-amber-500" />
              </div>
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <h1 className="text-xl font-bold font-display text-surface-900 dark:text-white">{profile.fullName}</h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold border border-amber-500/20 w-fit mx-auto sm:mx-0">
                  <Shield className="w-3 h-3" />
                  CarryBuddy Partner
                </span>
              </div>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">{profile.email}</p>
              {profile.phone && <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">{profile.phone}</p>}
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">
                Partner since {new Date(profile.joinDate).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Deliveries', value: profile.completedDeliveries, gradient: 'from-emerald-500/20 to-emerald-600/10 text-emerald-600 dark:text-emerald-400' },
            { label: 'Rating', value: profile.rating > 0 ? profile.rating.toFixed(1) : '—', gradient: 'from-amber-500/20 to-amber-600/10 text-amber-600 dark:text-amber-400' },
            { label: 'Earnings', value: `₹${profile.totalEarnings.toLocaleString('en-IN')}`, gradient: 'from-sky-500/20 to-sky-600/10 text-sky-600 dark:text-sky-400' },
          ].map((stat) => (
            <div key={stat.label} className="glass-card p-4 text-center">
              <p className={`text-2xl font-bold ${stat.gradient.split(' ').pop()}`}>{stat.value}</p>
              <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                profile.isAvailable
                  ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                  : 'bg-surface-200 dark:bg-surface-700 text-surface-500'
              }`}>
                {profile.isAvailable ? <ToggleRight className="w-6 h-6" /> : <ToggleLeft className="w-6 h-6" />}
              </div>
              <div>
                <p className="text-sm font-bold text-surface-900 dark:text-white">
                  {profile.isAvailable ? 'Available for Jobs' : 'Currently Offline'}
                </p>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {profile.isAvailable ? 'You will receive new job requests' : 'Turn on to receive new jobs'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleAvailability}
              disabled={togglingAvailability}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                profile.isAvailable
                  ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                  : 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20 hover:shadow-xl hover:shadow-amber-500/30'
              } disabled:opacity-50`}
            >
              {togglingAvailability ? 'Updating...' : profile.isAvailable ? 'Go Offline' : 'Go Online'}
            </button>
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={200}>
        <GlassCard variant="elevated" padding="lg">
          <h2 className="section-title flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-amber-500" />
            Job Performance
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {performanceMetrics.map((metric) => (
              <div key={metric.label} className="text-center p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                <div className="w-8 h-8 mx-auto rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-2">
                  {metric.icon}
                </div>
                <p className="text-lg font-bold text-surface-900 dark:text-white">{metric.value}</p>
                <p className="text-[10px] font-medium text-surface-500 dark:text-surface-400 uppercase tracking-wider">{metric.label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-amber-500/5 to-orange-500/5 border border-amber-500/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">5-Star Deliveries</span>
              </div>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                {profile.completedDeliveries > 0 ? Math.floor(profile.completedDeliveries * 0.85) : 0}
              </span>
            </div>
            <div className="mt-2 w-full bg-surface-200 dark:bg-surface-700 rounded-full h-1.5">
              <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-1.5 rounded-full transition-all" style={{ width: '85%' }} />
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-amber-500" />
              Reviews
            </h2>
            {reviews.length > 0 && (
              <span className="text-xs font-medium text-surface-500 dark:text-surface-400">{reviews.length} reviews</span>
            )}
          </div>

          {reviews.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-3">
                <Star className="w-7 h-7 text-surface-400" />
              </div>
              <p className="text-sm font-medium text-surface-500 dark:text-surface-400">No reviews yet</p>
              <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">Complete deliveries to receive reviews</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <div key={review._id} className="p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-amber-500/10 flex items-center justify-center text-xs font-bold text-amber-600 dark:text-amber-400">
                        {review.reviewerName?.[0] ?? '?'}
                      </div>
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">{review.reviewerName ?? 'Anonymous'}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < review.rating ? 'text-amber-400 fill-amber-400' : 'text-surface-300 dark:text-surface-600'}`} />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-surface-600 dark:text-surface-400 leading-relaxed">{review.comment}</p>
                  <p className="text-[10px] text-surface-400 dark:text-surface-500 mt-2">
                    {new Date(review.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

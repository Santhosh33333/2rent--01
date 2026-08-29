import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Package, Route, DollarSign, Star, TrendingUp,
  CheckCircle, MapPin, ArrowRight, Wallet, Zap,
  AlertTriangle, Sparkles
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface CarryJob {
  _id: string
  description: string
  pickupLocation: { address: string }
  dropLocation: { address: string }
  status: string
  price: number
  distance: number
  createdAt: string
}

interface CarryStats {
  activeJobs: number
  totalEarnings: number
  completedJobs: number
  rating: number
}

export function CarryBuddyDashboard() {
  const { user } = useAuth()
  const [jobs, setJobs] = useState<CarryJob[]>([])
  const [stats, setStats] = useState<CarryStats>({ activeJobs: 0, totalEarnings: 0, completedJobs: 0, rating: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [myRequestsRes, statsRes] = await Promise.allSettled([
          api.get('/carry-buddy/my-requests'),
          api.get('/carry-buddy/stats'),
        ])

        if (myRequestsRes.status === 'fulfilled') {
          const root = myRequestsRes.value.data
          const items = (Array.isArray(root) ? root : (root?.data?.items ?? root?.data ?? []))
          setJobs((Array.isArray(items) ? items : []).slice(0, 5))
        }

        if (statsRes.status === 'fulfilled') {
          const s = statsRes.value.data?.data ?? statsRes.value.data ?? {}
          setStats({
            activeJobs: s.activeJobs ?? 0,
            totalEarnings: s.totalEarnings ?? 0,
            completedJobs: s.completedJobs ?? 0,
            rating: s.rating ?? 0,
          })
        }
      } catch {
        setError('Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    fetchDashboard()
  }, [])

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const userName = user?.name?.split(' ')[0] ?? 'Partner'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="skeleton h-8 w-56 rounded-2xl" />
            <div className="skeleton h-4 w-36 mt-2 rounded-xl" />
          </div>
          <div className="skeleton h-14 w-14 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card-static p-5">
              <div className="skeleton h-4 w-20 rounded-xl" />
              <div className="skeleton h-8 w-16 mt-3 rounded-xl" />
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
        <div className="empty-state-icon">
          <AlertTriangle className="w-10 h-10 text-danger-400" />
        </div>
        <h3 className="empty-state-title">Something went wrong</h3>
        <p className="empty-state-desc">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-6">Retry</button>
      </div>
    )
  }

  const quickActions = [
    { to: '/carry/jobs', icon: Package, label: 'View Jobs', desc: 'Browse available jobs', gradient: 'from-amber-500 to-orange-600' },
    { to: '/carry/route', icon: Route, label: 'Route Map', desc: 'Navigate deliveries', gradient: 'from-emerald-500 to-emerald-600' },
    { to: '/carry/earnings', icon: DollarSign, label: 'Earnings', desc: 'Track your income', gradient: 'from-sky-500 to-blue-600' },
    { to: '/carry/profile', icon: Star, label: 'Availability', desc: 'Manage your status', gradient: 'from-rose-500 to-pink-600' },
  ]

  const statCards = [
    { title: 'Active Jobs', value: stats.activeJobs, icon: <Package className="w-5 h-5" />, gradient: 'warning' as const, change: stats.activeJobs > 0 ? 'In progress' : 'None active', changeType: stats.activeJobs > 0 ? 'positive' as const : 'neutral' as const },
    { title: 'Total Earnings', value: `₹${stats.totalEarnings.toLocaleString('en-IN')}`, icon: <Wallet className="w-5 h-5" />, gradient: 'success' as const, change: 'All time', changeType: 'neutral' as const },
    { title: 'Completed Jobs', value: stats.completedJobs, icon: <CheckCircle className="w-5 h-5" />, gradient: 'primary' as const, change: stats.completedJobs > 0 ? `${stats.completedJobs} total` : 'No jobs yet', changeType: stats.completedJobs > 0 ? 'positive' as const : 'neutral' as const },
    { title: 'Rating', value: stats.rating > 0 ? stats.rating.toFixed(1) : '—', icon: <Star className="w-5 h-5" />, gradient: 'accent' as const, change: stats.rating >= 4.5 ? 'Excellent' : stats.rating >= 3 ? 'Good' : 'New partner', changeType: stats.rating >= 4.5 ? 'positive' as const : 'neutral' as const },
  ]

  return (
    <div className="space-y-6 sm:space-y-8">
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 p-6 sm:p-8 text-white shadow-xl shadow-amber-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-50" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-orange-500/20 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-xs font-semibold border border-white/20">
                    <Zap className="w-3 h-3" />
                    CarryBuddy Partner
                  </span>
                </div>
                <p className="text-white/70 text-sm font-medium mb-1">{getGreeting()}</p>
                <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{userName}</h1>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-white/60 text-xs">Today's Earnings</p>
                  <p className="text-2xl font-bold">₹{stats.totalEarnings.toLocaleString('en-IN')}</p>
                </div>
                <div className="w-14 h-14 rounded-2xl avatar flex items-center justify-center text-xl font-bold ring-2 ring-white/30 bg-white/20">
                  {userName.charAt(0).toUpperCase()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              {statCards.map((stat) => (
                <div key={stat.title} className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-white/60">{stat.icon}</div>
                    <span className="text-[10px] font-medium text-white/60 uppercase tracking-wider">{stat.title}</span>
                  </div>
                  <p className="text-lg font-bold">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <action.icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">{action.label}</p>
                <p className="text-[10px] sm:text-xs text-surface-500 dark:text-surface-400 mt-0.5">{action.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-500" />
                Recent Jobs
              </h2>
              <Link to="/carry/jobs" className="text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-500 flex items-center gap-1 transition-colors">
                View all <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {jobs.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4 animate-float">
                  <Package className="w-8 h-8 text-surface-400" />
                </div>
                <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1 font-display">No jobs yet</h3>
                <p className="text-sm text-surface-500 dark:text-surface-400 mb-5">Accept your first carry job to get started</p>
                <Link to="/carry/jobs" className="btn-primary btn-sm">
                  <Package className="w-4 h-4" />
                  Browse Jobs
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <Link key={job._id} to={`/carry/jobs`} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 group-hover:scale-110 transition-transform">
                      <Package className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{job.description || 'Package delivery'}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {job.pickupLocation?.address ?? 'Pickup'} → {job.dropLocation?.address ?? 'Drop'}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-amber-600 dark:text-amber-400">₹{job.price}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                        job.status === 'active' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                        'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400'
                      }`}>
                        {job.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={300}>
          <div className="space-y-6">
            <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-amber-500 to-orange-600 text-white border-0">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium text-white/80">Performance</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/70">Completion Rate</span>
                  <span className="text-lg font-bold">{stats.completedJobs > 0 ? '98%' : '—'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/70">On-time Delivery</span>
                  <span className="text-lg font-bold">{stats.completedJobs > 0 ? '95%' : '—'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-white/70">Avg Rating</span>
                  <span className="text-lg font-bold">{stats.rating > 0 ? stats.rating.toFixed(1) : '—'}</span>
                </div>
              </div>
            </GlassCard>

            <GlassCard variant="elevated" padding="lg">
              <h3 className="font-bold font-display text-surface-900 dark:text-surface-100 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Incentives
              </h3>
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Complete 5 more jobs this week</p>
                <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">Earn ₹200 bonus on your next payout</p>
                <div className="mt-3 w-full bg-amber-500/20 rounded-full h-2">
                  <div className="bg-amber-500 h-2 rounded-full transition-all" style={{ width: `${Math.min((stats.completedJobs / 5) * 100, 100)}%` }} />
                </div>
                <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70 mt-1">{Math.min(stats.completedJobs, 5)}/5 jobs completed</p>
              </div>
            </GlassCard>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

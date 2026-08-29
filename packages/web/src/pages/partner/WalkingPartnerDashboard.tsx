import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, MapPin, Wallet, DollarSign, Star,
  TrendingUp, Clock, CheckCircle, XCircle, ToggleLeft, ToggleRight,
  Navigation, User, Calendar, Zap, ChevronRight
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface DashboardStats {
  todayRequests: number
  totalEarnings: number
  averageRating: number
  weeklyCompleted: number
}

interface WalkingRequest {
  id: string
  type: string
  startLocation: string
  endLocation: string
  startTime: string
  fare: number
  status: 'OPEN' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | string
  distance?: string
}

export function WalkingPartnerDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    todayRequests: 0, totalEarnings: 0, averageRating: 0, weeklyCompleted: 0,
  })
  const [recentRequests, setRecentRequests] = useState<WalkingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [isAvailable, setIsAvailable] = useState(true)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [statsRes, requestsRes] = await Promise.allSettled([
          api.get('/dashboard/stats'),
          api.get('/walking-requests'),
        ])
        if (statsRes.status === 'fulfilled') {
          const d = statsRes.value.data?.data || statsRes.value.data
          setStats({
            todayRequests: d?.todayRequests ?? d?.todayRequests ?? 0,
            totalEarnings: d?.totalEarnings ?? 0,
            averageRating: d?.averageRating ?? 0,
            weeklyCompleted: d?.weeklyCompleted ?? 0,
          })
        }
        if (requestsRes.status === 'fulfilled') {
          const raw = requestsRes.value.data?.data || requestsRes.value.data || []
          const arr: WalkingRequest[] = Array.isArray(raw) ? raw : (raw.items || [])
          setRecentRequests(arr
            .map((r: any) => ({ ...r, fare: Number(r.fare ?? 0) }))
            .filter((r) => r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS')
            .slice(0, 5))
        }
      } catch {
        // silent
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

  const userName = user?.name?.split(' ')[0] || 'Partner'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div><div className="skeleton h-8 w-56 rounded-2xl" /><div className="skeleton h-4 w-36 mt-2 rounded-xl" /></div>
          <div className="skeleton h-10 w-32 rounded-2xl" />
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

  return (
    <div className="space-y-6 sm:space-y-8">
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 sm:p-8 text-white shadow-xl shadow-emerald-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-50" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-teal-500/20 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-white/70 text-sm font-medium">{getGreeting()}</p>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-semibold backdrop-blur-sm">
                    <Zap className="w-3 h-3" /> Walking Partner
                  </span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{userName}</h1>
                <p className="text-white/60 text-sm mt-1">Here's your walking dashboard</p>
              </div>
              <button
                onClick={() => setIsAvailable(!isAvailable)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold transition-all ${
                  isAvailable
                    ? 'bg-white/20 text-white hover:bg-white/30'
                    : 'bg-white/10 text-white/50 hover:bg-white/15'
                }`}
              >
                {isAvailable ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                {isAvailable ? 'Available' : 'Unavailable'}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              {[
                { label: "Today's Requests", value: stats.todayRequests, icon: ClipboardList },
                { label: 'Total Earnings', value: `₹${stats.totalEarnings.toLocaleString('en-IN')}`, icon: DollarSign },
                { label: 'Average Rating', value: `★ ${stats.averageRating.toFixed(1)}`, icon: Star },
                { label: 'Active Status', value: isAvailable ? 'Online' : 'Offline', icon: isAvailable ? CheckCircle : XCircle },
              ].map((stat) => (
                <div key={stat.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/10">
                  <div className="flex items-center gap-2 mb-2">
                    <stat.icon className="w-3.5 h-3.5 text-white/60" />
                    <span className="text-[10px] font-medium text-white/60 uppercase tracking-wider">{stat.label}</span>
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
          <h2 className="section-title mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { to: '/partner/jobs', icon: ClipboardList, label: 'Accept Job', gradient: 'from-emerald-500 to-emerald-600' },
              { to: '/partner/navigation', icon: Navigation, label: 'View Navigation', gradient: 'from-sky-500 to-blue-600' },
              { to: '/partner/wallet', icon: Wallet, label: 'Earnings', gradient: 'from-amber-500 to-orange-600' },
              { to: '/partner/profile', icon: User, label: 'Profile', gradient: 'from-violet-500 to-violet-600' },
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <action.icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">{action.label}</p>
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
                <ClipboardList className="w-5 h-5 text-emerald-500" />
                Recent Requests
              </h2>
              <Link to="/partner/jobs" className="text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 flex items-center gap-1 transition-colors">
                View all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            {recentRequests.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4">
                  <ClipboardList className="w-8 h-8 text-surface-400" />
                </div>
                <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1 font-display">No active requests</h3>
                <p className="text-sm text-surface-500 dark:text-surface-400 mb-5">Accept a job to see it here</p>
                <Link to="/partner/jobs" className="btn-primary btn-sm">
                  <ClipboardList className="w-4 h-4" /> Browse Jobs
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recentRequests.map((req) => (
                  <Link
                    key={req.id}
                    to={`/walking-requests/${req.id}`}
                    className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group"
                  >
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
                      <MapPin className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                        {req.startLocation || req.type}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-surface-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {req.startTime ? new Date(req.startTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'ASAP'}
                        </span>
                        {req.distance && (
                          <span className="text-xs text-surface-500">{req.distance}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{req.fare}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        req.status === 'IN_PROGRESS'
                          ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {req.status === 'IN_PROGRESS' ? 'In Progress' : 'Accepted'}
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
            <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white border-0">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium text-white/80">Weekly Performance</span>
              </div>
              <p className="text-3xl font-bold font-display">{stats.weeklyCompleted} walks</p>
              <div className="mt-4 bg-white/15 rounded-xl p-3">
                <div className="flex justify-between text-xs text-white/60 mb-1">
                  <span>Weekly Goal</span>
                  <span>{Math.min(stats.weeklyCompleted, 20)}/20</span>
                </div>
                <div className="h-2 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((stats.weeklyCompleted / 20) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </GlassCard>

            <GlassCard variant="elevated" padding="lg">
              <h3 className="font-bold font-display text-surface-900 dark:text-surface-100 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-500" />
                Today's Summary
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Completed', value: stats.todayRequests, icon: CheckCircle, color: 'text-emerald-500' },
                  { label: 'Earnings', value: `₹${(stats.todayRequests * 150).toLocaleString('en-IN')}`, icon: Wallet, color: 'text-amber-500' },
                  { label: 'Rating', value: `★ ${stats.averageRating.toFixed(1)}`, icon: Star, color: 'text-violet-500' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between p-2.5 rounded-xl">
                    <div className="flex items-center gap-2">
                      <item.icon className={`w-4 h-4 ${item.color}`} />
                      <span className="text-sm text-surface-600 dark:text-surface-400">{item.label}</span>
                    </div>
                    <span className="text-sm font-bold text-surface-900 dark:text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

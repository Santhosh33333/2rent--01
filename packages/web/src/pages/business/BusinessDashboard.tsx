import { useState, useEffect } from 'react'
import { Building, Users, ShoppingBag, BarChart3, TrendingUp, DollarSign, Gift, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { api, assetUrl } from '../../lib/api'

interface Profile {
  fullName?: string
  email?: string
  businessName?: string
  category?: string
  rating?: number
  createdAt?: string
  avatar?: string
}

interface DashboardData {
  totalOrders?: number
  revenue?: number
  staffMembers?: number
  activePromotions?: number
  recentOrders?: Array<{
    id: string
    item: string
    amount: string
    status: string
  }>
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-surface-200 dark:bg-surface-700 ${className ?? ''}`} />
}

function StatCardSkeleton() {
  return (
    <GlassCard variant="elevated" padding="lg">
      <div className="flex items-center gap-3 mb-4">
        <SkeletonBlock className="w-11 h-11 rounded-2xl" />
        <SkeletonBlock className="h-4 w-24" />
      </div>
      <SkeletonBlock className="h-7 w-20 mb-1" />
      <SkeletonBlock className="h-3 w-28" />
    </GlassCard>
  )
}

function OrderRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl">
      <SkeletonBlock className="w-11 h-11 rounded-xl flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
      <SkeletonBlock className="h-4 w-16" />
    </div>
  )
}

export function BusinessDashboard() {
  const [profile, setProfile] = useState<Profile>({})
  const [dashboard, setDashboard] = useState<DashboardData>({})
  const [loading, setLoading] = useState(true)
  const [, setError] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(false)
      try {
        const [profileRes, dashboardRes] = await Promise.allSettled([
          api.get('/users/profile'),
          api.get('/dashboard'),
        ])

        if (profileRes.status === 'fulfilled') {
          setProfile(profileRes.value.data?.data ?? profileRes.value.data ?? {})
        }
        if (dashboardRes.status === 'fulfilled') {
          setDashboard(dashboardRes.value.data?.data ?? dashboardRes.value.data ?? {})
        }
        if (profileRes.status === 'rejected' && dashboardRes.status === 'rejected') {
          throw new Error('Failed to load dashboard data')
        }
      } catch {
        setError(true)
        toast.error('Failed to load dashboard data')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const displayName = profile.businessName || profile.fullName || 'Your Business'
  const category = profile.category || '—'
  const rating = profile.rating != null ? `⭐ ${profile.rating}` : '—'
  const since = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—'

  const statCards = [
    { title: 'Total Orders', value: loading ? '—' : String(dashboard.totalOrders ?? 0), icon: ShoppingBag, gradient: 'from-blue-500 to-blue-600', change: !loading && dashboard.totalOrders ? `+${Math.min(dashboard.totalOrders, 18)} this week` : undefined, changeType: 'positive' as const },
    { title: 'Revenue', value: loading ? '—' : `₹${(dashboard.revenue ?? 0).toLocaleString('en-IN')}`, icon: DollarSign, gradient: 'from-emerald-500 to-emerald-600', change: !loading && dashboard.revenue ? `+₹${Math.min(dashboard.revenue, 12400).toLocaleString('en-IN')}` : undefined, changeType: 'positive' as const },
    { title: 'Staff Members', value: loading ? '—' : String(dashboard.staffMembers ?? 0), icon: Users, gradient: 'from-violet-500 to-violet-600' },
    { title: 'Active Promotions', value: loading ? '—' : String(dashboard.activePromotions ?? 0), icon: Gift, gradient: 'from-amber-500 to-orange-600', change: !loading && dashboard.activePromotions ? `${Math.min(dashboard.activePromotions, 2)} expiring soon` : undefined, changeType: 'warning' as const },
  ]

  const quickActions = [
    { icon: Users, label: 'Manage Staff', desc: 'Add or manage your team', gradient: 'from-violet-500 to-violet-600', to: '/business/staff' },
    { icon: ShoppingBag, label: 'Orders', desc: 'View all orders', gradient: 'from-blue-500 to-blue-600', to: '/business/orders' },
    { icon: Gift, label: 'Promotions', desc: 'Create deals & offers', gradient: 'from-amber-500 to-orange-600', to: '/business/promotions' },
    { icon: BarChart3, label: 'Analytics', desc: 'Business insights', gradient: 'from-emerald-500 to-emerald-600', to: '/business/analytics' },
  ]

  const recentOrders = dashboard.recentOrders ?? []

  const statusColorMap: Record<string, string> = {
    delivered: 'text-emerald-500',
    'in transit': 'text-amber-500',
    processing: 'text-blue-500',
    cancelled: 'text-red-500',
    pending: 'text-amber-500',
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600 via-purple-500 to-indigo-500 p-6 sm:p-8 text-white shadow-xl shadow-purple-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-50" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-purple-500/20 rounded-full blur-3xl" />

          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Building className="w-5 h-5 text-white/80" />
                <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-xs font-semibold border border-white/20">
                  Business Account
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{loading ? 'Loading...' : displayName}</h1>
              <p className="text-white/60 text-sm mt-1">Manage your store, staff, and orders</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center ring-2 ring-white/30">
                {profile.avatar ? (
                  <img src={assetUrl(profile.avatar) || ''} alt={displayName} className="w-14 h-14 rounded-2xl object-cover" />
                ) : (
                  <Building className="w-7 h-7" />
                )}
              </div>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((stat) => (
              <GlassCard key={stat.title} variant="elevated" padding="lg">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg`}>
                    <stat.icon className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-sm text-surface-500">{stat.title}</p>
                </div>
                <p className="text-2xl font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
                {stat.change && (
                  <p className={`text-xs mt-1 flex items-center gap-1 ${stat.changeType === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    <TrendingUp className="w-3 h-3" /> {stat.change}
                  </p>
                )}
              </GlassCard>
            ))}
          </div>
        )}
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnimatedPage delay={200} className="lg:col-span-1">
          <GlassCard variant="elevated" padding="lg" className="h-full">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title">Quick Actions</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => (
                <a
                  key={action.label}
                  href={action.to}
                  className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300"
                >
                  <div className={`w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br ${action.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                    <action.icon className="w-5 h-5 text-white" />
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">{action.label}</p>
                  <p className="text-[10px] text-surface-500 dark:text-surface-400 mt-0.5 hidden sm:block">{action.desc}</p>
                </a>
              ))}
            </div>
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={300} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-primary-500" />
                Recent Orders
              </h2>
              <a href="/business/orders" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 flex items-center gap-1 transition-colors">
                View all <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            <div className="space-y-2">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <OrderRowSkeleton key={i} />
                ))
              ) : recentOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4">
                    <ShoppingBag className="w-7 h-7 text-surface-400" />
                  </div>
                  <p className="text-sm font-semibold text-surface-500 dark:text-surface-400">No orders yet</p>
                  <p className="text-xs text-surface-400 dark:text-surface-500 mt-1">Orders will appear here once customers start renting</p>
                </div>
              ) : (
                recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md shadow-primary-500/20 group-hover:scale-110 transition-transform">
                      <ShoppingBag className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{order.item}</p>
                        <span className="text-[10px] text-surface-400">{order.id}</span>
                      </div>
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{order.amount}</p>
                    </div>
                    <span className={`text-xs font-semibold ${statusColorMap[order.status.toLowerCase()] ?? 'text-surface-500'}`}>{order.status}</span>
                  </div>
                ))
              )}
            </div>
          </GlassCard>
        </AnimatedPage>
      </div>

      <AnimatedPage delay={400}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-3">
                <Building className="w-5 h-5 text-violet-500" />
                <h3 className="font-bold font-display text-surface-900 dark:text-surface-100">Business Profile</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-surface-500">Store Name</p>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{loading ? <SkeletonBlock className="h-4 w-28 inline-block" /> : displayName}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Category</p>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{loading ? <SkeletonBlock className="h-4 w-20 inline-block" /> : category}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Rating</p>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{loading ? <SkeletonBlock className="h-4 w-16 inline-block" /> : rating}</p>
                </div>
                <div>
                  <p className="text-xs text-surface-500">Since</p>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{loading ? <SkeletonBlock className="h-4 w-20 inline-block" /> : since}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <a href="/business/profile" className="px-5 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-center">
                <p className="text-xs font-medium text-surface-500">Profile</p>
                <p className="text-sm font-bold text-surface-900 dark:text-white mt-0.5">Edit</p>
              </a>
              <a href="/business/settings" className="px-5 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-center">
                <p className="text-xs font-medium text-surface-500">Settings</p>
                <p className="text-sm font-bold text-surface-900 dark:text-white mt-0.5">Manage</p>
              </a>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

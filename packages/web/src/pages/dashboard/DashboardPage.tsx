import { useState, useEffect } from 'react'
import {
  Users, Calendar, MessageCircle, Wallet, MapPin, Heart,
  Footprints, ArrowRight, TrendingUp, Star, ChevronRight, Home
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

interface DashboardStats {
  wallet: { balance: number } | null
  friends: number
  communities: number
  events: number
  bookings: number
  unreadMessages: number
}

export function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    wallet: null, friends: 0, communities: 0, events: 0, bookings: 0, unreadMessages: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const [statsRes, communitiesRes, eventsRes, walkingRes] =
          await Promise.allSettled([
            api.get('/dashboard/stats'),
            api.get('/communities'),
            api.get('/events'),
            api.get('/walking-requests'),
          ])

        const statsData = statsRes.status === 'fulfilled' ? (statsRes.value.data?.data || statsRes.value.data || {}) : {}
        const communitiesData = communitiesRes.status === 'fulfilled' ? (communitiesRes.value.data?.data || communitiesRes.value.data || null) : null
        const eventsData = eventsRes.status === 'fulfilled' ? (eventsRes.value.data?.data || eventsRes.value.data || null) : null
        const walkingData = walkingRes.status === 'fulfilled' ? (walkingRes.value.data?.data || walkingRes.value.data || null) : null

        const communitiesItems = Array.isArray(communitiesData) ? communitiesData : (Array.isArray(communitiesData?.items) ? communitiesData.items : null)
        const eventsItems = Array.isArray(eventsData) ? eventsData : (Array.isArray(eventsData?.items) ? eventsData.items : null)
        const walkingItems = Array.isArray(walkingData) ? walkingData : (Array.isArray(walkingData?.items) ? walkingData.items : null)

        setStats({
          wallet: statsData?.wallet ?? null,
          friends: statsData?.friends ?? 0,
          communities: communitiesItems ? communitiesItems.length : (communitiesData?.count ?? 0),
          events: eventsItems ? eventsItems.length : (eventsData?.count ?? 0),
          bookings: walkingItems ? walkingItems.length : (walkingData?.count ?? 0),
          unreadMessages: statsData?.unreadMessages ?? 0,
        })
      } catch {
        // fallback
      } finally {
        setLoading(false)
      }
    }
    fetchDashboard()
  }, [])

  const userName = user?.name?.split(' ')[0] || 'there'
  const walletBalance = stats.wallet?.balance ?? 0

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const quickStats = [
    { label: 'Wallet', value: `₹${walletBalance.toLocaleString('en-IN')}`, icon: Wallet, color: 'from-primary-500 to-primary-600' },
    { label: 'Friends', value: stats.friends, icon: Users, color: 'from-sky-500 to-blue-600' },
    { label: 'Communities', value: stats.communities, icon: Heart, color: 'from-pink-500 to-rose-600' },
    { label: 'Events', value: stats.events, icon: Calendar, color: 'from-amber-500 to-orange-600' },
    { label: 'Bookings', value: stats.bookings, icon: Footprints, color: 'from-emerald-500 to-emerald-600' },
  ]

  const features = [
    { to: '/bookings/create', icon: Footprints, label: 'Book Service', desc: 'Walking or CarryBuddy', gradient: 'from-emerald-500 to-emerald-600' },
    { to: '/communities', icon: Users, label: 'Communities', desc: 'Join local groups', gradient: 'from-sky-500 to-blue-600' },
    { to: '/events', icon: Calendar, label: 'Events', desc: 'Upcoming activities', gradient: 'from-violet-500 to-purple-600' },
    { to: '/messages', icon: MessageCircle, label: 'Chat', desc: 'Send a message', gradient: 'from-primary-500 to-accent-600' },
    { to: '/notifications', icon: Heart, label: 'Alerts', desc: 'Notifications & updates', gradient: 'from-pink-500 to-rose-600' },
  ]

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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass-card-static p-5">
              <div className="skeleton h-4 w-20 rounded-xl" />
              <div className="skeleton h-8 w-16 mt-3 rounded-xl" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="glass-card-static p-5">
              <div className="skeleton h-12 w-12 rounded-2xl mx-auto" />
              <div className="skeleton h-4 w-20 mx-auto mt-3 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero Greeting */}
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 p-6 sm:p-8 text-white shadow-xl shadow-primary-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-50" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-accent-500/20 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-white/70 text-sm font-medium mb-1">{getGreeting()}</p>
                <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{userName}</h1>
                <p className="text-white/60 text-sm mt-1">Here's what's happening today</p>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-xl font-bold ring-2 ring-white/30">
                {userName.charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6">
              {quickStats.map((stat) => (
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

      {/* Feature Grid */}
      <AnimatedPage delay={100}>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {features.map((feature) => (
              <Link
                key={feature.to}
                to={feature.to}
                className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300"
              >
                <div className={`w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  <feature.icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">{feature.label}</p>
                <p className="text-[10px] sm:text-xs text-surface-500 dark:text-surface-400 mt-0.5 hidden sm:block">{feature.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </AnimatedPage>

      {/* Activity Feed + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary-500" />
                Activity Feed
              </h2>
              <Link to="/profile" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 flex items-center gap-1 transition-colors">
                View all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="space-y-2">
              {stats.bookings > 0 && (
                <Link to="/walking-requests" className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                    <Footprints className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">{stats.bookings} active booking{stats.bookings !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">View and manage your requests</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                </Link>
              )}
              {stats.communities > 0 && (
                <Link to="/communities" className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md shadow-sky-500/20 group-hover:scale-110 transition-transform">
                    <Users className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">{stats.communities} communit{stats.communities === 1 ? 'y' : 'ies'} joined</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Connect with like-minded people</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                </Link>
              )}
              {stats.events > 0 && (
                <Link to="/events" className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 group-hover:scale-110 transition-transform">
                    <Calendar className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">{stats.events} upcoming event{stats.events !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Don't miss out on local events</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                </Link>
              )}
              {stats.bookings === 0 && stats.communities === 0 && stats.events === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4">
                    <Home className="w-8 h-8 text-surface-400" />
                  </div>
                  <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1 font-display">Welcome to RentBuddy</h3>
                  <p className="text-sm text-surface-500 dark:text-surface-400 mb-5">Start exploring to see your activity here</p>
                  <Link to="/walking-requests" className="btn-primary btn-sm">
                    <Footprints className="w-4 h-4" />
                    Explore Walks
                  </Link>
                </div>
              )}
            </div>
          </GlassCard>
        </AnimatedPage>

        {/* Sidebar */}
        <AnimatedPage delay={300}>
          <div className="space-y-6">
            {/* Wallet Card */}
            <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-primary-600 to-primary-700 text-white border-0">
              <div className="flex items-center gap-2 mb-4">
                <Wallet className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium text-white/80">Wallet Balance</span>
              </div>
              <p className="text-3xl font-bold font-display">₹{walletBalance.toLocaleString('en-IN')}</p>
              <div className="flex gap-2 mt-4">
                <Link to="/wallet/withdraw" className="flex-1 text-center py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors">
                  Withdraw
                </Link>
                <Link to="/wallet/transactions" className="flex-1 text-center py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors">
                  History
                </Link>
              </div>
            </GlassCard>

            {/* Messages Shortcut */}
            <GlassCard variant="elevated" padding="lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold font-display text-surface-900 dark:text-surface-100 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-primary-500" />
                  Messages
                </h3>
                {stats.unreadMessages > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-semibold">
                    {stats.unreadMessages} new
                  </span>
                )}
              </div>
              <Link to="/messages" className="btn-outline w-full btn-sm">
                {stats.unreadMessages > 0 ? 'View Unread Messages' : 'Open Messages'}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </GlassCard>

            {/* Quick Links */}
            <GlassCard variant="elevated" padding="lg">
              <h3 className="font-bold font-display text-surface-900 dark:text-surface-100 mb-4">Quick Links</h3>
              <div className="space-y-2">
                {[
                  { to: '/profile', icon: Star, label: 'My Profile' },
                  { to: '/walking-requests', icon: MapPin, label: 'Nearby Walks' },
                  { to: '/events', icon: Calendar, label: 'Browse Events' },
                ].map((link) => (
                  <Link key={link.to} to={link.to} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors group">
                    <link.icon className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                    <span className="text-sm font-medium text-surface-700 dark:text-surface-300">{link.label}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-surface-400 ml-auto group-hover:text-primary-500 transition-colors" />
                  </Link>
                ))}
              </div>
            </GlassCard>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

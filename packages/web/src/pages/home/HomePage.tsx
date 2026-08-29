import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Bell,
  Calendar,
  ChevronRight,
  Clock,
  Footprints,
  MessageCircle,
  Search,
  Sparkles,
  User,
  Wallet,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { QUICK_ACTIONS } from '../../lib/discoveryData'

interface Booking {
  id: string
  serviceType: string
  startLocation: string
  endLocation: string
  status: string
  scheduledAt: string
  partnerName?: string
}

interface WalletData {
  balance: number
}

export function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [recentBookings, setRecentBookings] = useState<Booking[]>([])
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bookingsRes, walletRes] = await Promise.allSettled([
          api.get('/bookings'),
          api.get('/wallet'),
        ])
        if (bookingsRes.status === 'fulfilled') {
          const raw = bookingsRes.value.data?.data || bookingsRes.value.data || []
          const arr = Array.isArray(raw) ? raw : (raw.items || [])
          setRecentBookings(arr.slice(0, 3))
        }
        if (walletRes.status === 'fulfilled') {
          const d = walletRes.value.data?.data || walletRes.value.data
          setWallet({ balance: d?.balance ?? 0 })
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const userName = user?.name?.split(' ')[0] || 'there'

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const quickLinks = [
    { to: '/messages', icon: MessageCircle, label: 'Chat' },
    { to: '/notifications', icon: Bell, label: 'Notifications' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      CONFIRMED: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
      IN_PROGRESS: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
      COMPLETED: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
      CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }
    return map[status] || map.PENDING
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-48 rounded-3xl" />
        <div className="grid grid-cols-2 gap-4">
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
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 p-6 sm:p-8 text-white shadow-xl shadow-primary-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-50" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-accent-500/20 rounded-full blur-3xl" />

          <div className="relative z-10 flex items-center justify-between gap-4">
            <div>
              <p className="text-white/70 text-sm font-medium mb-1">{getGreeting()}</p>
              <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{userName}!</h1>
              <p className="text-white/60 text-sm mt-1">Your social ecosystem is ready.</p>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-xl font-bold ring-2 ring-white/30">
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>

          <div className="relative z-10 mt-5">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/70" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
                  }
                }}
                placeholder="Search people, places, events, movies..."
                className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/60 outline-none"
              />
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="section-title">Quick Actions</h2>
            <Link to="/discover" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
              Explore all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.label.includes('❤️') ? Sparkles : activityIcons[action.key] || Sparkles
              return (
                <Link
                  key={action.key}
                  to={action.route}
                  className="group rounded-2xl border border-surface-200 bg-white p-3 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-md dark:border-surface-800 dark:bg-surface-900"
                >
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-violet-600 text-white shadow-lg shadow-primary-500/20 mx-auto">
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs sm:text-sm font-semibold">{action.label.replace(/^[^\w]*/g, '')}</p>
                </Link>
              )
            })}
          </div>
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary-500" />
                Personal recommendations
              </h2>
              <Link to="/discover" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 flex items-center gap-1 transition-colors">
                View more <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="space-y-3">
              {[
                { title: 'Weekend social walk', text: 'A relaxed route with music lovers around your area.', badge: 'Walking Buddy', route: '/discover/walking-buddy' },
                { title: 'Movie meetup near you', text: 'Open to casual plans and weekend cinema chats.', badge: 'Movies', route: '/discover/movies' },
                { title: 'Community brunch', text: 'Friendly local meetups for food, stories, and connection.', badge: 'Food', route: '/discover/food' },
              ].map((item) => (
                <Link key={item.title} to={item.route} className="flex items-center gap-4 rounded-2xl border border-surface-200 bg-surface-50 p-3 transition hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-800/40 dark:hover:bg-surface-800">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-primary-600 text-white">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white">{item.title}</p>
                      <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{item.badge}</span>
                    </div>
                    <p className="mt-1 text-xs text-surface-500">{item.text}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-surface-400" />
                </Link>
              ))}
            </div>
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={300}>
          <div className="space-y-6">
            <GlassCard variant="elevated" padding="lg" className="bg-gradient-to-br from-primary-600 to-primary-700 text-white border-0">
              <div className="flex items-center gap-2 mb-4">
                <Wallet className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium text-white/80">Wallet Balance</span>
              </div>
              <p className="text-3xl font-bold font-display">₹{(wallet?.balance ?? 0).toLocaleString('en-IN')}</p>
              <div className="flex gap-2 mt-4">
                <Link to="/wallet/topup" className="flex-1 text-center py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors">
                  Top Up
                </Link>
                <Link to="/wallet/transactions" className="flex-1 text-center py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors">
                  History
                </Link>
              </div>
            </GlassCard>

            <GlassCard variant="elevated" padding="lg">
              <h3 className="font-bold font-display text-surface-900 dark:text-surface-100 mb-4">Quick Links</h3>
              <div className="space-y-2">
                {quickLinks.map((link) => (
                  <Link key={link.to} to={link.to} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors group">
                    <span className="flex items-center gap-3 text-sm font-medium text-surface-700 dark:text-surface-300">
                      <link.icon className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                      {link.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                  </Link>
                ))}
              </div>
            </GlassCard>
          </div>
        </AnimatedPage>
      </div>

      <AnimatedPage delay={350}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title flex items-center gap-2">
              <Footprints className="w-5 h-5 text-emerald-500" />
              Recent activity
            </h2>
            <Link to="/bookings" className="text-sm font-medium text-primary-600 dark:text-primary-400">Open bookings</Link>
          </div>
          {recentBookings.length === 0 ? (
            <div className="text-center py-8 text-surface-500">
              No recent activity yet. Start with a social plan or a local meetup.
            </div>
          ) : (
            <div className="space-y-3">
              {recentBookings.map((booking) => (
                <Link key={booking.id} to={`/bookings/${booking.id}`} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-md shadow-emerald-500/20 flex-shrink-0">
                    <Footprints className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{booking.startLocation || 'Pickup'}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-surface-500">
                      <Calendar className="w-3 h-3" />
                      {booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'ASAP'}
                    </div>
                  </div>
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold flex-shrink-0 ${statusBadge(booking.status)}`}>
                    {booking.status?.replace(/_/g, ' ')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

const activityIcons: Record<string, any> = {
  dating: Sparkles,
  friendship: MessageCircle,
  movies: Calendar,
  'walking-buddy': Footprints,
  carrybuddy: Footprints,
  travel: Sparkles,
  events: Calendar,
  communities: MessageCircle,
  food: Sparkles,
  fitness: Sparkles,
  gaming: Sparkles,
  study: Sparkles,
  networking: Sparkles,
}


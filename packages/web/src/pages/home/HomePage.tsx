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
  MapPin,
  Users,
  Heart,
  Rss,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { getErrorMessage, getErrorDetail } from '../../lib/error'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { QUICK_ACTIONS } from '../../lib/discoveryData'
import { AskNabriPanel } from './AskNabriPanel'
import { Reveal } from '../../components/motion/Reveal'
import { Tilt } from '../../components/motion/Tilt'
import { Avatar } from '../../components/Avatar'
import type { FeedPost, FeedPageData } from '../../types/post'

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

interface SuggestedUser {
  id: string
  name: string
  avatarUrl?: string | null
  city?: string | null
  bio?: string | null
}

/** Shape returned by GET /friendships/suggested (a raw Prisma User row). */
interface SuggestedApiUser {
  id: string
  fullName?: string | null
  avatarUrl?: string | null
  city?: string | null
  bio?: string | null
}

interface TrendingEvent {
  id: number | string
  title?: string
  name?: string
  startTime?: string
  location?: string | null
  city?: string | null
}

interface CommunityItem {
  id: string
  name: string
  memberCount?: number
  city?: string | null
}

export function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [recentBookings, setRecentBookings] = useState<Booking[]>([])
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [suggestedUsers, setSuggestedUsers] = useState<SuggestedUser[]>([])
  const [trendingEvents, setTrendingEvents] = useState<TrendingEvent[]>([])
  const [communities, setCommunities] = useState<CommunityItem[]>([])
  const [feedPreview, setFeedPreview] = useState<FeedPost[]>([])
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set())
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Recommendations are dismissible. The choice is remembered locally so a user
  // who has seen the suggestions does not get them back on every app open.
  const [showPeople, setShowPeople] = useState(
    () => localStorage.getItem('nabri.home.hidePeople') !== '1',
  )
  const [showToday, setShowToday] = useState(
    () => localStorage.getItem('nabri.home.hideToday') !== '1',
  )

  const dismiss = (key: 'hidePeople' | 'hideToday') => {
    try {
      localStorage.setItem(`nabri.home.${key}`, '1')
    } catch {
      // Private mode / storage disabled: the section still hides for this visit.
    }
    if (key === 'hidePeople') setShowPeople(false)
    else setShowToday(false)
  }

  const formatEventDate = (iso?: string) => {
    if (!iso) return 'Date TBA'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return 'Date TBA'
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })
  }

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [bookingsRes, walletRes, suggestedRes, trendingRes, communitiesRes, feedRes] = await Promise.allSettled([
          api.get('/bookings'),
          api.get('/wallet'),
          api.get('/friendships/suggested').catch(() => null),
          api.get('/search/trending').catch(() => null),
          api.get('/communities').catch(() => null),
          api.get('/posts', { params: { limit: 3 } }).catch(() => null),
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
        if (suggestedRes.status === 'fulfilled' && suggestedRes.value) {
          const d = suggestedRes.value.data?.data || suggestedRes.value.data || []
          const arr: SuggestedApiUser[] = Array.isArray(d) ? d : (d.items || [])
          setSuggestedUsers(
            arr.slice(0, 6).map((u) => ({
              id: u.id,
              name: u.fullName || 'Nabri member',
              avatarUrl: u.avatarUrl ?? null,
              city: u.city ?? null,
              bio: u.bio ?? null,
            })),
          )
        }
        if (trendingRes.status === 'fulfilled' && trendingRes.value) {
          // GET /search/trending returns { communities, events }. Events are raw
          // rows, so the date is read from startTime and may be absent.
          const d = trendingRes.value.data?.data || trendingRes.value.data || {}
          const events = Array.isArray(d.events) ? d.events : []
          setTrendingEvents(events.slice(0, 4))
        }
        if (communitiesRes.status === 'fulfilled' && communitiesRes.value) {
          const d = communitiesRes.value.data?.data || communitiesRes.value.data || []
          const arr = Array.isArray(d) ? d : (d.items || [])
          setCommunities(arr.slice(0, 4))
        }
        if (feedRes.status === 'fulfilled' && feedRes.value) {
          const data: FeedPageData | undefined = feedRes.value.data?.data
          setFeedPreview((data?.items ?? []).slice(0, 3))
        }
      } catch (err) {
        console.error('Home page fetch error:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  /**
   * Send a friend request straight from the suggestion card. There is no public
   * profile page to open, so the useful action is the request itself; the button
   * reports its own result rather than pretending the tap did something.
   */
  const connect = async (person: SuggestedUser) => {
    if (requestingId || requestedIds.has(person.id)) return
    setRequestingId(person.id)
    try {
      await api.post('/friendships', { addresseeId: person.id })
      setRequestedIds((s) => new Set(s).add(person.id))
      toast.success(`Request sent to ${person.name.split(' ')[0]}`)
    } catch (err) {
      // A request already in flight (from another screen) is not an error.
      if (getErrorDetail(err) === 'REQUEST_EXISTS') {
        setRequestedIds((s) => new Set(s).add(person.id))
        toast.success('Request already sent')
      } else {
        toast.error(getErrorMessage(err, 'Could not send the request. Please try again.'))
      }
    } finally {
      setRequestingId(null)
    }
  }

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
          {[...Array(8)].map((_, i) => (
            <div key={i} className="glass-card-static p-5">
              <div className="skeleton h-12 w-12 rounded-2xl mx-auto" />
              <div className="skeleton h-4 w-20 mx-auto mt-3 rounded-xl" />
            </div>
          ))}
        </div>
        <div className="skeleton h-36 rounded-3xl" />
        <div className="skeleton h-40 rounded-3xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <AnimatedPage>
        <div className="hero-indigo overflow-hidden">
          <div className="hero-sheen pointer-events-none absolute inset-0" />
          {/* Slow prismatic wash: the only ambient colour on the screen, so the
              hero reads as premium rather than decorated. */}
          <div className="prism-aurora animate-prism-drift opacity-60" aria-hidden />
          {/* One light sweep, to signal that the balance below is live. */}
          <div className="prism-sweep animate-prism-sweep" aria-hidden />
          <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#D2F53C]/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-white/5 blur-3xl" />

          <div className="relative z-10 flex items-center justify-between gap-4">
            <div>
              <p className="text-white/70 text-sm font-medium mb-1">{getGreeting()}</p>
              <h1 className="text-2xl sm:text-3xl font-bold font-display tracking-tight">{userName}!</h1>
              <p className="text-white/60 text-sm mt-1">Your social ecosystem is ready.</p>
            </div>
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
              <span className="brand-badge h-14 w-14">
                <span className="flex h-full w-full items-center justify-center text-xl font-bold text-white">
                  {userName.charAt(0).toUpperCase()}
                </span>
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white/40 bg-[#D2F53C] dark:border-surface-900" />
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

      <AnimatedPage delay={60}>
        <AskNabriPanel />
      </AnimatedPage>

      {/* People you may like — a recommendation, so it is dismissible, and the
          interests that drive it are one tap from here. */}
      {showPeople && suggestedUsers.length > 0 && (
        <AnimatedPage delay={80}>
          <Reveal>
            <GlassCard variant="elevated" padding="lg">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="section-title flex items-center gap-2">
                  <Heart className="w-5 h-5 text-rose-500" />
                  People you may like
                </h2>
                <div className="flex items-center gap-1">
                  <Link
                    to="/preferences"
                    className="rounded-lg px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-500/10 dark:text-primary-400"
                  >
                    Adjust interests
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss('hidePeople')}
                    aria-label="Dismiss people suggestions"
                    className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-1">
                {suggestedUsers.map((u) => {
                  const sent = requestedIds.has(u.id)
                  const busy = requestingId === u.id
                  return (
                    <div
                      key={u.id}
                      className="flex min-w-[140px] max-w-[160px] flex-shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-surface-200 bg-white p-3 text-center shadow-card dark:border-surface-800 dark:bg-surface-900"
                    >
                      <Avatar src={u.avatarUrl} name={u.name} className="mx-auto h-16 w-16" />
                      <p className="mt-2 line-clamp-1 text-sm font-semibold text-surface-900 dark:text-white">{u.name}</p>
                      {u.city && <p className="line-clamp-1 text-xs text-surface-500 dark:text-surface-400">{u.city}</p>}
                      <button
                        type="button"
                        onClick={() => void connect(u)}
                        disabled={sent || busy}
                        className={`mt-2 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                          sent
                            ? 'cursor-default bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                            : 'bg-primary-600 text-white hover:bg-primary-700'
                        }`}
                      >
                        {sent ? 'Requested' : busy ? 'Sending…' : 'Connect'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          </Reveal>
        </AnimatedPage>
      )}

      <AnimatedPage delay={100}>
        <Reveal>
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary-500" />
                Quick actions
              </h2>
              <Link to="/discover" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
                Explore all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {QUICK_ACTIONS.slice(0, 9).map((action, i) => {
                const Icon = activityIcons[action.key] || Sparkles
                return (
                  <Reveal key={action.key} delay={i * 0.05} from="up">
                    <Tilt max={10} lift={16} scale={1.04} glare>
                      <Link
                        to={action.route}
                        className="group relative flex h-full flex-col items-center rounded-2xl border border-surface-200 bg-white p-3 text-center shadow-card transition-shadow hover:shadow-card-hover dark:border-surface-800 dark:bg-surface-900"
                      >
                        <span className="prism-chip mb-3 h-12 w-12 text-white shadow-lg shadow-primary-500/20">
                          <Icon className="h-5 w-5" />
                        </span>
                        <p className="line-clamp-2 text-xs font-semibold sm:text-sm">
                          {action.label.replace(/^[^\w]*/g, '')}
                        </p>
                      </Link>
                    </Tilt>
                  </Reveal>
                )
              })}
            </div>
          </div>
        </Reveal>
      </AnimatedPage>

      {/* Real posts from the community feed — no placeholder content, so an
          empty feed simply shows nothing here rather than a convincing fake. */}
      {feedPreview.length > 0 && (
        <AnimatedPage delay={140}>
          <Reveal>
            <GlassCard variant="elevated" padding="lg">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="section-title flex items-center gap-2">
                  <Rss className="w-5 h-5 text-sky-500" />
                  From the community
                </h2>
                <Link to="/feed" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
                  Open feed <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="space-y-3">
                {feedPreview.map((post) => (
                  <Link
                    key={post.id}
                    to={`/feed/${post.id}`}
                    className="flex items-start gap-3 rounded-2xl border border-surface-200 bg-surface-50 p-3 transition hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-800/40 dark:hover:bg-surface-800"
                  >
                    <Avatar src={post.author?.avatarUrl} name={post.author?.fullName} className="h-10 w-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                        {post.author?.fullName || 'Nabri member'}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-surface-500 dark:text-surface-400">
                        {post.content || 'Shared a photo'}
                      </p>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-surface-400">
                        <span className="flex items-center gap-1">
                          <Heart className="w-3 h-3" /> {post._count?.likes ?? 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle className="w-3 h-3" /> {post._count?.comments ?? 0}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </GlassCard>
          </Reveal>
        </AnimatedPage>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {showToday && (
        <AnimatedPage delay={200} className="lg:col-span-2"><Reveal>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6 gap-2">
              <h2 className="section-title flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-500" />
                Nabri Today
              </h2>
              <div className="flex items-center gap-1">
                <Link to="/events" className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 flex items-center gap-1 transition-colors">
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => dismiss('hideToday')}
                  aria-label="Dismiss today's suggestions"
                  className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {trendingEvents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-surface-300 bg-surface-100 p-6 text-center text-sm text-surface-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400">
                No upcoming events yet. <Link to="/events" className="text-primary-600 hover:underline dark:text-primary-400">Browse events</Link> or create one.
              </div>
            ) : (
              <div className="space-y-3">
                {trendingEvents.map((ev) => (
                  <Link key={ev.id} to={`/events/${ev.id}`} className="flex items-center gap-4 rounded-2xl border border-surface-200 bg-surface-50 p-3 transition hover:bg-surface-100 dark:border-surface-700 dark:bg-surface-800/40 dark:hover:bg-surface-800">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-primary-600 text-white">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-surface-900 dark:text-white">{ev.title || ev.name || 'Event'}</p>
                      </div>
                      <p className="mt-1 flex items-center gap-1 text-xs text-surface-500">
                        <Clock className="w-3 h-3" /> {formatEventDate(ev.startTime)} {ev.city && <>· <MapPin className="w-3 h-3" /> {ev.city}</>}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-surface-400" />
                  </Link>
                ))}
              </div>
            )}

            {communities.length > 0 && (
              <div className="mt-6">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100">Communities</h3>
                  <Link to="/communities" className="text-xs font-medium text-primary-600 dark:text-primary-400">View all</Link>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {communities.map((c) => (
                    <Link key={c.id} to={`/communities/${c.id}`} className="flex items-center gap-3 rounded-2xl border border-surface-200 bg-white p-2.5 transition hover:bg-surface-50 dark:border-surface-800 dark:bg-surface-900/60 dark:hover:bg-surface-900">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
                        <Users className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">{c.name}</p>
                        <p className="text-xs text-surface-500">{c.memberCount ?? 0} members {c.city && `· ${c.city}`}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-surface-400" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </GlassCard>
        </Reveal>
        </AnimatedPage>
        )}

        <AnimatedPage delay={300} className={showToday ? '' : 'lg:col-span-3'}><Reveal>
          <div className="space-y-6">
            <GlassCard variant="elevated" padding="lg" className="prism-ring border-0 bg-gradient-to-br from-primary-600 to-primary-700 text-white">
              <div className="flex items-center gap-2 mb-4">
                <Wallet className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium text-white/80">Wallet Balance</span>
              </div>
              <p className="prism-text animate-prism-breathe font-display text-3xl font-bold">
                ₹{(wallet?.balance ?? 0).toLocaleString('en-IN')}
              </p>
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
        </Reveal>
        </AnimatedPage>
      </div>

      <AnimatedPage delay={350}><Reveal>
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
      </Reveal>
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


import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  BriefcaseBusiness,
  Calendar,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  Dumbbell,
  Footprints,
  Gamepad2,
  Heart,
  MapPin,
  MessageCircle,
  Music,
  Package,
  Plane,
  Rss,
  Search,
  Sparkles,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { getErrorMessage, getErrorDetail } from '../../lib/error'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { QUICK_ACTIONS, type QuickAction } from '../../lib/discoveryData'
import { AskNabriPanel } from './AskNabriPanel'
import { Reveal } from '../../components/motion/Reveal'
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

/**
 * Icon + accent per quick action.
 *
 * The accent is a literal Tailwind gradient string, not built by concatenation
 * at runtime, so the classes survive the JIT scan. Keys must match QUICK_ACTIONS.
 */
const QUICK_ACTION_STYLE: Record<string, { icon: LucideIcon; accent: string }> = {
  dating: { icon: Heart, accent: 'from-rose-500 to-pink-600' },
  friendship: { icon: Users, accent: 'from-blue-500 to-cyan-600' },
  events: { icon: CalendarDays, accent: 'from-fuchsia-500 to-pink-600' },
  communities: { icon: UsersRound, accent: 'from-cyan-500 to-blue-600' },
  movies: { icon: Clapperboard, accent: 'from-violet-500 to-purple-600' },
  music: { icon: Music, accent: 'from-pink-500 to-rose-600' },
  sports: { icon: Dumbbell, accent: 'from-emerald-500 to-lime-600' },
  'ai-assistant': { icon: Sparkles, accent: 'from-indigo-500 to-violet-600' },
  'walking-buddy': { icon: Footprints, accent: 'from-emerald-500 to-teal-600' },
  carrybuddy: { icon: Package, accent: 'from-amber-500 to-orange-600' },
  travel: { icon: Plane, accent: 'from-sky-500 to-indigo-600' },
  food: { icon: UtensilsCrossed, accent: 'from-orange-500 to-amber-600' },
  fitness: { icon: Dumbbell, accent: 'from-lime-500 to-green-600' },
  gaming: { icon: Gamepad2, accent: 'from-indigo-500 to-violet-600' },
  study: { icon: BookOpen, accent: 'from-teal-500 to-cyan-600' },
  networking: { icon: BriefcaseBusiness, accent: 'from-slate-500 to-slate-700' },
  'local-activities': { icon: MapPin, accent: 'from-pink-500 to-rose-600' },
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
  // Live counters for the Explore tiles. These are the sizes of the real sets
  // this screen fetched - not a global total - so a tile never shows a number
  // the page cannot back up (see QuickAction.countKey).
  const [liveCounts, setLiveCounts] = useState({ people: 0, events: 0, communities: 0 })
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
            arr.slice(0, 8).map((u) => ({
              id: u.id,
              name: u.fullName || 'Nabri member',
              avatarUrl: u.avatarUrl ?? null,
              city: u.city ?? null,
              bio: u.bio ?? null,
            })),
          )
          setLiveCounts((c) => ({ ...c, people: arr.length }))
        }
        if (trendingRes.status === 'fulfilled' && trendingRes.value) {
          // GET /search/trending returns { communities, events }. Events are raw
          // rows, so the date is read from startTime and may be absent.
          const d = trendingRes.value.data?.data || trendingRes.value.data || {}
          const events = Array.isArray(d.events) ? d.events : []
          setTrendingEvents(events.slice(0, 6))
          setLiveCounts((c) => ({ ...c, events: events.length }))
        }
        if (communitiesRes.status === 'fulfilled' && communitiesRes.value) {
          const d = communitiesRes.value.data?.data || communitiesRes.value.data || []
          const arr = Array.isArray(d) ? d : (d.items || [])
          setCommunities(arr.slice(0, 6))
          setLiveCounts((c) => ({ ...c, communities: typeof d.total === 'number' ? d.total : arr.length }))
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

  /** Live count when the home screen has one, otherwise the factual subtitle. */
  const tileSubtitle = (action: QuickAction) => {
    if (action.countKey) {
      const n = liveCounts[action.countKey]
      if (n > 0) {
        if (action.countKey === 'people') return `${n} nearby`
        if (action.countKey === 'events') return `${n} upcoming`
        return `${n} groups`
      }
    }
    return action.subtitle
  }

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
      <div className="space-y-6 sm:space-y-8">
        <div className="skeleton h-44 rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="glass-card-static p-3">
              <div className="skeleton h-11 w-11 rounded-2xl" />
              <div className="skeleton h-4 w-20 mt-3 rounded-xl" />
              <div className="skeleton h-3 w-14 mt-2 rounded-xl" />
            </div>
          ))}
        </div>
        <div className="skeleton h-36 rounded-3xl" />
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

          {/* The brand sits on the home hero itself so the app name and glyph are
              unmistakable here, not only in the sticky header above. */}
          <div className="relative z-10 mb-4 flex items-center gap-2">
            <span className="brand-badge h-7 w-7">
              <img src="/logo-glyph-white.svg" alt="" className="h-4 w-4" />
            </span>
            <span className="text-sm font-black font-display tracking-tight text-white/90">
              Nabri<span className="text-[#D2F53C]">.</span>
            </span>
          </div>

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
                placeholder="People, friends, events, movies, communities..."
                className="w-full rounded-2xl border border-white/20 bg-white/10 py-3 pl-11 pr-4 text-sm text-white placeholder:text-white/60 outline-none"
              />
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={60}>
        <AskNabriPanel />
      </AnimatedPage>

      {/* Explore — every destination is shown, each with a real (live) subtitle.
          Previously only 9 of 17 tiles were rendered and the rest hid behind an
          "Explore all" link, which is what made the screen feel incomplete. */}
      <AnimatedPage delay={100}>
        <Reveal>
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-title flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary-500" />
                Explore Nabri
              </h2>
              <Link to="/discover" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
                See all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {QUICK_ACTIONS.map((action) => {
                const style = QUICK_ACTION_STYLE[action.key] ?? { icon: Sparkles, accent: 'from-primary-500 to-primary-700' }
                const Icon = style.icon
                return (
                  <Link
                    key={action.key}
                    to={action.route}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-surface-200 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-surface-800 dark:bg-surface-900"
                  >
                    <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br ${style.accent} text-white shadow-lg shadow-black/5`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="line-clamp-1 text-sm font-semibold text-surface-900 dark:text-white">
                      {action.label}
                    </span>
                    <span className="line-clamp-1 text-xs text-surface-500 dark:text-surface-400">
                      {tileSubtitle(action)}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </Reveal>
      </AnimatedPage>

      {/* People you may like — a recommendation, so it is dismissible, and the
          interests that drive it are one tap from here. */}
      {showPeople && suggestedUsers.length > 0 && (
        <AnimatedPage delay={140}>
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

      {/* Happening nearby — real events, dismissible like the people row. */}
      {showToday && (
        <AnimatedPage delay={180}>
          <Reveal>
            <div>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="section-title flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary-500" />
                  Happening nearby
                </h2>
                <div className="flex items-center gap-1">
                  <Link to="/events" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
                    View all <ChevronRight className="w-4 h-4" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => dismiss('hideToday')}
                    aria-label="Dismiss event suggestions"
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
                <div className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-1">
                  {trendingEvents.map((ev) => (
                    <Link
                      key={ev.id}
                      to={`/events/${ev.id}`}
                      className="flex min-w-[210px] max-w-[230px] flex-shrink-0 snap-start flex-col rounded-2xl border border-surface-200 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-surface-800 dark:bg-surface-900"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-primary-600 text-white">
                          <Calendar className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                          {formatEventDate(ev.startTime)}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-semibold text-surface-900 dark:text-white">
                        {ev.title || ev.name || 'Event'}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-surface-500 dark:text-surface-400">
                        <MapPin className="h-3 w-3" /> {ev.city || ev.location || 'Online / TBA'}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Reveal>
        </AnimatedPage>
      )}

      {/* Communities to join — real groups. */}
      {communities.length > 0 && (
        <AnimatedPage delay={210}>
          <Reveal>
            <div>
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="section-title flex items-center gap-2">
                  <Users className="w-5 h-5 text-cyan-500" />
                  Communities to join
                </h2>
                <Link to="/communities" className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 dark:text-primary-400">
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="-mx-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-2 pb-1">
                {communities.map((c) => (
                  <Link
                    key={c.id}
                    to={`/communities/${c.id}`}
                    className="flex min-w-[210px] max-w-[240px] flex-shrink-0 snap-start items-center gap-3 rounded-2xl border border-surface-200 bg-white p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover dark:border-surface-800 dark:bg-surface-900"
                  >
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white">
                      <Users className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold text-surface-900 dark:text-white">{c.name}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">
                        {c.memberCount ?? 0} members{c.city ? ` · ${c.city}` : ''}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </Reveal>
        </AnimatedPage>
      )}

      {/* Real posts from the community feed — no placeholder content, so an
          empty feed simply shows nothing here rather than a convincing fake. */}
      {feedPreview.length > 0 && (
        <AnimatedPage delay={240}>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AnimatedPage delay={280} className="lg:col-span-2">
          <Reveal>
            <GlassCard variant="elevated" padding="lg" className="h-full">
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

        <AnimatedPage delay={320}>
          <Reveal>
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
          </Reveal>
        </AnimatedPage>
      </div>
    </div>
  )
}

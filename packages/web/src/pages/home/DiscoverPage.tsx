import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Search, Users, Calendar, Footprints, MapPin, Clock, ChevronRight, TrendingUp, Sparkles
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { EmptyState } from '../../components/EmptyState'

interface Event {
  id: number
  name: string
  date: string
  location: string
  attendees?: number
  category?: string
}

interface Community {
  id: number
  name: string
  members: number
  description: string
  category?: string
  location?: string
}

type Category = 'all' | 'partners' | 'events' | 'communities'

export function DiscoverPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<Category>('all')
  const [events, setEvents] = useState<Event[]>([])
  const [communities, setCommunities] = useState<Community[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [eventsRes, communitiesRes] = await Promise.allSettled([
          api.get('/events'),
          api.get('/communities'),
        ])
        if (eventsRes.status === 'fulfilled') {
          const raw = eventsRes.value.data?.data || eventsRes.value.data || []
          setEvents(Array.isArray(raw) ? raw : (raw.items || []))
        }
        if (communitiesRes.status === 'fulfilled') {
          const raw = communitiesRes.value.data?.data || communitiesRes.value.data || []
          setCommunities(Array.isArray(raw) ? raw : (raw.items || []))
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const filteredEvents = events.filter(e => {
    const matchesSearch = e.name.toLowerCase().includes(search.toLowerCase()) || (e.location || '').toLowerCase().includes(search.toLowerCase())
    const isUpcoming = new Date(e.date) >= new Date()
    return matchesSearch && isUpcoming && (category === 'all' || category === 'events')
  }).slice(0, 5)

  const filteredCommunities = communities.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.description.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (category === 'all' || category === 'communities')
  }).slice(0, 5)

  const categories: { key: Category; label: string; icon: typeof Users }[] = [
    { key: 'all', label: 'All', icon: Sparkles },
    { key: 'partners', label: 'Partners', icon: Footprints },
    { key: 'events', label: 'Events', icon: Calendar },
    { key: 'communities', label: 'Communities', icon: Users },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-12 rounded-2xl" />
        <div className="flex gap-2">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-10 w-24 rounded-xl" />)}</div>
        <div className="grid gap-4">{[1, 2, 3].map(i => (
          <div key={i} className="glass-card-static p-5">
            <div className="flex items-start justify-between"><div className="flex-1"><div className="skeleton h-5 w-44 rounded-xl mb-2" /><div className="skeleton h-4 w-32 rounded-xl" /></div></div>
          </div>
        ))}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events, communities, partners..."
            className="input pl-12 py-3.5"
          />
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategory(cat.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                category === cat.key
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              <cat.icon className="w-4 h-4" />
              {cat.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      {(category === 'all' || category === 'partners') && !search && (
        <AnimatedPage delay={50}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-primary-500" />
              <h2 className="section-title">Trending</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link to="/bookings/create?type=WALKING" className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Footprints className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">Walking Buddy</p>
                <p className="text-[10px] text-surface-500 mt-0.5">Find a companion</p>
              </Link>
              <Link to="/bookings/create?type=CARRY_BUDDY" className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform duration-300">
                  <Footprints className="w-5 h-5 text-white" />
                </div>
                <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">CarryBuddy</p>
                <p className="text-[10px] text-surface-500 mt-0.5">Deliver items</p>
              </Link>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      {(category === 'all' || category === 'events') && (
        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title flex items-center gap-2">
                <Calendar className="w-5 h-5 text-amber-500" />
                Upcoming Events
              </h2>
              <Link to="/events" className="text-sm font-medium text-primary-600 dark:text-primary-400 flex items-center gap-1">
                View all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-sm text-surface-500 text-center py-6">No upcoming events</p>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map((event) => (
                  <Link key={event.id} to={`/events/${event.id}`} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 flex-shrink-0">
                      <Calendar className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{event.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-surface-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(event.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-xs text-surface-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {event.location}
                        </span>
                      </div>
                    </div>
                    {event.attendees !== undefined && (
                      <span className="text-xs text-surface-400 flex items-center gap-1">
                        <Users className="w-3 h-3" /> {event.attendees}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 transition-colors" />
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>
        </AnimatedPage>
      )}

      {(category === 'all' || category === 'communities') && (
        <AnimatedPage delay={200}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-500" />
                Communities
              </h2>
              <Link to="/communities" className="text-sm font-medium text-primary-600 dark:text-primary-400 flex items-center gap-1">
                View all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            {filteredCommunities.length === 0 ? (
              <p className="text-sm text-surface-500 text-center py-6">No communities found</p>
            ) : (
              <div className="space-y-3">
                {filteredCommunities.map((community) => (
                  <Link key={community.id} to={`/communities/${community.id}`} className="flex items-center gap-4 p-3 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md shadow-sky-500/20 flex-shrink-0">
                      <Users className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{community.name}</p>
                      <p className="text-xs text-surface-500 mt-0.5 truncate">{community.description}</p>
                    </div>
                    <span className="text-xs text-surface-400 flex items-center gap-1 flex-shrink-0">
                      <Users className="w-3 h-3" /> {community.members}
                    </span>
                    <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-primary-500 transition-colors" />
                  </Link>
                ))}
              </div>
            )}
          </GlassCard>
        </AnimatedPage>
      )}

      {!loading && filteredEvents.length === 0 && filteredCommunities.length === 0 && (
        <EmptyState
          icon={Search}
          title="No results found"
          description={search ? 'Try a different search term' : 'Nothing to show yet'}
        />
      )}
    </div>
  )
}

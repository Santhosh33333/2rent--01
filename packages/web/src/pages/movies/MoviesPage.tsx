import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clapperboard, MapPin, Search, Star, Users } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { useAsync } from '../../hooks/useAsync'
import { getErrorMessage } from '../../lib/error'

type MovieTab = 'now_playing' | 'popular' | 'upcoming'

const TABS: Array<{ key: MovieTab; label: string }> = [
  { key: 'now_playing', label: 'Now Playing' },
  { key: 'popular', label: 'Popular' },
  { key: 'upcoming', label: 'Upcoming' },
]

interface Movie {
  id: number
  title: string
  overview: string
  posterUrl: string | null
  releaseDate: string | null
  rating: number | null
  language: string | null
}

interface MovieMeetup {
  id: string
  name: string
  date: string
  location: string
  attendees: number
}

export function MoviesPage() {
  const [tab, setTab] = useState<MovieTab>('now_playing')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [movies, setMovies] = useState<Movie[]>([])
  const [unconfigured, setUnconfigured] = useState(false)
  const [meetups, setMeetups] = useState<MovieMeetup[]>([])

  const { loading, error, retry, execute: reload } = useAsync(async () => {
    const res = await api.get(`/movies/${tab}`)
    const d = res.data?.data || res.data || {}
    const list: Movie[] = Array.isArray(d.movies) ? d.movies : []
    setMovies(list)
    setUnconfigured(false)
    return list
  }, true)

  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      return
    }
    reload().catch((err) => {
      if ((err as any)?.response?.status === 503) setUnconfigured(true)
    })
  }, [tab, reload])

  useEffect(() => {
    api
      .get('/events', { params: { category: 'movies', limit: 6 } })
      .then((r) => {
        const d = r.data?.data || r.data || {}
        const raw = Array.isArray(d) ? d : d.items || []
        setMeetups(
          raw.map((ev: any) => ({
            id: ev.id,
            name: ev.title || 'Movie meetup',
            date: ev.startTime,
            location: ev.location ?? 'TBA',
            attendees: ev.attendeeCount ?? 0,
          }))
        )
      })
      .catch(() => {})
  }, [])

  const runSearch = async () => {
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    try {
      const res = await api.get('/movies/search', { params: { q } })
      const d = res.data?.data || res.data || {}
      setMovies(Array.isArray(d.movies) ? d.movies : [])
      setUnconfigured(false)
    } catch (err) {
      if ((err as any)?.response?.status === 503) setUnconfigured(true)
      else toast.error(getErrorMessage(err, 'Search failed'))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Movies" subtitle="Real listings, meetups and movie partners" />

      <AnimatedPage delay={50}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder="Search movies..."
            className="input pl-12 py-3.5"
          />
        </div>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key)
                setQuery('')
              }}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                tab === t.key && !query
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {loading || searching ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-64 rounded-3xl" />
            ))}
          </div>
        ) : error || unconfigured ? (
          <div className="rounded-3xl border border-dashed border-surface-300 p-8 text-center dark:border-surface-700">
            <Clapperboard className="w-8 h-8 mx-auto text-surface-300 dark:text-surface-600" />
            <p className="mt-3 font-semibold">Movie listings aren't connected yet</p>
            <p className="mt-1 text-sm text-surface-500">
              Listings need a TMDB API key on the server. Movie meetups below work right now.
            </p>
            <button onClick={retry} className="mt-3 text-sm font-semibold text-primary-600 dark:text-primary-400">
              Retry
            </button>
          </div>
        ) : movies.length === 0 ? (
          <EmptyState icon={Clapperboard} title="No movies found" description="Try a different search." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {movies.map((m) => (
              <div key={m.id} className="glass-card overflow-hidden">
                {m.posterUrl ? (
                  <img src={m.posterUrl} alt={m.title} className="w-full aspect-[2/3] object-cover" loading="lazy" />
                ) : (
                  <div className="w-full aspect-[2/3] bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                    <Clapperboard className="w-8 h-8 text-surface-300" />
                  </div>
                )}
                <div className="p-3">
                  <p className="font-semibold text-sm truncate">{m.title}</p>
                  <p className="text-xs text-surface-500 flex items-center gap-2 mt-1">
                    {m.rating != null && (
                      <span className="flex items-center gap-0.5">
                        <Star className="w-3 h-3 text-amber-500" /> {m.rating.toFixed(1)}
                      </span>
                    )}
                    {m.releaseDate && <span>{m.releaseDate.slice(0, 4)}</span>}
                  </p>
                  {m.overview && <p className="text-xs text-surface-500 mt-1 line-clamp-2">{m.overview}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-rose-500" /> Movie meetups
            </h2>
            <Link to="/events" className="text-xs font-semibold text-primary-600 dark:text-primary-400">
              Create meetup
            </Link>
          </div>
          {meetups.length === 0 ? (
            <p className="text-sm text-surface-500">No movie meetups yet — create one from Events.</p>
          ) : (
            <div className="space-y-2">
              {meetups.map((m) => (
                <Link key={m.id} to={`/events/${m.id}`} className="flex items-center gap-3 rounded-2xl border border-surface-200 p-3 dark:border-surface-700 hover:border-primary-300 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{m.name}</p>
                    <p className="text-xs text-surface-500 flex items-center gap-2 mt-0.5">
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(new Date(m.date), 'MMM d')}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {m.location}</span>
                      <span>{m.attendees} going</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </AnimatedPage>
    </div>
  )
}

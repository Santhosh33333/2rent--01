import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Calendar, Search, MapPin, Users, Clock, ChevronRight, Plus, X, Navigation, Video, Film, Ticket } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { isSignedIn } from '../../lib/auth'
import { directionsUrl, isUsableLocation } from '../../lib/maps'
import { prepareCover } from '../../lib/photo'
import { openExternalUrl } from '../../lib/externalLink'
import { AnimatedPage } from '../../components/AnimatedPage'
import { LocationInput } from '../../components/LocationInput'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

interface Event {
  id: number
  name: string
  date: string
  endTime?: string | null
  /** Decided by the backend from its own clock, never recomputed in the browser. */
  isLive?: boolean
  location: string
  isOnline?: boolean
  latitude?: number | null
  longitude?: number | null
  rsvp: boolean
  description?: string
  attendees?: number
  category?: string
  capacity?: number | null
  price?: number | null
  coverImageUrl?: string | null
  isMovie?: boolean
  theatreName?: string | null
}


export function EventsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const createLock = useRef(false)
  const [form, setForm] = useState({ title: '', description: '', location: '', startTime: '', endTime: '', capacity: '', category: '', price: '', isMovie: false, theatreName: '', bookingUrl: '', coordinatorName: '', coordinatorPhone: '' })
  const [categories, setCategories] = useState<Array<{ key: string; enabled: boolean }>>([])
  const [coverFile, setCoverFile] = useState<Blob | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  // Live Indian movie catalog for the picker, plus the chosen film. The
  // catalog loads lazily the first time the movie toggle is switched on.
  interface MoviePick {
    id: number
    title: string
    posterUrl?: string | null
    releaseDate?: string | null
    originalLanguage?: string | null
    bookingUrl?: string
    group: 'now' | 'up'
  }
  const [movieCatalog, setMovieCatalog] = useState<MoviePick[]>([])
  const [movieQuery, setMovieQuery] = useState('')
  const [selectedMovie, setSelectedMovie] = useState<MoviePick | null>(null)
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'week' | 'free' | 'rsvped'>('all')
  const [signedIn, setSignedIn] = useState(isSignedIn)

  useEffect(() => {
    setSignedIn(isSignedIn())
  }, [showCreate])

  // Landing page CTAs deep-link here with ?category=movies. The page previously
  // ignored that param, so "Create a movie event" landed on a plain feed with
  // no hint it was about movies. Prefill the create form from it so the flow
  // starts where the button promised it would.
  useEffect(() => {
    const category = searchParams.get('category')
    if (category) {
      setForm((f) => ({ ...f, category }))
      setDatePreset('all')
    }
  }, [searchParams, showCreate])

  useEffect(() => {
    // Public endpoint on purpose. The whole /api/events router is behind
    // authenticateToken + requireKycVerified, so reading the feed from there
    // 401'd for anonymous visitors, and the axios interceptor reacts to a 401
    // with window.location.replace('/login') mid-load. That is what made this
    // page sit on a loading skeleton forever and left Create Event
    // unclickable. The public feed works for signed-in and anonymous alike and
    // still reports isRegistered per viewer.
    api.get('/public/events/categories', { timeout: 10000 })
      .then((r) => {
        const list = r.data?.data?.categories
        if (Array.isArray(list)) setCategories(list.filter((c: any) => c.enabled !== false))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!form.isMovie) return

    // The picker used to load once and then never again, so an organiser who
    // left the create-event form open overnight picked yesterday's releases.
    // Re-fetch whenever the cinema day rolls over, capped so a long-lived tab
    // re-checks on visibility instead of trusting a stale timer.
    const today = () => new Date().toDateString()
    let currentDay = today()

    const load = () => {
      api.get('/public/movies/now-playing', { timeout: 15000 })
        .then((r) => {
          const d = r.data?.data
          const now = Array.isArray(d?.nowPlaying) ? d.nowPlaying : []
          const up = Array.isArray(d?.upcoming) ? d.upcoming : []
          const rows: MoviePick[] = [
            ...now.map((m: any) => ({ id: m.id, title: m.title, posterUrl: m.posterUrl, releaseDate: m.releaseDate, originalLanguage: m.originalLanguage, bookingUrl: m.bookingUrl, group: 'now' as const })),
            ...up.map((m: any) => ({ id: m.id, title: m.title, posterUrl: m.posterUrl, releaseDate: m.releaseDate, originalLanguage: m.originalLanguage, bookingUrl: m.bookingUrl, group: 'up' as const })),
          ]
          if (rows.length) setMovieCatalog(rows)
        })
        .catch(() => {})
    }

    load()
    const refreshIfDayChanged = () => {
      if (today() === currentDay) return
      currentDay = today()
      load()
    }
    const timer = window.setInterval(refreshIfDayChanged, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', refreshIfDayChanged)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfDayChanged)
    }
  }, [form.isMovie])

  const chooseMovie = (m: MoviePick) => {
    setForm((f) => ({
      ...f,
      title: m.title,
      // Prefill the checkout only if the organizer has not already typed their
      // own link - a theatre-specific link always beats the generic search.
      bookingUrl: f.bookingUrl.trim() ? f.bookingUrl : m.bookingUrl || f.bookingUrl,
    }))
    setSelectedMovie(m)
    setMovieQuery('')
  }

  const movieSearch = movieQuery.trim()
  const nowRows = movieCatalog.filter((m) => m.group === 'now' && (!movieSearch || m.title.toLowerCase().includes(movieSearch)))
  const upRows = movieCatalog.filter((m) => m.group === 'up' && (!movieSearch || m.title.toLowerCase().includes(movieSearch)))

  const pickCover = async (file: File | undefined) => {
    if (!file) return
    try {
      const { blob, previewUrl } = await prepareCover(file)
      setCoverFile(blob)
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return previewUrl
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not use that image.')
    }
  }

  const createEvent = async () => {
    if (createLock.current) return
    if (form.title.trim().length < 3) {
      toast.error('Title must be at least 3 characters')
      return
    }
    if (form.isMovie && !form.theatreName.trim() && !form.location.trim()) {
      toast.error('A movie event needs the theatre name and where to meet')
      return
    }
    if (form.isMovie && form.coordinatorPhone.trim() && !form.coordinatorName.trim()) {
      toast.error('Add the coordinator\'s name with their phone number')
      return
    }
    if (form.bookingUrl.trim() && !/^https?:\/\//i.test(form.bookingUrl.trim())) {
      toast.error('Booking link must be a full http(s) URL')
      return
    }
    if (!form.startTime || Number.isNaN(new Date(form.startTime).getTime())) {
      toast.error('Pick a valid start date and time')
      return
    }
    // Same 6 AM - 10 PM local day the server enforces, checked here so the
    // organizer gets an instant message instead of a round-trip rejection.
    const startHour = new Date(form.startTime).getHours()
    if (startHour < 6 || startHour >= 22) {
      toast.error('Events run between 6:00 AM and 10:00 PM')
      return
    }
    if (form.endTime) {
      const endHour = new Date(form.endTime).getHours()
      if (endHour > 22 || (endHour === 0 && new Date(form.endTime).getDate() !== new Date(form.startTime).getDate())) {
        toast.error('Events have to finish by 10:00 PM the same day')
        return
      }
      if (new Date(form.endTime) <= new Date(form.startTime)) {
        toast.error('End time must be after the start time')
        return
      }
    }
    createLock.current = true
    setCreating(true)
    try {
      const res = await api.post('/events', {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        location: form.location.trim() || undefined,
        startTime: new Date(form.startTime).toISOString(),
        endTime: form.endTime ? new Date(form.endTime).toISOString() : undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        category: form.category || undefined,
        price: form.price !== '' ? Number(form.price) : undefined,
        isMovie: form.isMovie,
        theatreName: form.isMovie ? form.theatreName.trim() || undefined : undefined,
        bookingUrl: form.isMovie && form.bookingUrl.trim() ? form.bookingUrl.trim() : undefined,
        coordinatorName: form.isMovie && form.coordinatorName.trim() ? form.coordinatorName.trim() : undefined,
        coordinatorPhone: form.isMovie && form.coordinatorPhone.trim() ? form.coordinatorPhone.trim() : undefined,
      })
      const created = res.data?.data || res.data
      if (created?.id && coverFile) {
        try {
          const fd = new FormData()
          fd.append('cover', coverFile, 'cover.jpg')
          await api.post(`/events/${created.id}/cover`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
          })
        } catch {
          toast.error('Event created, but the cover image failed to upload.')
        }
      }
      toast.success('Event created')
      setShowCreate(false)
      setForm({ title: '', description: '', location: '', startTime: '', endTime: '', capacity: '', category: '', price: '', isMovie: false, theatreName: '', bookingUrl: '', coordinatorName: '', coordinatorPhone: '' })
      setCoverFile(null)
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setSelectedMovie(null)
      setMovieQuery('')
      if (created?.id) navigate(`/events/${created.id}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create event')
    } finally {
      createLock.current = false
      setCreating(false)
    }
  }

  const { loading, error, retry } = useAsync(
    async (signal) => {
      // limit=24 is the public endpoint's ceiling, which is what makes the
      // client-side preset filtering below honest: the whole feed is in hand.
      const res = await api.get('/public/events', { params: { limit: 24 }, signal, timeout: 15000 })
      const d = res.data?.data || res.data || {}
      const raw = Array.isArray(d) ? d : d.items || []
      const data = raw.map((ev: any) => ({
        id: ev.id,
        name: ev.title || 'Event',
        date: ev.startTime,
        endTime: ev.endTime ?? null,
        // The backend decides this against its own clock, so the badge can
        // never disagree with the "Live Now" list. Recomputing it in the browser
        // from the device time is what made this drift.
        isLive: ev.isLive === true,
        location: ev.location ?? 'TBA',
        isOnline: ev.isOnline === true,
        latitude: ev.latitude ?? null,
        longitude: ev.longitude ?? null,
        description: ev.description ?? '',
        category: ev.category,
        attendees: ev.attendeeCount ?? 0,
        capacity: ev.capacity ?? null,
        price: ev.price ?? null,
        coverImageUrl: ev.coverImageUrl ?? null,
        isMovie: !!ev.isMovie,
        theatreName: ev.theatreName ?? null,
        rsvp: !!ev.isRegistered,
      }))
      setEvents(data)
      return data
    },
    true,
    { cancelPrevious: true }
  )

  // The date pills filter in the browser rather than on the server: the public
  // feed is capped at 24 rows and is already fully in hand, so a server round
  // trip per pill would only add a loading flash without changing results.
  // A preset change therefore needs no refetch at all, which is why there is no
  // effect watching `datePreset` here any more.

  const filtered = events.filter(e => {
    const matchesSearch = (e.name || '').toLowerCase().includes(search.toLowerCase()) || (e.location || '').toLowerCase().includes(search.toLowerCase())
    if (datePreset === 'rsvped') return matchesSearch && e.rsvp
    if (datePreset === 'free') return matchesSearch && (e.price == null || Number(e.price) === 0)
    if (datePreset === 'today' || datePreset === 'week') {
      if (!matchesSearch) return false
      const start = new Date(e.date)
      if (Number.isNaN(start.getTime())) return false
      // The feed is "live and not yet finished", so anything starting in the
      // past is a live event. Past windows are still live *now*, so a
      // today/week match has to include them rather than drop them.
      const now = new Date()
      if (start <= now) return true
      if (datePreset === 'today') {
        return start.toDateString() === now.toDateString()
      }
      return start.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000
    }
    return matchesSearch
  })

  // Split on the server's decision. The default feed already excludes events
  // that have finished, so anything not live here genuinely has not started.
  const liveNow = filtered.filter(e => e.isLive)
  const upcoming = filtered.filter(e => !e.isLive)

  const renderCard = (event: Event) => {
    const eventDate = new Date(event.date)
    const isFull = event.capacity != null && (event.attendees ?? 0) >= event.capacity
    const mapUrl = directionsUrl(event.location, { latitude: event.latitude, longitude: event.longitude })
    const showMap = !event.isOnline && !!mapUrl
    return (
      <Link key={event.id} to={`/events/${event.id}`}
        className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300 block">
        {event.coverImageUrl && (
          <img src={assetUrl(event.coverImageUrl) || ''} alt="" className="w-full h-36 rounded-2xl object-cover mb-3" loading="lazy" />
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-md flex-shrink-0 ${event.isMovie ? 'bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/20' : 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20'} group-hover:scale-110 transition-transform`}>
                {event.isMovie ? <Film className="w-5 h-5 text-white" /> : <Calendar className="w-5 h-5 text-white" />}
              </div>
              <div>
                <h3 className="font-bold font-display text-surface-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                  {event.name}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  {event.category && <span className="badge-primary text-[10px]">{event.category}</span>}
                  {event.isMovie && event.theatreName && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                      <Film className="w-2.5 h-2.5" aria-hidden="true" /> {event.theatreName}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="text-xs text-surface-500 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {format(eventDate, 'MMM d, yyyy')}</span>
              <span className="text-xs text-surface-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {format(eventDate, 'h:mm a')}</span>
              {event.isOnline ? (
                <span className="text-xs text-surface-500 flex items-center gap-1">
                  <Video className="w-3.5 h-3.5" /> Online
                </span>
              ) : showMap ? (
                <a
                  href={mapUrl!}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); openExternalUrl(mapUrl) }}
                  title={`Get directions to ${event.location}`}
                  className="text-xs flex items-center gap-1 font-medium text-primary-600 dark:text-primary-400 hover:underline underline-offset-2"
                >
                  <Navigation className="w-3.5 h-3.5" /> {event.location}
                </a>
              ) : (
                <span className="text-xs text-surface-500 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {isUsableLocation(event.location) ? event.location : 'Venue to be announced'}
                </span>
              )}
              {event.attendees !== undefined && <span className="text-xs text-surface-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {event.attendees}{event.capacity != null ? `/${event.capacity}` : ''} attending</span>}
              {event.price != null && (
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {Number(event.price) === 0 ? 'Free' : `₹${event.price}`}
                </span>
              )}
              {isFull && !event.isLive && <span className="badge-danger text-[10px]">Event Full</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {event.isLive ? (
              <span className="badge-danger text-[10px] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> Live Now
              </span>
            ) : (
              <span className={event.rsvp ? 'badge-success' : 'badge-primary'}>
                {event.rsvp ? 'Going' : 'Upcoming'}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-surface-300 dark:text-surface-600 group-hover:text-primary-500 transition-colors" />
          </div>
        </div>
      </Link>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-36 rounded-2xl" />
        <div className="skeleton h-12 rounded-2xl" />
        <div className="flex gap-2">{[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-8 w-20 rounded-xl" />)}</div>
        <SkeletonLoader lines={5} variant="list" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState 
        icon={Calendar} 
        title="Failed to load events" 
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>} 
      />
    )
  }

  return (
    // This route is deliberately mounted OUTSIDE <Layout> (it is public, so an
    // anonymous visitor can browse without an account), and <Layout> is what
    // supplies the horizontal container for every other page. Without
    // repeating that container here the header sat at x=0 and the search
    // field ran the full width of the viewport, edge to edge.
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
      <PageHeader title="Events" subtitle="Discover walking events and meetups near you" action={
        <>
          <button
            onClick={() => {
              // Creating is authenticated, and the whole /api/events router sits
              // behind authenticateToken. Letting an anonymous visitor open the
              // form only produced a 401 on submit, which the axios interceptor
              // converts into a hard redirect to /login. Offering the choice up
              // front is the same outcome, minus the surprise navigation.
              if (!isSignedIn()) {
                toast('Sign in to create an event', { icon: '🔒' })
                return
              }
              setShowCreate((v) => !v)
            }}
            className="btn-gradient btn-sm flex items-center gap-2"
          >
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Close' : 'New Event'}
          </button>
          {!signedIn && (
            <Link
              to="/login?next=%2Fevents"
              className="btn btn-sm btn-ghost flex items-center gap-2"
            >
              Sign in to post
            </Link>
          )}
        </>
      } />

      {showCreate && (
        <AnimatedPage>
          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-surface-900 dark:text-white">Create an event</h3>

            <button
              type="button"
              role="switch"
              aria-checked={form.isMovie}
              onClick={() => setForm((f) => ({ ...f, isMovie: !f.isMovie }))}
              className={`w-full flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                form.isMovie
                  ? 'border-primary-500 bg-primary-500/10 text-surface-900 dark:text-white'
                  : 'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${form.isMovie ? 'bg-gradient-to-br from-primary-500 to-accent-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-500'}`}>
                {form.isMovie ? <Film className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">This is a movie event</span>
                <span className="block text-xs text-surface-500">
                  {form.isMovie
                    ? 'Title = film name, and a theatre + ticket link can be added below.'
                    : 'Pick this to list a film, theatre and booking link as an event.'}
                </span>
              </span>
            </button>

            <input value={form.title} onChange={(e) => {
                    setForm((f) => ({ ...f, title: e.target.value }))
                    // Editing the title by hand means the picker choice no longer
                    // matches; show the picker again instead of a stale chip.
                    if (selectedMovie && e.target.value !== selectedMovie.title) setSelectedMovie(null)
                  }} placeholder={form.isMovie ? 'Movie name (e.g. Indran 2)' : 'Event title (min 3 characters)'} maxLength={200} className="input" />
            {form.isMovie && (
              <>
                {selectedMovie ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-primary-500/40 bg-primary-500/5 p-3">
                    <div className="w-12 h-16 rounded-lg overflow-hidden bg-surface-100 dark:bg-surface-800 flex-shrink-0">
                      {selectedMovie.posterUrl && <img src={selectedMovie.posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{selectedMovie.title}</p>
                      <p className="text-xs text-surface-500">
                        {selectedMovie.group === 'now' ? 'Now playing' : 'Opening soon'}
                        {selectedMovie.releaseDate ? ` · ${selectedMovie.releaseDate.slice(0, 10)}` : ''}
                        {selectedMovie.originalLanguage ? ` · ${selectedMovie.originalLanguage.toUpperCase()}` : ''}
                      </p>
                    </div>
                    <button type="button" onClick={() => setSelectedMovie(null)} className="shrink-0 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline">
                      Change film
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                    <input
                      value={movieQuery}
                      onChange={(e) => setMovieQuery(e.target.value)}
                      placeholder={
                        movieCatalog.length
                          ? 'Search real films now playing / opening soon…'
                          : 'Loading live Indian films…'
                      }
                      disabled={!movieCatalog.length}
                      className="input pl-10"
                    />
                    {movieCatalog.length > 0 && (nowRows.length > 0 || upRows.length > 0) && (
                      <div className="absolute z-20 mt-2 left-0 right-0 max-h-72 overflow-y-auto rounded-2xl bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 shadow-xl p-1.5">
                        <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-surface-400">In cinemas now</p>
                        {nowRows.slice(0, 4).map((m) => (
                          <button key={`n${m.id}`} type="button" onClick={() => chooseMovie(m)}
                            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700/60 text-left transition-colors">
                            <div className="w-9 h-12 rounded-lg overflow-hidden bg-surface-100 dark:bg-surface-800 flex-shrink-0">
                              {m.posterUrl && <img src={m.posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{m.title}</p>
                              <p className="text-xs text-surface-500">{m.originalLanguage?.toUpperCase()}{m.releaseDate ? ` · ${m.releaseDate.slice(0, 10)}` : ''}</p>
                            </div>
                          </button>
                        ))}
                        <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-surface-400">Opening soon</p>
                        {upRows.slice(0, 4).map((m) => (
                          <button key={`u${m.id}`} type="button" onClick={() => chooseMovie(m)}
                            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700/60 text-left transition-colors">
                            <div className="w-9 h-12 rounded-lg overflow-hidden bg-surface-100 dark:bg-surface-800 flex-shrink-0">
                              {m.posterUrl && <img src={m.posterUrl} alt="" className="w-full h-full object-cover" loading="lazy" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{m.title}</p>
                              <p className="text-xs text-surface-500">{m.originalLanguage?.toUpperCase()}{m.releaseDate ? ` · ${m.releaseDate.slice(0, 10)}` : ''}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <input value={form.theatreName} onChange={(e) => setForm((f) => ({ ...f, theatreName: e.target.value }))} placeholder="Theatre (e.g. PVR Cinemas, Acropolis Mall)" maxLength={160} className="input" />
                <div className="relative">
                  <Ticket className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                  <input value={form.bookingUrl} onChange={(e) => setForm((f) => ({ ...f, bookingUrl: e.target.value }))} placeholder="Booking link (optional, e.g. https://in.bookmyshow.com/...)" inputMode="url" maxLength={1000} className="input pl-10" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input value={form.coordinatorName} onChange={(e) => setForm((f) => ({ ...f, coordinatorName: e.target.value }))} placeholder="Coordinator (name, confirms bookings)" maxLength={100} className="input" />
                  <input value={form.coordinatorPhone} onChange={(e) => setForm((f) => ({ ...f, coordinatorPhone: e.target.value }))} placeholder="Their phone (optional)" inputMode="tel" maxLength={20} className="input" />
                </div>
              </>
            )}
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder={form.isMovie ? "Showtime, seats to book, meeting point (optional)" : 'Description (optional)'} maxLength={1000} rows={3} className="input resize-none" />
            <LocationInput
              label="Location"
              optional
              value={form.location}
              onChange={(v) => setForm((f) => ({ ...f, location: v }))}
              placeholder="Event venue or area"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-500">{form.isMovie ? (selectedMovie && selectedMovie.group === 'up' ? 'Showtime (after release)' : 'Showtime') : 'Starts'}</span>
                <input type="datetime-local" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-surface-500">Ends (optional)</span>
                <input type="datetime-local" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} className="input mt-1" />
              </label>
            </div>
            <input type="number" min={1} max={10000} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="Capacity (optional)" className="input" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-500">Category</span>
                <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input mt-1">
                  <option value="">Select…</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>{c.key.charAt(0).toUpperCase() + c.key.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-surface-500">Price ₹ (0 = free)</span>
                <input type="number" min={0} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="Free" className="input mt-1" />
              </label>
            </div>
            <div>
              <span className="text-xs text-surface-500">Cover photo (optional)</span>
              <div className="mt-1 flex items-center gap-3">
                {coverPreview ? (
                  <img src={coverPreview} alt="Cover preview" className="w-full h-32 rounded-2xl object-cover" />
                ) : (
                  <label className="flex-1 cursor-pointer rounded-2xl border border-dashed border-surface-300 dark:border-surface-600 px-4 py-3 text-sm text-surface-500 text-center">
                    Choose cover photo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                )}
                {coverPreview && (
                  <button type="button" onClick={() => { setCoverFile(null); setCoverPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null }) }} className="shrink-0 p-2 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-500" aria-label="Remove cover">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <button onClick={createEvent} disabled={creating} className="btn-gradient w-full disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={50}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events..." className="input pl-12 py-3.5" />
        </div>

        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {([
            { key: 'all', label: 'All Events' },
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
            { key: 'free', label: 'Free' },
            { key: 'rsvped', label: 'Rsvped' },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setDatePreset(f.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                datePreset === f.key ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState icon={Calendar} title={search ? 'No events match' : 'No events found'}
            description={search ? 'Try a different search term' : 'Check back later for upcoming events'} />
        ) : (
          <div className="space-y-8">
            {liveNow.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-display text-lg font-bold text-surface-900 dark:text-white">Live Now</h2>
                  <span className="badge-danger text-[10px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> {liveNow.length} happening
                  </span>
                </div>
                <div className="grid gap-4">{liveNow.map(renderCard)}</div>
              </section>
            )}

            <section>
              <h2 className="font-display text-lg font-bold text-surface-900 dark:text-white mb-3">
                {liveNow.length > 0 ? 'Coming Up' : 'Upcoming'}
              </h2>
              {upcoming.length === 0 ? (
                <EmptyState icon={Calendar} title="Nothing else coming up"
                  description="You can create the first one." />
              ) : (
                <div className="grid gap-4">{upcoming.map(renderCard)}</div>
              )}
            </section>
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

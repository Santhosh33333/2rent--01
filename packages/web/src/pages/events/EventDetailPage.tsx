import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Calendar, MapPin, Users, ArrowLeft, Loader2, AlertTriangle,
  Clock, CheckCircle, XCircle, Sparkles,
  MapPinned, Share2, Radio, Video, Globe, Ticket, ShieldCheck, X, Navigation,
  Film, ExternalLink, Music2,
} from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { isSignedIn } from '../../lib/auth'
import { directionsUrl } from '../../lib/maps'
import { openExternalUrl } from '../../lib/externalLink'
import { EventChat } from '../../components/events/EventChat'
import { EventCostSheet } from '../../components/events/EventCostSheet'
import { MusicToggle } from '../landing/components/MusicToggle'

interface EventDetail {
  id: string
  name: string
  description: string
  date: string
  endTime?: string | null
  location: string
  isOnline?: boolean
  rsvp: boolean
  attendees: number
  category?: string
  organizer?: string
  isVerifiedOrganizer?: boolean
  maxAttendees?: number
  coverImageUrl?: string | null
  price?: number | null
  currency?: string
  status?: string
  isOrganizer?: boolean
  isLive?: boolean
  womenOnly?: boolean
  isFull?: boolean
  isMovie?: boolean
  theatreName?: string | null
  bookingUrl?: string | null
  coordinatorName?: string | null
  coordinatorPhone?: string | null
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rsvping, setRsvping] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkedIn, setCheckedIn] = useState(false)
  // "app" | "web" | null. A visitor who is not signed in has to choose where
  // they want to join, because RSVP writes need an account either way.
  const [joinChoice, setJoinChoice] = useState<'app' | 'web' | null>(null)
  const [signedIn, setSignedIn] = useState(isSignedIn)

  const mapEvent = useCallback((raw: any): EventDetail | null => {
    if (!raw) return null
    return {
      id: raw.id,
      name: raw.title,
      description: raw.description ?? '',
      date: raw.startTime,
      endTime: raw.endTime ?? null,
      location: raw.location ?? (raw.isOnline ? 'Online event' : 'To be announced'),
      isOnline: !!raw.isOnline,
      rsvp: !!raw.isRegistered,
      attendees: raw.attendeeCount ?? 0,
      category: raw.category,
      organizer: raw.organizer?.fullName,
      isVerifiedOrganizer: !!raw.isVerified,
      maxAttendees: raw.capacity,
      coverImageUrl: raw.coverImageUrl ?? null,
      price: raw.price ?? null,
      currency: raw.currency ?? 'INR',
      status: raw.status ?? 'PUBLISHED',
      isOrganizer: !!raw.isOrganizer,
      isLive: !!raw.isLive,
      womenOnly: !!raw.womenOnly,
      isFull: !!raw.isFull,
      isMovie: !!raw.isMovie,
      theatreName: raw.theatreName ?? null,
      bookingUrl: raw.bookingUrl ?? null,
      coordinatorName: raw.coordinatorName ?? null,
      coordinatorPhone: raw.coordinatorPhone ?? null,
    }
  }, [])

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()

    const fetchEvent = async () => {
      setLoading(true)
      setError(null)

      // Which endpoint to call is decided by whether there is a token, NOT by
      // trying the authenticated one and reacting to a 401.
      //
      // This used to call the private route first and fall back on 401. That
      // fallback could never run: a 401 is intercepted in lib/api.ts, which
      // attempts a token refresh and then calls window.location.replace('/login').
      // The page was already being torn down, so an anonymous visitor clicking
      // an event link was navigated away mid-request and saw a loading screen
      // instead of the event. Public links have to work without a login, so the
      // anonymous path must never issue a request that triggers the redirect.
      const authed = isSignedIn()
      setSignedIn(authed)

      if (authed) {
        try {
          const res = await api.get(`/events/${id}`, { signal: controller.signal })
          const raw = res.data?.data || res.data
          setEvent(mapEvent(raw))
          // These two paths return before the public request below, whose
          // `finally` owns setLoading(false). Without clearing it here a
          // signed-in visitor - which is exactly the organizer who just created
          // the event - sat on the skeleton forever instead of the event.
          setLoading(false)
          return
        } catch (err: any) {
          if (err?.code === 'ERR_CANCELED') return
          const status = err?.response?.status
          // The session is gone or KYC is missing. Drop to the public view
          // rather than leaving a spinner; the 401 has already navigated, so
          // there is nothing useful left to do here.
          if (status === 401 || status === 403) {
            setSignedIn(false)
          } else {
            setError(getErrorMessage(err, 'Failed to load event details'))
            setLoading(false)
            return
          }
        }
      }

      try {
        const res = await api.get(`/public/events/${id}`, { signal: controller.signal })
        const raw = res.data?.data?.event || res.data?.event || res.data?.data
        setEvent(mapEvent(raw))
      } catch (err: any) {
        if (err?.code === 'ERR_CANCELED') return
        setError(getErrorMessage(err, 'Failed to load event details'))
      } finally {
        setLoading(false)
      }
    }

    fetchEvent()
    return () => controller.abort()
  }, [id, mapEvent])

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: event?.name || 'Event', url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Event link copied')
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  const handleRsvp = async () => {
    if (!event || !id) return
    setRsvping(true)
    try {
      if (event.rsvp) {
        await api.post(`/events/${id}/cancel`)
        setEvent({ ...event, rsvp: false, attendees: Math.max(0, event.attendees - 1) })
        setJoinChoice(null)
        toast.success('RSVP cancelled')
      } else {
        await api.post(`/events/${id}/register`)
        setEvent({ ...event, rsvp: true, attendees: event.attendees + 1 })
        setJoinChoice(null)
        toast.success("You're going! Check-in opens at the event.")
      }
    } catch (err: any) {
      toast.error(getErrorMessage(err, 'Failed to update RSVP'))
      // A rejected write means the session is gone or KYC is missing. Do not
      // leave the sheet open pretending the join succeeded.
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setJoinChoice(null)
        setSignedIn(false)
      }
    } finally {
      setRsvping(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <div className="h-10 w-32 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
        <div className="glass-card p-8">
          <div className="h-8 w-56 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-4" />
          <div className="space-y-3 mb-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-4 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
            ))}
          </div>
          <div className="h-4 w-full bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-3/4 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-6" />
          <div className="h-11 w-28 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
        </div>
      </div>
    )
  }

  if (error || !event) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <Link to="/events" className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Events
        </Link>
        <div className="glass-card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 font-medium mb-2">Failed to Load</p>
          <p className="text-sm text-surface-500 mb-4">{error || 'Event not found'}</p>
          <Link to="/events" className="btn-primary btn-sm">
            Back to Events
          </Link>
        </div>
      </div>
    )
  }

  const eventDate = new Date(event.date)
  const now = new Date()
  const endDate = event.endTime ? new Date(event.endTime) : null
  const endIsValid = !!endDate && !Number.isNaN(endDate!.getTime())
  // An event is over when its END has passed, not when it has started. Testing
  // startTime alone made every genuinely live event report "Event ended" and
  // disabled its RSVP button, so nobody could join one while it was running.
  // The server's isLive is authoritative and is never overridden here; endTime
  // decides the rest, with the old startTime test kept only as the fallback for
  // open-ended events that have no end time at all.
  const isPast = !event.isLive && (endIsValid ? endDate! < now : eventDate < now)
  const spotsLeft = event.maxAttendees != null ? Math.max(0, event.maxAttendees - event.attendees) : undefined
  const soldOut = event.isFull || (spotsLeft !== undefined && spotsLeft <= 0)
  const canRsvp = !isPast && !soldOut
  const countdown = event.isLive
    ? 'Happening now'
    : !isPast
      ? `Starts ${formatDistanceToNowStrict(eventDate, { addSuffix: true })}`
      : 'This event has ended'

  // Directions for the venue. Online events have nowhere to navigate to, and an
  // unannounced venue must not link out, because a Maps search for "TBA" returns
  // a confident pin in the wrong city.
  const detailMapUrl = event.isOnline ? null : directionsUrl(event.location)

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <Link
        to="/events"
        className="inline-flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Events</span>
      </Link>

      {/* Event Card */}
      <div className="glass-card overflow-hidden">
        {/* Cover Header */}
        {event.coverImageUrl ? (
          <div className="h-48 relative">
            <img src={assetUrl(event.coverImageUrl) || ''} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                onClick={handleShare}
                title="Share this event"
                className="w-9 h-9 rounded-xl bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm flex items-center justify-center text-surface-600 dark:text-surface-400 hover:bg-white dark:hover:bg-surface-700 transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
            {event.isLive && (
              <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-rose-500/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-500/40">
                <Radio className="w-3 h-3 animate-pulse" aria-hidden="true" />
                Live now
              </span>
            )}
          </div>
        ) : (
          <div className="h-32 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900 relative">
            <div className="absolute inset-0 bg-grid opacity-20" />
            <div className="absolute top-4 right-4 flex gap-2">
              <button
                onClick={handleShare}
                title="Share this event"
                className="w-9 h-9 rounded-xl bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm flex items-center justify-center text-surface-600 dark:text-surface-400 hover:bg-white dark:hover:bg-surface-700 transition-colors"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
            {event.isLive && (
              <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-rose-500/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-500/40">
                <Radio className="w-3 h-3 animate-pulse" aria-hidden="true" />
                Live now
              </span>
            )}
          </div>
        )}

        <div className="p-6 md:p-8 -mt-16 relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 mb-4">
            {event.isMovie ? (
              <Film className="w-8 h-8 text-white" />
            ) : event.isOnline ? (
              <Video className="w-8 h-8 text-white" />
            ) : (
              <Calendar className="w-8 h-8 text-white" />
            )}
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">
                {event.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {event.category && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                    {event.category}
                  </span>
                )}
                {event.womenOnly && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300">
                    Women only
                  </span>
                )}
                <span className="text-xs text-surface-400 font-medium">{countdown}</span>
              </div>
            </div>
          </div>

          {/* Event Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <div className="glass-card-sm p-3 text-center">
              <Calendar className="w-4 h-4 text-primary-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Date</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {format(eventDate, 'MMM d, yyyy')}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <Clock className="w-4 h-4 text-accent-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">{event.isMovie ? 'Showtime' : 'Time'}</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {format(eventDate, 'h:mm a')}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              {event.isOnline ? (
                <Globe className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
              ) : (
                <MapPin className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
              )}
              <p className="text-[10px] text-surface-400">{event.isOnline ? 'Format' : 'Location'}</p>
              {detailMapUrl ? (
                <a
                  href={detailMapUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openExternalUrl(detailMapUrl)
                  }}
                  title={`Open directions to ${event.location}`}
                  className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline underline-offset-2 inline-flex items-center gap-1"
                >
                  <Navigation className="w-3 h-3" />
                  <span className="truncate">{event.location}</span>
                </a>
              ) : (
                <p className="text-xs font-medium text-surface-900 dark:text-white truncate">
                  {event.location}
                </p>
              )}
            </div>
            <div className="glass-card-sm p-3 text-center">
              <Users className="w-4 h-4 text-violet-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Going</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {event.attendees}{event.maxAttendees != null ? `/${event.maxAttendees}` : ''}
              </p>
            </div>
          </div>

          {/* Entry + seats strip */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {event.isMovie && event.theatreName && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300">
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                {event.theatreName}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300">
              <Ticket className="w-3.5 h-3.5" aria-hidden="true" />
              {event.price == null || Number(event.price) === 0 ? 'Free entry' : `${event.currency === 'INR' ? '₹' : ''}${event.price}`}
            </span>
            {event.isMovie && event.bookingUrl && (
              <a
                href={event.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  openExternalUrl(event.bookingUrl)
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold bg-primary-600 text-white hover:bg-primary-700 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                Book tickets
              </a>
            )}
            {spotsLeft !== undefined && !soldOut && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300">
                {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} left
              </span>
            )}
            {soldOut && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300">
                Full
              </span>
            )}
          </div>

          {/* Description */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary-500" />
              About this Event
            </h2>
            <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed whitespace-pre-line">
              {event.description || 'Details for this event have not been written yet.'}
            </p>
          </div>

          {/* Cost sheet. The organizer sets one per-person amount and the total
              is derived from it; attendees pay their own share from the wallet. */}
          {event.status !== 'CANCELLED' && (
            <div className="mt-6">
              <EventCostSheet eventId={event.id} isOrganizer={event.isOrganizer === true} />
            </div>
          )}

          {/* Love songs for the room. Same shared player as the landing page and
              a dating match, so this never plays on top of music already running
              elsewhere. It renders nothing until a catalogue exists - see
              lib/songLibrary.ts for why the repository ships with no tracks. */}
          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-1.5">
              <Music2 className="w-4 h-4 text-primary-500" aria-hidden="true" />
              Music for this event
            </h2>
            <MusicToggle variant="inline" label="event music" />
          </div>

          {/* Organizer */}
          {event.organizer && (
            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
                {event.organizer.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-surface-400">Organized by</p>
                <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{event.organizer}</p>
              </div>
              {event.isVerifiedOrganizer && (
                <span
                  title="Verified organizer"
                  className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Verified
                </span>
              )}
              {event.isOrganizer && event.status !== 'CANCELLED' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm('Cancel this event? Registered participants will be notified.')) return
                    try {
                      await api.put(`/events/${event.id}`, { status: 'CANCELLED' })
                      toast.success('Event cancelled')
                      setEvent({ ...event, status: 'CANCELLED' })
                    } catch (err) {
                      toast.error(getErrorMessage(err, 'Could not cancel the event'))
                    }
                  }}
                  className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Cancel event
                </button>
              )}
            </div>
          )}

          {/* Booking coordinator. Only movie events name one: it is the person
              added to the outing who does NOT buy a seat, and instead confirms
              the group's ticket booking. */}
          {event.isMovie && event.coordinatorName && (
            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-violet-50/60 dark:bg-violet-900/10 border border-violet-200/70 dark:border-violet-800/40">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center text-violet-600 dark:text-violet-300 font-semibold text-sm">
                {event.coordinatorName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-violet-500 dark:text-violet-300 font-semibold">Booking coordinator · not booking a seat</p>
                <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{event.coordinatorName}</p>
                <p className="text-xs text-surface-500 mt-0.5">Confirms the group's ticket booking — no seat of their own.</p>
              </div>
              {event.coordinatorPhone && (
                <a
                  href={`tel:${event.coordinatorPhone.replace(/[^+\d]/g, '')}`}
                  className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800/40 hover:bg-violet-100 dark:hover:bg-violet-900/20 transition-colors"
                >
                  Call
                </a>
              )}
            </div>
          )}

          {/* Spots Left Warning */}
          {spotsLeft !== undefined && spotsLeft <= 5 && spotsLeft > 0 && !isPast && (
            <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Only {spotsLeft} {spotsLeft === 1 ? 'spot' : 'spots'} left! RSVP now.
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => {
                if (!signedIn) {
                  setJoinChoice(joinChoice === 'web' ? null : 'web')
                  return
                }
                handleRsvp()
              }}
              disabled={rsvping || !canRsvp}
              className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                event.rsvp
                  ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-surface-200 dark:border-surface-700'
                  : 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30'
              } ${!canRsvp ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {rsvping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : event.rsvp ? (
                <><XCircle className="w-4 h-4" /> Cancel RSVP</>
              ) : isPast ? (
                <>Event ended</>
              ) : soldOut ? (
                <>Event full</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> {signedIn ? 'RSVP Now' : 'Join this event'}</>
              )}
            </button>
            {event.rsvp && signedIn && (
              <button
                onClick={async () => {
                  setCheckingIn(true)
                  try {
                    await api.post(`/events/${id}/checkin`)
                    setCheckedIn(true)
                    toast.success('Checked in. Enjoy the event!')
                  } catch (e: any) {
                    toast.error(e?.response?.data?.message || 'Check-in failed')
                  } finally {
                    setCheckingIn(false)
                  }
                }}
                disabled={checkingIn || checkedIn}
                title="Check in to this event"
                className="px-4 py-3 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors disabled:opacity-50 flex items-center gap-2 text-sm font-medium"
              >
                {checkingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPinned className="w-4 h-4" />}
                {checkedIn ? 'Checked In' : 'Check In'}
              </button>
            )}
          </div>

          {/* RSVP Status */}
          {event.rsvp && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
                {event.isMovie && event.bookingUrl ? (
                  <>
                    <p>You're going! Your seat is saved in the group. Book your cinema ticket now — {event.bookingUrl.startsWith('https://in.bookmyshow.com') ? 'BookMyShow' : 'the ticket link'}.</p>
                    <a
                      href={event.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.preventDefault()
                        openExternalUrl(event.bookingUrl)
                      }}
                      className="inline-flex items-center gap-1 mt-1 font-bold text-primary-700 dark:text-primary-300 hover:underline"
                    >
                      <Ticket className="w-3.5 h-3.5" aria-hidden="true" /> Book seats
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </>
                ) : event.isMovie ? (
                  <p>You're going! Seat saved in the group. The coordinator confirms the final ticket count before the show.</p>
                ) : (
                  <p>{checkedIn ? "You're checked in. Enjoy the event!" : "You're going! We'll send you a reminder before the event."}</p>
                )}
              </div>
            </div>
          )}

          {/* Group thread. The server decides who may read or post, so the
              component only needs to know whether to offer the composer. */}
          {signedIn && (
            <EventChat eventId={event.id} canPost={event.rsvp || event.isOrganizer === true} />
          )}
        </div>
      </div>

      {/* Join in the app or on the web. Joining needs an account either way, so
          an anonymous visitor picks where they want to continue instead of
          being bounced to a store link they never asked for. */}
      {joinChoice && !signedIn && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-choice-title"
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setJoinChoice(null)} />
          <div className="relative w-full max-w-md glass-card p-6 shadow-2xl animate-fadeInUp">
            <button
              onClick={() => setJoinChoice(null)}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-surface-400 hover:text-surface-700 dark:hover:text-white hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 id="join-choice-title" className="text-lg font-bold font-display text-surface-900 dark:text-white pr-8">
              Where do you want to join?
            </h2>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-1.5">
              Both options need a free Nabri account so the organiser can see who is coming.
            </p>

            <div className="mt-5 space-y-3">
              <Link
                to={`/register?next=${encodeURIComponent(`/events/${event.id}`)}`}
                onClick={() => setJoinChoice(null)}
                className="group flex items-center gap-3.5 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all"
              >
                <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white shadow-md shadow-primary-500/25">
                  <CheckCircle className="w-5 h-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-surface-900 dark:text-white">
                    Join here on the website
                  </span>
                  <span className="block text-xs text-surface-500 dark:text-surface-400">
                    Sign up and RSVP without installing anything
                  </span>
                </span>
              </Link>

              <Link
                to="/download"
                onClick={() => setJoinChoice(null)}
                className="group flex items-center gap-3.5 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 hover:border-primary-400 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-all"
              >
                <span className="w-10 h-10 rounded-xl bg-surface-900 dark:bg-white flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-white dark:text-surface-900" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-surface-900 dark:text-white">
                    Open the Nabri app
                  </span>
                  <span className="block text-xs text-surface-500 dark:text-surface-400">
                    Get reminders and check-in from your phone
                  </span>
                </span>
              </Link>
            </div>

            <p className="mt-4 text-center text-xs text-surface-400">
              Already have an account?{' '}
              <Link
                to={`/login?next=${encodeURIComponent(`/events/${event.id}`)}`}
                onClick={() => setJoinChoice(null)}
                className="text-primary-600 dark:text-primary-400 font-semibold hover:underline"
              >
                Log in
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

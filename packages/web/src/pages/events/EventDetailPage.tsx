import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Calendar, MapPin, Users, ArrowLeft, Loader2, AlertTriangle,
  Clock, Share2, CheckCircle, XCircle, Sparkles,
  MessageCircle
} from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

interface EventDetail {
  id: number
  name: string
  description: string
  date: string
  location: string
  rsvp: boolean
  attendees: number
  category?: string
  organizer?: string
  maxAttendees?: number
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rsvping, setRsvping] = useState(false)

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const res = await api.get(`/events/${id}`)
        const raw = res.data?.data || res.data
        const data = raw ? {
          id: raw.id,
          name: raw.title,
          description: raw.description ?? '',
          date: raw.startTime,
          location: raw.location ?? 'TBA',
          rsvp: !!raw.isRegistered,
          attendees: raw.attendeeCount ?? 0,
          category: raw.category,
          organizer: raw.organizer?.fullName,
          maxAttendees: raw.capacity,
        } : null
        setEvent(data)
      } catch (err) {
        setError('Failed to load event details')
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchEvent()
  }, [id])

  const handleRsvp = async () => {
    if (!event) return
    setRsvping(true)
    try {
      if (event.rsvp) {
        await api.post(`/events/${id}/cancel`)
        setEvent({ ...event, rsvp: false, attendees: event.attendees - 1 })
        toast.success('RSVP cancelled')
      } else {
        await api.post(`/events/${id}/register`)
        setEvent({ ...event, rsvp: true, attendees: event.attendees + 1 })
        toast.success('RSVP confirmed!')
      }
    } catch {
      toast.error('Failed to update RSVP')
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
        <button onClick={() => navigate('/events')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Events
        </button>
        <div className="glass-card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 font-medium mb-2">Failed to Load</p>
          <p className="text-sm text-surface-500 mb-4">{error || 'Event not found'}</p>
          <button onClick={() => navigate('/events')} className="btn-primary btn-sm">
            Back to Events
          </button>
        </div>
      </div>
    )
  }

  const eventDate = new Date(event.date)
  const isPast = eventDate < new Date()
  const spotsLeft = event.maxAttendees ? event.maxAttendees - event.attendees : undefined

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <button
        onClick={() => navigate('/events')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Events</span>
      </button>

      {/* Event Card */}
      <div className="glass-card overflow-hidden">
        {/* Gradient Header */}
        <div className="h-32 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900 relative">
          <div className="absolute inset-0 bg-grid opacity-20" />
          <div className="absolute top-4 right-4 flex gap-2">
            <button className="w-9 h-9 rounded-xl bg-white/80 dark:bg-surface-800/80 backdrop-blur-sm flex items-center justify-center text-surface-600 dark:text-surface-400 hover:bg-white dark:hover:bg-surface-700 transition-colors">
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 md:p-8 -mt-16 relative">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 mb-4">
            <Calendar className="w-8 h-8 text-white" />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
                {event.name}
              </h1>
              {event.category && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 mt-1">
                  {event.category}
                </span>
              )}
            </div>
          </div>

          {/* Event Meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="glass-card-sm p-3 text-center">
              <Calendar className="w-4 h-4 text-primary-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Date</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {format(eventDate, 'MMM d, yyyy')}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <Clock className="w-4 h-4 text-accent-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Time</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {format(eventDate, 'h:mm a')}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <MapPin className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Location</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white truncate">
                {event.location}
              </p>
            </div>
            <div className="glass-card-sm p-3 text-center">
              <Users className="w-4 h-4 text-violet-500 mx-auto mb-1" />
              <p className="text-[10px] text-surface-400">Attendees</p>
              <p className="text-xs font-medium text-surface-900 dark:text-white">
                {event.attendees}{spotsLeft !== undefined ? `/${event.maxAttendees}` : ''}
              </p>
            </div>
          </div>

          {/* Description */}
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-primary-500" />
              About this Event
            </h2>
            <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
              {event.description || 'Join us for a wonderful walking event. Meet fellow pet lovers and enjoy a great time together!'}
            </p>
          </div>

          {/* Organizer */}
          {event.organizer && (
            <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
                {event.organizer.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <p className="text-xs text-surface-400">Organized by</p>
                <p className="text-sm font-medium text-surface-900 dark:text-white">{event.organizer}</p>
              </div>
            </div>
          )}

          {/* Spots Left Warning */}
          {spotsLeft !== undefined && spotsLeft <= 5 && spotsLeft > 0 && (
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
              onClick={handleRsvp}
              disabled={rsvping || isPast}
              className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                event.rsvp
                  ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-surface-200 dark:border-surface-700'
                  : 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30'
              } ${isPast ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {rsvping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : event.rsvp ? (
                <><XCircle className="w-4 h-4" /> Cancel RSVP</>
              ) : (
                <><CheckCircle className="w-4 h-4" /> RSVP Now</>
              )}
            </button>
            <button className="px-4 py-3 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors">
              <MessageCircle className="w-4 h-4" />
            </button>
          </div>

          {/* RSVP Status */}
          {event.rsvp && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                You're going! We'll send you a reminder before the event.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Calendar, Search, MapPin, Users, Clock, ChevronRight, Plus, X } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { prepareCover } from '../../lib/photo'
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
  location: string
  rsvp: boolean
  description?: string
  attendees?: number
  category?: string
  capacity?: number | null
  price?: number | null
  coverImageUrl?: string | null
}

export function EventsPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [events, setEvents] = useState<Event[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const createLock = useRef(false)
  const [form, setForm] = useState({ title: '', description: '', location: '', startTime: '', endTime: '', capacity: '', category: '', price: '' })
  const [categories, setCategories] = useState<Array<{ key: string; enabled: boolean }>>([])
  const [coverFile, setCoverFile] = useState<Blob | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'week' | 'free' | 'rsvped'>('all')

  useEffect(() => {
    api.get('/events/categories')
      .then((r) => {
        const list = r.data?.data?.categories
        if (Array.isArray(list)) setCategories(list.filter((c: any) => c.enabled !== false))
      })
      .catch(() => {})
  }, [])

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
    if (!form.startTime || Number.isNaN(new Date(form.startTime).getTime())) {
      toast.error('Pick a valid start date and time')
      return
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
      setForm({ title: '', description: '', location: '', startTime: '', endTime: '', capacity: '', category: '', price: '' })
      setCoverFile(null)
      setCoverPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      if (created?.id) navigate(`/events/${created.id}`)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create event')
    } finally {
      createLock.current = false
      setCreating(false)
    }
  }

  const { loading, error, retry, execute: reloadEvents } = useAsync(
    async (signal) => {
      const params: Record<string, string | number> = {}
      if (datePreset === 'today' || datePreset === 'week') params.preset = datePreset
      if (datePreset === 'free') params.free = 'true'
      const res = await api.get('/events', { params, signal, timeout: 15000 })
      const d = res.data?.data || res.data || {}
      const raw = Array.isArray(d) ? d : d.items || []
      const data = raw.map((ev: any) => ({
        id: ev.id,
        name: ev.title || 'Event',
        date: ev.startTime,
        location: ev.location ?? 'TBA',
        description: ev.description ?? '',
        category: ev.category,
        attendees: ev.attendeeCount ?? 0,
        capacity: ev.capacity ?? null,
        price: ev.price ?? null,
        coverImageUrl: ev.coverImageUrl ?? null,
        rsvp: !!ev.isRegistered,
      }))
      setEvents(data)
      return data
    },
    true,
    { cancelPrevious: true }
  )

  // Server-side date preset: refetch when the pill changes (first load is
  // handled by useAsync itself).
  const firstPresetLoad = useRef(true)
  useEffect(() => {
    if (firstPresetLoad.current) {
      firstPresetLoad.current = false
      return
    }
    reloadEvents().catch(() => {})
  }, [datePreset, reloadEvents])

  const filtered = events.filter(e => {
    const matchesSearch = (e.name || '').toLowerCase().includes(search.toLowerCase()) || (e.location || '').toLowerCase().includes(search.toLowerCase())
    if (datePreset === 'rsvped') return matchesSearch && e.rsvp
    return matchesSearch
  })

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
    <div className="space-y-6">
      <PageHeader title="Events" subtitle="Discover walking events and meetups near you" action={
        <button onClick={() => setShowCreate((v) => !v)} className="btn-gradient btn-sm flex items-center gap-2">
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Close' : 'New Event'}
        </button>
      } />

      {showCreate && (
        <AnimatedPage>
          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-surface-900 dark:text-white">Create an event</h3>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Event title (min 3 characters)" maxLength={200} className="input" />
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" maxLength={1000} rows={3} className="input resize-none" />
            <LocationInput
              label="Location"
              optional
              value={form.location}
              onChange={(v) => setForm((f) => ({ ...f, location: v }))}
              placeholder="Event venue or area"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-500">Starts</span>
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
          <div className="grid gap-4">
            {filtered.map(event => {
              const eventDate = new Date(event.date)
              const isPast = eventDate < new Date()
              const isFull = event.capacity != null && (event.attendees ?? 0) >= event.capacity
              return (
                <Link key={event.id} to={`/events/${event.id}`}
                  className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300 block">
                  {event.coverImageUrl && (
                    <img src={assetUrl(event.coverImageUrl) || ''} alt="" className="w-full h-36 rounded-2xl object-cover mb-3" loading="lazy" />
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md shadow-amber-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
                          <Calendar className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-bold font-display text-surface-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                            {event.name}
                          </h3>
                          {event.category && <span className="badge-primary text-[10px]">{event.category}</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span className="text-xs text-surface-500 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {format(eventDate, 'MMM d, yyyy')}</span>
                        <span className="text-xs text-surface-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {format(eventDate, 'h:mm a')}</span>
                        <span className="text-xs text-surface-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {event.location}</span>
                        {event.attendees !== undefined && <span className="text-xs text-surface-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {event.attendees}{event.capacity != null ? `/${event.capacity}` : ''} attending</span>}
                        {event.price != null && (
                          <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                            {Number(event.price) === 0 ? 'Free' : `₹${event.price}`}
                          </span>
                        )}
                        {isFull && !isPast && <span className="badge-danger text-[10px]">Event Full</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={event.rsvp ? 'badge-success' : isPast ? 'badge-neutral' : 'badge-primary'}>
                        {event.rsvp ? 'Going' : isPast ? 'Ended' : 'Upcoming'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-surface-300 dark:text-surface-600 group-hover:text-primary-500 transition-colors" />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

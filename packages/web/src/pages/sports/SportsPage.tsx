import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, ChevronRight, Clock, MapPin, Plus, Trophy, Users, X } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { LocationInput } from '../../components/LocationInput'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

const SPORTS = [
  { key: 'cricket', label: 'Cricket' },
  { key: 'football', label: 'Football' },
  { key: 'badminton', label: 'Badminton' },
  { key: 'tennis', label: 'Tennis' },
  { key: 'basketball', label: 'Basketball' },
  { key: 'volleyball', label: 'Volleyball' },
  { key: 'table-tennis', label: 'Table Tennis' },
  { key: 'running', label: 'Running' },
  { key: 'cycling', label: 'Cycling' },
  { key: 'swimming', label: 'Swimming' },
  { key: 'gym', label: 'Gym / Fitness' },
  { key: 'boxing', label: 'Boxing' },
  { key: 'chess', label: 'Chess' },
  { key: 'esports', label: 'Esports' },
  { key: 'other', label: 'Other' },
]

interface SportGame {
  id: string
  name: string
  sport: string | null
  date: string
  location: string
  attendees: number
  capacity: number | null
  coverImageUrl: string | null
  rsvp: boolean
}

export function SportsPage() {
  const [games, setGames] = useState<SportGame[]>([])
  const [sport, setSport] = useState('all')
  const [when, setWhen] = useState<'all' | 'today' | 'week'>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', sport: 'cricket', location: '', date: '', time: '', capacity: '' })

  const { loading, error, retry, execute: reload } = useAsync(async () => {
    const params: Record<string, string> = { category: 'sports' }
    if (sport !== 'all') params.subcategory = sport
    if (when !== 'all') params.preset = when
    const res = await api.get('/events', { params })
    const d = res.data?.data || res.data || {}
    const raw = Array.isArray(d) ? d : d.items || []
    const data: SportGame[] = raw.map((ev: any) => ({
      id: ev.id,
      name: ev.title || 'Game',
      sport: ev.subcategory || null,
      date: ev.startTime,
      location: ev.location ?? 'TBA',
      attendees: ev.attendeeCount ?? 0,
      capacity: ev.capacity ?? null,
      coverImageUrl: ev.coverImageUrl ?? null,
      rsvp: !!ev.isRegistered,
    }))
    setGames(data)
    return data
  }, true)

  const firstLoad = useRef(true)
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false
      return
    }
    reload().catch(() => {})
  }, [sport, when, reload])

  const createGame = async () => {
    if (form.title.trim().length < 3) {
      toast.error('Give the game a title (min 3 characters)')
      return
    }
    if (!form.date || !form.time) {
      toast.error('Pick a date and time')
      return
    }
    const start = new Date(`${form.date}T${form.time}`)
    if (Number.isNaN(start.getTime()) || start < new Date()) {
      toast.error('Pick a future date and time')
      return
    }
    setCreating(true)
    try {
      const res = await api.post('/events', {
        title: form.title.trim(),
        category: 'sports',
        subcategory: form.sport,
        location: form.location.trim() || undefined,
        startTime: start.toISOString(),
        capacity: form.capacity ? Number(form.capacity) : undefined,
      })
      const created = res.data?.data || res.data
      toast.success('Game created')
      setShowCreate(false)
      setForm({ title: '', sport: 'cricket', location: '', date: '', time: '', capacity: '' })
      if (created?.id) window.location.assign(`/events/${created.id}`)
      else reload().catch(() => {})
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create game')
    } finally {
      setCreating(false)
    }
  }

  const sportLabel = (key: string | null) => SPORTS.find((s) => s.key === key)?.label || 'Sports'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sports"
        subtitle="Find players, create games, join and play"
        action={
          <button onClick={() => setShowCreate((v) => !v)} className="btn-gradient btn-sm flex items-center gap-2">
            {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {showCreate ? 'Close' : 'New Game'}
          </button>
        }
      />

      {showCreate && (
        <AnimatedPage>
          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-surface-900 dark:text-white">Create a game</h3>
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Sunday Cricket – Chennai" maxLength={200} className="input" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-500">Sport</span>
                <select value={form.sport} onChange={(e) => setForm((f) => ({ ...f, sport: e.target.value }))} className="input mt-1">
                  {SPORTS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-surface-500">Players needed</span>
                <input type="number" min={2} max={100} value={form.capacity} onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="e.g. 12" className="input mt-1" />
              </label>
            </div>
            <LocationInput label="Location" optional value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v }))} placeholder="Ground / venue / area" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-500">Date</span>
                <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className="input mt-1" />
              </label>
              <label className="block">
                <span className="text-xs text-surface-500">Time</span>
                <input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} className="input mt-1" />
              </label>
            </div>
            <button onClick={createGame} disabled={creating} className="btn-gradient w-full disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Game'}
            </button>
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={50}>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ key: 'all', label: 'All Sports' }, ...SPORTS].map((s) => (
            <button
              key={s.key}
              onClick={() => setSport(s.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                sport === s.key
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {s.key === 'all' ? 'All Sports' : s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          {([
            { key: 'all', label: 'Any time' },
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
          ] as const).map((w) => (
            <button
              key={w.key}
              onClick={() => setWhen(w.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                when === w.key
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {loading ? (
          <div className="space-y-4">
            <SkeletonLoader lines={4} variant="list" />
          </div>
        ) : error ? (
          <EmptyState icon={Trophy} title="Failed to load games" description="Check your connection and try again" action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>} />
        ) : games.length === 0 ? (
          <EmptyState icon={Trophy} title="No games yet" description={sport === 'all' ? 'Be the first to create one.' : `No ${sportLabel(sport)} games yet — create one!`} />
        ) : (
          <div className="grid gap-4">
            {games.map((g) => {
              const d = new Date(g.date)
              const isPast = d < new Date()
              const isFull = g.capacity != null && g.attendees >= g.capacity
              return (
                <Link key={g.id} to={`/events/${g.id}`} className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300 block">
                  {g.coverImageUrl && (
                    <img src={assetUrl(g.coverImageUrl) || ''} alt="" className="w-full h-36 rounded-2xl object-cover mb-3" loading="lazy" />
                  )}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md flex-shrink-0">
                          <Trophy className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-bold font-display text-surface-900 dark:text-white group-hover:text-emerald-600 transition-colors">{g.name}</h3>
                          <span className="badge-primary text-[10px]">{sportLabel(g.sport)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-2">
                        <span className="text-xs text-surface-500 flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {format(d, 'MMM d, yyyy')}</span>
                        <span className="text-xs text-surface-500 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {format(d, 'h:mm a')}</span>
                        <span className="text-xs text-surface-500 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {g.location}</span>
                        <span className="text-xs text-surface-500 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {g.attendees}{g.capacity != null ? `/${g.capacity}` : ''} players</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={g.rsvp ? 'badge-success' : isPast ? 'badge-neutral' : isFull ? 'badge-danger' : 'badge-primary'}>
                        {g.rsvp ? 'Joined' : isPast ? 'Ended' : isFull ? 'Full' : 'Open'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-surface-300 dark:text-surface-600 group-hover:text-emerald-500 transition-colors" />
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

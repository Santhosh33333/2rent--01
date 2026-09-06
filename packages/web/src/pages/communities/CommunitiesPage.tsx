import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Users, Search, UserPlus, UserMinus, MapPin, Hash, Plus, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

interface Community {
  id: string
  name: string
  members: number
  description: string
  joined: boolean
  category?: string
  location?: string
}

export function CommunitiesPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [joining, setJoining] = useState<string | null>(null)
  const [list, setList] = useState<Community[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', privacy: 'PUBLIC', city: '' })

  const { loading, error, retry } = useAsync(
    async () => {
      const res = await api.get('/communities')
      const data = res.data?.data || res.data || []
      const items = Array.isArray(data) ? data : (data.items || [])
      // Normalize backend shape (memberCount/isMember/city) to view shape.
      setList(items.map((c: any) => ({
        id: String(c.id),
        name: c.name,
        members: c.memberCount ?? c._count?.members ?? 0,
        description: c.description || '',
        joined: !!c.isMember,
        category: c.category,
        location: c.city ?? c.location,
      })))
      return items
    },
    true
  )

  const toggleJoin = async (id: string) => {
    setJoining(id)
    try {
      const community = list.find(c => c.id === id)
      if (!community) return
      if (community.joined) {
        await api.post(`/communities/${id}/leave`)
      } else {
        await api.post(`/communities/${id}/join`)
      }
      setList(list.map(c => c.id === id ? { ...c, joined: !c.joined, members: c.joined ? c.members - 1 : c.members + 1 } : c))
    } catch (err: any) {
      console.error('Failed to toggle join:', err)
      toast.error(err?.response?.data?.message || 'Failed to join community')
    } finally {
      setJoining(null)
    }
  }

  const filtered = list.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const createCommunity = async () => {
    if (form.name.trim().length < 3) {
      toast.error('Name must be at least 3 characters')
      return
    }
    setCreating(true)
    try {
      const res = await api.post('/communities', {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        privacy: form.privacy,
        city: form.city.trim() || undefined,
      })
      const created = res.data?.data || res.data
      toast.success('Community created')
      setShowCreate(false)
      setForm({ name: '', description: '', privacy: 'PUBLIC', city: '' })
      if (created?.id) navigate(`/communities/${created.id}`)
      else retry()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create community')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="skeleton h-12 rounded-2xl" />
        <SkeletonLoader lines={5} variant="list" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={Users}
        title="Failed to load communities"
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Communities" subtitle="Discover and join communities near you" action={
        <button onClick={() => setShowCreate((v) => !v)} className="btn-gradient btn-sm flex items-center gap-2">
          {showCreate ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showCreate ? 'Close' : 'New Community'}
        </button>
      } />

      <AnimatedPage delay={50}>
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search communities..."
            className="input pl-12 py-3.5"
          />
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-3 mt-4">
          <span className="badge-glass"><Users className="w-3.5 h-3.5" /> {list.length} total</span>
          <span className="badge-glass"><UserPlus className="w-3.5 h-3.5" /> {list.filter(c => c.joined).length} joined</span>
        </div>
      </AnimatedPage>

      {showCreate && (
        <AnimatedPage>
          <div className="glass-card p-5 space-y-3">
            <h3 className="font-bold text-surface-900 dark:text-white">Create a community</h3>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Community name (min 3 characters)"
              maxLength={100}
              className="input"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this community about? (optional)"
              maxLength={500}
              rows={3}
              className="input resize-none"
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.privacy} onChange={(e) => setForm((f) => ({ ...f, privacy: e.target.value }))} className="input">
                <option value="PUBLIC">Public</option>
                <option value="PRIVATE">Private</option>
              </select>
              <input
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                placeholder="City (optional)"
                className="input"
              />
            </div>
            <button onClick={createCommunity} disabled={creating} className="btn-gradient w-full disabled:opacity-50">
              {creating ? 'Creating...' : 'Create Community'}
            </button>
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'No communities match' : 'No communities yet'}
            description={search ? 'Try a different search term' : 'Check back later for new communities'}
          />
        ) : (
          <div className="grid gap-4">
            {filtered.map(community => (
              <div key={community.id} className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md shadow-sky-500/20 group-hover:scale-110 transition-transform flex-shrink-0">
                        <Hash className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <Link to={`/communities/${community.id}`} className="font-bold font-display text-surface-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                          {community.name}
                        </Link>
                        {community.category && (
                          <span className="ml-2 badge-primary text-[10px]">{community.category}</span>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-surface-500 dark:text-surface-400 mt-1 line-clamp-2 leading-relaxed">
                      {community.description}
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      <span className="text-xs text-surface-400 flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {community.members} members</span>
                      {community.location && <span className="text-xs text-surface-400 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {community.location}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => toggleJoin(community.id)}
                    disabled={joining === community.id}
                    className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                      community.joined
                        ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 hover:text-danger-500 border border-surface-200 dark:border-surface-700'
                        : 'btn-gradient'
                    }`}
                  >
                    {community.joined ? (
                      <span className="flex items-center gap-1.5"><UserMinus className="w-3.5 h-3.5" /> Leave</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Join</span>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

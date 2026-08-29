import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Users, ArrowLeft, Loader2, AlertTriangle,
  Hash, MapPin, Calendar, Globe, Shield,
  UserPlus, UserMinus, MessageCircle, ChevronRight,
  Sparkles
} from 'lucide-react'
import { api } from '../../lib/api'

interface CommunityDetail {
  id: number
  name: string
  description: string
  members: number
  joined: boolean
  category?: string
  location?: string
  createdAt?: string
  isPublic?: boolean
  membersList?: { id: string; name: string; initials: string }[]
}

export function CommunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [community, setCommunity] = useState<CommunityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await api.get(`/communities/${id}`)
        const data = res.data?.data || res.data
        setCommunity(data)
      } catch (err) {
        setError('Failed to load community details')
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchDetail()
  }, [id])

  const toggleJoin = async () => {
    if (!community) return
    setJoining(true)
    try {
      if (community.joined) {
        await api.post(`/communities/${id}/leave`)
      } else {
        await api.post(`/communities/${id}/join`)
      }
      setCommunity({
        ...community,
        joined: !community.joined,
        members: community.joined ? community.members - 1 : community.members + 1,
      })
    } catch {
      // keep UI optimistic
    } finally {
      setJoining(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <div className="h-10 w-32 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
        <div className="glass-card p-8">
          <div className="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-4" />
          <div className="h-4 w-full bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-2" />
          <div className="h-4 w-3/4 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-6" />
          <div className="flex gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-5 w-28 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
            ))}
          </div>
        </div>
        <div className="glass-card p-6">
          <div className="h-6 w-24 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-4" />
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-surface-800 animate-pulse" />
              <div className="h-4 w-28 bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !community) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <button onClick={() => navigate('/communities')} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Communities
        </button>
        <div className="glass-card p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 font-medium mb-2">Failed to Load</p>
          <p className="text-sm text-surface-500 mb-4">{error || 'Community not found'}</p>
          <button onClick={() => navigate('/communities')} className="btn-primary btn-sm">
            Back to Communities
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <button
        onClick={() => navigate('/communities')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Communities</span>
      </button>

      {/* Community Header */}
      <div className="glass-card p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center">
                <Hash className="w-7 h-7 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
                  {community.name}
                </h1>
                {community.category && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 mt-1">
                    {community.category}
                  </span>
                )}
              </div>
            </div>
            <p className="text-surface-600 dark:text-surface-400 leading-relaxed">
              {community.description}
            </p>

            {/* Meta Info */}
            <div className="flex flex-wrap gap-4 mt-4">
              <div className="flex items-center gap-1.5 text-sm text-surface-500">
                <Users className="w-4 h-4" />
                <span><strong className="text-surface-900 dark:text-white">{community.members}</strong> members</span>
              </div>
              {community.location && (
                <div className="flex items-center gap-1.5 text-sm text-surface-500">
                  <MapPin className="w-4 h-4" />
                  <span>{community.location}</span>
                </div>
              )}
              {community.createdAt && (
                <div className="flex items-center gap-1.5 text-sm text-surface-500">
                  <Calendar className="w-4 h-4" />
                  <span>Created {new Date(community.createdAt).toLocaleDateString()}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm text-surface-500">
                {community.isPublic !== false ? (
                  <><Globe className="w-4 h-4" /><span>Public</span></>
                ) : (
                  <><Shield className="w-4 h-4" /><span>Private</span></>
                )}
              </div>
            </div>
          </div>

          {/* Join/Leave Button */}
          <button
            onClick={toggleJoin}
            disabled={joining}
            className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              community.joined
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-surface-200 dark:border-surface-700'
                : 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30'
            }`}
          >
            {joining ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : community.joined ? (
              <span className="flex items-center gap-1.5">
                <UserMinus className="w-4 h-4" />
                Leave
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <UserPlus className="w-4 h-4" />
                Join
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Members Section */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-primary-500" />
            Members
            <span className="text-sm font-normal text-surface-400">({community.members})</span>
          </h2>
          <button className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1">
            View All
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2">
          {(community.membersList || [
            { id: '1', name: 'Alice Johnson', initials: 'AJ' },
            { id: '2', name: 'Bob Smith', initials: 'BS' },
            { id: '3', name: 'Carol White', initials: 'CW' },
            { id: '4', name: 'David Brown', initials: 'DB' },
            { id: '5', name: 'Eva Martinez', initials: 'EM' },
          ]).slice(0, 8).map(member => (
            <div key={member.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
                  {member.initials}
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{member.name}</p>
                  <p className="text-xs text-surface-400">Member</p>
                </div>
              </div>
              <button className="w-8 h-8 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 flex items-center justify-center text-surface-400 opacity-0 group-hover:opacity-100 transition-all">
                <MessageCircle className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* About Section */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-primary-500" />
          About this Community
        </h2>
        <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
          {community.description || 'This community brings together pet lovers and walking enthusiasts. Join to connect with like-minded people, share experiences, and organize group walks.'}
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          {['Pet Friendly', 'Walking', 'Social', 'Outdoor'].map(tag => (
            <span key={tag} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

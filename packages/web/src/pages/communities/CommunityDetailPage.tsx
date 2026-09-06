import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Users, ArrowLeft, Loader2, AlertTriangle,
  Hash, MapPin, Calendar, Globe, Shield,
  UserPlus, UserMinus, Send, Trash2, MessageSquare, Flag, BarChart3, Plus, X
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

interface Member {
  id: string
  role: string
  user: { id: string; fullName: string; avatarUrl?: string | null }
}

interface Post {
  id: string
  content: string
  authorId: string
  createdAt: string
  author?: { fullName: string; avatarUrl?: string | null }
  _count?: { comments: number }
}

interface Comment {
  id: string
  content: string
  authorId: string
  createdAt: string
  author?: { fullName: string; avatarUrl?: string | null }
}

interface PollOption {
  id: string
  text: string
  voteCount: number
}

interface Poll {
  id: string
  question: string
  authorId: string
  closesAt?: string | null
  createdAt: string
  author?: { fullName: string; avatarUrl?: string | null }
  options: PollOption[]
  myOptionId?: string | null
}

interface CommunityEvent {
  id: string
  title: string
  startTime: string
  location?: string | null
  attendeeCount?: number
}

interface Community {
  id: string
  name: string
  description?: string | null
  privacy: string
  city?: string | null
  createdAt?: string
  memberCount: number
  isMember: boolean
  isOwner: boolean
}

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
}

export function CommunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [community, setCommunity] = useState<Community | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [composer, setComposer] = useState('')
  const [posting, setPosting] = useState(false)
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({})
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [reporting, setReporting] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [polls, setPolls] = useState<Poll[]>([])
  const [events, setEvents] = useState<CommunityEvent[]>([])
  const [showPollForm, setShowPollForm] = useState(false)
  const [pollQ, setPollQ] = useState('')
  const [pollOpts, setPollOpts] = useState<string[]>(['', ''])
  const [pollBusy, setPollBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [cRes, mRes, pRes, pollRes, eRes] = await Promise.all([
        api.get(`/communities/${id}`),
        api.get(`/communities/${id}/members`).catch(() => null),
        api.get(`/communities/${id}/posts`).catch(() => null),
        api.get(`/communities/${id}/polls`).catch(() => null),
        api.get('/events', { params: { communityId: id } }).catch(() => null),
      ])
      const c = cRes.data?.data || cRes.data
      setCommunity(c)
      const m = mRes?.data?.data || mRes?.data
      if (m?.items) setMembers(m.items)
      const p = pRes?.data?.data || pRes?.data
      if (p?.items) setPosts(p.items)
      const pl = pollRes?.data?.data || pollRes?.data
      if (pl?.items) setPolls(pl.items)
      const ev = eRes?.data?.data || eRes?.data
      const evItems = Array.isArray(ev) ? ev : ev?.items || []
      setEvents(evItems)
    } catch {
      setError('Failed to load community details')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggleJoin = async () => {
    if (!community) return
    setJoining(true)
    try {
      if (community.isMember) {
        await api.post(`/communities/${id}/leave`)
        toast.success('Left community')
      } else {
        await api.post(`/communities/${id}/join`)
        toast.success('Joined community')
      }
      await refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Action failed')
    } finally {
      setJoining(false)
    }
  }

  const publishPost = async () => {
    if (!composer.trim()) return
    setPosting(true)
    try {
      await api.post(`/communities/${id}/posts`, { content: composer.trim() })
      setComposer('')
      toast.success('Post published')
      await refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to publish')
    } finally {
      setPosting(false)
    }
  }

  const removePost = async (postId: string) => {
    try {
      await api.delete(`/communities/${id}/posts/${postId}`)
      setPosts((prev) => prev.filter((p) => p.id !== postId))
      toast.success('Post deleted')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Cannot delete post')
    }
  }

  const loadComments = async (postId: string) => {
    const open = !openComments[postId]
    setOpenComments((prev) => ({ ...prev, [postId]: open }))
    if (open && !comments[postId]) {
      try {
        const res = await api.get(`/communities/${id}/posts/${postId}/comments`)
        const data = res.data?.data || res.data
        setComments((prev) => ({ ...prev, [postId]: data.items || [] }))
      } catch {
        toast.error('Failed to load comments')
      }
    }
  }

  const addComment = async (postId: string) => {
    const content = (drafts[postId] || '').trim()
    if (!content) return
    try {
      const res = await api.post(`/communities/${id}/posts/${postId}/comments`, { content })
      const saved = res.data?.data || res.data
      setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), saved?.comment || saved] }))
      setDrafts((prev) => ({ ...prev, [postId]: '' }))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to comment')
    }
  }

  const removeComment = async (postId: string, commentId: string) => {
    try {
      await api.delete(`/communities/${id}/posts/${postId}/comments/${commentId}`)
      setComments((prev) => ({ ...prev, [postId]: (prev[postId] || []).filter((c) => c.id !== commentId) }))
      toast.success('Comment deleted')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Cannot delete comment')
    }
  }

  const submitReport = async (kind: 'post' | 'comment', postId: string, commentId?: string) => {
    if (reportReason.trim().length < 3) {
      toast.error('Tell us why (min 3 characters)')
      return
    }
    try {
      const url = kind === 'post'
        ? `/communities/${id}/posts/${postId}/report`
        : `/communities/${id}/posts/${postId}/comments/${commentId}/report`
      await api.post(url, { reason: reportReason.trim() })
      toast.success('Reported. Admins will review it.')
      setReporting(null)
      setReportReason('')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to report')
    }
  }

  const createPoll = async () => {
    const options = pollOpts.map((o) => o.trim()).filter(Boolean)
    if (pollQ.trim().length < 3) {
      toast.error('Ask a question (min 3 characters)')
      return
    }
    if (options.length < 2) {
      toast.error('Provide at least 2 options')
      return
    }
    setPollBusy(true)
    try {
      await api.post(`/communities/${id}/polls`, { question: pollQ.trim(), options })
      setPollQ('')
      setPollOpts(['', ''])
      setShowPollForm(false)
      toast.success('Poll created')
      await refresh()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create poll')
    } finally {
      setPollBusy(false)
    }
  }

  const votePoll = async (pollId: string, optionId: string) => {
    try {
      const res = await api.post(`/communities/${id}/polls/${pollId}/vote`, { optionId })
      const updated = res.data?.data || res.data
      setPolls((prev) => prev.map((p) => p.id === pollId ? { ...p, options: updated.options, myOptionId: optionId } : p))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to vote')
    }
  }

  const removePoll = async (pollId: string) => {
    try {
      await api.delete(`/communities/${id}/polls/${pollId}`)
      setPolls((prev) => prev.filter((p) => p.id !== pollId))
      toast.success('Poll deleted')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Cannot delete poll')
    }
  }

  const reportBox = (key: string, kind: 'post' | 'comment', postId: string, commentId?: string) => {    if (reporting !== key) {
      return (
        <button onClick={() => { setReporting(key); setReportReason('') }} title="Report to admins" className="w-8 h-8 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 flex items-center justify-center text-surface-400">
          <Flag className="w-4 h-4" />
        </button>
      )
    }
    return (
      <div className="flex gap-1.5 items-center">
        <input
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Why? (min 3 chars)"
          maxLength={200}
          className="input !py-1.5 !px-2.5 text-xs w-40"
        />
        <button onClick={() => submitReport(kind, postId, commentId)} className="btn-gradient btn-sm !py-1.5 !px-3 text-xs">Send</button>
        <button onClick={() => setReporting(null)} className="text-xs text-surface-400 px-1">Cancel</button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 animate-fadeInUp">
        <div className="h-10 w-32 bg-surface-100 dark:bg-surface-800 rounded-xl animate-pulse" />
        <div className="glass-card p-8">
          <div className="h-8 w-48 bg-surface-100 dark:bg-surface-800 rounded animate-pulse mb-4" />
          <div className="h-4 w-full bg-surface-100 dark:bg-surface-800 rounded animate-pulse" />
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
              </div>
            </div>
            {community.description ? (
              <p className="text-surface-600 dark:text-surface-400 leading-relaxed">
                {community.description}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-4 mt-4">
              <div className="flex items-center gap-1.5 text-sm text-surface-500">
                <Users className="w-4 h-4" />
                <span><strong className="text-surface-900 dark:text-white">{community.memberCount}</strong> members</span>
              </div>
              {community.city && (
                <div className="flex items-center gap-1.5 text-sm text-surface-500">
                  <MapPin className="w-4 h-4" />
                  <span>{community.city}</span>
                </div>
              )}
              {community.createdAt && (
                <div className="flex items-center gap-1.5 text-sm text-surface-500">
                  <Calendar className="w-4 h-4" />
                  <span>Created {new Date(community.createdAt).toLocaleDateString('en-IN')}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm text-surface-500">
                {community.privacy !== 'PRIVATE' ? (
                  <><Globe className="w-4 h-4" /><span>Public</span></>
                ) : (
                  <><Shield className="w-4 h-4" /><span>Private</span></>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={toggleJoin}
            disabled={joining}
            className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              community.isMember
                ? 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 border border-surface-200 dark:border-surface-700'
                : 'bg-gradient-to-r from-primary-500 to-accent-500 text-white shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30'
            }`}
          >
            {joining ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : community.isMember ? (
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

      {/* Members Section — real data only */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary-500" />
          Members
          <span className="text-sm font-normal text-surface-400">({community.memberCount})</span>
        </h2>

        {members.length === 0 ? (
          <p className="text-sm text-surface-400">No members to show.</p>
        ) : (
          <div className="space-y-2">
            {members.slice(0, 8).map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-sm">
                    {initials(member.user?.fullName || '?')}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">{member.user?.fullName || 'Member'}</p>
                    <p className="text-xs text-surface-400">{member.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Posts Section */}
      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-primary-500" />
          Posts
        </h2>

        {community.isMember ? (
          <div className="flex gap-2 mb-6">
            <input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="Share something with the community..."
              maxLength={2000}
              className="input flex-1"
              disabled={posting}
            />
            <button onClick={publishPost} disabled={posting || !composer.trim()} className="btn-gradient px-4 disabled:opacity-50">
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <p className="text-sm text-surface-400 mb-6">Join this community to post and comment.</p>
        )}

        {posts.length === 0 ? (
          <p className="text-sm text-surface-400">No posts yet. Be the first to share something.</p>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500/20 to-accent-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-semibold text-xs">
                      {initials(post.author?.fullName || '?')}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-surface-900 dark:text-white">{post.author?.fullName || 'Member'}</p>
                      <p className="text-xs text-surface-400">{new Date(post.createdAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    {(post as any).isAnnouncement && (
                      <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">📢 Announcement</span>
                    )}
                  </div>
                  <button onClick={() => removePost(post.id)} title="Delete post" className="w-8 h-8 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 flex items-center justify-center text-surface-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {reportBox(`post-${post.id}`, 'post', post.id)}
                </div>
                <p className="text-sm text-surface-700 dark:text-surface-300 mt-3 whitespace-pre-wrap">{post.content}</p>
                <button onClick={() => loadComments(post.id)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline mt-2">
                  {openComments[post.id] ? 'Hide comments' : `Comments (${post._count?.comments ?? ''})`}
                </button>
                {openComments[post.id] && (
                  <div className="mt-3 space-y-2 pl-3 border-l-2 border-surface-200 dark:border-surface-700">
                    {(comments[post.id] || []).map((c) => (
                      <div key={c.id} className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-surface-900 dark:text-white">{c.author?.fullName || 'Member'}</p>
                          <p className="text-sm text-surface-600 dark:text-surface-400">{c.content}</p>
                        </div>
                        <button onClick={() => removeComment(post.id, c.id)} title="Delete comment" className="text-surface-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        {reportBox(`comment-${c.id}`, 'comment', post.id, c.id)}
                      </div>
                    ))}
                    {community.isMember && (
                      <div className="flex gap-2 pt-1">
                        <input
                          value={drafts[post.id] || ''}
                          onChange={(e) => setDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                          placeholder="Write a comment..."
                          maxLength={1000}
                          className="input flex-1 !py-2 text-sm"
                        />
                        <button onClick={() => addComment(post.id)} className="btn-gradient px-3">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* Polls Section */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary-500" />
            Polls
          </h2>
          {community.isMember && (
            <button onClick={() => setShowPollForm((v) => !v)} className="btn-gradient btn-sm flex items-center gap-1.5">
              {showPollForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showPollForm ? 'Close' : 'New Poll'}
            </button>
          )}
        </div>

        {showPollForm && community.isMember && (
          <div className="mb-5 p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50 space-y-2.5">
            <input
              value={pollQ}
              onChange={(e) => setPollQ(e.target.value)}
              placeholder="Ask a question..."
              maxLength={500}
              className="input"
            />
            {pollOpts.map((opt, i) => (
              <input
                key={i}
                value={opt}
                onChange={(e) => setPollOpts((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                placeholder={`Option ${i + 1}`}
                maxLength={200}
                className="input"
              />
            ))}
            <div className="flex gap-2">
              {pollOpts.length < 6 && (
                <button onClick={() => setPollOpts((prev) => [...prev, ''])} className="btn-outline btn-sm">+ Option</button>
              )}
              <button onClick={createPoll} disabled={pollBusy} className="btn-gradient btn-sm disabled:opacity-50">
                {pollBusy ? 'Creating...' : 'Create Poll'}
              </button>
            </div>
          </div>
        )}

        {polls.length === 0 ? (
          <p className="text-sm text-surface-400">No polls yet.</p>
        ) : (
          <div className="space-y-4">
            {polls.map((poll) => {
              const total = poll.options.reduce((s, o) => s + o.voteCount, 0)
              const closed = !!poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now()
              return (
                <div key={poll.id} className="p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-surface-900 dark:text-white">{poll.question}</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        {poll.author?.fullName || 'Member'} • {total} vote{total === 1 ? '' : 's'}{closed ? ' • Closed' : ''}
                      </p>
                    </div>
                    <button onClick={() => removePoll(poll.id)} title="Delete poll" className="w-8 h-8 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 flex items-center justify-center text-surface-400 flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-2 mt-3">
                    {poll.options.map((opt) => {
                      const pct = total > 0 ? Math.round((opt.voteCount / total) * 100) : 0
                      const mine = poll.myOptionId === opt.id
                      return (
                        <button
                          key={opt.id}
                          onClick={() => !closed && community.isMember && votePoll(poll.id, opt.id)}
                          disabled={closed || !community.isMember}
                          className={`w-full text-left p-2.5 rounded-xl border transition-colors ${mine ? 'border-primary-500 bg-primary-500/10' : 'border-surface-200 dark:border-surface-700 hover:border-primary-400'} ${closed || !community.isMember ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-surface-900 dark:text-white">{opt.text}</span>
                            <span className="text-surface-500 text-xs">{opt.voteCount} ({pct}%)</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 mt-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500" style={{ width: `${pct}%` }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {/* Events Section */}
      {events.length > 0 && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary-500" />
            Upcoming Events
          </h2>
          <div className="space-y-2">
            {events.slice(0, 5).map((ev) => (
              <Link key={ev.id} to={`/events/${ev.id}`} className="flex items-center justify-between gap-3 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-surface-900 dark:text-white">{ev.title}</p>
                  <p className="text-xs text-surface-400">
                    {new Date(ev.startTime).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {ev.location ? ` • ${ev.location}` : ''}
                  </p>
                </div>
                {ev.attendeeCount !== undefined && (
                  <span className="text-xs text-surface-400 flex-shrink-0">{ev.attendeeCount} going</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

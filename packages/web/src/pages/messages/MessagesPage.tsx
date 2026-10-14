import { useState, useEffect, useCallback } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { MessageCircle, Search, ChevronRight, Clock, Phone, UserPlus, Users } from 'lucide-react'
import { api, chatRequestApi } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useSocket } from '../../hooks/useSocket'
import { AnimatedPage } from '../../components/AnimatedPage'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'
import CallUserButton from '../../components/CallUserButton'
import { Avatar } from '../../components/Avatar'
import { GroupsSection } from './GroupsSection'

interface Conversation {
  conversationId: string
  partnerId: string | null
  partnerName: string
  partnerAvatar: string | null
  lastMessage: string | null
  lastMessageAt: string | null
  unreadCount: number
}

interface CallRecord {
  id: string
  callerId: string
  receiverId: string
  type: string
  status: string
  duration: number | null
  createdAt: string
  caller?: { id: string; fullName: string | null; avatarUrl: string | null } | null
  receiver?: { id: string; fullName: string | null; avatarUrl: string | null } | null
}

/** Human label for a call-log status. */
function callStatusLabel(record: CallRecord, myId: string): { text: string; missed: boolean } {
  const outgoing = record.callerId === myId
  switch (record.status) {
    case 'ENDED':
      return {
        text: `${outgoing ? 'Outgoing' : 'Incoming'} · ${record.duration ? `${record.duration}s` : 'connected'}`,
        missed: false,
      }
    case 'MISSED':
      return { text: outgoing ? 'Unanswered call' : 'Missed call', missed: true }
    case 'REJECTED':
      return { text: 'Declined', missed: false }
    case 'CANCELLED':
      return { text: 'Cancelled', missed: false }
    case 'FAILED':
      return { text: 'Could not connect', missed: true }
    default:
      return { text: outgoing ? 'Outgoing call' : 'Incoming call', missed: false }
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export function MessagesPage() {
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([])
  /** Pending incoming chat requests, surfaced as a badge on the Requests row. */
  const [pendingRequests, setPendingRequests] = useState(0)
  const { user } = useAuth()
  const myId = user?.id
  const { on } = useSocket({ autoConnect: true })
  // Discovery cards ("Message <name>") link to `/messages?user=<id>`. That param
  // used to be ignored, so tapping the button landed on the conversation LIST
  // with nothing open — it read as "chat does not open". Forward it to the
  // thread route, which handles a brand-new (empty) conversation too.
  const [searchParams] = useSearchParams()
  const targetUserId = searchParams.get('user')
  // Chats (1:1) and Groups share the Messages screen but, like their data
  // models, stay on separate tabs. `?tab=groups` deep-links to the groups side
  // (used by group notifications and after creating/leaving a group).
  const [tab, setTab] = useState<'chats' | 'groups'>(searchParams.get('tab') === 'groups' ? 'groups' : 'chats')
  const [groupInviteCount, setGroupInviteCount] = useState(0)

  // Recent calls, so a missed call can be returned without leaving the app.
  // The API returns identities only - never phone numbers.
  const fetchRecentCalls = useCallback(async (signal?: AbortSignal) => {
    const res = await api.get('/calls', { params: { limit: 5 }, signal, timeout: 15000 })
    const d = res.data?.data || {}
    const items: CallRecord[] = Array.isArray(d) ? d : d.items || []
    setRecentCalls(items)
  }, [])

  useEffect(() => {
    fetchRecentCalls().catch(() => {})
  }, [fetchRecentCalls])

  // Pending chat requests are their own inbox, but the count belongs on the
  // Messages screen so they are discoverable at all. Refreshed alongside the
  // conversation poll below; a failure just leaves the badge at its last value.
  const fetchRequestCount = useCallback(async () => {
    try {
      const res = await chatRequestApi.counts()
      setPendingRequests(res.data.data?.pendingReceived ?? 0)
    } catch {
      // Non-fatal: the row still opens the inbox.
    }
  }, [])

  useEffect(() => {
    fetchRequestCount().catch(() => {})
  }, [fetchRequestCount])

  // A finished call refreshes the history entry.
  useEffect(() => {
    const off = on('call:ended', () => {
      fetchRecentCalls().catch(() => {})
    })
    return () => {
      off?.()
    }
  }, [fetchRecentCalls, on])

  const fetchConversations = useCallback(async (signal?: AbortSignal) => {
    const res = await api.get('/messages/conversations', { signal, timeout: 15000 })
    const d = res.data?.data || {}
    const items: Conversation[] = Array.isArray(d) ? d : d.items || []
    setConversations(items.filter((c) => c.partnerId))
    return items
  }, [])

  const { loading, error, retry } = useAsync(fetchConversations, true)

  // Real-time: incoming messages bump the matching conversation to the top, refresh
  // its preview, and increment the unread badge — without waiting for the poll.
  useEffect(() => {
    if (!myId) return
    const off = on('new_message', (data: unknown) => {
      const msg = data as {
        conversationId: string
        senderId: string
        content: string
        timestamp?: string | number
      }
      if (!msg?.conversationId) return
      const ts =
        typeof msg.timestamp === 'string'
          ? msg.timestamp
          : new Date(msg.timestamp || Date.now()).toISOString()
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.conversationId === msg.conversationId)
        if (idx === -1) {
          // Unknown conversation (e.g. a freshly accepted chat) — pull latest from server.
          fetchConversations().catch(() => {})
          return prev
        }
        const list = [...prev]
        const c = { ...list[idx] }
        c.lastMessage = msg.content
        c.lastMessageAt = ts
        if (msg.senderId !== myId) c.unreadCount = (c.unreadCount || 0) + 1
        list.splice(idx, 1)
        list.unshift(c)
        return list
      })
    })
    return () => off && off()
  }, [myId, on, fetchConversations])

  // A group invitation can arrive while the Chats tab is showing, where
  // GroupsSection is not mounted to watch for it — so the badge is incremented
  // here too. Switching to the Groups tab re-reads the authoritative count.
  useEffect(() => {
    const off = on('chat_group_invite', () => setGroupInviteCount((n) => n + 1))
    return () => off && off()
  }, [on])

  // Keep the list fresh as a safety net behind the socket (which pushes
  // new_message live). Backed off + hidden-tab aware: the old 8s hot poll
  // hammered the API from every open tab.
  useEffect(() => {
    const poll = setInterval(() => {
      if (typeof document === 'undefined' || !document.hidden) {
        fetchConversations().catch(() => {})
        fetchRequestCount().catch(() => {})
      }
    }, 25000)
    return () => clearInterval(poll)
  }, [fetchConversations, fetchRequestCount])

  const filtered = conversations.filter(c => c.partnerName.toLowerCase().includes(search.toLowerCase()))
  const unreadCount = conversations.filter(c => c.unreadCount > 0).length

  if (targetUserId && targetUserId !== 'undefined' && targetUserId !== 'null') {
    return <Navigate to={`/messages/${targetUserId}`} replace />
  }

  // Loading and error are handled inside the Chats branch below rather than as
  // early returns: the tab switcher has to stay on screen, otherwise a failed
  // conversation load locks the user out of Group chat completely.
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <AnimatedPage>
        <div className="hero-sky">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/10 rounded-full blur-3xl" />

          <div className="relative z-10 flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-sm">
              <MessageCircle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display">Messages</h1>
              <p className="text-white/60 text-sm">
                {unreadCount > 0 ? `${unreadCount} unread conversations` : 'No unread messages'}
              </p>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === 'groups' ? 'Search groups...' : 'Search conversations...'}
              className="input bg-white/15 border-white/20 text-white placeholder:text-white/40 pl-11 focus:bg-white/20 focus:border-white/30"
            />
          </div>
        </div>
      </AnimatedPage>

      {/* Chats / Groups switcher */}
      <div className="flex rounded-2xl bg-surface-100 p-1 dark:bg-surface-800">
        <button
          type="button"
          onClick={() => setTab('chats')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === 'chats'
              ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-900 dark:text-white'
              : 'text-surface-500 dark:text-surface-400'
          }`}
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> Chats
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-500 px-1 text-[11px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab('groups')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition ${
            tab === 'groups'
              ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-900 dark:text-white'
              : 'text-surface-500 dark:text-surface-400'
          }`}
        >
          <Users className="h-4 w-4" aria-hidden /> Groups
          {groupInviteCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
              {groupInviteCount}
            </span>
          )}
        </button>
      </div>

      {tab === 'groups' ? (
        <AnimatedPage delay={60}>
          <GroupsSection search={search} onInviteCountChange={setGroupInviteCount} />
        </AnimatedPage>
      ) : loading ? (
        <div className="space-y-4">
          <div className="skeleton h-8 w-48 rounded-2xl" />
          <div className="skeleton h-12 rounded-2xl" />
          <SkeletonLoader lines={5} variant="list" />
        </div>
      ) : error ? (
        <EmptyState
          icon={MessageCircle}
          title="Failed to load messages"
          description="Please check your connection and try again"
          action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
        />
      ) : (
        <>
      {/* Chat requests live in their own inbox. Without this row nothing in the
          UI ever called the request endpoints, so "asked to chat" was invisible. */}
      <AnimatedPage delay={60}>
        <Link
          to="/messages/requests"
          className="glass-elevated flex items-center gap-3 px-4 py-3.5 no-underline transition hover:bg-surface-50 dark:hover:bg-surface-800/50"
        >
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 text-white shadow-md shadow-primary-500/20">
            <UserPlus className="h-5 w-5" aria-hidden />
            {pendingRequests > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-white dark:ring-surface-900">
                {pendingRequests > 9 ? '9+' : pendingRequests}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-surface-900 dark:text-white">Chat requests</p>
            <p className="truncate text-xs text-surface-500 dark:text-surface-400">
              {pendingRequests > 0
                ? `${pendingRequests} ${pendingRequests === 1 ? 'person wants' : 'people want'} to connect`
                : 'People asking to start a conversation'}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-surface-400" aria-hidden />
        </Link>
      </AnimatedPage>

      {/* Conversation List */}
      <AnimatedPage delay={100}>
        <div className="glass-elevated overflow-hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filtered.length === 0 ? (
            <EmptyState icon={MessageCircle} title={search ? 'No conversations found' : 'No conversations yet'}
              description={search ? 'Try a different search term' : 'Start chatting with your walking partners!'}
              action={!search ? <Link to="/discover" className="btn btn-primary btn-sm">Find people to chat with</Link> : undefined} />
          ) : (
            filtered.map((conv) => (
              <Link key={conv.conversationId} to={`/messages/${conv.partnerId}`} state={{ name: conv.partnerName }}
                className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors group">
                <div className="flex items-center gap-4">
                  <div className="relative flex-shrink-0">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-primary-500/20">
                      {conv.partnerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className={`text-sm font-bold ${conv.unreadCount > 0 ? 'text-surface-900 dark:text-white' : 'text-surface-700 dark:text-surface-300'}`}>
                        {conv.partnerName}
                      </h3>
                      <span className="text-xs text-surface-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {timeAgo(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-sm truncate ${conv.unreadCount > 0 ? 'text-surface-700 dark:text-surface-300 font-medium' : 'text-surface-500 dark:text-surface-400'}`}>
                        {conv.lastMessage ?? 'Say hello'}
                      </p>
                      <div className="flex items-center gap-2 ml-2">
                        {conv.unreadCount > 0 && (
                          <span className="min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary-500 text-white text-xs font-bold flex items-center justify-center">
                            {conv.unreadCount}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-surface-300 dark:text-surface-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </AnimatedPage>

      {/* Recent in-app calls */}
      {recentCalls.length > 0 && (
        <AnimatedPage delay={150}>
          <div className="glass-elevated overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-100 dark:border-surface-800">
              <Phone className="w-4 h-4 text-emerald-500" />
              <h2 className="text-sm font-bold text-surface-900 dark:text-white">Recent calls</h2>
              <span className="text-xs text-surface-400 ml-auto">In-app · numbers stay private</span>
            </div>
            <div className="divide-y divide-surface-100 dark:divide-surface-800">
              {recentCalls.map((record) => {
                const other = record.callerId === myId ? record.receiver : record.caller
                if (!other) return null
                const { text, missed } = callStatusLabel(record, myId as string)
                return (
                  <div key={record.id} className="flex items-center gap-3 px-4 py-3">
                    {/* `other.avatarUrl` was already in scope (and even forwarded
                        to the call button below) but this tile always drew
                        initials, so a member's photo never showed in the list. */}
                    <Avatar
                      src={other.avatarUrl}
                      name={other.fullName}
                      className="w-10 h-10 rounded-xl"
                      textClassName="text-xs"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                        {other.fullName || 'Nabri member'}
                      </p>
                      <p className={`text-xs ${missed ? 'text-red-500 font-medium' : 'text-surface-500 dark:text-surface-400'}`}>
                        {text} · {timeAgo(record.createdAt)}
                      </p>
                    </div>
                    <CallUserButton
                      peer={{ id: other.id, fullName: other.fullName, avatarUrl: other.avatarUrl }}
                      callType={record.type === 'VIDEO' ? 'VIDEO' : 'VOICE'}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </AnimatedPage>
      )}
        </>
      )}
    </div>
  )
}

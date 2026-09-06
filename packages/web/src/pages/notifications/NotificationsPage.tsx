import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, Trash2, MessageSquare, Calendar, MapPin, Users, CreditCard, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { AnimatedPage } from '../../components/AnimatedPage'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { api } from '../../lib/api'
import { useAsync } from '../../hooks/useAsync'
import { useNotifications } from '../../hooks/useSocket'
import { formatDistanceToNow } from 'date-fns'

interface Notification {
  id: string
  title: string
  description?: string
  type: string
  isRead: boolean
  actionUrl?: string
  metadata?: string
  createdAt: string
  readAt?: string
}

function getNotificationIcon(type: string): any {
  const lower = (type || 'general').toLowerCase()
  if (lower.includes('message')) return MessageSquare
  if (lower.includes('event')) return Calendar
  if (lower.includes('booking') || lower.includes('walk')) return MapPin
  if (lower.includes('community')) return Users
  if (lower.includes('payment') || lower.includes('wallet')) return CreditCard
  if (lower.includes('security') || lower.includes('sos')) return Shield
  return Bell
}

/** Normalize any row/payload shape (HTTP list, socket push, legacy cache)
 *  into render-safe form. Never throws — broken rows render, never crash. */
function normalizeOne(raw: any): Notification | null {
  if (!raw || typeof raw !== 'object' || !raw.id) return null
  let embedded: any = {}
  try {
    embedded = typeof raw.data === 'string' ? JSON.parse(raw.data) : (raw.data || {})
  } catch {
    embedded = {}
  }
  const type = typeof raw.type === 'string' && raw.type
    ? raw.type
    : (typeof embedded?.type === 'string' && embedded.type ? embedded.type : 'GENERAL')
  return {
    id: String(raw.id),
    title: String(raw.title || 'Notification'),
    description: typeof raw.description === 'string' ? raw.description : String(raw.body || ''),
    type,
    isRead: !!raw.isRead,
    actionUrl: raw.actionUrl,
    metadata: typeof raw.data === 'string' ? raw.data : (raw.metadata ?? null),
    createdAt: raw.createdAt || new Date().toISOString(),
    readAt: raw.readAt,
  }
}

function normalizeList(items: any[]): Notification[] {
  if (!Array.isArray(items)) return []
  return items.map(normalizeOne).filter((n): n is Notification => n !== null)
}

const categoryColors: Record<string, string> = {
  message: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10',
  booking: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10',
  event: 'text-violet-500 bg-violet-50 dark:bg-violet-500/10',
  community: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10',
  payment: 'text-rose-500 bg-rose-50 dark:bg-rose-500/10',
  security: 'text-red-500 bg-red-50 dark:bg-red-500/10',
  default: 'text-surface-500 bg-surface-100 dark:bg-surface-800',
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const { loading, error, retry } = useAsync(
    async () => {
      const res = await api.get('/notifications', { params: { limit: 50 } })
      const data = res.data?.data
      setNotifications(normalizeList(data?.notifications || []))
      setUnreadCount(data?.unreadCount || 0)
      return data
    },
    true
  )

  // Realtime: prepend arrivals instantly + toast (backend fans out every row).
  const { listenToNotifications } = useNotifications()
  useEffect(() => {
    const off = listenToNotifications((incoming: any) => {
      const shaped = normalizeOne(incoming)
      if (!shaped) return
      setNotifications((prev) => {
        if (prev.some((n) => n.id === shaped.id)) return prev
        return [shaped, ...prev]
      })
      setUnreadCount((c) => c + 1)
      toast.success(shaped.title, { duration: 5000 })
    })
    return () => {
      if (typeof off === 'function') off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markAsRead = async (id: string) => {
    try {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
      await api.post(`/notifications/${id}/read`)
    } catch (error) {
      console.error('Mark as read failed:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() })))
      setUnreadCount(0)
      await api.post('/notifications/mark-all-read')
    } catch (error) {
      console.error('Mark all as read failed:', error)
    }
  }

  const clearAllRead = async () => {
    try {
      setNotifications(prev => prev.filter(n => !n.isRead))
      await api.delete('/notifications/clear-read')
    } catch (error) {
      console.error('Clear read failed:', error)
    }
  }

  const deleteNotification = async (id: string) => {
    try {
      setNotifications(prev => prev.filter(n => n.id !== id))
      const wasUnread = !notifications.find(n => n.id === id)?.isRead
      if (wasUnread) setUnreadCount(prev => Math.max(0, prev - 1))
      await api.delete(`/notifications/${id}`)
    } catch (error) {
      console.error('Delete failed:', error)
    }
  }

  const filtered = filter === 'unread' ? notifications.filter(n => !n.isRead) : notifications

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group">
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back</span>
      </button>

      <AnimatedPage>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-sm text-surface-500 mt-1">
                {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllAsRead} className="btn-ghost btn-sm text-xs inline-flex items-center gap-1">
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            {notifications.some(n => n.isRead) && (
              <button onClick={clearAllRead} className="btn-ghost btn-sm text-xs text-danger-500 inline-flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Clear read
              </button>
            )}
          </div>
        </div>
      </AnimatedPage>

      <div className="flex gap-2">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}
          >
            {f === 'all' ? 'All' : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      <AnimatedPage delay={50}>
        {loading ? (
          <SkeletonLoader lines={5} variant="list" />
        ) : error ? (
          <EmptyState
            icon={BellOff}
            title="Failed to load notifications"
            description="Please try again"
            action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={filter === 'unread' ? "You're all caught up!" : 'Notifications will appear here'}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((n, i) => {
              const ntype = n.type || 'GENERAL'
              const Icon = getNotificationIcon(ntype)
              const baseColor = ntype.split('_')[0].toLowerCase()
              const colorClass = categoryColors[baseColor] || categoryColors.default

              return (
                <AnimatedPage key={n.id} delay={i * 30}>
                  <div
                    className={`glass-card-static p-4 flex items-start gap-3 transition-all ${
                      !n.isRead ? 'border-l-4 border-primary-500 bg-primary-50/30 dark:bg-primary-500/5' : ''
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className={`text-sm font-semibold ${
                          !n.isRead ? 'text-surface-900 dark:text-white' : 'text-surface-700 dark:text-surface-300'
                        }`}>
                          {n.title}
                        </h3>
                        {!n.isRead && <span className="w-2 h-2 rounded-full bg-primary-500 shrink-0" />}
                      </div>
                      {n.description && (
                        <p className="text-xs text-surface-500 mt-0.5 line-clamp-2">{n.description}</p>
                      )}
                      <p className="text-xs text-surface-400 mt-1">
                        {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {!n.isRead && (
                        <button
                          onClick={() => markAsRead(n.id)}
                          className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400 hover:text-primary-500 transition-colors"
                          title="Mark as read"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteNotification(n.id)}
                        className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-400 hover:text-danger-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </AnimatedPage>
              )
            })}
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

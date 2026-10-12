import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, MessageCircle, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { Avatar } from '../../components/Avatar'
import { ScreenState, ListSkeleton } from '../../components/ui'
import { getErrorMessage } from '../../lib/error'
import {
  chatRequestApi,
  type ChatRequestRecord,
  type ChatRequestStatus,
} from '../../lib/api'

/**
 * Chat requests: the "can I message you?" inbox.
 *
 * Received requests can be accepted (which opens the conversation) or declined;
 * sent requests show where they stand. Both halves are loaded together so one
 * failing source degrades to the other rather than emptying the screen.
 */

const SENT_STATUS_LABEL: Record<ChatRequestStatus, string> = {
  PENDING: 'Waiting',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  EXPIRED: 'Expired',
}

function timeAgo(value: string): string {
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

export function ChatRequestsPage() {
  const navigate = useNavigate()
  const [received, setReceived] = useState<ChatRequestRecord[]>([])
  const [sent, setSent] = useState<ChatRequestRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const [recv, snt] = await Promise.allSettled([
      chatRequestApi.received(),
      chatRequestApi.sent(),
    ])
    if (signal?.aborted) return
    if (recv.status === 'rejected' && snt.status === 'rejected') {
      setError("We couldn't load your chat requests.")
      setReceived([])
      setSent([])
    } else {
      setReceived(recv.status === 'fulfilled' ? recv.value.data.data.requests ?? [] : [])
      setSent(snt.status === 'fulfilled' ? snt.value.data.data.requests ?? [] : [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const accept = async (request: ChatRequestRecord) => {
    if (busyId) return
    setBusyId(request.id)
    try {
      await chatRequestApi.accept(request.id)
      toast.success(`You can now chat with ${request.sender?.fullName || 'them'}.`)
      // The accept endpoint provisions the conversation, so go straight into it.
      navigate(`/messages/${request.senderId}`)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not accept the request'))
      setBusyId(null)
    }
  }

  const decline = async (request: ChatRequestRecord) => {
    if (busyId) return
    setBusyId(request.id)
    try {
      await chatRequestApi.reject(request.id)
      setReceived((prev) => prev.filter((r) => r.id !== request.id))
      toast.success('Request declined.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not decline the request'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-24">
      <header className="flex items-center gap-3">
        <Link
          to="/messages"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-100 text-surface-600 transition hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
          aria-label="Back to messages"
        >
          <MessageCircle className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-900 dark:text-white">
            Chat requests
          </h1>
          <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">
            {loading
              ? 'Checking what needs you'
              : received.length > 0
                ? `${received.length} ${received.length === 1 ? 'request needs' : 'requests need'} your attention`
                : 'Nothing needs you right now'}
          </p>
        </div>
      </header>

      {loading ? (
        <ListSkeleton count={4} />
      ) : error ? (
        <ScreenState
          kind="error"
          title="Couldn't load chat requests"
          message={error}
          onRetry={() => void load()}
        />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-bold text-surface-900 dark:text-white">Received</h2>
            {received.length === 0 ? (
              <p className="rounded-3xl border border-dashed border-surface-200 px-4 py-8 text-center text-sm text-surface-500 dark:border-surface-700 dark:text-surface-400">
                No pending requests right now.
              </p>
            ) : (
              <ul className="space-y-3">
                {received.map((request) => (
                  <li
                    key={request.id}
                    className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={request.sender?.avatarUrl}
                        name={request.sender?.fullName}
                        className="h-12 w-12 rounded-2xl"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-surface-900 dark:text-white">
                          {request.sender?.fullName || 'A Nabri member'}
                        </p>
                        <p className="truncate text-xs text-surface-500 dark:text-surface-400">
                          {[request.sender?.city, timeAgo(request.createdAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>

                    {request.message ? (
                      <p className="mt-3 rounded-2xl bg-surface-50 px-3 py-2 text-sm text-surface-600 dark:bg-surface-800/60 dark:text-surface-300">
                        &ldquo;{request.message}&rdquo;
                      </p>
                    ) : null}

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void accept(request)}
                        disabled={busyId !== null}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                      >
                        <Check className="h-4 w-4" aria-hidden /> Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => void decline(request)}
                        disabled={busyId !== null}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-surface-200 bg-white px-4 py-2.5 text-sm font-semibold text-surface-600 transition hover:bg-surface-50 active:scale-[0.98] disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
                      >
                        <X className="h-4 w-4" aria-hidden /> Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {sent.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-bold text-surface-900 dark:text-white">Sent</h2>
              <ul className="space-y-2">
                {sent.map((request) => {
                  const accepted = request.status === 'ACCEPTED'
                  return (
                    <li
                      key={request.id}
                      className="flex items-center gap-3 rounded-3xl border border-surface-200 bg-white p-3.5 dark:border-surface-800 dark:bg-surface-900"
                    >
                      <Avatar
                        src={request.receiver?.avatarUrl}
                        name={request.receiver?.fullName}
                        className="h-11 w-11 rounded-2xl"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-surface-900 dark:text-white">
                          {request.receiver?.fullName || 'A Nabri member'}
                        </p>
                        <p className="truncate text-xs text-surface-500 dark:text-surface-400">
                          {SENT_STATUS_LABEL[request.status]} · {timeAgo(request.createdAt)}
                        </p>
                      </div>
                      {accepted ? (
                        <Link
                          to={`/messages/${request.receiverId}`}
                          className="shrink-0 rounded-full bg-primary-500/15 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-500/25 dark:text-primary-300"
                        >
                          Open chat
                        </Link>
                      ) : (
                        <span className="shrink-0 rounded-full bg-surface-100 px-3 py-1.5 text-[11px] font-semibold text-surface-600 dark:bg-surface-800 dark:text-surface-300">
                          {SENT_STATUS_LABEL[request.status]}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default ChatRequestsPage

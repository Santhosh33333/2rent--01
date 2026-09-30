import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, MessageCircle, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { useSocket } from '../../hooks/useSocket'

interface ThreadSender {
  id: string
  fullName: string
  avatarUrl?: string | null
}

interface ThreadMessage {
  id: string
  content: string
  messageType: string
  mediaUrl?: string | null
  createdAt: string
  sender: ThreadSender
  isMine: boolean
}

interface EventChatProps {
  eventId: string
  /** True when the viewer is on the attendee list (or runs the event). */
  canPost: boolean
}

/**
 * The event's group thread.
 *
 * Rendered only for people who are going, because the server enforces the same
 * rule on every read and write. A member who is not attending is shown a short
 * prompt to RSVP instead of an input box that would reject on submit.
 */
export function EventChat({ eventId, canPost }: EventChatProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const { on } = useSocket({ autoConnect: true })

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/events/${eventId}/messages`, { timeout: 10000 })
      const items = Array.isArray(res.data?.data?.items) ? res.data.data.items : []
      setMessages(items)
    } catch {
      // Not attending, or the event is gone. Leave the thread empty; the
      // surrounding page already shows the RSVP control.
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  // Live updates for the rest of the thread.
  useEffect(() => {
    const offAdded = on('event_message', (payload: unknown) => {
      const data = payload as ThreadMessage & { eventId?: string };
      if (!data?.id || data.eventId !== eventId) return;
      setMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, { ...data, isMine: false }]));
    });
    const offDeleted = on('event_message_deleted', (payload: unknown) => {
      const data = payload as { eventId?: string; messageId?: string };
      if (!data?.messageId || data.eventId !== eventId) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, content: '[deleted]', messageType: 'TEXT' } : m)),
      );
    });
    return () => {
      offAdded?.();
      offDeleted?.();
    };
  }, [on, eventId])

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length])

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/events/${eventId}/messages`, { content }, { timeout: 10000 });
      const saved = res.data?.data as ThreadMessage | undefined;
      if (saved?.id) setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      setDraft('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send the message.'));
    } finally {
      setSending(false);
    }
  };

  if (!canPost) {
    return (
      <section className="mt-6 rounded-2xl border border-surface-200 dark:border-surface-700 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-white">
          <MessageCircle className="w-4 h-4 text-primary-500" />
          Group chat
        </div>
        <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
          RSVP to join the conversation with everyone else going.
        </p>
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-2xl border border-surface-200 dark:border-surface-700 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-200 dark:border-surface-700">
        <MessageCircle className="w-4 h-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Group chat</h3>
        {messages.length > 0 && (
          <span className="ml-auto text-xs text-surface-500 dark:text-surface-400">{messages.length}</span>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-surface-400">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-surface-500 dark:text-surface-400">
            No messages yet. Say hello to the group.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex gap-2 ${m.isMine ? 'flex-row-reverse' : ''}`}>
              {!m.isMine && (
                <div className="w-7 h-7 rounded-full bg-primary-500/15 text-primary-600 dark:text-primary-300 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {(m.sender?.fullName || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className={`max-w-[75%] ${m.isMine ? 'text-right' : ''}`}>
                {!m.isMine && (
                  <p className="text-[10px] font-semibold text-surface-500 dark:text-surface-400 mb-0.5">
                    {m.sender?.fullName}
                  </p>
                )}
                <div
                  className={`inline-block px-3 py-2 rounded-2xl text-sm text-left whitespace-pre-wrap break-words ${
                    m.isMine
                      ? 'bg-primary-600 text-white'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-800 dark:text-surface-100'
                  }`}
                >
                  {m.content}
                </div>
                <p className="mt-0.5 text-[10px] text-surface-400">
                  {format(new Date(m.createdAt), 'h:mm a')}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-surface-200 dark:border-surface-700 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message the group"
          maxLength={2000}
          className="flex-1 px-3 py-2 text-sm rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
        />
        <button
          onClick={() => void send()}
          disabled={!draft.trim() || sending}
          aria-label="Send message"
          className="p-2 rounded-xl bg-primary-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors hover:bg-primary-700"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </section>
  )
}
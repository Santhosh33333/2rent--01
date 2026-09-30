import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LifeBuoy, Plus, MessageSquare, Send, X } from 'lucide-react'
import { getErrorMessage } from '../../lib/error'
import { isSignedIn } from '../../lib/auth'
import { supportApi, SUPPORT_CATEGORIES } from '../../lib/api'
import { supportTicketStatusLabel, supportStatusClass, supportPriorityClass } from '../../lib/supportFormat'

interface TicketRow {
  id: string
  reference: string
  category: string
  subject: string
  status: string
  priority: string
  createdAt: string
  lastRepliedAt: string | null
}

interface ThreadMessage {
  id: string
  body: string
  isStaff: boolean
  isResolution: boolean
  createdAt: string
  author?: { id: string; fullName: string } | null
}

interface ThreadEvent {
  id: string
  action: string
  fromValue: string | null
  toValue: string | null
  createdAt: string
}

interface Thread {
  id: string
  reference: string
  subject: string
  category: string
  status: string
  priority: string
  createdAt: string
  firstResponseAt: string | null
  messages: ThreadMessage[]
  events: ThreadEvent[]
}

function when(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SupportPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [category, setCategory] = useState<string>('ACCOUNT')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const [thread, setThread] = useState<Thread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    // "My requests" is an authenticated list. On this now-public route an
    // anonymous visitor must not trigger it: a 401 is intercepted in lib/api.ts,
    // which refreshes the session and then calls window.location.replace('/login'),
    // so a visitor who only wanted to send a message was navigated away. With no
    // account there is no ticket list to show, which is what the redirect would
    // have achieved anyway, minus the surprise navigation.
    if (!isSignedIn()) {
      setTickets([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await supportApi.myTickets()
      const d = res.data?.data ?? res.data
      setTickets(Array.isArray(d) ? d : [])
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load your support requests'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openThread = async (id: string) => {
    setOpenId(id)
    setThreadLoading(true)
    setThread(null)
    setReply('')
    setReplyError('')
    try {
      const res = await supportApi.myTicket(id)
      setThread(res.data?.data ?? null)
    } catch (err: unknown) {
      setReplyError(getErrorMessage(err, 'Could not open that request'))
    } finally {
      setThreadLoading(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    setSubmitting(true)
    try {
      const res = await supportApi.createTicket({ category, subject: subject.trim(), body: body.trim() })
      const created = res.data?.data
      setShowForm(false)
      setSubject('')
      setBody('')
      await load()
      if (created?.id) await openThread(created.id)
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Could not send your request'))
    } finally {
      setSubmitting(false)
    }
  }

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread) return
    setReplyError('')
    setSending(true)
    try {
      await supportApi.reply(thread.id, reply.trim())
      setReply('')
      const res = await supportApi.myTicket(thread.id)
      setThread(res.data?.data ?? null)
      await load()
    } catch (err: unknown) {
      setReplyError(getErrorMessage(err, 'Could not send your reply'))
    } finally {
      setSending(false)
    }
  }

  // A requester can close their own thread. They cannot resolve it: "resolved"
  // means the problem is fixed, and that call belongs to support.
  const closeTicket = async (id: string) => {
    setReplyError('')
    try {
      await supportApi.updateStatus(id, 'CLOSED')
      const res = await supportApi.myTicket(id)
      setThread(res.data?.data ?? null)
      await load()
    } catch (err: unknown) {
      setReplyError(getErrorMessage(err, 'Could not close this request'))
    }
  }

  const openCount = tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status)).length

  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/home" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">Help &amp; support</h1>
            <p className="text-gray-400 text-sm mt-1">
              {openCount > 0 ? `${openCount} open request${openCount === 1 ? '' : 's'}` : 'No open requests'}
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition"
            >
              <Plus className="w-4 h-4" /> New request
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>
        )}

        {showForm && (
          <form onSubmit={submit} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-white font-semibold">Tell us what happened</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="bg-red-900/20 border border-red-800 text-red-300 p-3 rounded-lg mb-4 text-sm">{formError}</div>
            )}

            <label className="block text-sm text-gray-400 mb-1.5" htmlFor="support-category">What is this about?</label>
            <select
              id="support-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white mb-4 focus:border-blue-500 outline-none"
            >
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <label className="block text-sm text-gray-400 mb-1.5" htmlFor="support-subject">Subject</label>
            <input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary, e.g. Payment taken but booking not created"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white mb-4 focus:border-blue-500 outline-none"
            />

            <label className="block text-sm text-gray-400 mb-1.5" htmlFor="support-body">Details</label>
            <textarea
              id="support-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="What did you expect, and what happened instead? Include dates, amounts or reference numbers if you have them."
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white mb-4 focus:border-blue-500 outline-none resize-y"
            />

            {category === 'SAFETY' && (
              <p className="text-amber-300/90 text-xs mb-4 bg-amber-900/20 border border-amber-800 rounded-lg p-3">
                Safety requests are flagged urgent and go to the top of our queue. If anyone is in immediate danger,
                please contact emergency services first.
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition"
            >
              {submitting ? 'Sending…' : 'Send request'}
            </button>
          </form>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading your requests…</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16">
            <LifeBuoy className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <p className="text-gray-400 mb-1">You have not raised any requests yet.</p>
            <p className="text-gray-500 text-sm">If something is not working, tell us and we will help.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => (openId === t.id ? setOpenId(null) : openThread(t.id))}
                  className="w-full text-left p-4 hover:bg-gray-800/50 transition"
                >
                  <div className="flex items-start gap-3">
                    <MessageSquare className="w-4 h-4 text-gray-500 mt-1 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium truncate">{t.subject}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${supportStatusClass(t.status)}`}>
                          {supportTicketStatusLabel(t.status)}
                        </span>
                        {t.priority === 'URGENT' && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${supportPriorityClass(t.priority)}`}>
                            Urgent
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs mt-1.5 font-mono">{t.reference} · {when(t.createdAt)}</p>
                    </div>
                  </div>
                </button>

                {openId === t.id && (
                  <div className="border-t border-gray-800 p-4">
                    {threadLoading ? (
                      <div className="text-center py-8 text-gray-500 text-sm">Loading conversation…</div>
                    ) : !thread ? (
                      <div className="text-center py-8 text-red-400 text-sm">{replyError || 'Could not open that request.'}</div>
                    ) : (
                      <>
                        <div className="space-y-3 mb-4 max-h-96 overflow-y-auto pr-1">
                          {thread.messages.map((m) => (
                            <div key={m.id} className={`flex ${m.isStaff ? 'justify-start' : 'justify-end'}`}>
                              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                                m.isStaff ? 'bg-gray-800 text-gray-100' : 'bg-blue-600 text-white'
                              }`}>
                                <p className="text-xs opacity-70 mb-1">
                                  {m.isStaff ? 'Nabri support' : 'You'} · {when(m.createdAt)}
                                </p>
                                <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                                {m.isResolution && (
                                  <p className="text-xs mt-2 pt-2 border-t border-white/20 opacity-80">
                                    Marked as the resolution
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {replyError && (
                          <div className="bg-red-900/20 border border-red-800 text-red-300 p-3 rounded-lg mb-3 text-sm">{replyError}</div>
                        )}

                        {thread.status === 'CLOSED' ? (
                          <p className="text-gray-500 text-sm text-center py-3">
                            This request is closed. Raise a new one if you still need help.
                          </p>
                        ) : (
                          <>
                            <form onSubmit={sendReply} className="flex gap-2">
                              <input
                                value={reply}
                                onChange={(e) => setReply(e.target.value)}
                                placeholder="Add a reply…"
                                aria-label="Your reply"
                                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white focus:border-blue-500 outline-none"
                              />
                              <button
                                type="submit"
                                disabled={sending || reply.trim().length < 2}
                                className="px-4 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg transition flex items-center gap-1.5"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            </form>
                            <button
                              onClick={() => closeTicket(thread.id)}
                              className="mt-3 w-full text-center text-sm text-gray-500 hover:text-gray-300 transition"
                            >
                              Close this request
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

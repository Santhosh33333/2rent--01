import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, LifeBuoy, Plus, MessageSquare, Send, X, Bot, ShieldCheck, Clock, CreditCard } from 'lucide-react'
import { getErrorMessage } from '../../lib/error'
import { isSignedIn } from '../../lib/auth'
import { AgentPanel } from '../../components/agent/AgentPanel'
import { supportApi, SUPPORT_CATEGORIES } from '../../lib/api'
import { supportTicketStatusLabel, supportStatusClass, supportPriorityClass } from '../../lib/supportFormat'

/**
 * Illustration for the assistant card.
 *
 * Hand-drawn SVG rather than a bitmap or a remote URL: an <img> pointing at
 * somewhere else is a broken image and a privacy leak the moment the host goes
 * away, and shipping a binary nobody can edit is worse than 40 lines of markup
 * that scales, themes with the rest of the page, and costs nothing.
 */
function SupportIllustration() {
  return (
    <svg viewBox="0 0 220 150" className="h-full w-full" role="img" aria-label="A support conversation between a person and an assistant">
      <defs>
        <linearGradient id="sup-orb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>

      {/* Assistant bubble */}
      <rect x="8" y="14" width="132" height="58" rx="14" fill="url(#sup-orb)" opacity="0.16" />
      <rect x="8" y="14" width="132" height="58" rx="14" fill="none" stroke="url(#sup-orb)" strokeWidth="1.5" />
      <circle cx="28" cy="34" r="9" fill="url(#sup-orb)" />
      <path d="M24 34h8M28 30v8" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="44" y="28" width="78" height="6" rx="3" fill="url(#sup-orb)" opacity="0.7" />
      <rect x="44" y="41" width="60" height="6" rx="3" fill="url(#sup-orb)" opacity="0.4" />
      <rect x="20" y="56" width="44" height="6" rx="3" fill="url(#sup-orb)" opacity="0.25" />

      {/* Person bubble */}
      <rect x="76" y="82" width="136" height="52" rx="14" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
      <circle cx="196" cy="108" r="13" fill="#374151" />
      <circle cx="196" cy="103" r="4.6" fill="#9ca3af" />
      <path d="M188.5 118c1.6-5 4-7.5 7.5-7.5s5.9 2.5 7.5 7.5z" fill="#9ca3af" />
      <rect x="90" y="96" width="72" height="6" rx="3" fill="#4b5563" />
      <rect x="90" y="109" width="52" height="6" rx="3" fill="#374151" />
    </svg>
  )
}

/** The questions the assistant is actually good at, so the entry is not a blank box. */
const ASSISTANT_STARTERS = [
  'Why is my top-up still pending?',
  'A booking I paid for has not started.',
  'How do I change or cancel a booking?',
  'Someone is messaging me and I am not comfortable.',
]

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

  // The assistant panel, opened from the card below. Mounted here rather than
  // relying on the global launcher because /support is routed outside <Layout>,
  // where AgentLauncher lives - so without this the only way to reach the
  // assistant from the support page was to navigate away from it.
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantPrompt, setAssistantPrompt] = useState<string | null>(null)

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

        {/*
          The assistant, ahead of the ticket form.

          Ordering is the design: most visits here are "why has my money not
          arrived", which is a question with an answer, not a ticket. Putting
          the assistant first means the common case never produces a support
          request, and the human path is still there for everything else.
        */}
        <section className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div className="hidden sm:block w-40 h-32 shrink-0">
              <SupportIllustration />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <Bot className="w-5 h-5 text-violet-400" />
                Ask Nabri Assistant
              </h2>
              <p className="text-gray-400 text-sm mt-1.5">
                Instant answers from your own account - wallet, bookings and payment status. It can
                only read your data, never spend it.
              </p>

              {isSignedIn() ? (
                <>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {ASSISTANT_STARTERS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => { setAssistantPrompt(q); setAssistantOpen(true) }}
                        className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-full px-3 py-1.5 transition"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAssistantOpen(true)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
                  >
                    <Bot className="w-4 h-4" /> Open the assistant
                  </button>
                </>
              ) : (
                <div className="mt-4 rounded-xl bg-gray-800/70 border border-gray-700 p-3.5">
                  <p className="text-sm text-gray-300">
                    The assistant answers from your account, so it needs you to be signed in.
                  </p>
                  <Link
                    to="/login"
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition"
                  >
                    Sign in to ask
                  </Link>
                  <p className="mt-2 text-xs text-gray-500">
                    No account? Send a request below and a human will read it.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/*
            Emergency and trust rows. A support page that offers only an AI
            would be the wrong advice for the two cases where a person is in
            trouble, so the human paths stay one glance away.
          */}
          <div className="grid gap-3 mt-5 pt-5 border-t border-gray-800 sm:grid-cols-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-gray-200">Someone is bothering you</p>
                <p className="text-xs text-gray-500 mt-0.5">Block, then report it to us.</p>
                <Link to="/messages" className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block">
                  Open messages
                </Link>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <CreditCard className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-gray-200">Money looks wrong</p>
                <p className="text-xs text-gray-500 mt-0.5">Send a request with the amount.</p>
                <button
                  type="button"
                  onClick={() => { setCategory('PAYMENTS'); setShowForm(true) }}
                  className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
                >
                  Report a payment
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-gray-200">How long a reply takes</p>
                <p className="text-xs text-gray-500 mt-0.5">Usually same day, Mon-Sat.</p>
              </div>
            </div>
          </div>
        </section>

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

      {/* Overlay variant: a sheet on small screens, docked right on desktop. It
          reports the prompt as consumed immediately, so picking a starter
          question sends it once rather than re-sending on every re-render. */}
      <AgentPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        pendingPrompt={assistantPrompt}
        onPromptConsumed={() => setAssistantPrompt(null)}
      />
    </div>
  )
}

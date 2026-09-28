import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Flag, MessageSquare, Send, UserCheck, X, FileDown } from 'lucide-react'
import { getErrorMessage } from '../../lib/error'
import { supportApi, type SupportPriority } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { exportTableToPdf } from '../../lib/pdfExport'
import {
  supportTicketStatusLabel,
  supportStatusClass,
  supportPriorityClass,
  supportCategoryLabel,
  allowedNextStatuses,
} from '../../lib/supportFormat'

interface QueueTicket {
  id: string
  reference: string
  category: string
  subject: string
  status: string
  priority: string
  createdAt: string
  lastRepliedAt: string | null
  firstResponseAt: string | null
  requester?: { id: string; fullName: string; email: string } | null
  assignedTo?: { id: string; fullName: string; email: string } | null
  _count?: { messages: number }
}

interface ThreadMessage {
  id: string
  body: string
  isStaff: boolean
  isResolution: boolean
  createdAt: string
  author?: { id: string; fullName: string } | null
}

interface Thread {
  id: string
  reference: string
  subject: string
  category: string
  status: string
  priority: string
  requester?: { id: string; fullName: string; email: string } | null
  assignedTo?: { id: string; fullName: string } | null
  messages: ThreadMessage[]
  events: { id: string; action: string; fromValue: string | null; toValue: string | null; createdAt: string }[]
}

const FILTERS = [
  ['ALL', 'All'],
  ['OPEN', 'Open'],
  ['IN_PROGRESS', 'In progress'],
  ['WAITING_ON_USER', 'Waiting on user'],
  ['RESOLVED', 'Resolved'],
  ['CLOSED', 'Closed'],
] as const

const PRIORITIES: SupportPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

function when(iso: string | null | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AdminSupportQueuePage() {
  const { user: currentAdmin } = useAuth()
  const [tickets, setTickets] = useState<QueueTicket[]>([])
  const [counts, setCounts] = useState<{ open: number; urgent: number; unassigned: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<string>('ALL')
  const [mineOnly, setMineOnly] = useState(false)

  const [openId, setOpenId] = useState<string | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [actionError, setActionError] = useState('')
  const [sending, setSending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await supportApi.queue({
        status: filter === 'ALL' ? undefined : filter,
        mine: mineOnly || undefined,
      })
      const d = res.data?.data ?? res.data
      setTickets(Array.isArray(d?.tickets) ? d.tickets : [])
      setCounts(d?.counts ?? null)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the support queue'))
    } finally {
      setLoading(false)
    }
  }, [filter, mineOnly])

  useEffect(() => {
    load()
  }, [load])

  const openThread = async (id: string) => {
    setOpenId(id)
    setThreadLoading(true)
    setThread(null)
    setReply('')
    setResolution('')
    setResolving(false)
    setActionError('')
    try {
      const res = await supportApi.myTicket(id)
      setThread(res.data?.data ?? null)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not open that ticket'))
    } finally {
      setThreadLoading(false)
    }
  }

  const refreshThread = async (id: string) => {
    const res = await supportApi.myTicket(id)
    setThread(res.data?.data ?? null)
    await load()
  }

  const sendReply = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread) return
    setActionError('')
    setSending(true)
    try {
      await supportApi.reply(thread.id, reply.trim())
      setReply('')
      await refreshThread(thread.id)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not send that reply'))
    } finally {
      setSending(false)
    }
  }

  const move = async (status: string) => {
    if (!thread) return
    setActionError('')
    try {
      await supportApi.updateStatus(thread.id, status)
      await refreshThread(thread.id)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, `Could not move this ticket to ${status}`))
    }
  }

  // Resolving always sends an explanation, because the server refuses to resolve
  // a ticket that has not actually been answered.
  const confirmResolve = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!thread) return
    if (resolution.trim().length < 2) {
      setActionError('Say what was done before resolving.')
      return
    }
    setActionError('')
    try {
      await supportApi.updateStatus(thread.id, 'RESOLVED', { resolution: resolution.trim() })
      setResolution('')
      setResolving(false)
      await refreshThread(thread.id)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not resolve this ticket'))
    }
  }

  const setPriority = async (id: string, priority: SupportPriority) => {
    setActionError('')
    try {
      await supportApi.setPriority(id, priority)
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, priority } : t)))
      if (openId === id && thread) setThread({ ...thread, priority })
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not change the priority'))
    }
  }

  const assignToMe = async (id: string, myId: string) => {
    setActionError('')
    try {
      await supportApi.assign(id, myId)
      await load()
      if (openId === id) await refreshThread(id)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not assign that ticket'))
    }
  }

  const unassign = async (id: string) => {
    setActionError('')
    try {
      await supportApi.assign(id, '')
      await load()
      if (openId === id) await refreshThread(id)
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Could not unassign that ticket'))
    }
  }

  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">Support desk</h1>
            <p className="text-gray-400 text-sm mt-1">
              {counts ? `${counts.open} open · ${counts.urgent} urgent · ${counts.unassigned} unassigned` : 'Loading counts…'}
            </p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Support tickets',
                columns: ['Reference', 'Subject', 'Category', 'Priority', 'Status', 'Requester', 'Created'],
                rows: tickets.map((t) => [
                  t.reference,
                  t.subject,
                  supportCategoryLabel(t.category),
                  t.priority,
                  supportTicketStatusLabel(t.status),
                  t.requester?.fullName || '-',
                  when(t.createdAt),
                ]),
                fileName: `nabri-support-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={tickets.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="flex gap-2 flex-wrap mb-6 items-center">
          {FILTERS.map(([s, label]) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === s ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              mineOnly ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
          >
            Mine only
          </button>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>
        )}
        {actionError && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-3 rounded-xl mb-4 text-sm">{actionError}</div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading the queue…</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-16 text-gray-500">Nothing in this view.</div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => (
              <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <button
                  onClick={() => (openId === t.id ? setOpenId(null) : openThread(t.id))}
                  className="w-full text-left p-4 hover:bg-gray-800/50 transition"
                >
                  <div className="flex items-start gap-3">
                    {t.priority === 'URGENT' ? (
                      <Flag className="w-4 h-4 text-red-400 mt-1 shrink-0" />
                    ) : (
                      <MessageSquare className="w-4 h-4 text-gray-500 mt-1 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium truncate">{t.subject}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${supportStatusClass(t.status)}`}>
                          {supportTicketStatusLabel(t.status)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${supportPriorityClass(t.priority)}`}>
                          {t.priority}
                        </span>
                        {t.category === 'SAFETY' && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-900/40 text-red-300">
                            Safety
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 text-xs mt-1.5">
                        <span className="font-mono">{t.reference}</span> · {supportCategoryLabel(t.category)} ·{' '}
                        {t.requester?.fullName || 'Unknown'} · {when(t.createdAt)} · {t._count?.messages ?? 0} messages
                        {t.assignedTo ? ` · assigned to ${t.assignedTo.fullName}` : ' · unassigned'}
                      </p>
                    </div>
                  </div>
                </button>

                {openId === t.id && (
                  <div className="border-t border-gray-800 p-4">
                    {threadLoading ? (
                      <div className="text-center py-8 text-gray-500 text-sm">Loading conversation…</div>
                    ) : !thread ? (
                      <div className="text-center py-8 text-red-400 text-sm">{actionError || 'Could not open that ticket.'}</div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 flex-wrap mb-4 text-xs">
                          <span className="text-gray-400">
                            Requester: <span className="text-gray-200">{thread.requester?.fullName}</span>{' '}
                            <span className="text-gray-500">({thread.requester?.email})</span>
                          </span>
                          {thread.assignedTo && (
                            <span className="inline-flex items-center gap-1 text-gray-400">
                              <UserCheck className="w-3.5 h-3.5" /> {thread.assignedTo.fullName}
                            </span>
                          )}
                        </div>

                        <div className="space-y-3 mb-4 max-h-96 overflow-y-auto pr-1">
                          {thread.messages.map((m) => (
                            <div key={m.id} className={`flex ${m.isStaff ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                                m.isStaff ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-100'
                              }`}>
                                <p className="text-xs opacity-70 mb-1">
                                  {m.isStaff ? 'Support' : m.author?.fullName || 'Requester'} · {when(m.createdAt)}
                                </p>
                                <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                                {m.isResolution && (
                                  <p className="text-xs mt-2 pt-2 border-t border-white/20 opacity-80">Resolution</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {thread.status === 'CLOSED' ? (
                          <p className="text-gray-500 text-sm text-center py-3">
                            Closed. Reopen it if the requester comes back with this unresolved.
                          </p>
                        ) : (
                          <form onSubmit={sendReply} className="flex gap-2 mb-3">
                            <input
                              value={reply}
                              onChange={(e) => setReply(e.target.value)}
                              placeholder="Reply to the requester…"
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
                        )}

                        <div className="flex flex-wrap gap-2 items-center pt-3 border-t border-gray-800">
                          {allowedNextStatuses(thread.status)
                            .filter((s) => s !== 'RESOLVED')
                            .map((s) => (
                              <button
                                key={s}
                                onClick={() => move(s)}
                                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs transition"
                              >
                                {supportTicketStatusLabel(s)}
                              </button>
                            ))}

                          {allowedNextStatuses(thread.status).includes('RESOLVED') && !resolving && (
                            <button
                              onClick={() => setResolving(true)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition"
                            >
                              Resolve…
                            </button>
                          )}

                          <select
                            value={thread.priority}
                            onChange={(e) => setPriority(thread.id, e.target.value as SupportPriority)}
                            aria-label="Priority"
                            className="px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs"
                          >
                            {PRIORITIES.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>

                          {thread.assignedTo ? (
                            <button
                              onClick={() => unassign(thread.id)}
                              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs inline-flex items-center gap-1 transition"
                            >
                              <X className="w-3 h-3" /> Unassign
                            </button>
                          ) : currentAdmin?.id ? (
                            <button
                              onClick={() => assignToMe(thread.id, currentAdmin.id)}
                              className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs inline-flex items-center gap-1 transition"
                            >
                              <UserCheck className="w-3 h-3" /> Assign to me
                            </button>
                          ) : null}
                        </div>

                        {resolving && (
                          <form onSubmit={confirmResolve} className="mt-3 bg-gray-800/60 border border-gray-700 rounded-xl p-3">
                            <label className="block text-xs text-gray-400 mb-1.5" htmlFor="resolution-note">
                              What was done? This is sent to the requester as the resolution.
                            </label>
                            <textarea
                              id="resolution-note"
                              value={resolution}
                              onChange={(e) => setResolution(e.target.value)}
                              rows={3}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm mb-3 focus:border-blue-500 outline-none resize-y"
                            />
                            <div className="flex gap-2">
                              <button
                                type="submit"
                                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition"
                              >
                                Mark resolved
                              </button>
                              <button
                                type="button"
                                onClick={() => setResolving(false)}
                                className="px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}

                        {thread.events.length > 0 && (
                          <details className="mt-3">
                            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                              Audit trail ({thread.events.length})
                            </summary>
                            <ul className="mt-2 space-y-1 text-xs text-gray-500">
                              {thread.events.map((ev) => (
                                <li key={ev.id} className="font-mono">
                                  {when(ev.createdAt)} · {ev.action}
                                  {ev.fromValue || ev.toValue ? ` · ${ev.fromValue ?? ''} → ${ev.toValue ?? ''}` : ''}
                                </li>
                              ))}
                            </ul>
                          </details>
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

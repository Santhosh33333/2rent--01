import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { AdminPageHeader, AdminShell } from '../../components/admin/AdminPageHeader'
import { ChevronLeft, ChevronRight, Download, Loader2, Mail, Inbox, Users, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminApi } from '../../lib/api'

/**
 * Replies to the three website enquiry forms (beta tester, app feedback,
 * investor/supporter).
 *
 * The same submissions still arrive by email through formsubmit.co - this
 * screen reads the mirrored copy, which is what makes them listable. The two
 * actions at the top are the point of the screen: one sheet, one row per
 * reply, either downloaded or mailed to the founder.
 */
interface FormReply {
  id: string
  form: string
  subject: string
  name: string | null
  email: string
  fields: Record<string, string> | null
  createdAt: string
  /** When the beta invitation was emailed; null/absent for non-beta forms. */
  invitedAt: string | null
}

interface Stats {
  total: number
  byForm: Array<{ form: string; count: number }>
}

const FORM_BADGE: Record<string, string> = {
  'Beta tester': 'bg-indigo-900/40 text-indigo-300',
  'App feedback': 'bg-emerald-900/40 text-emerald-300',
  'Investor or supporter': 'bg-amber-900/40 text-amber-300',
}

export function AdminFormRepliesPage() {
  const [items, setItems] = useState<FormReply[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<'export' | 'email' | 'testers' | 'invites' | null>(null)
  const [testerCount, setTesterCount] = useState<number | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, unknown> = { page, limit: 50 }
      if (filter) params.form = filter
      const res = await adminApi.getFormReplies(params as never)
      const body = res.data ?? {}
      const list = Array.isArray(body.data) ? body.data : []
      setItems(list)
      const meta = body.meta
      setTotal(meta?.total ?? list.length)
      setTotalPages(meta?.totalPages ?? 1)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load replies'))
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const res = await adminApi.getFormReplyStats()
      const d = res.data?.data || res.data
      if (d && typeof d.total === 'number') setStats(d as Stats)
    } catch {
      // Stats are a header nicety; a failure here must not hide the replies.
    }
  }

  const loadTesters = async () => {
    try {
      const res = await adminApi.getBetaTesters()
      const d = res.data?.data || res.data
      if (d && typeof d.count === 'number') setTesterCount(d.count)
    } catch {
      // Count is a header nicety; the export still works without it.
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filter])

  useEffect(() => {
    void loadStats()
    void loadTesters()
  }, [])

  const downloadSheet = async () => {
    setBusy('export')
    try {
      const res = await adminApi.exportFormReplies()
      const blob = new Blob([res.data as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filenameFrom(res as never) || `nabri-form-replies-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Spreadsheet downloaded.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not build the spreadsheet'))
    } finally {
      setBusy(null)
    }
  }

  const emailSheet = async () => {
    setBusy('email')
    try {
      const res = await adminApi.emailFormReplies()
      const d = res.data?.data
      toast.success(d?.to ? `Sheet sent to ${d.to} (${d.rows} rows).` : 'Sheet emailed.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not email the spreadsheet'))
    } finally {
      setBusy(null)
    }
  }

  const downloadTesters = async () => {
    setBusy('testers')
    try {
      const res = await adminApi.exportBetaTesters()
      const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `nabri-beta-testers-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Tester list downloaded — import it into Google Play.')
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not export the tester list'))
    } finally {
      setBusy(null)
    }
  }

  const emailBetaInvites = async () => {
    const count = testerCount !== null ? testerCount : 'all'
    if (!window.confirm(
      `Send the beta invitation email to ${count} beta tester(s) who have not received it yet?\n\n` +
      'Existing (old) and newly signed-up beta testers are included; anyone already invited is skipped. ' +
      'This runs from the server and mails real people, so it cannot be undone.',
    )) return
    setBusy('invites')
    try {
      const res = await adminApi.sendBetaInvites()
      const d = res.data?.data || res.data
      if (d) {
        toast.success(
          `Beta invites: ${d.sent} sent` +
          (d.failed ? `, ${d.failed} failed` : '') +
          (d.alreadyInvited ? `, ${d.alreadyInvited} already invited` : '') +
          '.',
        )
      } else {
        toast.success('Beta invites sent.')
      }
      void loadTesters()
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not send beta invites'))
    } finally {
      setBusy(null)
    }
  }

  const filters = ['', ...(stats?.byForm.map((entry) => entry.form) ?? [])]

  return (
    <AdminShell width="max-w-5xl">
      <AdminPageHeader
        title="Form Replies"
        subtitle="Beta tester, app feedback and investor enquiries from the website"
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {filters.map((form) => (
            <button
              key={form || 'ALL'}
              onClick={() => {
                setFilter(form)
                setPage(1)
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === form ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {form || 'All'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void downloadTesters()}
            disabled={busy !== null || (testerCount ?? 0) === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition"
            title="Deduplicated beta-tester emails, ready to import into the Google Play closed test"
          >
            {busy === 'testers' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Tester emails{testerCount !== null ? ` (${testerCount})` : ''}
          </button>
          <button
            onClick={() => void emailBetaInvites()}
            disabled={busy !== null || (testerCount ?? 0) === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition"
            title="Email the beta invitation (join group → become tester → install) to every beta tester not yet invited. Sends from the server."
          >
            {busy === 'invites' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Email beta invites
          </button>
          <button
            onClick={() => void downloadSheet()}
            disabled={busy !== null || total === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition"
          >
            {busy === 'export' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download Excel
          </button>
          <button
            onClick={() => void emailSheet()}
            disabled={busy !== null || total === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition"
            title="Sends the sheet as an .xlsx attachment to your admin email"
          >
            {busy === 'email' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Email me the sheet
          </button>
        </div>
      </div>

      {stats && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-xs uppercase tracking-wide">Total replies</p>
            <p className="text-white text-2xl font-semibold mt-1">{stats.total}</p>
          </div>
          {stats.byForm.slice(0, 3).map((entry) => (
            <div key={entry.form} className="bg-gray-800 rounded-xl p-4">
              <p className="text-gray-400 text-xs uppercase tracking-wide truncate">{entry.form}</p>
              <p className="text-white text-2xl font-semibold mt-1">{entry.count}</p>
            </div>
          ))}
        </div>
      )}

      {error && <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>}

      {loading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
          <p className="text-gray-400 mt-4">Loading replies...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <Inbox className="w-8 h-8 text-gray-600 mx-auto" />
          <p className="text-gray-400 mt-3">No replies yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Replies start appearing the first time someone submits a form on the website.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((reply) => {
            const fields = (reply.fields ?? {}) as Record<string, string>
            return (
              <div key={reply.id} className="bg-gray-800 p-4 rounded-xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${FORM_BADGE[reply.form] || 'bg-gray-700 text-gray-300'}`}>
                    {reply.form}
                  </span>
                  {reply.form.trim().toLowerCase() === 'beta tester' && (
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        reply.invitedAt ? 'bg-emerald-900/40 text-emerald-300' : 'bg-amber-900/40 text-amber-300'
                      }`}
                      title={reply.invitedAt ? `Invited ${new Date(reply.invitedAt).toLocaleString('en-IN')}` : 'Invitation not sent yet'}
                    >
                      {reply.invitedAt ? 'Invited' : 'Not invited'}
                    </span>
                  )}
                  <p className="text-white text-sm font-medium">{reply.name || reply.email}</p>
                  <a href={`mailto:${reply.email}`} className="text-blue-400 text-xs hover:underline">
                    {reply.email}
                  </a>
                  <span className="ml-auto text-gray-500 text-xs">
                    {new Date(reply.createdAt).toLocaleString('en-IN')}
                  </span>
                </div>

                {Object.keys(fields).length > 0 && (
                  <dl className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                    {Object.entries(fields).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <dt className="text-gray-500 text-[11px] uppercase tracking-wide">{key}</dt>
                        <dd className="text-gray-200 text-sm break-words whitespace-pre-wrap">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-gray-500 text-sm">
            {total} reply(ies) · page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-2 rounded-lg bg-gray-800 text-gray-300 disabled:opacity-40 hover:bg-gray-700 transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

/** The server names the file; fall back to a local name if the header is absent. */
function filenameFrom(response: { headers?: Record<string, string> }): string {
  const header = response.headers?.['content-disposition'] ?? ''
  const match = /filename=([^;]+)/i.exec(header)
  return match ? match[1].replace(/"/g, '').trim() : ''
}

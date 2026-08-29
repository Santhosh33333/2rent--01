import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, ShieldAlert, Check } from 'lucide-react'
import { adminApi } from '../../lib/api'

interface ChatReportRow {
  id: string
  reporterName: string
  reason: string
  description?: string
  status: string
  conversationId?: string
  createdAt: string
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-900/30 text-amber-400',
    REVIEWED: 'bg-sky-900/30 text-sky-400',
    ACTIONED: 'bg-emerald-900/30 text-emerald-400',
    DISMISSED: 'bg-gray-700 text-gray-400',
  }
  return map[status] || 'bg-gray-700 text-gray-400'
}

export function AdminChatReportsPage() {
  const [items, setItems] = useState<ChatReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchReports = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter
      const res = await adminApi.getChatReports(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : []
      setItems(
        raw.map((r: any) => ({
          id: r.id,
          reporterName: r.reporter?.fullName || 'Unknown',
          reason: r.reason,
          description: r.description,
          status: r.status,
          conversationId: r.conversationId,
          createdAt: r.createdAt,
        })),
      )
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load chat reports'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter])

  const handleResolve = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.resolveChatReport(id)
      setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'REVIEWED' } : r)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to resolve report'))
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Chat Reports</h1>
            <p className="text-gray-400 text-sm mt-1">Messaging safety reports &amp; moderation</p>
          </div>
        </div>

        <div className="mb-6">
          <div className="flex gap-2">
            {[['ALL', 'All'], ['PENDING', 'Pending'], ['REVIEWED', 'Reviewed'], ['ACTIONED', 'Actioned'], ['DISMISSED', 'Dismissed']].map(([s, label]) => (
              <button
                key={s}
                onClick={() => {
                  setStatusFilter(s)
                  setPage(1)
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  statusFilter === s ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading chat reports...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20">
            <ShieldAlert className="w-8 h-8 text-gray-600 mx-auto" />
            <p className="text-gray-400 mt-3">No chat reports found</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {items.map((r) => (
                <div key={r.id} className="bg-gray-800 p-4 rounded-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(r.status)}`}>{r.status}</span>
                        <p className="text-white text-sm font-medium">{r.reason}</p>
                      </div>
                      <p className="text-gray-400 text-xs mt-1">Reported by {r.reporterName}</p>
                      {r.description && <p className="text-gray-300 text-sm mt-2">{r.description}</p>}
                      {r.conversationId && (
                        <p className="text-gray-600 text-[10px] font-mono mt-1">conversation: {r.conversationId.slice(0, 8)}</p>
                      )}
                      <p className="text-gray-500 text-xs mt-1">
                        {r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '-'}
                      </p>
                    </div>
                    {r.status === 'PENDING' && (
                      <button
                        onClick={() => handleResolve(r.id)}
                        disabled={actionLoading === r.id}
                        className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-400 rounded-lg transition"
                        title="Mark reviewed"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-gray-500 text-sm">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-white transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-white transition"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

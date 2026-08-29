import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Radio, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface DispatchRow {
  id: string
  userName: string
  partnerName?: string
  serviceType: string
  status: string
  offersSent: number
  createdAt: string
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    PARTNER_SEARCHING: 'bg-sky-900/30 text-sky-400',
    PARTNER_ACCEPTED: 'bg-indigo-900/30 text-indigo-400',
    OTP_GENERATED: 'bg-violet-900/30 text-violet-400',
    IN_PROGRESS: 'bg-amber-900/30 text-amber-400',
  }
  return map[status] || 'bg-gray-700 text-gray-400'
}

export function AdminDispatchPage() {
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [auto, setAuto] = useState(true)

  const fetchBoard = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.getDispatchBoard({ page })
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.bookings) ? d.bookings : Array.isArray(d) ? d : []
      setRows(
        raw.map((b: any) => ({
          id: b.id,
          userName: b.user?.fullName || 'Unknown',
          partnerName: b.partner?.user?.fullName || null,
          serviceType: b.serviceType || '—',
          status: b.status,
          offersSent: b._count?.dispatchRequests ?? 0,
          createdAt: b.createdAt,
        })),
      )
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 50)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load dispatch board'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(fetchBoard, 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, page])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Dispatch Monitor</h1>
            <p className="text-gray-400 text-sm mt-1">Live view of bookings in the assignment lifecycle</p>
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-blue-500" />
            Auto-refresh (5s)
          </label>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Dispatch Board',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['User', 'Partner', 'Service', 'Status', 'Offers', 'Created'],
                rows: rows.map((r) => [
                  r.userName || '-',
                  r.partnerName || '(unassigned)',
                  r.serviceType || '-',
                  r.status || '-',
                  String(r.offersSent),
                  r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '-',
                ]),
                fileName: `rentbuddy-dispatch-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        {error && <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading dispatch board...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-20">
            <Radio className="w-8 h-8 text-gray-600 mx-auto" />
            <p className="text-gray-400 mt-3">No active dispatches right now</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">User</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Assigned Partner</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Service</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Offers</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3 text-white text-sm font-medium">{r.userName}</td>
                        <td className="px-4 py-3 text-gray-300 text-sm">
                          {r.partnerName ? r.partnerName : <span className="text-amber-400 text-xs">awaiting partner</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{r.serviceType}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(r.status)}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-sm">{r.offersSent}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, CheckCircle, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface Report {
  id: string
  reporterName: string
  reporterId: string
  targetName: string
  targetId: string
  reason: string
  description?: string
  status: string
  createdAt: string
}

export function AdminReportsPage() {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchReports = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter
      const res = await adminApi.getReports(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.reports) ? d.reports : Array.isArray(d) ? d : []
      setReports(raw.map((r: any) => ({
        id: r.id,
        reporterName: r.reporter?.fullName || r.reporterName || 'Unknown',
        reporterId: r.reporterId || r.reporter?.id || '',
        targetName: r.target?.fullName || r.targetName || 'Unknown',
        targetId: r.targetId || r.target?.id || '',
        reason: r.reason,
        description: r.description,
        status: r.status,
        createdAt: r.createdAt,
      })))
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load reports'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [page, statusFilter])

  const handleResolve = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.resolveReport(id)
      setReports((prev) => prev.map((r) => r.id === id ? { ...r, status: 'RESOLVED' } : r))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to resolve report'))
    } finally {
      setActionLoading(null)
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-900/30 text-amber-400',
      RESOLVED: 'bg-emerald-900/30 text-emerald-400',
      DISMISSED: 'bg-gray-700 text-gray-400',
    }
    return map[status] || 'bg-gray-700 text-gray-400'
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-gray-400 text-sm mt-1">Review user reports</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'User Reports',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['Reporter', 'Target', 'Reason', 'Description', 'Status', 'Date'],
                rows: reports.map((r) => [
                  r.reporterName || '-',
                  r.targetName || '-',
                  r.reason || '-',
                  r.description || '-',
                  r.status || '-',
                  r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '-',
                ]),
                fileName: `rentbuddy-reports-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={reports.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6">
          <div className="flex gap-2">
            {[['ALL', 'All'], ['PENDING', 'Pending'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']].map(([s, label]) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  statusFilter === s
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No reports found</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {reports.map((report) => (
                <div key={report.id} className="bg-gray-800 rounded-xl p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full bg-red-900/30 flex items-center justify-center text-xs font-bold text-red-400">
                          {report.reporterName?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{report.reporterName || 'Unknown'}</p>
                          <p className="text-gray-500 text-xs">reported</p>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300">
                          {report.targetName?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-white text-sm font-medium">{report.targetName || 'Unknown'}</p>
                          <p className="text-gray-500 text-xs">target</p>
                        </div>
                      </div>
                      <div className="mt-2">
                        <p className="text-blue-400 text-xs font-medium">{report.reason}</p>
                        {report.description && (
                          <p className="text-gray-400 text-sm mt-1">{report.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(report.status)}`}>
                        {report.status}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {report.createdAt ? new Date(report.createdAt).toLocaleDateString('en-IN') : '-'}
                      </span>
                      {report.status === 'PENDING' && (
                        <button
                          onClick={() => handleResolve(report.id)}
                          disabled={actionLoading === report.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-400 text-xs font-medium rounded-lg transition"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          {actionLoading === report.id ? 'Resolving...' : 'Resolve'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-gray-500 text-sm">Page {page} of {totalPages}</p>
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
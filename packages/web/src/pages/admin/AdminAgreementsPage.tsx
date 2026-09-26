import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, FileDown, FileText, Search, Eye, X } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'
import toast from 'react-hot-toast'

interface Agreement {
  id: string
  kind: 'USER' | 'PARTNER'
  title: string
  status: string
  contentHtml?: string
  sentAt?: string | null
  acceptedAt?: string | null
  createdAt: string
  user?: { id: string; fullName?: string; email?: string; phone?: string }
}

function statusBadge(status: string): string {
  if (status === 'ACCEPTED') return 'bg-emerald-500/20 text-emerald-400'
  if (status === 'SENT') return 'bg-blue-500/20 text-blue-400'
  return 'bg-amber-500/20 text-amber-400'
}

export function AdminAgreementsPage() {
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [kindFilter, setKindFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<Agreement | null>(null)

  const fetchAgreements = async () => {
    setLoading(true)
    setError('')
    try {
      const params: Record<string, unknown> = { page }
      if (statusFilter !== 'ALL') params.status = statusFilter
      if (kindFilter !== 'ALL') params.kind = kindFilter
      if (search.trim()) params.search = search.trim()
      const res = await adminApi.getAgreements(params as any)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.agreements) ? d.agreements : Array.isArray(d) ? d : []
      setAgreements(raw.map((a: any) => ({
        id: a.id,
        kind: a.kind,
        title: a.title,
        status: a.status,
        contentHtml: a.contentHtml,
        sentAt: a.sentAt,
        acceptedAt: a.acceptedAt,
        createdAt: a.createdAt,
        user: a.user,
      })))
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load agreements'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAgreements()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, kindFilter])

  const openDetail = async (ag: Agreement) => {
    if (ag.contentHtml) {
      setViewing(ag)
      return
    }
    setViewing(ag)
    try {
      const res = await adminApi.getAgreement(ag.id)
      const d = res.data?.data?.agreement || res.data?.agreement
      if (d) setViewing({ ...ag, contentHtml: d.contentHtml })
    } catch {
      toast.error('Could not load full agreement text')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link to="/admin/dashboard" className="text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">Agreements</h1>
            <p className="text-gray-400 text-sm mt-1">Post-KYC legal agreement archive</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Agreement Register',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['User', 'Email', 'Type', 'Title', 'Status', 'Issued', 'Accepted'],
                rows: agreements.map((a) => [
                  a.user?.fullName || '-',
                  a.user?.email || '-',
                  a.kind === 'PARTNER' ? 'Partner' : 'Member',
                  a.title || '-',
                  a.status || '-',
                  a.sentAt || a.createdAt ? new Date(a.sentAt || a.createdAt).toLocaleString('en-IN') : '-',
                  a.acceptedAt ? new Date(a.acceptedAt).toLocaleString('en-IN') : 'Not accepted',
                ]),
                fileName: `nabri-agreements-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={agreements.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {[['ALL', 'All'], ['ACCEPTED', 'Accepted'], ['SENT', 'Sent'], ['PENDING', 'Pending']].map(([s, label]) => (
              <button
                key={s}
                onClick={() => { setStatusFilter(s); setPage(1) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  statusFilter === s ? 'bg-blue-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {[['ALL', 'Member + Partner'], ['USER', 'Member'], ['PARTNER', 'Partner']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setKindFilter(k); setPage(1) }}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                  kindFilter === k ? 'bg-sky-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <form
            className="relative ml-auto"
            onSubmit={(e) => { e.preventDefault(); setPage(1); fetchAgreements() }}
          >
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or email"
              className="pl-9 pr-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-56"
            />
          </form>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading agreements...</p>
          </div>
        ) : agreements.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No agreements found</p>
            <p className="text-gray-500 text-xs mt-2">Agreements are issued automatically when a KYC is approved.</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">User</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Type</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Agreement</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Issued</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Accepted</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agreements.map((a) => (
                      <tr key={a.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-white text-sm font-medium">{a.user?.fullName || 'Unknown'}</p>
                          {a.user?.email && <p className="text-gray-500 text-xs">{a.user.email}</p>}
                          {a.user?.phone && (
                            <a href={`tel:${a.user.phone}`} className="text-gray-500 text-xs hover:text-sky-400">
                              {a.user.phone}
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${a.kind === 'PARTNER' ? 'bg-purple-500/20 text-purple-400' : 'bg-sky-500/20 text-sky-400'}`}>
                            {a.kind === 'PARTNER' ? 'Partner' : 'Member'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-200 text-sm max-w-xs truncate">{a.title}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(a.status)}`}>{a.status}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-400 text-xs">{a.sentAt ? new Date(a.sentAt).toLocaleDateString('en-IN') : '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-400 text-xs">{a.acceptedAt ? new Date(a.acceptedAt).toLocaleDateString('en-IN') : '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openDetail(a)}
                            className="p-1.5 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition"
                            title="View agreement text"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setViewing(null)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 p-4 border-b border-gray-700">
              <FileText className="w-5 h-5 text-sky-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="text-white font-semibold truncate">{viewing.title}</h2>
                <p className="text-gray-400 text-xs">
                  {viewing.user?.fullName} {viewing.user?.email ? `· ${viewing.user.email}` : ''} · {viewing.status}
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="text-gray-400 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {viewing.contentHtml ? (
                <div
                  className="text-sm leading-relaxed text-gray-200 [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2 [&_p]:mb-3 [&_li]:mb-1 [&_table]:w-full [&_td]:py-1.5 [&_td]:border-b [&_td]:border-gray-700"
                  dangerouslySetInnerHTML={{ __html: viewing.contentHtml }}
                />
              ) : (
                <p className="text-gray-400 text-sm">Full text not available in this list payload.</p>
              )}
            </div>
            <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
              Issued {viewing.sentAt ? new Date(viewing.sentAt).toLocaleString('en-IN') : '-'} · Accepted{' '}
              {viewing.acceptedAt ? new Date(viewing.acceptedAt).toLocaleString('en-IN') : 'not yet'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
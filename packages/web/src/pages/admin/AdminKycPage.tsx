import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Check, X, Phone, Mail, ShieldCheck, AlertTriangle, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'
import { AuthImage } from '../../components/AuthImage'

interface KycUser {
  id: string
  fullName: string
  email: string
  phone: string | null
  avatarUrl?: string | null
}

interface KycEntry {
  id: string
  userId: string
  status: string
  selfieUrl?: string | null
  govIdUrl?: string | null
  govIdType?: string | null
  addressProofUrl?: string | null
  rejectionReason?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emergencyContactRelation?: string | null
  createdAt: string
  updatedAt: string
  user: KycUser
}

// Statuses an admin can act on (mirrors backend REVIEWABLE list)
const ACTIONABLE = new Set(['SUBMITTED', 'PENDING_REVIEW', 'UNDER_VERIFICATION', 'RESUBMIT_REQUIRED'])

const FILTERS = [
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'UNDER_VERIFICATION', label: 'Under Review' },
  { key: 'RESUBMIT_REQUIRED', label: 'Resubmit' },
  { key: 'VERIFIED', label: 'Verified' },
  { key: 'REJECTED', label: 'Rejected' },
]

const PAGE_LIMIT = 20

// One KYC document preview â€” click opens the full-screen viewer.
function DocCard({ label, url, onOpen }: { label: string; url?: string | null; onOpen: () => void }) {
  return (
    <div>
      <p className="text-gray-400 text-xs font-medium mb-2">{label}</p>
      {url ? (
        <button type="button" onClick={onOpen} className="block w-full group relative" title="Click to view full size">
          <AuthImage
            url={url}
            alt={label}
            className="w-full h-64 object-contain rounded-lg bg-gray-900 border border-gray-700 group-hover:border-blue-500 transition"
          />
          <span className="absolute bottom-2 right-2 text-[10px] px-2 py-1 rounded bg-black/70 text-gray-300 opacity-0 group-hover:opacity-100 transition pointer-events-none">
            View full size
          </span>
        </button>
      ) : (
        <div className="w-full h-64 rounded-lg bg-gray-900 flex items-center justify-center text-gray-600 text-xs">Not uploaded</div>
      )}
    </div>
  )
}

export function AdminKycPage() {
  const [entries, setEntries] = useState<KycEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState('SUBMITTED')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ url: string; label: string } | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  const fetchKyc = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await adminApi.getKycQueue({ page, limit: PAGE_LIMIT, status: statusFilter })
      const d = res.data?.data || res.data
      setEntries(Array.isArray(d?.items) ? d.items : [])
      setTotal(Number(d?.total) || 0)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load KYC queue'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKyc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.approveKyc(id)
      // Refresh so the reviewed entry leaves the list and the next one moves up
      await fetchKyc()
      setExpandedId(null)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to approve'))
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return
    setActionLoading(id)
    try {
      await adminApi.rejectKyc(id, { reason: rejectReason })
      setRejectId(null)
      setRejectReason('')
      await fetchKyc()
      setExpandedId(null)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to reject'))
      setActionLoading(null)
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      SUBMITTED: 'bg-amber-900/30 text-amber-400',
      PENDING_REVIEW: 'bg-amber-900/30 text-amber-400',
      UNDER_VERIFICATION: 'bg-blue-900/30 text-blue-400',
      RESUBMIT_REQUIRED: 'bg-purple-900/30 text-purple-400',
      VERIFIED: 'bg-emerald-900/30 text-emerald-400',
      REJECTED: 'bg-red-900/30 text-red-400',
    }
    return map[status] || 'bg-gray-700 text-gray-400'
  }

  const downloadPdf = () => {
    exportTableToPdf({
      title: 'KYC Verification Queue',
      subtitle: `Filter: ${statusFilter} Â· ${total} submission(s)`,
      columns: ['Applicant', 'Email', 'Phone', 'Status', 'ID Type', 'Emergency Contact', 'Updated'],
      rows: entries.map((e) => [
        e.user?.fullName || '-',
        e.user?.email || '-',
        e.user?.phone || '-',
        e.status,
        e.govIdType || '-',
        [e.emergencyContactName, e.emergencyContactPhone].filter(Boolean).join(' Â· ') || '-',
        e.updatedAt ? new Date(e.updatedAt).toLocaleString('en-IN') : '-',
      ]),
      fileName: `rentbuddy-kyc-${statusFilter.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">KYC Verification</h1>
            <p className="text-gray-400 text-sm mt-1">Review identity documents submitted by users</p>
          </div>
          <button
            onClick={downloadPdf}
            disabled={entries.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setStatusFilter(f.key); setPage(1) }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                  statusFilter === f.key
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {f.label}
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
            <p className="text-gray-400 mt-4">Loading KYC queue...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <ShieldCheck className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400">No KYC submissions in this state</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {entries.map((entry) => {
                const actionable = ACTIONABLE.has(entry.status)
                return (
                  <div key={entry.id} className="bg-gray-800 rounded-xl overflow-hidden">
                    <div
                      className="p-4 hover:bg-gray-750 cursor-pointer transition"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-white overflow-hidden">
                            {entry.user?.avatarUrl ? (
                              <img src={entry.user.avatarUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              entry.user?.fullName?.charAt(0)?.toUpperCase() || '?'
                            )}
                          </div>
                          <div>
                            <p className="text-white font-medium text-sm">{entry.user?.fullName || 'Unknown'}</p>
                            <p className="text-gray-500 text-xs">{entry.user?.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-gray-500 text-xs hidden sm:block">
                            {entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString('en-IN') : '-'}
                          </span>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(entry.status)}`}>
                            {entry.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    </div>

                    {expandedId === entry.id && (
                      <div className="p-4 border-t border-gray-700/50">
                        {/* Full applicant data */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4 bg-gray-900/50 p-3 rounded-lg">
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <Mail className="w-4 h-4 text-gray-500 flex-shrink-0" /> {entry.user?.email || '-'}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-300">
                            <Phone className="w-4 h-4 text-gray-500 flex-shrink-0" /> {entry.user?.phone || 'Not provided'}
                          </div>
                          <div className="text-sm text-gray-400">
                            Emergency contact: <span className="text-gray-300">{entry.emergencyContactName || '-'}</span>
                            {entry.emergencyContactPhone ? ` Â· ${entry.emergencyContactPhone}` : ''}
                            {entry.emergencyContactRelation ? ` (${entry.emergencyContactRelation})` : ''}
                          </div>
                          <div className="text-sm text-gray-400">
                            ID type: <span className="text-gray-300">{entry.govIdType || '-'}</span>
                          </div>
                          <div className="text-sm text-gray-400">
                            Submitted: {entry.createdAt ? new Date(entry.createdAt).toLocaleString('en-IN') : '-'}
                          </div>
                          <div className="text-sm text-gray-400">
                            Last update: {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('en-IN') : '-'}
                          </div>
                          <div className="text-xs text-gray-500 sm:col-span-2 break-all">
                            User ID: <span className="font-mono">{entry.userId}</span> Â· Submission ID:{' '}
                            <span className="font-mono">{entry.id}</span>
                          </div>
                        </div>

                        {entry.rejectionReason && (
                          <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/60 text-red-300 text-sm p-3 rounded-lg mb-4">
                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            Previous rejection reason: {entry.rejectionReason}
                          </div>
                        )}

                        {/* Documents â€” click any card for the full-size viewer */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                          <DocCard
                            label={`Government ID${entry.govIdType ? ` (${entry.govIdType})` : ''}`}
                            url={entry.govIdUrl}
                            onOpen={() => entry.govIdUrl && setPreviewDoc({ url: entry.govIdUrl, label: 'Government ID' })}
                          />
                          <DocCard label="Selfie" url={entry.selfieUrl} onOpen={() => entry.selfieUrl && setPreviewDoc({ url: entry.selfieUrl, label: 'Selfie' })} />
                          <DocCard
                            label="Address Proof"
                            url={entry.addressProofUrl}
                            onOpen={() => entry.addressProofUrl && setPreviewDoc({ url: entry.addressProofUrl, label: 'Address Proof' })}
                          />
                        </div>

                        {actionable && (
                          <>
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleApprove(entry.id) }}
                                disabled={actionLoading === entry.id}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                              >
                                <Check className="w-4 h-4" />
                                {actionLoading === entry.id ? 'Processing...' : 'Approve'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setRejectId(rejectId === entry.id ? null : entry.id) }}
                                disabled={actionLoading === entry.id}
                                className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                              >
                                <X className="w-4 h-4" />
                                Reject
                              </button>
                            </div>

                            {rejectId === entry.id && (
                              <div className="mt-3 flex gap-2">
                                <input
                                  type="text"
                                  placeholder="Rejection reason..."
                                  value={rejectReason}
                                  onChange={(e) => setRejectReason(e.target.value)}
                                  className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-red-500"
                                  autoFocus
                                />
                                <button
                                  onClick={() => handleReject(entry.id)}
                                  disabled={!rejectReason.trim() || actionLoading === entry.id}
                                  className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                                >
                                  Confirm
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between mt-4">
              <p className="text-gray-500 text-sm">{total} submission{total === 1 ? '' : 's'} Â· Page {page} of {totalPages}</p>
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

      {/* Full-screen document viewer */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-6"
          onClick={() => setPreviewDoc(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-lg bg-gray-800 text-gray-300 hover:text-white transition"
            onClick={() => setPreviewDoc(null)}
          >
            <X className="w-5 h-5" />
          </button>
          <p className="text-gray-300 text-sm mb-3">{previewDoc.label}</p>
          <AuthImage url={previewDoc.url} alt={previewDoc.label} className="max-h-[80vh] max-w-full object-contain rounded-lg" />
          <p className="text-gray-600 text-xs mt-3">Click anywhere to close</p>
        </div>
      )}
    </div>
  )
}
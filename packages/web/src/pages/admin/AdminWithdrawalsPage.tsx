import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Check, X, FileDown, ImagePlus, Loader2 } from 'lucide-react'
import { adminApi, assetUrl } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'
import toast from 'react-hot-toast'

interface Withdrawal {
  id: string
  userId: string
  userName: string
  userEmail?: string
  amount: number | string
  status: string
  method?: string
  accountDetail?: string
  payoutProofImageUrl?: string | null
  createdAt: string
}

export function AdminWithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
const [statusFilter, setStatusFilter] = useState('PENDING')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<Record<string, File>>({})

  const fetchWithdrawals = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter
      const res = await adminApi.getWithdrawals(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.withdrawals) ? d.withdrawals : Array.isArray(d) ? d : []
      setWithdrawals(raw.map((w: any) => ({
        id: w.id,
        userId: w.userId,
        userName: w.user?.fullName || w.userName || 'Unknown',
        userEmail: w.user?.email || '',
        amount: w.amount,
        status: w.status,
        method: w.method || '',
accountDetail: w.accountDetail || w.upiId || w.bankAccount || '',
        payoutProofImageUrl: w.payoutProofImageUrl || null,
        createdAt: w.createdAt,
      })))
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load withdrawals'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWithdrawals()
  }, [page, statusFilter])

const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.approveWithdrawal(id)
      setWithdrawals((prev) => prev.map((w) => w.id === id ? { ...w, status: 'APPROVED' } : w))
      toast('Withdrawal approved.')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to approve withdrawal'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleApproveWithProof = async (id: string) => {
    const proof = proofFile[id]
    if (!proof) {
      setError('Attach a payout proof screenshot before marking as paid.')
      return
    }
    setActionLoading(id)
    try {
      const res = await adminApi.approveWithdrawalWithProof(id, proof)
      const d = res.data?.data || res.data
      setWithdrawals((prev) => prev.map((w) => w.id === id ? { ...w, status: 'APPROVED', payoutProofImageUrl: d?.payoutProofImageUrl || null } : w))
      setProofFile((f) => { const c = { ...f }; delete c[id]; return c })
      toast('Withdrawal marked as paid with proof.')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to approve withdrawal'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.rejectWithdrawal(id, 'Rejected by admin')
      setWithdrawals((prev) => prev.map((w) => w.id === id ? { ...w, status: 'REJECTED' } : w))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to reject withdrawal'))
    } finally {
      setActionLoading(null)
    }
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      PENDING: 'bg-amber-900/30 text-amber-400',
      APPROVED: 'bg-emerald-900/30 text-emerald-400',
      REJECTED: 'bg-red-900/30 text-red-400',
      COMPLETED: 'bg-emerald-900/30 text-emerald-400',
    }
    return map[status] || 'bg-gray-700 text-gray-400'
  }

  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold font-display text-white">Withdrawals</h1>
            <p className="text-gray-400 text-sm mt-1">Review withdrawal requests</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Withdrawal Requests',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['User', 'Email', 'Amount', 'Method', 'Account', 'Status', 'Requested'],
                rows: withdrawals.map((w) => [
                  w.userName || '-',
                  w.userEmail || '-',
                  `₹${w.amount}`,
                  w.method || '-',
                  w.accountDetail || '-',
                  w.status || '-',
                  w.createdAt ? new Date(w.createdAt).toLocaleString('en-IN') : '-',
                ]),
                fileName: `nabri-withdrawals-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={withdrawals.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6">
          <div className="flex gap-2">
            {[['ALL', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['COMPLETED', 'Completed']].map(([s, label]) => (
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
            <p className="text-gray-400 mt-4">Loading withdrawals...</p>
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No withdrawal requests found</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">User</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Amount</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Date</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => (
                      <tr key={w.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-white text-sm font-medium">{w.userName || 'Unknown'}</p>
                          {w.userEmail && <p className="text-gray-500 text-xs">{w.userEmail}</p>}
                          {w.accountDetail && (
                            <p className="text-gray-500 text-xs">
                              {w.method ? `${w.method}: ` : ''}{w.accountDetail}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-white font-semibold">₹{Number(w.amount || 0).toLocaleString('en-IN')}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(w.status)}`}>
                            {w.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-400 text-xs">
                            {w.createdAt ? new Date(w.createdAt).toLocaleDateString('en-IN') : '-'}
                          </span>
                        </td>
<td className="px-4 py-3">
                          {w.payoutProofImageUrl && (
                            <div className="mb-2">
                              <a href={assetUrl(w.payoutProofImageUrl)} target="_blank" rel="noreferrer" title="View payout proof">
                                <img src={assetUrl(w.payoutProofImageUrl)} alt="Payout proof" className="h-14 w-14 rounded-lg object-cover border border-gray-700" />
                              </a>
                            </div>
                          )}
                          {w.status === 'PENDING' && (
                            <div className="space-y-2">
                              <label className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs cursor-pointer">
                                <ImagePlus className="w-4 h-4" />
                                {proofFile[w.id] ? proofFile[w.id].name : 'Payout proof (paid)'}
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,image/gif"
                                  className="hidden"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) setProofFile((p) => ({ ...p, [w.id]: f }))
                                    e.target.value = ''
                                  }}
                                />
                              </label>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => proofFile[w.id] ? handleApproveWithProof(w.id) : handleApprove(w.id)}
                                  disabled={actionLoading === w.id}
                                  className={`p-1.5 ${proofFile[w.id] ? 'bg-sky-500/30 hover:bg-sky-500/40 text-sky-300' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400'} disabled:opacity-50 rounded-lg transition`}
                                  title={proofFile[w.id] ? 'Approve with payout proof' : 'Approve (no proof)'}
                                >
                                  {actionLoading === w.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                </button>
                                <button
                                  onClick={() => handleReject(w.id)}
                                  disabled={actionLoading === w.id}
                                  className="p-1.5 bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-400 rounded-lg transition"
                                  title="Reject"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          )}
                          {w.status !== 'PENDING' && w.status !== 'REJECTED' && w.payoutProofImageUrl && (
                            <p className="text-[10px] text-gray-500 mt-1">Payout proof attached</p>
                          )}
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
    </div>
  )
}

import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, Check, X, Wallet, CreditCard, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface Partner {
  id: string
  userId: string
  name: string
  email: string
  phone: string
  status: string
  services: string[]
  bankAccount?: string
  upiId?: string
  createdAt: string
}

export function AdminWalkingPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchPartners = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter
      const res = await adminApi.getPartners(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.partners) ? d.partners : Array.isArray(d) ? d : []
      setPartners(raw.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        name: p.user?.fullName || p.name || 'Unknown',
        email: p.user?.email || p.email || '',
        phone: p.user?.phone || p.phone || '',
        status: p.status,
        services: [
          p.providesWalking === true || p.providesWalking === 'true' ? 'WALKING' : null,
          p.providesCarry === true || p.providesCarry === 'true' ? 'CARRY_BUDDY' : null,
        ].filter(Boolean) as string[],
        bankAccount: [p.bankAccountName, p.bankAccountNumber, p.bankIfsc].filter(Boolean).join(' Â· ') || p.bankAccount || '',
        upiId: p.upiId || '',
        createdAt: p.createdAt,
      })))
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load partners'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPartners()
  }, [page, statusFilter])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      await adminApi.approvePartner(id)
      setPartners((prev) => prev.filter((p) => p.id !== id))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to approve partner'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return
    setActionLoading(id)
    try {
      await adminApi.rejectPartner(id, rejectReason)
      setPartners((prev) => prev.filter((p) => p.id !== id))
      setRejectId(null)
      setRejectReason('')
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to reject partner'))
    } finally {
      setActionLoading(null)
    }
  }

  const statusBadge = (status: string) => {
      const map: Record<string, string> = {
        ALL: 'bg-gray-700 text-gray-300',
        PENDING: 'bg-amber-900/30 text-amber-400',
        APPLIED: 'bg-amber-900/30 text-amber-400',
        APPROVED: 'bg-emerald-900/30 text-emerald-400',
        REJECTED: 'bg-red-900/30 text-red-400',
        ACTIVE: 'bg-emerald-900/30 text-emerald-400',
        SUSPENDED: 'bg-red-900/30 text-red-400',
      }
    return map[status] || 'bg-gray-700 text-gray-400'
  }

  const serviceBadge = (service: string) => {
    const map: Record<string, string> = {
      WALKING: 'bg-emerald-900/40 text-emerald-300',
      CARRY_BUDDY: 'bg-amber-900/40 text-amber-300',
    }
    return map[service] || 'bg-gray-700 text-gray-300'
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Partners</h1>
            <p className="text-gray-400 text-sm mt-1">Approve & manage partner applications</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Walking Partners',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['Name', 'Email', 'Phone', 'Status', 'Services', 'Joined'],
                rows: partners.map((p) => [
                  p.name || '-',
                  p.email || '-',
                  p.phone || '-',
                  p.status || '-',
                  (p.services || []).join(', ') || '-',
                  p.createdAt ? new Date(p.createdAt).toLocaleDateString('en-IN') : '-',
                ]),
                fileName: `rentbuddy-partners-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={partners.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6">
          <div className="flex gap-2">
            {[['ALL', 'All'], ['PENDING', 'Pending'], ['APPLIED', 'Applied'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([s, label]) => (
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
            <p className="text-gray-400 mt-4">Loading partners...</p>
          </div>
        ) : partners.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No partner applications found</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {partners.map((partner) => (
                <div key={partner.id} className="bg-gray-800 rounded-xl overflow-hidden">
                  <div
                    className="p-4 cursor-pointer hover:bg-gray-750 transition"
                    onClick={() => setExpandedId(expandedId === partner.id ? null : partner.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-white">
                          {partner.name?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <p className="text-white font-medium text-sm">{partner.name || 'Unknown'}</p>
                          <p className="text-gray-500 text-xs">{partner.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="hidden sm:flex gap-1">
                          {(partner.services || []).map((svc) => (
                            <span key={svc} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${serviceBadge(svc)}`}>
                              {svc === 'WALKING' ? 'Walking' : svc === 'CARRY_BUDDY' ? 'Carry' : svc}
                            </span>
                          ))}
                        </div>
                        <span className="text-gray-500 text-xs hidden sm:block">
                          {partner.createdAt ? new Date(partner.createdAt).toLocaleDateString('en-IN') : '-'}
                        </span>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(partner.status)}`}>
                          {partner.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {expandedId === partner.id && (
                    <div className="p-4 border-t border-gray-700/50">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-4">
                        <div>
                          <p className="text-gray-500 text-xs">Partner ID</p>
                          <p className="text-white font-mono text-xs">{partner.id}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Phone</p>
                          <p className="text-white">{partner.phone || 'Not provided'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs flex items-center gap-1">
                            <Wallet className="w-3 h-3" /> Bank Account
                          </p>
                          <p className="text-white text-xs">{partner.bankAccount || 'Not provided'}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs flex items-center gap-1">
                            <CreditCard className="w-3 h-3" /> UPI ID
                          </p>
                          <p className="text-white text-xs">{partner.upiId || 'Not provided'}</p>
                        </div>
                      </div>

                      {partner.services && partner.services.length > 0 && (
                        <div className="mb-4">
                          <p className="text-gray-500 text-xs mb-2">Services Offered</p>
                          <div className="flex gap-2">
                            {partner.services.map((svc) => (
                              <span key={svc} className={`text-xs px-3 py-1 rounded-full font-medium ${serviceBadge(svc)}`}>
                                {svc === 'WALKING' ? 'Walking Buddy' : svc === 'CARRY_BUDDY' ? 'CarryBuddy' : svc}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {(partner.status === 'PENDING' || partner.status === 'APPLIED') && (
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(partner.id) }}
                            disabled={actionLoading === partner.id}
                            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                          >
                            <Check className="w-4 h-4" />
                            {actionLoading === partner.id ? 'Processing...' : 'Approve'}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setRejectId(rejectId === partner.id ? null : partner.id) }}
                            disabled={actionLoading === partner.id}
                            className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                          >
                            <X className="w-4 h-4" />
                            Reject
                          </button>
                        </div>
                      )}

                      {rejectId === partner.id && (
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
                            onClick={() => handleReject(partner.id)}
                            disabled={!rejectReason.trim() || actionLoading === partner.id}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
                          >
                            Confirm
                          </button>
                        </div>
                      )}
                    </div>
                  )}
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
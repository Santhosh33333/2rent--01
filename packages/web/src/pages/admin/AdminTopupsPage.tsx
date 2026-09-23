import { useState, useEffect } from 'react'
import { Wallet, Check, X, HelpCircle, IndianRupee, User as UserIcon, Clock, FileDown } from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminApi, assetUrl } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { exportTableToPdf } from '../../lib/pdfExport'

interface TopupRow {
  id: string
  amount: number | string
  referenceNumber: string
  proofImageUrl?: string | null
  verificationNote?: string | null
  status: string
  createdAt: string
  user?: { id: string; fullName?: string | null; email?: string | null; phone?: string | null } | null
}

const STATUS_BADGE: Record<string, string> = {
  VERIFICATION_PENDING: 'bg-amber-900/40 text-amber-300',
  VERIFIED: 'bg-emerald-900/40 text-emerald-300',
  REJECTED: 'bg-red-900/40 text-red-300',
  REQUEST_INFO: 'bg-blue-900/40 text-blue-300',
}

export function AdminTopupsPage() {
  const [rows, setRows] = useState<TopupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('VERIFICATION_PENDING')

  const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { status: filter, limit: 50 }
      const res = await adminApi.getTopupRequests(params)
      const d = res.data?.data || res.data
      setRows(Array.isArray(d?.items) ? d.items : [])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [filter])

  const act = async (id: string, action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO') => {
    if ((action === 'REJECT' || action === 'REQUEST_INFO') && !note[id]?.trim()) {
      setError('A note is required so the user knows why.')
      return
    }
    setBusyId(id)
    setError('')
    try {
      await adminApi.verifyTopupRequest(id, { action, note: note[id] })
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="bg-surface-50 dark:bg-surface-950 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-surface-200 dark:bg-surface-800 hover:bg-surface-300 dark:hover:bg-surface-700 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white transition">
            <span className="flex items-center gap-1 text-sm"><Clock className="w-4 h-4" /> Back</span>
          </Link>
        </div>
        <h1 className="text-2xl font-display font-bold text-surface-900 dark:text-white flex items-center gap-2 mt-3">
          <Wallet className="w-6 h-6 text-primary" /> Manual UPI Top-ups
        </h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Users pay your UPI QR externally and submit the UTR. Verify the amount against your bank statement, then credit their wallet.
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
          {[['VERIFICATION_PENDING', 'Pending'], ['REQUEST_INFO', 'More Info'], ['VERIFIED', 'Credited'], ['REJECTED', 'Rejected'], ['ALL', 'All']].map(([s, label]) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${filter === s ? 'bg-primary text-white' : 'bg-surface-200 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-700'}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Manual UPI Top-ups',
                subtitle: `Status: ${filter}`,
                columns: ['User', 'Email', 'Amount', 'UTR', 'Status', 'Requested'],
                rows: rows.map((r) => [
                  r.user?.fullName || '-',
                  r.user?.email || '-',
                  inr(Number(r.amount || 0)),
                  r.referenceNumber || '-',
                  r.status || '-',
                  r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN') : '-',
                ]),
                fileName: `nabri-topups-${filter.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`,
              })
            }
            disabled={rows.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-200 dark:bg-surface-800 hover:bg-surface-300 dark:hover:bg-surface-700 disabled:opacity-40 text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        {error ? <div className="mt-3 rounded-lg bg-red-900/30 text-red-300 px-3 py-2 text-sm">{error}</div> : null}

        {loading ? (
          <div className="text-center py-16">
            <div className="w-8 h-8 rounded-full border-2 border-surface-300 dark:border-surface-700 border-t-primary animate-spin mx-auto" />
            <p className="text-surface-500 dark:text-surface-400 mt-4">Loading top-ups...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-surface-500 dark:text-surface-400">No top-up requests found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-800 rounded-2xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                        <UserIcon className="w-4 h-4 text-surface-500 dark:text-surface-400" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-surface-900 dark:text-white">{r.user?.fullName || 'Unknown user'}</p>
                        <p className="text-xs text-surface-500 dark:text-surface-400">{r.user?.email || r.user?.phone || '—'}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm">
                      <span className="font-bold text-surface-900 dark:text-white flex items-center gap-1"><IndianRupee className="w-3.5 h-3.5" />{inr(Number(r.amount || 0))}</span>
                      <span className="text-surface-400 text-xs">UTR {r.referenceNumber}</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_BADGE[r.status] || 'bg-surface-200 dark:bg-surface-800 text-surface-500'}`}>{r.status.replace('_', ' ')}</span>
                      <span className="text-xs text-surface-400">{r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : ''}</span>
                    </div>
                    {r.verificationNote && <p className="text-xs text-surface-500 dark:text-surface-400 mt-1.5">Note: {r.verificationNote}</p>}
                  </div>

                  {r.proofImageUrl && (
                    <a href={assetUrl(r.proofImageUrl)} target="_blank" rel="noreferrer" className="flex-shrink-0">
                      <img src={assetUrl(r.proofImageUrl)} alt="Payment proof" className="h-24 w-24 rounded-xl object-cover border border-surface-200 dark:border-surface-700" />
                    </a>
                  )}

                  {r.status === 'VERIFICATION_PENDING' || r.status === 'REQUEST_INFO' ? (
                    <div className="w-full sm:w-auto flex-shrink-0 sm:max-w-xs space-y-2">
                      <input
                        value={note[r.id] ?? ''}
                        onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                        placeholder="Note (required for reject/info)"
                        className="w-full px-3 py-2 rounded-lg bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:border-primary"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => act(r.id, 'VERIFY')}
                          disabled={busyId === r.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-400 text-sm font-medium transition"
                        >
                          {busyId === r.id ? <span className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Credit
                        </button>
                        <button
                          onClick={() => act(r.id, 'REJECT')}
                          disabled={busyId === r.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-400 text-sm font-medium transition"
                        >
                          <X className="w-4 h-4" /> Reject
                        </button>
                        <button
                          onClick={() => act(r.id, 'REQUEST_INFO')}
                          disabled={busyId === r.id}
                          title="Ask the user for more information"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-50 text-blue-400 text-sm font-medium transition"
                        >
                          <HelpCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
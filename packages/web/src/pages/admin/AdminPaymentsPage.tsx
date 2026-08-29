import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, ChevronLeft, ChevronRight, CreditCard, IndianRupee, Clock, XCircle, Percent, Banknote, Wallet, Download, Phone, Mail, User as UserIcon, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface PaymentStats {
  totalCollected: number
  completedTransactions: number
  failedTransactions: number
  pendingTransactions: number
  platformFeesEarned: number
  partnerPayouts: number
  walletTopups: number
  topupCount: number
  pendingWithdrawalsAmount: number
  cashCollectedByPartners: number
  cashPlatformFeesDue: number
  cashBookingCount: number
}

interface PaymentRow {
  id: string
  razorpayOrderId: string
  razorpayPaymentId?: string | null
  amount: number
  currency: string
  status: string
  type: string
  createdAt: string
  completedAt?: string | null
  user?: { id: string; fullName?: string; email: string; phone?: string | null }
  booking?: { id: string; serviceType: string; status: string; paymentStatus?: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  CREATED: 'bg-blue-900/40 text-blue-300',
  AUTHORIZED: 'bg-indigo-900/40 text-indigo-300',
  CAPTURED: 'bg-emerald-900/40 text-emerald-300',
  COMPLETED: 'bg-emerald-900/40 text-emerald-300',
  FAILED: 'bg-red-900/40 text-red-300',
}

export function AdminPaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [stats, setStats] = useState<PaymentStats | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page, limit: 20 }
      if (search.trim()) params.search = search.trim()
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.type = typeFilter
      const res = await adminApi.getPayments(params)
      const d = res.data?.data || res.data
      setRows(Array.isArray(d?.items) ? d.items : [])
      const total = Number(d?.total || 0)
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load payments'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    adminApi.getPaymentStats()
      .then((res) => setStats(res.data?.data || res.data))
      .catch(() => { /* stats are supplementary */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter, typeFilter])

  const csvEscape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const handleDownloadCsv = async () => {
    setDownloading(true)
    try {
      // Fetch every page matching the current filters (capped at 2000 rows)
      let all: PaymentRow[] = []
      for (let p = 1; p <= 100; p++) {
        const params: any = { page: p, limit: 20 }
        if (search.trim()) params.search = search.trim()
        if (statusFilter) params.status = statusFilter
        if (typeFilter) params.type = typeFilter
        const res = await adminApi.getPayments(params)
        const d = res.data?.data || res.data
        const items: PaymentRow[] = Array.isArray(d?.items) ? d.items : []
        all = all.concat(items)
        if (all.length >= (Number(d?.total) || 0) || items.length === 0) break
      }

      const header = ['Payment ID', 'Order ID', 'Razorpay Payment ID', 'Type', 'Status', 'Amount', 'Currency', 'Payer Name', 'Payer Email', 'Payer Phone', 'User ID', 'Booking Service', 'Booking Status', 'Created At', 'Completed At']
      const lines = [header.join(',')]
      for (const r of all) {
        lines.push([
          r.id, r.razorpayOrderId, r.razorpayPaymentId || '', r.type, r.status,
          Number(r.amount).toFixed(2), r.currency,
          r.user?.fullName || '', r.user?.email || '', r.user?.phone || '', r.user?.id || '',
          r.booking?.serviceType || '', r.booking?.status || '',
          r.createdAt ? new Date(r.createdAt).toISOString() : '',
          r.completedAt ? new Date(r.completedAt).toISOString() : '',
        ].map(csvEscape).join(','))
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      const parts = ['rentbuddy-payments', stamp]
      if (statusFilter) parts.push(statusFilter.toLowerCase())
      if (typeFilter) parts.push(typeFilter.toLowerCase())
      if (search.trim()) parts.push('search')
      a.download = `${parts.join('-')}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to export payments')
    } finally {
      setDownloading(false)
    }
  }

  const statCards = stats ? [    { label: 'Total Collected', value: inr(stats.totalCollected), sub: `${stats.completedTransactions} completed`, icon: IndianRupee, color: 'text-emerald-400 bg-emerald-900/30' },
    { label: 'Platform Fees Earned', value: inr(stats.platformFeesEarned), sub: 'from completed bookings', icon: Percent, color: 'text-violet-400 bg-violet-900/30' },
    { label: 'Cash Collected by Partners', value: inr(stats.cashCollectedByPartners), sub: `${stats.cashBookingCount} cash bookings · fees due ${inr(stats.cashPlatformFeesDue)}`, icon: Banknote, color: 'text-amber-400 bg-amber-900/30' },
    { label: 'Wallet Top-ups', value: inr(stats.walletTopups), sub: `${stats.topupCount} top-ups`, icon: Wallet, color: 'text-sky-400 bg-sky-900/30' },
    { label: 'Partner Payouts', value: inr(stats.partnerPayouts), sub: 'earnings credited', icon: CreditCard, color: 'text-indigo-400 bg-indigo-900/30' },
    { label: 'Pending Withdrawals', value: inr(stats.pendingWithdrawalsAmount), sub: 'awaiting payout', icon: Clock, color: 'text-orange-400 bg-orange-900/30' },
    { label: 'Failed Transactions', value: String(stats.failedTransactions), sub: `${stats.pendingTransactions} pending`, icon: XCircle, color: 'text-red-400 bg-red-900/30' },
  ] : []

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Payment Center</h1>
            <p className="text-gray-400 text-sm mt-1">Real Razorpay orders and payments</p>
          </div>
        </div>

        {statCards.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {statCards.map((c) => (
              <div key={c.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700/60">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${c.color}`}>
                  <c.icon className="w-4 h-4" />
                </div>
                <p className="text-gray-500 text-[11px] uppercase tracking-wide">{c.label}</p>
                <p className="text-white font-bold text-lg mt-0.5">{c.value}</p>
                <p className="text-gray-500 text-xs mt-0.5">{c.sub}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); load() }} className="flex gap-2 flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order/payment ID…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-white placeholder:text-gray-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <button type="submit" className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition">Search</button>
          </form>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-white text-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All statuses</option>
            {['CREATED', 'AUTHORIZED', 'CAPTURED', 'COMPLETED', 'FAILED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-white text-sm focus:border-emerald-500 focus:outline-none">
            <option value="">All types</option>
            <option value="BOOKING">BOOKING</option>
            <option value="TOPUP">TOPUP</option>
          </select>
          <button
            onClick={handleDownloadCsv}
            disabled={downloading || loading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold transition whitespace-nowrap"
            title="Download all payments matching current filters as CSV"
          >
            <Download className="w-4 h-4" />
            {downloading ? 'Exporting.' : 'Download CSV'}
          </button>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Payments',
                subtitle: [
                  stats ? `Collected ₹${stats.totalCollected.toLocaleString('en-IN')}` : null,
                  stats ? `Fees ₹${stats.platformFeesEarned.toLocaleString('en-IN')}` : null,
                  `${rows.length} transaction(s) on this page`,
                ]
                  .filter(Boolean)
                  .join(' · '),
                columns: ['Date', 'Payer', 'Email', 'Amount', 'Type', 'Status', 'Booking'],
                rows: rows.map((r) => [
                  r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '-',
                  r.user?.fullName || '-',
                  r.user?.email || '-',
                  `₹${r.amount}`,
                  r.type || '-',
                  r.status || '-',
                  r.booking?.serviceType || '-',
                ]),
                fileName: `rentbuddy-payments-${new Date().toISOString().slice(0, 10)}${statusFilter ? `-${statusFilter.toLowerCase()}` : ''}${typeFilter ? `-${typeFilter.toLowerCase()}` : ''}`,
                landscape: true,
              })
            }
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition whitespace-nowrap"
            title="Download the payments currently loaded as PDF"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        {error && <div className="mb-4 p-4 rounded-xl bg-red-900/20 border border-red-800/50 text-red-300 text-sm">{error}</div>}

        {loading ? (
          <div className="py-16 text-center text-gray-500">Loading payments…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <CreditCard className="w-12 h-12 mx-auto text-gray-700 mb-3" />
            <p className="text-gray-400">No payments yet.</p>
            <p className="text-gray-600 text-sm mt-1">Records appear here the moment a real Razorpay order is created.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl bg-gray-900 border border-gray-800 overflow-hidden">
                <div
                  className="p-5 flex flex-col lg:flex-row lg:items-center gap-4 cursor-pointer hover:bg-gray-800/40 transition"
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center font-bold text-white">
                    ₹{Number(r.amount).toLocaleString('en-IN')}
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                    <div>
                      <p className="text-gray-500 text-[11px] uppercase tracking-wide">Order ID</p>
                      <p className="font-mono text-gray-200 truncate">{r.razorpayOrderId}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[11px] uppercase tracking-wide">Payment ID</p>
                      <p className="font-mono text-gray-200 truncate">{r.razorpayPaymentId || '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[11px] uppercase tracking-wide">Paid By</p>
                      <p className="text-gray-200 truncate">{r.user?.fullName || r.user?.email || '—'}</p>
                    </div>
                  <div>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wide">Type / Status</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="px-2 py-0.5 rounded-full bg-gray-800 text-gray-300 text-[10px] font-bold">{r.type}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_BADGE[r.status] || 'bg-gray-800 text-gray-300'}`}>{r.status}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wide">Booking</p>
                    {r.booking ? (
                      <span className="text-gray-200">{r.booking.serviceType} · {r.booking.status}</span>
                    ) : (
                      <span className="text-gray-500">{r.type === 'TOPUP' ? 'Wallet top-up' : '—'}</span>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500 text-[11px] uppercase tracking-wide">Created</p>
                    <p className="text-gray-200">{new Date(r.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              </div>

                {expandedId === r.id && (
                  <div className="px-5 pb-5 border-t border-gray-800 pt-4">
                    <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-3">Payer Details</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm bg-gray-950/60 p-4 rounded-xl border border-gray-800/60">
                      <div>
                        <p className="text-gray-500 text-xs flex items-center gap-1"><UserIcon className="w-3 h-3" /> Name</p>
                        <p className="text-white">{r.user?.fullName || '—'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs flex items-center gap-1"><Mail className="w-3 h-3" /> Email</p>
                        <p className="text-white truncate">{r.user?.email || '—'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</p>
                        <p className="text-white">{r.user?.phone || '—'}</p>
                      </div>
                      <div>
                        <p className="text-gray-500 text-[11px] uppercase tracking-wide">User ID</p>
                        <p className="font-mono text-gray-300 text-xs break-all">{r.user?.id || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-8">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 disabled:opacity-30 hover:bg-gray-800 transition text-sm">
            <ChevronLeft className="w-4 h-4" /> Prev
          </button>
          <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-gray-900 border border-gray-800 text-gray-300 disabled:opacity-30 hover:bg-gray-800 transition text-sm">
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
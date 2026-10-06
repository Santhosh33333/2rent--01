import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { AdminPageHeader, AdminShell } from '../../components/admin/AdminPageHeader'
import { Search, ChevronLeft, ChevronRight, CreditCard, IndianRupee, Clock, XCircle, Percent, Banknote, Wallet, Download, Phone, Mail, User as UserIcon, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'
import { saveBlob } from '../../lib/download'
import toast from 'react-hot-toast'

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
  cashfreeOrderId: string
  cashfreePaymentId?: string | null
  amount: number
  currency: string
  status: string
  type: string
  createdAt: string
  completedAt?: string | null
  user?: { id: string; fullName?: string; email: string; phone?: string | null }
  booking?: { id: string; serviceType: string; status: string; paymentStatus?: string } | null
}

/**
 * A subscription payment awaiting review.
 *
 * Deliberately not merged into `PaymentRow`: that list is retired gateway
 * history and is read-only, while this one is a live queue where acting on a
 * row activates a plan. Same amount field, completely different consequence.
 */
interface SubscriptionPaymentRow {
  id: string
  amount: number
  currency: string
  status: string
  referenceNumber?: string | null
  periodStart: string
  periodEnd: string
  createdAt: string
  plan?: { name: string; code: string } | null
  user?: { id: string; fullName?: string; email: string; phone?: string | null } | null
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

  // ---- Subscription payment queue -----------------------------------------
  const [subRows, setSubRows] = useState<SubscriptionPaymentRow[]>([])
  const [subLoading, setSubLoading] = useState(true)
  const [subError, setSubError] = useState('')
  const [subActing, setSubActing] = useState<string | null>(null)
  // Reject and request-info both require a reason, so they collect one inline
  // rather than in a modal: the row stays visible while the admin types, which
  // is what makes "is this the right payment?" answerable.
  const [noteFor, setNoteFor] = useState<{ id: string; action: 'REJECT' | 'REQUEST_INFO' } | null>(null)
  const [noteText, setNoteText] = useState('')

  const loadSubscriptions = async () => {
    setSubLoading(true)
    setSubError('')
    try {
      const params: any = { status: 'VERIFICATION_PENDING', limit: 20 }
      const res = await adminApi.getSubscriptionPayments(params)
      const d = res.data?.data || res.data
      setSubRows(Array.isArray(d?.items) ? d.items : [])
    } catch (err: unknown) {
      setSubError(getErrorMessage(err, 'Failed to load subscription payments'))
    } finally {
      setSubLoading(false)
    }
  }

  const actOnSubscription = async (
    id: string,
    action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO',
    note?: string,
  ) => {
    setSubActing(id)
    try {
      const res = await adminApi.verifySubscriptionPayment(id, { action, note })
      const body = res.data || {}
      const message = body.message || (action === 'VERIFY'
        ? 'Payment verified and the plan is now active.'
        : 'Payment updated.')
      if (body.data?.alreadySettled) toast(message)
      else toast.success(message)
      setNoteFor(null)
      setNoteText('')
      await loadSubscriptions()
    } catch (err: unknown) {
      // The server refuses a reference already used elsewhere with 409
      // REFERENCE_ALREADY_USED; getErrorMessage carries that message through.
      toast.error(getErrorMessage(err, 'Could not update this payment'))
    } finally {
      setSubActing(null)
    }
  }

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

  // Loaded once, independently of the ledger's filters: pagination and status
  // filters below apply to the gateway history, and re-querying the queue when
  // an admin pages through retired orders would be a request nobody asked for.
  useEffect(() => {
    loadSubscriptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

      const header = ['Payment ID', 'Order ID', 'Cashfree Payment ID', 'Type', 'Status', 'Amount', 'Currency', 'Payer Name', 'Payer Email', 'Payer Phone', 'User ID', 'Booking Service', 'Booking Status', 'Created At', 'Completed At']
      const lines = [header.join(',')]
      for (const r of all) {
        lines.push([
          r.id, r.cashfreeOrderId, r.cashfreePaymentId || '', r.type, r.status,
          Number(r.amount).toFixed(2), r.currency,
          r.user?.fullName || '', r.user?.email || '', r.user?.phone || '', r.user?.id || '',
          r.booking?.serviceType || '', r.booking?.status || '',
          r.createdAt ? new Date(r.createdAt).toISOString() : '',
          r.completedAt ? new Date(r.completedAt).toISOString() : '',
        ].map(csvEscape).join(','))
      }
      const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
      const stamp = new Date().toISOString().slice(0, 10)
      const parts = ['nabri-payments', stamp]
      if (statusFilter) parts.push(statusFilter.toLowerCase())
      if (typeFilter) parts.push(typeFilter.toLowerCase())
      if (search.trim()) parts.push('search')
      // Blob + <a download> is ignored by the Android WebView, so route the
      // export through the shared saver (native Share sheet on Android).
      const outcome = await saveBlob(blob, `${parts.join('-')}.csv`)
      if (outcome === 'shared') {
        toast.success('Choose where to save the CSV')
      } else {
        toast.success('Payments CSV downloaded')
      }
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
    <AdminShell width="max-w-6xl">
      <AdminPageHeader title="Payment Center" subtitle="Subscription payments waiting on you are at the top. Below them: gateway order history - Cashfree is retired, so those rows are the record of what it did." />

        {/* Subscription queue first, on purpose. It is the only part of this page
            that is actionable: verifying one of these rows activates a plan and
            sends the confirmation mail, so it must not sit below seven stat
            cards and a paginated history of orders nobody can act on. */}
        <section className="mb-8 rounded-2xl bg-gray-800/60 border border-emerald-800/40 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-gray-700/60">
            <div>
              <h2 className="text-white font-semibold flex items-center gap-2">
                <Wallet className="w-4 h-4 text-emerald-400" />
                Subscription payments awaiting verification
                {subRows.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300 text-[11px] font-bold">
                    {subRows.length}
                  </span>
                )}
              </h2>
              <p className="text-gray-500 text-xs mt-0.5">
                Verifying activates the plan and emails the user. This money buys a billing period - it is never credited to a wallet.
              </p>
            </div>
            <button
              onClick={loadSubscriptions}
              disabled={subLoading}
              className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 text-xs hover:bg-gray-700 disabled:opacity-50 transition self-start"
            >
              {subLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {subError && (
            <div className="px-5 py-3 bg-red-900/20 border-b border-red-900/40 text-red-300 text-sm">{subError}</div>
          )}

          {subLoading ? (
            <div className="px-5 py-8 text-center text-gray-500 text-sm">Loading subscription payments…</div>
          ) : subRows.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-500 text-sm">
              Nothing waiting. A payment submitted through the UPI flow appears here within a second.
            </div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {subRows.map((p) => {
                const busy = subActing === p.id
                return (
                  <div key={p.id} className="px-5 py-4">
                    <div className="flex flex-col xl:flex-row xl:items-start gap-4">
                      <div className="w-11 h-11 shrink-0 rounded-xl bg-emerald-900/40 border border-emerald-700/40 flex items-center justify-center font-bold text-emerald-300">
                        ₹{Number(p.amount).toLocaleString('en-IN')}
                      </div>
                      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-500 text-[11px] uppercase tracking-wide">User</p>
                          <p className="text-gray-200 truncate">{p.user?.fullName || p.user?.email || '—'}</p>
                          <p className="text-gray-500 text-xs truncate">{p.user?.email}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-gray-500 text-[11px] uppercase tracking-wide">Plan</p>
                          <p className="text-gray-200 truncate">{p.plan?.name || '—'}</p>
                          <p className="text-gray-500 text-xs">
                            {new Date(p.periodStart).toLocaleDateString('en-IN')} →{' '}
                            {new Date(p.periodEnd).toLocaleDateString('en-IN')}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-gray-500 text-[11px] uppercase tracking-wide">UTR / Reference</p>
                          <p className="font-mono text-gray-200 break-all">{p.referenceNumber || 'Not submitted yet'}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-gray-500 text-[11px] uppercase tracking-wide">Submitted</p>
                          <p className="text-gray-200">{new Date(p.createdAt).toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <button
                          onClick={() => actOnSubscription(p.id, 'VERIFY')}
                          disabled={busy || !p.referenceNumber}
                          title={!p.referenceNumber ? 'No reference submitted yet - there is nothing to check against the bank.' : 'Activate the plan'}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold transition"
                        >
                          {busy ? 'Working…' : 'Verify'}
                        </button>
                        <button
                          onClick={() => { setNoteFor({ id: p.id, action: 'REQUEST_INFO' }); setNoteText('') }}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-xs font-semibold transition"
                        >
                          Request info
                        </button>
                        <button
                          onClick={() => { setNoteFor({ id: p.id, action: 'REJECT' }); setNoteText('') }}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-red-900/60 border border-red-800/60 text-red-300 hover:bg-red-900 disabled:opacity-40 text-xs font-semibold transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    {noteFor?.id === p.id && (
                      <div className="mt-3 rounded-xl bg-gray-950/70 border border-gray-700/60 p-3">
                        <label className="block text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1.5">
                          {noteFor.action === 'REJECT' ? 'Why is this being rejected?' : 'What does the user need to send?'}
                        </label>
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          rows={2}
                          autoFocus
                          placeholder={noteFor.action === 'REJECT'
                            ? 'e.g. The UTR does not appear in the statement.'
                            : 'e.g. Send a screenshot of the debit with the UTR visible.'}
                          className="w-full rounded-lg bg-gray-900 border border-gray-700 text-white text-sm p-2.5 placeholder:text-gray-600 focus:border-emerald-500 focus:outline-none resize-none"
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => actOnSubscription(p.id, noteFor.action, noteText.trim())}
                            disabled={busy || noteText.trim().length < 5}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition"
                          >
                            Send
                          </button>
                          <button
                            onClick={() => { setNoteFor(null); setNoteText('') }}
                            disabled={busy}
                            className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 text-xs font-semibold transition"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

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
                fileName: `nabri-payments-${new Date().toISOString().slice(0, 10)}${statusFilter ? `-${statusFilter.toLowerCase()}` : ''}${typeFilter ? `-${typeFilter.toLowerCase()}` : ''}`,
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
            <p className="text-gray-600 text-sm mt-1">Nothing new lands here: Cashfree is retired, so these are the orders it created before the switch. Settle current payments from the UPI queue and bank reconciliation.</p>
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
                      <p className="font-mono text-gray-200 truncate">{r.cashfreeOrderId}</p>
                    </div>
                    <div>
                      <p className="text-gray-500 text-[11px] uppercase tracking-wide">Payment ID</p>
                      <p className="font-mono text-gray-200 truncate">{r.cashfreePaymentId || '—'}</p>
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
                    <p className="text-gray-200">{new Date(r.createdAt).toLocaleString('en-IN')}</p>
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
    </AdminShell>
  )
}
import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface BookingRow {
  id: string
  userName: string
  userEmail?: string
  partnerName?: string
  serviceType: string
  status: string
  paymentStatus?: string
  refundStatus?: string
  estimatedAmount?: number | string
  finalAmount?: number | string
  createdAt: string
}

const STATUS_FILTERS = [
  ['ALL', 'All'],
  ['PARTNER_SEARCHING', 'Searching'],
  ['PARTNER_ACCEPTED', 'Accepted'],
  ['IN_PROGRESS', 'In Progress'],
  ['COMPLETED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
  ['EXPIRED', 'Expired'],
]

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    PARTNER_SEARCHING: 'bg-sky-900/30 text-sky-400',
    PARTNER_ACCEPTED: 'bg-indigo-900/30 text-indigo-400',
    OTP_GENERATED: 'bg-violet-900/30 text-violet-400',
    IN_PROGRESS: 'bg-amber-900/30 text-amber-400',
    COMPLETED: 'bg-emerald-900/30 text-emerald-400',
    CANCELLED: 'bg-red-900/30 text-red-400',
    EXPIRED: 'bg-gray-700 text-gray-400',
    REFUND_INITIATED: 'bg-rose-900/30 text-rose-400',
    REFUND_COMPLETED: 'bg-emerald-900/30 text-emerald-400',
  }
  return map[status] || 'bg-gray-700 text-gray-400'
}

export function AdminBookingsPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [statusFilter, setStatusFilter] = useState('ALL')

  const fetchBookings = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter
      const res = await adminApi.getBookings(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.bookings) ? d.bookings : Array.isArray(d) ? d : []
      setBookings(
        raw.map((b: any) => ({
          id: b.id,
          userName: b.user?.fullName || b.userName || 'Unknown',
          userEmail: b.user?.email || '',
          partnerName: b.partner?.user?.fullName || b.partnerName || '—',
          serviceType: b.serviceType || '—',
          status: b.status,
          paymentStatus: b.paymentStatus,
          refundStatus: b.refundStatus,
          estimatedAmount: b.estimatedAmount,
          finalAmount: b.finalAmount,
          createdAt: b.createdAt,
        })),
      )
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load bookings'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBookings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, statusFilter])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Bookings</h1>
            <p className="text-gray-400 text-sm mt-1">Real-time booking pipeline &amp; settlement status</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Bookings',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['User', 'Partner', 'Service', 'Status', 'Payment', 'Refund', 'Created'],
                rows: bookings.map((b) => [
                  b.userName || '-',
                  b.partnerName || '-',
                  b.serviceType || '-',
                  b.status || '-',
                  b.paymentStatus || '-',
                  b.refundStatus || '-',
                  b.createdAt ? new Date(b.createdAt).toLocaleString('en-IN') : '-',
                ]),
                fileName: `rentbuddy-bookings-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={bookings.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="mb-6">
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(([s, label]) => (
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

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>
        )}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading bookings...</p>
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No bookings found</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">User</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Partner</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Service</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Payment</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Refund</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Amount</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-white text-sm font-medium">{b.userName}</p>
                          {b.userEmail && <p className="text-gray-500 text-xs">{b.userEmail}</p>}
                          <p className="text-gray-600 text-[10px] font-mono mt-0.5">{b.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{b.partnerName}</td>
                        <td className="px-4 py-3 text-gray-300 text-sm">{b.serviceType}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusBadge(b.status)}`}>{b.status}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{b.paymentStatus || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{b.refundStatus || '-'}</td>
                        <td className="px-4 py-3">
                          <span className="text-white font-semibold">
                            ₹{Number(b.finalAmount || b.estimatedAmount || 0).toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-gray-400 text-xs">
                            {b.createdAt ? new Date(b.createdAt).toLocaleDateString('en-IN') : '-'}
                          </span>
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

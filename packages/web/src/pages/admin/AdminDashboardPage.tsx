import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Users, Handshake, CalendarCheck, Wallet, ShieldCheck, Banknote, FileDown } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface DashboardData {
  totalUsers: number
  activeUsers: number
  totalPartners: number
  activePartners: number
  pendingPartnerApprovals: number
  totalBookings: number
  activeBookings: number
  completedBookings: number
  totalWalletBalance: number
  pendingWithdrawals: number
  pendingKyc: number
}

export function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const res = await adminApi.getDashboard()
        setData(res.data?.data || res.data)
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to load dashboard'))
      } finally {
        setLoading(false)
      }
    }
    fetchDashboard()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 text-gray-400">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          </div>
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          </div>
          <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl text-center">
            {error}
          </div>
        </div>
      </div>
    )
  }

  const stats = [
    {
      label: 'Total Users', value: data?.totalUsers ?? 0, icon: Users, color: 'text-blue-400',
      sub: `${data?.activeUsers ?? 0} active`
    },
    {
      label: 'Total Partners', value: data?.totalPartners ?? 0, icon: Handshake, color: 'text-emerald-400',
      sub: `${data?.activePartners ?? 0} active`
    },
    {
      label: 'Pending Approvals', value: data?.pendingPartnerApprovals ?? 0, icon: ShieldCheck, color: 'text-amber-400',
      sub: 'partner applications'
    },
    {
      label: 'Total Bookings', value: data?.totalBookings ?? 0, icon: CalendarCheck, color: 'text-violet-400',
      sub: `${data?.activeBookings ?? 0} active Â· ${data?.completedBookings ?? 0} completed`
    },
    {
      label: 'Wallet Balance', value: `₹${(data?.totalWalletBalance ?? 0).toLocaleString('en-IN')}`, icon: Wallet, color: 'text-cyan-400',
      sub: 'platform total'
    },
    {
      label: 'Pending Withdrawals', value: data?.pendingWithdrawals ?? 0, icon: Banknote, color: 'text-orange-400',
      sub: 'awaiting review'
    },
    {
      label: 'Pending KYC', value: data?.pendingKyc ?? 0, icon: ShieldCheck, color: 'text-pink-400',
      sub: 'identity verifications'
    },
  ]

  const downloadPdf = () => {
    exportTableToPdf({
      title: 'Platform Overview',
      columns: ['Metric', 'Value', 'Details'],
      rows: stats.map((s) => [s.label, s.value, s.sub]),
      fileName: `rentbuddy-dashboard-${new Date().toISOString().slice(0, 10)}`,
    })
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Platform overview & analytics</p>
          </div>
          <button
            onClick={downloadPdf}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-gray-800 p-5 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center">
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <span className="text-gray-400 text-sm font-medium">{stat.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{stat.value}</p>
              {stat.sub && <p className="text-gray-500 text-xs mt-1">{stat.sub}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
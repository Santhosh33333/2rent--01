import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight, FileDown, Wallet } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'

interface WalletRow {
  id: string
  balance: number
  userName: string
  userEmail?: string
  userStatus?: string
  userId: string
}

export function AdminWalletsPage() {
  const [wallets, setWallets] = useState<WalletRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState('')
  const [totalBalance, setTotalBalance] = useState(0)

  const fetchWallets = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { page }
      if (search) params.search = search
      const res = await adminApi.getWallets(params)
      const d = res.data?.data || res.data
      const raw = Array.isArray(d?.items) ? d.items : Array.isArray(d?.wallets) ? d.wallets : Array.isArray(d) ? d : []
      setWallets(
        raw.map((w: any) => ({
          id: w.id,
          balance: Number(w.balance || 0),
          userId: w.userId,
          userName: w.user?.fullName || 'Unknown',
          userEmail: w.user?.email || '',
          userStatus: w.user?.status,
        })),
      )
      setTotalBalance(Number(d?.totalBalance) || 0)
      const total = Number(d?.total) || 0
      setTotalPages(Math.max(1, Math.ceil(total / 20)))
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load wallets'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchWallets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search])

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Wallets</h1>
            <p className="text-gray-400 text-sm mt-1">User wallet balances &amp; platform float</p>
          </div>
          <button
            onClick={() =>
              exportTableToPdf({
                title: 'Wallets',
                subtitle: `Page ${page} of ${totalPages}`,
                columns: ['User', 'Email', 'Balance', 'Status'],
                rows: wallets.map((w) => [
                  w.userName || '-',
                  w.userEmail || '-',
                  `₹${w.balance.toLocaleString('en-IN')}`,
                  w.userStatus || '-',
                ]),
                fileName: `rentbuddy-wallets-${new Date().toISOString().slice(0, 10)}`,
                landscape: true,
              })
            }
            disabled={wallets.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
          >
            <FileDown className="w-4 h-4" /> PDF
          </button>
        </div>

        <div className="bg-gray-800 rounded-xl p-4 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-700 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Total platform float</p>
              <p className="text-white text-xl font-bold">₹{Number(totalBalance).toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search by name or email…"
            className="input w-full max-w-sm"
          />
        </div>

        {error && <div className="bg-red-900/20 border border-red-800 text-red-300 p-4 rounded-xl mb-4 text-center">{error}</div>}

        {loading ? (
          <div className="text-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-gray-700 border-t-blue-500 animate-spin mx-auto" />
            <p className="text-gray-400 mt-4">Loading wallets...</p>
          </div>
        ) : wallets.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400">No wallets found</p>
          </div>
        ) : (
          <>
            <div className="bg-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">User</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Status</th>
                      <th className="px-4 py-3 text-gray-400 text-xs font-medium uppercase">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map((w) => (
                      <tr key={w.id} className="border-b border-gray-700/50 last:border-0">
                        <td className="px-4 py-3">
                          <p className="text-white text-sm font-medium">{w.userName}</p>
                          {w.userEmail && <p className="text-gray-500 text-xs">{w.userEmail}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{w.userStatus || '-'}</td>
                        <td className="px-4 py-3">
                          <span className="text-white font-semibold">₹{w.balance.toLocaleString('en-IN')}</span>
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

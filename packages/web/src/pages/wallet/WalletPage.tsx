import { useState } from 'react'
import { Wallet, ArrowDownRight, Receipt, ShoppingCart, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

interface Transaction {
  id: string
  type: string
  amount: number
  description: string
  status: string
  createdAt: string
}

export function WalletPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalPaid, setTotalPaid] = useState(0)
  const [totalRequests, setTotalRequests] = useState(0)

  const { loading, error, retry } = useAsync(
    async () => {
      const txRes = await api.get('/wallet/transactions?limit=100')
      const txData = txRes.data?.data || txRes.data || {}
      const items: Transaction[] = txData.items || []
      setTransactions(items)
      const paid = items
        .filter((t: Transaction) => t.type === 'DEBIT' || t.type === 'PAYMENT')
        .reduce((sum: number, t: Transaction) => sum + t.amount, 0)
      setTotalPaid(paid)
      setTotalRequests(items.length)
      return items
    },
    true
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonLoader variant="card" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <SkeletonLoader key={i} variant="card" />)}
        </div>
        <SkeletonLoader variant="list" lines={5} />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState
        icon={Wallet}
        title="Failed to load payment data"
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Payments" subtitle="Your spending and transaction history" />

      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 p-6 sm:p-8 text-white shadow-xl shadow-primary-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <p className="text-white/60 text-sm font-medium mb-2">Total Spent</p>
            <p className="text-4xl sm:text-5xl font-bold font-display">₹{totalPaid.toLocaleString('en-IN')}</p>

            <div className="flex gap-3 mt-8">
              <Link to="/walking-requests/create" className="px-6 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-all flex items-center gap-2 backdrop-blur-sm">
                <ShoppingCart className="w-4 h-4" /> Book a Walk
              </Link>
              <Link to="/wallet/topup" className="px-6 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-all flex items-center gap-2 backdrop-blur-sm">
                <Zap className="w-4 h-4" /> Top Up
              </Link>
              <Link to="/wallet/transactions" className="px-6 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-all flex items-center gap-2 backdrop-blur-sm">
                <Receipt className="w-4 h-4" /> View History
              </Link>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Receipt className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-sm text-surface-500">Total Transactions</p>
            </div>
            <p className="text-2xl font-bold font-display text-surface-900 dark:text-white">{totalRequests}</p>
          </GlassCard>

          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="text-sm text-surface-500">Currency</p>
            </div>
            <p className="text-2xl font-bold font-display text-surface-900 dark:text-white">INR</p>
          </GlassCard>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary-500" />
              Recent Transactions
            </h2>
          </div>
          {transactions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4">
                <Wallet className="w-8 h-8 text-surface-400" />
              </div>
              <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1 font-display">No transactions yet</h3>
              <p className="text-sm text-surface-500 dark:text-surface-400">Book a walk or carry service to get started</p>
              <Link to="/walking-requests/create" className="mt-4 inline-block btn-primary btn-sm">
                Book a Walk
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map(tx => (
                <div key={tx.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center flex-shrink-0">
                    {tx.type === 'CREDIT' ? (
                      <ArrowDownRight className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <ShoppingCart className="w-4 h-4 text-primary-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{tx.description || tx.type}</p>
                    <p className="text-xs text-surface-500 mt-0.5">
                      {new Date(tx.createdAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${tx.type === 'CREDIT' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {tx.type === 'CREDIT' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                    </p>
                    {tx.status === 'PENDING' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

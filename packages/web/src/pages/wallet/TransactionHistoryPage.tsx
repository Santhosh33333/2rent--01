import { useState } from 'react'
import { Receipt } from 'lucide-react'
import { api } from '../../lib/api'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { EmptyState } from '../../components/EmptyState'
import { useAsync } from '../../hooks/useAsync'
import { PageHeader } from '../../components/PageHeader'
import { AnimatedPage } from '../../components/AnimatedPage'

interface Transaction {
  id: number
  type: 'credit' | 'debit'
  amount: number
  description: string
  date: string
}

export function TransactionHistoryPage() {
  const [filter, setFilter] = useState<'all' | 'credit' | 'debit'>('all')
  const [transactions, setTransactions] = useState<Transaction[]>([])

  const { loading, error, retry } = useAsync(
    async () => {
      const res = await api.get('/wallet/transactions')
      const raw = res.data?.data || res.data || []
      const data: Transaction[] = Array.isArray(raw) ? raw : (raw.items || [])
      setTransactions(data)
      return data
    },
    true
  )

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="flex gap-2">{[1, 2, 3].map(i => <div key={i} className="skeleton h-10 w-24 rounded-xl" />)}</div>
        <SkeletonLoader lines={8} variant="table" />
      </div>
    )
  }

  if (error) {
    return (
      <EmptyState 
        icon={Receipt}
        title="Failed to load transactions" 
        description="Please check your connection and try again"
        action={<button onClick={retry} className="btn btn-primary btn-sm">Retry</button>} 
      />
    )
  }

  const filtered = filter === 'all' ? transactions : transactions.filter(t => t.type === filter)

  return (
    <div className="space-y-6">
      <PageHeader title="Transaction History" subtitle="View all your wallet transactions" />

      <AnimatedPage delay={50}>
        <div className="flex gap-2">
          <button 
            onClick={() => setFilter('all')} 
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              filter === 'all' ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}>
            All
          </button>
          <button 
            onClick={() => setFilter('credit')} 
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              filter === 'credit' ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}>
            Credits
          </button>
          <button 
            onClick={() => setFilter('debit')} 
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              filter === 'debit' ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
            }`}>
            Debits
          </button>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        {filtered.length === 0 ? (
          <EmptyState 
            icon={Receipt}
            title={filter === 'all' ? 'No transactions yet' : `No ${filter}s found`}
            description="Your transactions will appear here"
          />
        ) : (
          <div className="glass-card overflow-hidden">
            <table className="min-w-full divide-y divide-surface-200 dark:divide-surface-700">
              <thead className="bg-surface-50 dark:bg-surface-800/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">Type</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-200 dark:divide-surface-700">
                {filtered.map(tx => (
                  <tr key={tx.id} className="hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors">
                    <td className="px-6 py-4 text-sm text-surface-600 dark:text-surface-300">{tx.date}</td>
                    <td className="px-6 py-4 text-sm font-medium text-surface-900 dark:text-white">{tx.description}</td>
                    <td className="px-6 py-4 text-sm capitalize">
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${
                        tx.type === 'credit' 
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className={`px-6 py-4 text-right text-sm font-bold ${tx.type === 'credit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {tx.type === 'credit' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AnimatedPage>
    </div>
  )
}

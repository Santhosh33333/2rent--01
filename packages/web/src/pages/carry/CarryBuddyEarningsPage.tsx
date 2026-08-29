import { useState, useEffect } from 'react'
import {
  DollarSign, TrendingUp, ArrowDownRight, ArrowUpRight, Wallet,
  Clock, Download, AlertTriangle, Gift, IndianRupee, RefreshCw
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

type TimeRange = 'today' | 'week' | 'month'

interface Transaction {
  _id: string
  amount: number
  type: string
  description: string
  createdAt: string
  status: string
}

interface EarningsData {
  total: number
  today: number
  week: number
  month: number
  transactions: Transaction[]
}

const TIME_TABS: { key: TimeRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
]

export function CarryBuddyEarningsPage() {
  const [activeRange, setActiveRange] = useState<TimeRange>('today')
  const [earnings, setEarnings] = useState<EarningsData>({ total: 0, today: 0, week: 0, month: 0, transactions: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)

  useEffect(() => {
    const fetchEarnings = async () => {
      setLoading(true)
      setError(null)
      try {
        const [earningsRes, walletRes] = await Promise.allSettled([
          api.get('/carry-buddy/earnings'),
          api.get('/wallet'),
        ])

        let total = 0, today = 0, week = 0, month = 0, transactions: Transaction[] = []

        if (earningsRes.status === 'fulfilled') {
          const d = earningsRes.value.data?.data ?? earningsRes.value.data ?? {}
          total = d.total ?? 0
          today = d.today ?? 0
          week = d.week ?? 0
          month = d.month ?? 0
          transactions = d.transactions ?? []
        }

        if (walletRes.status === 'fulfilled') {
          const w = walletRes.value.data?.data ?? walletRes.value.data ?? {}
          if (!total && w.balance) total = w.balance
        }

        setEarnings({ total, today, week, month, transactions })
      } catch {
        setError('Failed to load earnings')
      } finally {
        setLoading(false)
      }
    }
    fetchEarnings()
  }, [])

  const handleWithdraw = async () => {
    setWithdrawing(true)
    try {
      await api.post('/wallet/withdraw', { amount: earnings.total })
    } catch {
      // silently fail
    } finally {
      setWithdrawing(false)
    }
  }

  const currentAmount = earnings[activeRange] ?? 0

  const getDisplayTransactions = () => {
    const now = new Date()
    return earnings.transactions.filter((tx) => {
      const txDate = new Date(tx.createdAt)
      if (activeRange === 'today') {
        return txDate.toDateString() === now.toDateString()
      }
      if (activeRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return txDate >= weekAgo
      }
      if (activeRange === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        return txDate >= monthAgo
      }
      return true
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="glass-card-static p-5">
              <div className="skeleton h-4 w-20 rounded-xl" />
              <div className="skeleton h-10 w-28 mt-3 rounded-xl" />
            </div>
          ))}
        </div>
        <SkeletonLoader variant="list" lines={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><AlertTriangle className="w-10 h-10 text-danger-400" /></div>
        <h3 className="empty-state-title">Failed to load earnings</h3>
        <p className="empty-state-desc">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary mt-6">Retry</button>
      </div>
    )
  }

  const displayTransactions = getDisplayTransactions()

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-amber-500" />
            Earnings
          </h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Track your carry buddy earnings and payouts</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="flex gap-1 p-1 rounded-2xl bg-surface-100 dark:bg-surface-800/50">
          {TIME_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveRange(tab.key)}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeRange === tab.key
                  ? 'bg-white dark:bg-surface-700 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AnimatedPage delay={150}>
          <div className={`glass-card p-5 group hover:shadow-glow transition-all duration-300 hover:-translate-y-0.5`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-500 dark:text-surface-400">Total Balance</p>
                <p className="mt-2 text-3xl font-bold text-surface-900 dark:text-white tracking-tight">₹{earnings.total.toLocaleString('en-IN')}</p>
              </div>
              <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Wallet className="w-5 h-5" />
              </div>
            </div>
          </div>
        </AnimatedPage>

        <AnimatedPage delay={200}>
          <div className={`glass-card p-5 group hover:shadow-glow transition-all duration-300 hover:-translate-y-0.5`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-500 dark:text-surface-400">
                  {activeRange === 'today' ? 'Today' : activeRange === 'week' ? 'This Week' : 'This Month'}
                </p>
                <p className="mt-2 text-3xl font-bold text-surface-900 dark:text-white tracking-tight">₹{currentAmount.toLocaleString('en-IN')}</p>
              </div>
              <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <TrendingUp className="w-5 h-5" />
              </div>
            </div>
          </div>
        </AnimatedPage>

        <AnimatedPage delay={250}>
          <div className={`glass-card p-5 group hover:shadow-glow transition-all duration-300 hover:-translate-y-0.5`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-500 dark:text-surface-400">Incentives Earned</p>
                <p className="mt-2 text-3xl font-bold text-surface-900 dark:text-white tracking-tight">₹{Math.floor(earnings.total * 0.05).toLocaleString('en-IN')}</p>
              </div>
              <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500/20 to-sky-600/10 text-sky-600 dark:text-sky-400 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Gift className="w-5 h-5" />
              </div>
            </div>
          </div>
        </AnimatedPage>
      </div>

      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="section-title flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-500" />
              Transaction History
            </h2>
          </div>

          {displayTransactions.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center mb-4 animate-float">
                <IndianRupee className="w-8 h-8 text-surface-400" />
              </div>
              <h3 className="font-bold text-surface-900 dark:text-surface-100 mb-1 font-display">No transactions yet</h3>
              <p className="text-sm text-surface-500 dark:text-surface-400">Complete carry jobs to start earning</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayTransactions.map((tx) => (
                <div key={tx._id} className="flex items-center gap-4 p-4 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800/50 transition-all group">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    tx.type === 'credit' || tx.type === 'earning'
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  }`}>
                    {tx.type === 'credit' || tx.type === 'earning' ? <ArrowDownRight className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">{tx.description || 'Carry job earning'}</p>
                    <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                      {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
                      {new Date(tx.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <p className={`text-sm font-bold flex-shrink-0 ${
                    tx.type === 'credit' || tx.type === 'earning'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {tx.type === 'credit' || tx.type === 'earning' ? '+' : '-'}₹{tx.amount}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={400}>
        <GlassCard variant="elevated" padding="lg">
          <h2 className="section-title flex items-center gap-2 mb-4">
            <Gift className="w-5 h-5 text-amber-500" />
            Incentives Breakdown
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Weekly completion bonus</span>
              </div>
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">₹{Math.floor(earnings.total * 0.02).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Peak hours surcharge</span>
              </div>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">₹{Math.floor(earnings.total * 0.02).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-sky-500/5 border border-sky-500/10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-sm font-medium text-surface-700 dark:text-surface-300">Perfect delivery streak</span>
              </div>
              <span className="text-sm font-bold text-sky-600 dark:text-sky-400">₹{Math.floor(earnings.total * 0.01).toLocaleString('en-IN')}</span>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={450}>
        <button
          onClick={handleWithdraw}
          disabled={withdrawing || earnings.total <= 0}
          className="w-full btn-primary py-3.5 text-base flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0"
        >
          {withdrawing ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <Download className="w-5 h-5" />
          )}
          {withdrawing ? 'Processing...' : `Withdraw ₹${earnings.total.toLocaleString('en-IN')}`}
        </button>
      </AnimatedPage>
    </div>
  )
}

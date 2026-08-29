import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet, ArrowUpRight, ArrowDownRight, TrendingUp, DollarSign, Clock, CreditCard
} from 'lucide-react'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface WalletData {
  balance: number
  currency: string
}

interface Transaction {
  id: string
  type: string
  amount: number
  description: string
  status: string
  createdAt: string
}

interface Earnings {
  today: number
  weekly: number
  monthly: number
}

export function PartnerWalletPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [earnings, setEarnings] = useState<Earnings>({ today: 0, weekly: 0, monthly: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const [walletRes, txRes, perfRes] = await Promise.allSettled([
          api.get('/wallet'),
          api.get('/wallet/transactions'),
          api.get('/partner/performance'),
        ])
        if (walletRes.status === 'fulfilled') {
          const d = walletRes.value.data?.data || walletRes.value.data
          setWallet({ balance: d?.balance ?? 0, currency: d?.currency ?? 'INR' })
        }
        if (txRes.status === 'fulfilled') {
          const raw = txRes.value.data?.data || txRes.value.data
          const items = raw?.items || (Array.isArray(raw) ? raw : [])
          setTransactions(items)
        }
        if (perfRes.status === 'fulfilled') {
          const d = perfRes.value.data?.data || perfRes.value.data
          setEarnings({
            today: d?.todayEarnings ?? 0,
            weekly: d?.weeklyEarnings ?? 0,
            monthly: d?.monthlyEarnings ?? 0,
          })
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchWallet()
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-48 rounded-3xl" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <SkeletonLoader key={i} variant="card" />)}
        </div>
        <SkeletonLoader variant="list" lines={4} />
      </div>
    )
  }

  const txIcon = (type: string) => {
    switch (type) {
      case 'CREDIT': return <ArrowDownRight className="w-4 h-4 text-emerald-500" />
      case 'DEBIT': return <ArrowUpRight className="w-4 h-4 text-red-500" />
      case 'WITHDRAWAL': return <CreditCard className="w-4 h-4 text-amber-500" />
      default: return <DollarSign className="w-4 h-4 text-surface-400" />
    }
  }

  const txColor = (type: string) => {
    switch (type) {
      case 'CREDIT': return 'text-emerald-600 dark:text-emerald-400'
      case 'DEBIT': return 'text-red-600 dark:text-red-400'
      case 'WITHDRAWAL': return 'text-amber-600 dark:text-amber-400'
      default: return 'text-surface-600 dark:text-surface-400'
    }
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 sm:p-8 text-white shadow-xl shadow-emerald-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-5 h-5 text-white/80" />
              <span className="text-sm font-medium text-white/80">Partner Wallet</span>
            </div>
            <p className="text-4xl sm:text-5xl font-bold font-display">₹{(wallet?.balance ?? 0).toLocaleString('en-IN')}</p>
            <p className="text-white/60 text-sm mt-2">Available Balance</p>
            <div className="flex gap-3 mt-8">
              <Link to="/wallet/withdraw" className="px-6 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-all flex items-center gap-2 backdrop-blur-sm">
                <ArrowUpRight className="w-4 h-4" /> Withdraw
              </Link>
              <Link to="/wallet/transactions" className="px-6 py-3 rounded-2xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-all flex items-center gap-2 backdrop-blur-sm">
                <Clock className="w-4 h-4" /> History
              </Link>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Today's Earnings", value: `₹${earnings.today.toLocaleString('en-IN')}`, icon: DollarSign, gradient: 'from-emerald-500 to-emerald-600' },
            { label: 'This Week', value: `₹${earnings.weekly.toLocaleString('en-IN')}`, icon: TrendingUp, gradient: 'from-sky-500 to-blue-600' },
            { label: 'This Month', value: `₹${earnings.monthly.toLocaleString('en-IN')}`, icon: Wallet, gradient: 'from-violet-500 to-violet-600' },
          ].map((stat) => (
            <div key={stat.label} className="glass-card-static p-4 text-center group hover:-translate-y-0.5 transition-all duration-300">
              <div className={`w-10 h-10 mx-auto rounded-2xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg mb-2 group-hover:scale-110 transition-transform`}>
                <stat.icon className="w-4 h-4 text-white" />
              </div>
              <p className="text-lg font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
              <p className="text-[10px] text-surface-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="section-title flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-500" /> Transaction History
            </h2>
          </div>
          {transactions.length === 0 ? (
            <EmptyState icon={Wallet} title="No transactions yet" description="Complete jobs to start earning" />
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center flex-shrink-0">
                    {txIcon(tx.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 dark:text-white truncate">{tx.description}</p>
                    <p className="text-xs text-surface-500 mt-0.5">
                      {new Date(tx.createdAt).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-bold ${txColor(tx.type)}`}>
                      {tx.type === 'CREDIT' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
                    </p>
                    {tx.status === 'PENDING' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">Pending</span>
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

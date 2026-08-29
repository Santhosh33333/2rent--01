import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Star, TrendingUp, Award, CheckCircle, BarChart3,
  User, DollarSign, Wallet, ChevronRight, ArrowUpRight
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface PerformanceData {
  todayEarnings: number
  weeklyEarnings: number
  monthlyEarnings: number
  lifetimeEarnings: number
  pendingEarnings: number
  withdrawableBalance: number
  todayJobs: number
  weeklyJobs: number
  totalJobs: number
  completedJobs: number
  cancelledJobs: number
  completionRate: number
  monthlyJobs: number[]
  monthlyChart: number[]
  monthLabels: string[]
  averageRating: number
  level: string
  levelPoints: number
  recentRatings: {
    id: string
    userName: string
    userAvatar?: string
    rating: number
    comment: string
    createdAt: string
  }[]
}

export function PartnerPerformancePage() {
  const [data, setData] = useState<PerformanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'jobs' | 'earnings'>('jobs')

  useEffect(() => {
    api.get('/partner/performance')
      .then(res => {
        const d = res.data?.data ?? res.data
        setData({
          todayEarnings: d?.todayEarnings ?? 0,
          weeklyEarnings: d?.weeklyEarnings ?? 0,
          monthlyEarnings: d?.monthlyEarnings ?? 0,
          lifetimeEarnings: d?.lifetimeEarnings ?? 0,
          pendingEarnings: d?.pendingEarnings ?? 0,
          withdrawableBalance: d?.withdrawableBalance ?? 0,
          todayJobs: d?.todayJobs ?? 0,
          weeklyJobs: d?.weeklyJobs ?? 0,
          totalJobs: d?.totalJobs ?? 0,
          completedJobs: d?.completedJobs ?? 0,
          cancelledJobs: d?.cancelledJobs ?? 0,
          completionRate: d?.completionRate ?? 100,
          monthlyJobs: Array.isArray(d?.monthlyJobs) ? d.monthlyJobs : [],
          monthlyChart: Array.isArray(d?.monthlyEarningsChart) ? d.monthlyEarningsChart : [],
          monthLabels: Array.isArray(d?.monthLabels) ? d.monthLabels : [],
          averageRating: d?.averageRating ?? 0,
          level: d?.level ?? 'Bronze',
          levelPoints: d?.levelPoints ?? 0,
          recentRatings: Array.isArray(d?.recentRatings) ? d.recentRatings : [],
        })
      })
      .catch(() => toast.error('Failed to load performance data'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-52 rounded-3xl" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonLoader key={i} variant="card" />)}
        </div>
        <SkeletonLoader variant="card" />
      </div>
    )
  }

  if (!data) return null

  const barData = tab === 'jobs' ? data.monthlyJobs : data.monthlyChart
  const maxBar = barData.length > 0 ? Math.max(...barData, 1) : 1
  const fmt = (n: number) => n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : `₹${Math.round(n)}`

  const levelColor: Record<string, string> = {
    Bronze: 'from-amber-600 to-amber-700',
    Silver: 'from-slate-400 to-slate-500',
    Gold: 'from-yellow-400 to-yellow-500',
    Platinum: 'from-sky-400 to-sky-500',
    Diamond: 'from-violet-500 to-violet-700',
  }
  const levelGrad = levelColor[data.level] ?? 'from-amber-600 to-amber-700'

  return (
    <div className="space-y-6">

      {/* Level hero */}
      <AnimatedPage>
        <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${levelGrad} p-6 sm:p-8 text-white shadow-xl`}>
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10 text-center">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center mb-4 ring-2 ring-white/30 shadow-xl">
              <Award className="w-10 h-10 text-white" />
            </div>
            <p className="text-white/70 text-sm">Partner Level</p>
            <h1 className="text-3xl font-bold font-display mt-1">{data.level}</h1>
            <div className="flex items-center justify-center gap-1 mt-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Star
                  key={i}
                  className={`w-5 h-5 ${i <= Math.round(data.averageRating) ? 'fill-yellow-300 text-yellow-300' : 'text-white/30'}`}
                />
              ))}
              <span className="ml-2 text-lg font-bold">{data.averageRating.toFixed(1)}</span>
            </div>
            {/* XP bar */}
            <div className="mt-4 bg-white/15 rounded-xl p-3 max-w-xs mx-auto">
              <div className="flex justify-between text-xs text-white/70 mb-1.5">
                <span>{data.levelPoints} XP</span>
                <span>{1000 - (data.levelPoints % 1000)} to next</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-700"
                  style={{ width: `${Math.min((data.levelPoints % 1000) / 10, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </AnimatedPage>

      {/* 4 stat cards */}
      <AnimatedPage delay={100}>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Total Jobs', value: data.totalJobs, icon: CheckCircle, gradient: 'from-emerald-500 to-emerald-600' },
            { label: 'Completion', value: `${data.completionRate}%`, icon: TrendingUp, gradient: 'from-sky-500 to-blue-600' },
            { label: 'Lifetime Earn', value: fmt(data.lifetimeEarnings), icon: DollarSign, gradient: 'from-amber-500 to-orange-600' },
            { label: 'Avg Rating', value: `★ ${data.averageRating.toFixed(1)}`, icon: Star, gradient: 'from-violet-500 to-violet-600' },
          ].map(s => (
            <div key={s.label} className="glass-card p-5 group hover:-translate-y-0.5 transition-all duration-300">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400">{s.label}</p>
                  <p className="mt-2 text-2xl font-bold text-surface-900 dark:text-white">{s.value}</p>
                </div>
                <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${s.gradient} flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0`}>
                  <s.icon className="w-5 h-5 text-white" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </AnimatedPage>

      {/* Earnings breakdown */}
      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-5">
            <h3 className="section-title flex items-center gap-2">
              <Wallet className="w-5 h-5 text-emerald-500" /> Earnings Breakdown
            </h3>
            <Link to="/partner/wallet"
              className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              Wallet <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Today', value: fmt(data.todayEarnings), jobs: data.todayJobs, color: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' },
              { label: 'This Week', value: fmt(data.weeklyEarnings), jobs: data.weeklyJobs, color: 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300' },
              { label: 'This Month', value: fmt(data.monthlyEarnings), jobs: null, color: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' },
              { label: 'Pending', value: fmt(data.pendingEarnings), jobs: null, color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' },
            ].map(e => (
              <div key={e.label} className={`rounded-2xl p-4 ${e.color}`}>
                <p className="text-xs font-medium opacity-70 mb-1">{e.label}</p>
                <p className="text-xl font-bold font-display">{e.value}</p>
                {e.jobs !== null && (
                  <p className="text-xs opacity-60 mt-0.5">{e.jobs} jobs</p>
                )}
              </div>
            ))}
          </div>

          {data.withdrawableBalance > 0 && (
            <div className="mt-4 flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
              <div>
                <p className="text-xs text-white/70">Available to withdraw</p>
                <p className="text-2xl font-bold">{fmt(data.withdrawableBalance)}</p>
              </div>
              <Link to="/partner/wallet"
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-all">
                Withdraw <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      {/* Bar chart — toggle jobs vs earnings */}
      <AnimatedPage delay={200}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-5">
            <h3 className="section-title flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-violet-500" /> Monthly Chart
            </h3>
            <div className="flex bg-surface-100 dark:bg-surface-800 rounded-xl p-1 gap-1">
              {(['jobs', 'earnings'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    tab === t
                      ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow'
                      : 'text-surface-500 hover:text-surface-700'
                  }`}
                >
                  {t === 'jobs' ? 'Jobs' : 'Earnings'}
                </button>
              ))}
            </div>
          </div>

          {barData.length === 0 ? (
            <div className="text-center py-8 text-surface-400">No data yet</div>
          ) : (
            <div className="flex items-end justify-between gap-1.5 h-36">
              {barData.map((val, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                  <span className="text-[9px] font-medium text-surface-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    {tab === 'jobs' ? val : fmt(val)}
                  </span>
                  <div
                    className="w-full bg-gradient-to-t from-violet-500 to-violet-400 rounded-t-lg transition-all duration-500 hover:from-violet-600 hover:to-violet-500"
                    style={{ height: `${Math.max((val / maxBar) * 96, val > 0 ? 4 : 0)}px` }}
                    title={tab === 'jobs' ? `${val} jobs` : fmt(val)}
                  />
                  <span className="text-[9px] text-surface-400">{data.monthLabels[i]}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      {/* Jobs breakdown */}
      <AnimatedPage delay={250}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-5 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-500" /> Job Breakdown
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Total Jobs', value: data.totalJobs, color: 'bg-surface-500' },
              { label: 'Completed', value: data.completedJobs, color: 'bg-emerald-500' },
              { label: 'Cancelled', value: data.cancelledJobs, color: 'bg-red-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${row.color} flex-shrink-0`} />
                <span className="flex-1 text-sm text-surface-600 dark:text-surface-400">{row.label}</span>
                <span className="text-sm font-bold text-surface-900 dark:text-white">{row.value}</span>
                {data.totalJobs > 0 && (
                  <span className="text-xs text-surface-400 w-10 text-right">
                    {Math.round((row.value / data.totalJobs) * 100)}%
                  </span>
                )}
              </div>
            ))}
            {/* Completion rate bar */}
            <div className="pt-2">
              <div className="flex justify-between text-xs text-surface-500 mb-1">
                <span>Completion rate</span>
                <span className="font-semibold text-emerald-600">{data.completionRate}%</span>
              </div>
              <div className="h-2 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-700"
                  style={{ width: `${data.completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      {/* Recent ratings */}
      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-5 flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-500" /> Recent Ratings
          </h3>
          {data.recentRatings.length === 0 ? (
            <div className="text-center py-10">
              <Star className="w-8 h-8 text-surface-300 mx-auto mb-3" />
              <p className="text-sm text-surface-500">Complete bookings to receive ratings</p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.recentRatings.map(r => (
                <div key={r.id} className="p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {r.userAvatar ? (
                        <img src={r.userAvatar} alt={r.userName}
                          className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                          <User className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                        </div>
                      )}
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">{r.userName}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star key={i} className={`w-3.5 h-3.5 ${i <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-surface-300 dark:text-surface-600'}`} />
                      ))}
                    </div>
                  </div>
                  {r.comment && (
                    <p className="text-sm text-surface-600 dark:text-surface-400 italic">"{r.comment}"</p>
                  )}
                  <p className="text-xs text-surface-400 mt-2">
                    {new Date(r.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ClipboardList, MapPin, Wallet, Star, TrendingUp, CheckCircle,
  ToggleLeft, ToggleRight, Navigation, Calendar, Zap, ChevronRight,
  DollarSign, Award, Flame
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface PartnerStatus {
  isAvailable: boolean
  status: string
  averageRating: number
  completedJobs: number
}

interface PerformanceData {
  todayJobs: number
  weeklyJobs: number
  todayEarnings: number
  weeklyEarnings: number
  monthlyEarnings: number
  lifetimeEarnings: number
  pendingEarnings: number
  withdrawableBalance: number
  averageRating: number
  completionRate: number
  level: string
  levelPoints: number
  monthlyJobs: number[]
  monthLabels: string[]
}

interface ActiveJob {
  id: string
  serviceType: string
  startLocation: string
  status: string
  scheduledAt: string
  partnerEarning?: number
}

export function PartnerDashboardPage() {
  const { user } = useAuth()
  const [partnerStatus, setPartnerStatus] = useState<PartnerStatus>({
    isAvailable: true,
    status: 'NONE',
    averageRating: 0,
    completedJobs: 0,
  })
  const [perf, setPerf] = useState<PerformanceData>({
    todayJobs: 0, weeklyJobs: 0,
    todayEarnings: 0, weeklyEarnings: 0, monthlyEarnings: 0,
    lifetimeEarnings: 0, pendingEarnings: 0, withdrawableBalance: 0,
    averageRating: 0, completionRate: 100, level: 'Bronze', levelPoints: 0,
    monthlyJobs: [], monthLabels: [],
  })
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<ActiveJob[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [statusRes, perfRes, jobsRes] = await Promise.allSettled([
          api.get('/partner/status'),
          api.get('/partner/performance'),
          api.get('/partner/bookings?limit=5'),
        ])

        if (statusRes.status === 'fulfilled') {
          const d = statusRes.value.data?.data ?? statusRes.value.data
          setPartnerStatus({
            isAvailable: d?.isAvailable ?? true,
            status: d?.status ?? 'NONE',
            averageRating: d?.averageRating ?? 0,
            completedJobs: d?.completedJobs ?? 0,
          })
        }

        if (perfRes.status === 'fulfilled') {
          const d = perfRes.value.data?.data ?? perfRes.value.data
          setPerf({
            todayJobs: d?.todayJobs ?? 0,
            weeklyJobs: d?.weeklyJobs ?? 0,
            todayEarnings: d?.todayEarnings ?? 0,
            weeklyEarnings: d?.weeklyEarnings ?? 0,
            monthlyEarnings: d?.monthlyEarnings ?? 0,
            lifetimeEarnings: d?.lifetimeEarnings ?? 0,
            pendingEarnings: d?.pendingEarnings ?? 0,
            withdrawableBalance: d?.withdrawableBalance ?? 0,
            averageRating: d?.averageRating ?? 0,
            completionRate: d?.completionRate ?? 100,
            level: d?.level ?? 'Bronze',
            levelPoints: d?.levelPoints ?? 0,
            monthlyJobs: d?.monthlyJobs ?? [],
            monthLabels: d?.monthLabels ?? [],
          })
        }

        if (jobsRes.status === 'fulfilled') {
          const raw = jobsRes.value.data?.data?.items ?? jobsRes.value.data?.data ?? jobsRes.value.data ?? []
          const arr: ActiveJob[] = Array.isArray(raw) ? raw : []
          const active = arr.find(j => j.status === 'IN_PROGRESS' || j.status === 'OTP_GENERATED')
          setActiveJob(active ?? null)
          setRecentJobs(arr.slice(0, 5))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const toggleAvailability = async () => {
    if (toggling) return
    const newVal = !partnerStatus.isAvailable
    setPartnerStatus(p => ({ ...p, isAvailable: newVal }))
    setToggling(true)
    try {
      await api.put('/partner/availability', { isAvailable: newVal })
    } catch {
      setPartnerStatus(p => ({ ...p, isAvailable: !newVal }))
    } finally {
      setToggling(false)
    }
  }

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const fmt = (n: number) =>
    n >= 1000
      ? `₹${(n / 1000).toFixed(1)}k`
      : `₹${Math.round(n)}`

  const levelColor: Record<string, string> = {
    Bronze: 'from-amber-600 to-amber-700',
    Silver: 'from-slate-400 to-slate-500',
    Gold: 'from-yellow-400 to-yellow-500',
    Platinum: 'from-sky-400 to-sky-500',
    Diamond: 'from-violet-400 to-violet-600',
  }
  const levelGradient = levelColor[perf.level] ?? 'from-amber-600 to-amber-700'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-52 rounded-3xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonLoader key={i} variant="card" />)}
        </div>
        <SkeletonLoader variant="list" lines={4} />
      </div>
    )
  }

  const maxBar = Math.max(...perf.monthlyJobs, 1)

  return (
    <div className="space-y-6 sm:space-y-8">

      {/* Hero banner */}
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 sm:p-8 text-white shadow-xl shadow-emerald-500/20">
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-teal-500/20 rounded-full blur-3xl" />
          <div className="relative z-10">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
              <div>
                <p className="text-white/70 text-sm">{greeting()}</p>
                <h1 className="text-2xl sm:text-3xl font-bold font-display mt-0.5">
                  {user?.name?.split(' ')[0] ?? 'Partner'}
                </h1>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gradient-to-r ${levelGradient} text-white text-xs font-bold shadow`}>
                    <Award className="w-3 h-3" /> {perf.level}
                  </span>
                  {perf.completionRate >= 95 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 text-xs font-semibold">
                      <Flame className="w-3 h-3 text-orange-300" /> Top Partner
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={toggleAvailability}
                disabled={toggling}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all self-start ${
                  partnerStatus.isAvailable
                    ? 'bg-white/20 hover:bg-white/30'
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                }`}
              >
                {partnerStatus.isAvailable
                  ? <><ToggleRight className="w-5 h-5" /> Online</>
                  : <><ToggleLeft className="w-5 h-5" /> Offline</>}
              </button>
            </div>

            {/* 4 quick stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Today's Jobs", value: perf.todayJobs, icon: ClipboardList },
                { label: "Today's Earn", value: fmt(perf.todayEarnings), icon: DollarSign },
                { label: 'Rating', value: `★ ${perf.averageRating.toFixed(1)}`, icon: Star },
                { label: 'Completion', value: `${perf.completionRate}%`, icon: perf.completionRate >= 95 ? CheckCircle : TrendingUp },
              ].map(s => (
                <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-3.5 border border-white/10">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <s.icon className="w-3.5 h-3.5 text-white/60" />
                    <span className="text-[10px] font-medium text-white/60 uppercase tracking-wide">{s.label}</span>
                  </div>
                  <p className="text-lg font-bold">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AnimatedPage>

      {/* Active job banner */}
      {activeJob && (
        <AnimatedPage delay={50}>
          <GlassCard variant="elevated" padding="lg" className="border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                <Zap className="w-4 h-4" /> Active Job
              </h2>
              <Link to={`/bookings/${activeJob.id}`} className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                View <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 flex-shrink-0">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                  {activeJob.startLocation || activeJob.serviceType}
                </p>
                <p className="text-xs text-surface-500 mt-0.5">
                  {activeJob.status.replace(/_/g, ' ')}
                  {activeJob.partnerEarning ? ` · ₹${activeJob.partnerEarning}` : ''}
                </p>
              </div>
              <Link to={`/bookings/${activeJob.id}/tracking`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-sm font-semibold shadow-lg shadow-emerald-500/25">
                <Navigation className="w-4 h-4" /> Track
              </Link>
            </div>
          </GlassCard>
        </AnimatedPage>
      )}

      {/* Quick actions */}
      <AnimatedPage delay={100}>
        <h2 className="section-title mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { to: '/partner/jobs', icon: ClipboardList, label: 'Jobs', gradient: 'from-emerald-500 to-emerald-600' },
            { to: '/partner/map', icon: Navigation, label: 'Nearby', gradient: 'from-sky-500 to-blue-600' },
            { to: '/partner/wallet', icon: Wallet, label: 'Wallet', gradient: 'from-amber-500 to-orange-600' },
            { to: '/partner/performance', icon: TrendingUp, label: 'Analytics', gradient: 'from-violet-500 to-violet-600' },
          ].map(a => (
            <Link key={a.to} to={a.to}
              className="group glass-card-static p-4 text-center hover:-translate-y-1 transition-all duration-300">
              <div className={`w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br ${a.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                <a.icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-xs sm:text-sm font-bold text-surface-900 dark:text-surface-100">{a.label}</p>
            </Link>
          ))}
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Earnings breakdown */}
        <AnimatedPage delay={150} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-5">
              <h2 className="section-title flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-500" /> Earnings
              </h2>
              <Link to="/partner/performance" className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                Full report <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { label: 'Today', value: fmt(perf.todayEarnings), sub: `${perf.todayJobs} jobs`, color: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' },
                { label: 'This Week', value: fmt(perf.weeklyEarnings), sub: `${perf.weeklyJobs} jobs`, color: 'bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300' },
                { label: 'This Month', value: fmt(perf.monthlyEarnings), sub: 'month total', color: 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300' },
                { label: 'Lifetime', value: fmt(perf.lifetimeEarnings), sub: 'all time', color: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' },
              ].map(e => (
                <div key={e.label} className={`rounded-2xl p-4 ${e.color}`}>
                  <p className="text-xs font-medium opacity-70 mb-1">{e.label}</p>
                  <p className="text-2xl font-bold font-display">{e.value}</p>
                  <p className="text-xs opacity-60 mt-0.5">{e.sub}</p>
                </div>
              ))}
            </div>

            {/* Withdrawable callout */}
            {perf.withdrawableBalance > 0 && (
              <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                <div>
                  <p className="text-xs text-white/70">Available to withdraw</p>
                  <p className="text-2xl font-bold">{fmt(perf.withdrawableBalance)}</p>
                </div>
                <Link to="/partner/wallet"
                  className="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold transition-all">
                  Withdraw
                </Link>
              </div>
            )}
          </GlassCard>
        </AnimatedPage>

        {/* Right column */}
        <AnimatedPage delay={200}>
          <div className="space-y-4">

            {/* Level card */}
            <GlassCard variant="elevated" padding="lg" className={`bg-gradient-to-br ${levelGradient} text-white border-0`}>
              <div className="flex items-center gap-3 mb-3">
                <Award className="w-6 h-6 text-white/80" />
                <span className="text-sm font-semibold text-white/80">Partner Level</span>
              </div>
              <p className="text-3xl font-bold font-display">{perf.level}</p>
              <div className="mt-3 bg-white/15 rounded-xl p-3">
                <div className="flex justify-between text-xs text-white/70 mb-1.5">
                  <span>XP Points</span>
                  <span>{perf.levelPoints}</span>
                </div>
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-700"
                    style={{ width: `${Math.min((perf.levelPoints % 1000) / 10, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-white/50 mt-1">
                  {1000 - (perf.levelPoints % 1000)} XP to next level
                </p>
              </div>
            </GlassCard>

            {/* Mini bar chart */}
            {perf.monthlyJobs.length > 0 && (
              <GlassCard variant="elevated" padding="lg">
                <h3 className="font-bold text-surface-900 dark:text-white mb-4 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-violet-500" /> Monthly Jobs
                </h3>
                <div className="flex items-end gap-1 h-20">
                  {perf.monthlyJobs.map((n, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                      <div
                        className="w-full bg-gradient-to-t from-violet-500 to-violet-400 rounded-t-lg transition-all duration-500"
                        style={{ height: `${Math.max((n / maxBar) * 60, n > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-[9px] text-surface-400">{perf.monthLabels[i]}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {/* Today summary */}
            <GlassCard variant="elevated" padding="md">
              <h3 className="font-bold text-surface-900 dark:text-white mb-3 flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-emerald-500" /> Today
              </h3>
              <div className="space-y-2">
                {[
                  { label: 'Jobs', value: perf.todayJobs, icon: ClipboardList, color: 'text-emerald-500' },
                  { label: 'Earned', value: fmt(perf.todayEarnings), icon: Wallet, color: 'text-amber-500' },
                  { label: 'Pending', value: fmt(perf.pendingEarnings), icon: DollarSign, color: 'text-sky-500' },
                ].map(it => (
                  <div key={it.label} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <it.icon className={`w-3.5 h-3.5 ${it.color}`} />
                      <span className="text-xs text-surface-500">{it.label}</span>
                    </div>
                    <span className="text-sm font-bold text-surface-900 dark:text-white">{it.value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </AnimatedPage>
      </div>

      {/* Recent jobs */}
      <AnimatedPage delay={250}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center justify-between mb-5">
            <h2 className="section-title flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-emerald-500" /> Recent Jobs
            </h2>
            <Link to="/partner/jobs" className="text-sm text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              All jobs <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {recentJobs.length === 0 ? (
            <div className="text-center py-10">
              <ClipboardList className="w-8 h-8 text-surface-300 mx-auto mb-3" />
              <p className="text-sm text-surface-500">No jobs yet — go online to start receiving requests!</p>
            </div>
          ) : (
            <div className="divide-y divide-surface-100 dark:divide-surface-800">
              {recentJobs.map(job => (
                <Link key={job.id} to={`/bookings/${job.id}`}
                  className="flex items-center gap-3 py-3 hover:bg-surface-50 dark:hover:bg-surface-800/40 rounded-xl px-2 -mx-2 transition-all group">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <MapPin className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white truncate">
                      {job.startLocation || job.serviceType}
                    </p>
                    <p className="text-xs text-surface-500">
                      {job.status.replace(/_/g, ' ')}
                      {job.partnerEarning ? ` · ₹${job.partnerEarning}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-surface-300 group-hover:text-surface-500 flex-shrink-0 transition-colors" />
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

    </div>
  )
}

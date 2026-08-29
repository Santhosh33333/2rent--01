import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  User, Star, Settings, Shield, Camera, ChevronRight, Award, Footprints,
  Wallet, MessageSquare, LogOut, Phone, Mail, CheckCircle, Package, FileText
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { RoleSwitcher } from '../../components/RoleSwitcher'

interface PartnerStats {
  totalJobs: number
  averageRating: number
  totalEarnings: number
  serviceTypes: string[]
}

export function PartnerProfilePage() {
  const { user, logout } = useAuth()
  const [stats, setStats] = useState<PartnerStats>({ totalJobs: 0, averageRating: 0, totalEarnings: 0, serviceTypes: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const [statsRes, statusRes] = await Promise.allSettled([
          api.get('/partner/performance'),
          api.get('/partner/status'),
        ])
        if (statsRes.status === 'fulfilled') {
          const d = statsRes.value.data?.data || statsRes.value.data
          setStats({
            totalJobs: d?.totalJobs ?? 0,
            averageRating: d?.averageRating ?? 0,
            totalEarnings: d?.totalEarnings ?? 0,
            serviceTypes: d?.serviceTypes ?? [],
          })
        }
        if (statusRes.status === 'fulfilled') {
          const d = statusRes.value.data?.data || statusRes.value.data
          setStats((prev) => ({ ...prev, serviceTypes: d?.serviceTypes ?? prev.serviceTypes }))
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

  const initials = user?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || '?'

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-48 rounded-3xl" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <SkeletonLoader key={i} variant="card" />)}
        </div>
        <SkeletonLoader variant="card" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500 p-6 sm:p-8 text-white shadow-xl shadow-emerald-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />

          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative group">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl avatar flex items-center justify-center text-white text-3xl font-bold ring-4 ring-white/20">
                {initials}
              </div>
              <button className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-white text-emerald-600 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all hover:scale-110">
                <Camera className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold font-display">{user?.name || 'Partner'}</h1>
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-2 mt-2 flex-wrap">
                {stats.serviceTypes.includes('WALKING') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm">
                    <Footprints className="w-3 h-3" /> Walking
                  </span>
                )}
                {stats.serviceTypes.includes('CARRY_BUDDY') && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm">
                    <Package className="w-3 h-3" /> CarryBuddy
                  </span>
                )}
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-4 text-sm text-white/60 mt-2">
                <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user?.email || 'No email'}</span>
                <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{user?.phone || 'No phone'}</span>
              </div>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Jobs', value: stats.totalJobs, icon: Footprints, gradient: 'from-emerald-500 to-emerald-600' },
            { label: 'Rating', value: `★ ${stats.averageRating.toFixed(1)}`, icon: Star, gradient: 'from-amber-500 to-amber-600' },
            { label: 'Earnings', value: `₹${stats.totalEarnings.toLocaleString('en-IN')}`, icon: Wallet, gradient: 'from-violet-500 to-violet-600' },
          ].map((stat) => (
            <div key={stat.label} className="glass-card-static p-4 text-center group hover:-translate-y-0.5 transition-all duration-300">
              <div className={`w-11 h-11 mx-auto rounded-2xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center shadow-lg mb-3 group-hover:scale-110 transition-transform`}>
                <stat.icon className="w-5 h-5 text-white" />
              </div>
              <p className="text-xl font-bold font-display text-surface-900 dark:text-white">{stat.value}</p>
              <p className="text-xs text-surface-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary-500" /> Documents & KYC
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Identity Verification', status: 'Verified', verified: true },
                { label: 'Address Proof', status: 'Pending', verified: false },
                { label: 'Bank Details', status: 'Verified', verified: true },
              ].map((doc) => (
                <div key={doc.label} className="flex items-center justify-between p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${doc.verified ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                      <CheckCircle className={`w-4 h-4 ${doc.verified ? 'text-emerald-500' : 'text-amber-500'}`} />
                    </div>
                    <span className="text-sm font-medium text-surface-900 dark:text-white">{doc.label}</span>
                  </div>
                  <span className={`text-xs font-medium ${doc.verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {doc.status}
                  </span>
                </div>
              ))}
            </div>
          </GlassCard>
        </AnimatedPage>

        <AnimatedPage delay={300}>
          <div className="space-y-6">
            <GlassCard variant="elevated" padding="lg">
              <h3 className="section-title text-sm flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-surface-500" /> Settings
              </h3>
              <div className="space-y-2">
                {[
                  { to: '/profile', icon: User, label: 'Edit Profile' },
                  { to: '/verification', icon: Shield, label: 'Verification' },
                  { to: '/messages', icon: MessageSquare, label: 'Messages' },
                  { to: '/partner/performance', icon: Award, label: 'Performance' },
                ].map((link) => (
                  <Link key={link.to} to={link.to} className="flex items-center justify-between p-3 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors group">
                    <span className="text-sm text-surface-700 dark:text-surface-300 flex items-center gap-2">
                      <link.icon className="w-4 h-4" /> {link.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-surface-400 group-hover:text-emerald-500 transition-colors" />
                  </Link>
                ))}
                {/* Switch back to the USER (or other) account */}
                <RoleSwitcher />
              </div>
            </GlassCard>

            <button onClick={logout} className="w-full btn-outline text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 border-danger-200 dark:border-danger-800/30">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

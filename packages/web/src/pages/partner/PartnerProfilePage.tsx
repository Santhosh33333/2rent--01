import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  User, Star, Settings, Shield, Camera, ChevronRight, Award, Footprints,
  Wallet, LogOut, Phone, Mail, CheckCircle, FileText, Check, X, MessageCircle
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { Avatar } from '../../components/Avatar'
import { useAvatarUpload } from '../../lib/photo'
import { AvatarCropper } from '../../components/AvatarCropper'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { RoleSwitcher } from '../../components/RoleSwitcher'
import toast from 'react-hot-toast'

interface PartnerStats {
  totalJobs: number
  averageRating: number
  totalEarnings: number
  serviceTypes: string[]
  kycStatus?: string
}

export function PartnerProfilePage() {
  const { user, logout, updateUser } = useAuth()
  const avatar = useAvatarUpload((avatarUrl) => updateUser({ avatarUrl }))
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [stats, setStats] = useState<PartnerStats>({ totalJobs: 0, averageRating: 0, totalEarnings: 0, serviceTypes: [] })
  const [loading, setLoading] = useState(true)
  // Which sessions this partner takes. Named `providesWalking`/`providesCarry`
  // in the schema; on screen they are the two choices the apply flow offers.
  const [services, setServices] = useState({ call: false, chat: false })
  const [savingService, setSavingService] = useState<null | 'call' | 'chat'>(null)

  const toggleService = async (key: 'call' | 'chat') => {
    if (savingService) return
    const next =
      key === 'call' ? { ...services, call: !services.call } : { ...services, chat: !services.chat }
    if (!next.call && !next.chat) {
      toast.error('Keep at least one: choose Call sessions or Chat sessions.')
      return
    }
    setSavingService(key)
    setServices(next)
    try {
      await api.put('/partner/services', {
        providesWalking: next.call,
        providesCarry: next.chat,
      })
    } catch {
      setServices(services) // the save failed — show the truth, not the optimism
      toast.error('Could not update your services. Please try again.')
    } finally {
      setSavingService(null)
    }
  }

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const [statsRes, statusRes, kycRes] = await Promise.allSettled([
          api.get('/partner/performance'),
          api.get('/partner/status'),
          api.get('/verification/status'),
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
          setServices({ call: !!d?.providesWalking, chat: !!d?.providesCarry })
        }
        if (kycRes.status === 'fulfilled') {
          const d = kycRes.value.data?.data || kycRes.value.data
          setStats((prev) => ({ ...prev, kycStatus: d?.status ?? 'NOT_STARTED' }))
        }
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    fetchProfile()
  }, [])

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
      {avatar.cropFile && (
        <AvatarCropper file={avatar.cropFile} onCancel={avatar.cancelCrop} onDone={avatar.applyCrop} />
      )}
      <AnimatedPage>
        <div className="hero-indigo">
          <div className="hero-sheen pointer-events-none absolute inset-0" />

          <div className="prism-aurora animate-prism-drift opacity-50" aria-hidden />

          <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-[#D2F53C]/15 blur-3xl" />

          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative group">
              <Avatar
                src={avatar.previewUrl || user?.avatarUrl}
                name={user?.name}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl ring-4 ring-white/20"
                textClassName="text-3xl"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (fileInputRef.current) fileInputRef.current.value = ''
                  avatar.pick(file)
                }}
              />
              {avatar.previewUrl ? (
                <>
                  <button
                    type="button"
                    onClick={() => avatar.confirm()}
                    disabled={avatar.uploading}
                    aria-label="Use this photo"
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-lg hover:scale-110 transition-all disabled:opacity-50"
                  >
                    {avatar.uploading ? (
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" strokeWidth={3} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => avatar.cancel()}
                    disabled={avatar.uploading}
                    aria-label="Discard photo"
                    className="absolute -bottom-1 left-0 w-8 h-8 rounded-xl bg-surface-900/80 text-white flex items-center justify-center shadow-lg hover:scale-110 transition-all disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatar.uploading}
                  aria-label="Change photo"
                  className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-white text-emerald-600 flex items-center justify-center shadow-lg hover:scale-110 transition-all"
                >
                  <Camera className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold font-display">{user?.name || 'Partner'}</h1>
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-2 mt-2 flex-wrap">
                {services.call && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm">
                    <Phone className="w-3 h-3" /> Call sessions
                  </span>
                )}
                {services.chat && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm">
                    <MessageCircle className="w-3 h-3" /> Chat sessions
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
            { label: 'Total Jobs', value: stats.totalJobs, icon: Footprints, gradient: 'from-primary-500 to-primary-700' },
            { label: 'Rating', value: `★ ${stats.averageRating.toFixed(1)}`, icon: Star, gradient: 'from-accent-400 to-accent-500' },
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

      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title flex items-center gap-2 mb-1">
            <CheckCircle className="w-5 h-5 text-primary-500" /> My services
          </h3>
          <p className="text-xs text-surface-500 mb-4">
            Pick the sessions you take. Only matching jobs are sent to you, and you can change
            this any time.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {([
              { key: 'call', icon: Phone, label: 'Call sessions', desc: 'Jobs that start with a voice call in the app', on: services.call },
              { key: 'chat', icon: MessageCircle, label: 'Chat sessions', desc: 'Jobs that start with an in-app chat', on: services.chat },
            ] as const).map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={s.on}
                disabled={savingService !== null}
                onClick={() => toggleService(s.key)}
                className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all active:scale-[0.99] disabled:opacity-60 ${
                  s.on
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-200 dark:border-surface-700'
                }`}
              >
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    s.on ? 'bg-primary-500 text-white' : 'bg-surface-100 dark:bg-surface-800 text-surface-500'
                  }`}
                >
                  <s.icon className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-surface-900 dark:text-white">
                    {s.label}
                  </span>
                  <span className="block text-xs text-surface-500 dark:text-surface-400">
                    {s.desc}
                  </span>
                </span>
                <span
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    s.on
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-surface-300 dark:border-surface-600'
                  }`}
                >
                  {s.on && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>
          {savingService && <p className="mt-2 text-[11px] text-surface-400">Saving…</p>}
        </GlassCard>
      </AnimatedPage>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary-500" /> Documents & KYC
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Identity Verification', status: stats.kycStatus === 'VERIFIED' || stats.kycStatus === 'APPROVED' ? 'Verified' : stats.kycStatus === 'SUBMITTED' || stats.kycStatus === 'PENDING_REVIEW' ? 'Under Review' : 'Not Started', verified: stats.kycStatus === 'VERIFIED' || stats.kycStatus === 'APPROVED' },
                { label: 'Address Proof', status: stats.kycStatus === 'VERIFIED' || stats.kycStatus === 'APPROVED' ? 'Verified' : stats.kycStatus === 'SUBMITTED' || stats.kycStatus === 'PENDING_REVIEW' ? 'Under Review' : 'Not Started', verified: stats.kycStatus === 'VERIFIED' || stats.kycStatus === 'APPROVED' },
                { label: 'Bank Details', status: 'Pending', verified: false },
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
                  { to: '/partner/performance', icon: Award, label: 'Performance' },
                  { to: '/messages', icon: MessageCircle, label: 'Messages' },
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

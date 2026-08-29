import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '../../lib/auth'
import { Link } from 'react-router-dom'
import { VerificationBadge } from '../../components/VerificationBadge'
import { TrustScoreDisplay } from '../../components/TrustScoreDisplay'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { RoleSwitcher } from '../../components/RoleSwitcher'
import { useRole } from '../../lib/roleContext'
import {
  User, Mail, Phone, Camera, Save, X, Shield,
  LogOut, ChevronRight, MapPin, Calendar, Award, Edit3,
  Clock, AlertTriangle, Sparkles, Settings, Lock, Repeat
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api, assetUrl } from '../../lib/api'

export function ProfilePage() {
  const { user, updateUser, logout } = useAuth()
  const { approvedRoles, activeRole } = useRole()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [profileStats, setProfileStats] = useState<{ walksCompleted?: number; eventsJoined?: number; averageRating?: number; joinedYear?: number } | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<Record<string, unknown> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
    },
  })

  useEffect(() => {
    api.get('/users/profile/stats').then(r => setProfileStats(r.data.data)).catch(() => {})
    api.get('/verification/status').then(r => setVerificationStatus(r.data.data)).catch(() => {})
  }, [])

  const onSubmit = async (data: { name?: string; email?: string; phone?: string; bio?: string; city?: string; country?: string; gender?: string }) => {
    setSaving(true)
    try {
      await api.put('/users/profile', {
        fullName: data.name,
        bio: data.bio,
        city: data.city,
        country: data.country,
        gender: data.gender,
      })
      updateUser({ name: data.name, email: data.email, phone: data.phone })
      setEditing(false)
      toast.success('Profile updated successfully')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('photo', file)
      const res = await api.post('/users/profile-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const avatarUrl = res.data?.data?.avatarUrl
      if (avatarUrl) {
        updateUser({ avatarUrl })
        toast.success('Photo updated!')
      }
    } catch {
      toast.error('Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const adminRoles = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE"]
  const isAdmin = user?.role && adminRoles.includes(user.role)
  const initials = user?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase() || '?'

  const stats = [
    { label: 'Walks', value: profileStats?.walksCompleted ?? '—', icon: MapPin, gradient: 'from-emerald-500 to-emerald-600' },
    { label: 'Events', value: profileStats?.eventsJoined ?? '—', icon: Calendar, gradient: 'from-violet-500 to-violet-600' },
    { label: 'Rating', value: profileStats?.averageRating ?? '—', icon: Award, gradient: 'from-amber-500 to-amber-600' },
    { label: 'Joined', value: profileStats?.joinedYear ?? '—', icon: Clock, gradient: 'from-blue-500 to-blue-600' },
  ]

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Profile Header */}
      <AnimatedPage>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 p-6 sm:p-8 text-white shadow-xl shadow-primary-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-white/10 rounded-full blur-3xl" />

          <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="relative group">
              {user?.avatarUrl ? (
                <img src={assetUrl(user.avatarUrl) || ''} alt="avatar" className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover ring-4 ring-white/20" />
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl avatar flex items-center justify-center text-white text-3xl font-bold ring-4 ring-white/20">
                  {initials}
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-white text-primary-600 flex items-center justify-center shadow-lg hover:scale-110 transition-all disabled:opacity-50"
              >
                {uploading ? (
                  <span className="w-4 h-4 rounded-full border-2 border-primary-300 border-t-primary-600 animate-spin" />
                ) : (
                  <Camera className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="flex-1 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold font-display">{user?.name || 'User'}</h1>
                <VerificationBadge status={(user?.kycStatus === 'VERIFIED' || user?.kycStatus === 'APPROVED') ? 'verified' : 'pending'} size="sm" />
              </div>
              <p className="text-white/60 text-sm mb-3">@{user?.email?.split('@')[0] || 'user'}</p>
              <div className="flex items-center justify-center sm:justify-start gap-4 text-sm text-white/60">
                <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />{user?.email || 'No email'}</span>
                <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{user?.phone || 'No phone'}</span>
              </div>
            </div>

            <div className="flex gap-2">
              {!editing && (
                <button onClick={() => setEditing(true)} className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-semibold transition-colors flex items-center gap-2">
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
              )}
            </div>
          </div>
        </div>
      </AnimatedPage>

      {/* Stats Grid */}
      <AnimatedPage delay={100}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((stat) => (
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
        {/* Profile Form */}
        <AnimatedPage delay={200} className="lg:col-span-2">
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="section-title flex items-center gap-2">
                <User className="w-5 h-5 text-primary-500" />
                Profile Information
              </h2>
              {editing && (
                <button onClick={() => setEditing(false)} className="btn-ghost btn-sm">
                  <X className="w-4 h-4" /> Cancel
                </button>
              )}
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div>
                <label className="label">Full Name</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                  <input {...register('name', { required: 'Name is required' })} disabled={!editing} className="input pl-11" placeholder="Your full name" />
                </div>
                {errors.name && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.name.message}</p>}
              </div>

              <div>
                <label className="label">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                  <input {...register('email', { required: 'Email is required' })} disabled={!editing} className="input pl-11" placeholder="your@email.com" />
                </div>
                {errors.email && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.email.message}</p>}
              </div>

              <div>
                <label className="label">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                  <input {...register('phone')} disabled={!editing} className="input pl-11" placeholder="+91 98765 43210" />
                </div>
              </div>

              {editing && (
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? (
                      <span className="flex items-center gap-2"><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Saving...</span>
                    ) : (
                      <span className="flex items-center gap-2"><Save className="w-4 h-4" />Save Changes</span>
                    )}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
                </div>
              )}
            </form>
          </GlassCard>
        </AnimatedPage>

        {/* Sidebar */}
        <AnimatedPage delay={300}>
          <div className="space-y-6">
            {/* Trust Score */}
            <GlassCard variant="elevated" padding="lg">
              <h3 className="section-title text-sm flex items-center gap-2 mb-4">
                <Award className="w-4 h-4 text-amber-500" /> Trust Score
              </h3>
              <TrustScoreDisplay score={user?.trustScore || 0} size="md" />
            </GlassCard>

            {/* Verification Status */}
            <GlassCard variant="elevated" padding="lg">
              <h3 className="section-title text-sm flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-emerald-500" /> Verification
              </h3>
              <div className="space-y-3">
                {(() => {
                  // /verification/status returns booleans under `documents`
                  // (with top-level fallbacks) — there are no *Url fields.
                  const docs = (verificationStatus?.documents || {}) as Record<string, boolean>
                  const has = (k: string, topKey: string) => Boolean(docs[k] ?? verificationStatus?.[topKey])
                  const kycDone = verificationStatus?.status === 'VERIFIED'
                  const kycRejected = verificationStatus?.status === 'REJECTED'
                  const docStatus = (uploaded: boolean) =>
                    uploaded ? (kycDone ? 'verified' as const : kycRejected ? 'rejected' as const : 'pending' as const) : 'not-started' as const
                  return [
                    { label: 'Email', status: user?.isVerified ? 'verified' as const : 'not-started' as const },
                    { label: 'Mobile', status: user?.phone ? 'verified' as const : 'not-started' as const },
                    { label: 'Selfie', status: docStatus(has('selfie', 'selfie')) },
                    { label: 'Government ID', status: docStatus(has('govId', 'govId')) },
                    { label: 'Address Proof', status: docStatus(has('addressProof', 'addressProof')) },
                  ]
                })().map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-sm text-surface-600 dark:text-surface-400">{item.label}</span>
                    <VerificationBadge status={item.status} size="sm" />
                  </div>
                ))}
              </div>
              <Link to="/verification" className="mt-4 btn-outline btn-sm w-full justify-center text-xs">
                Complete Verification <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </GlassCard>

            {/* Account Switching (USER <-> PARTNER, etc.) */}
            {(approvedRoles.length > 1 || activeRole !== 'USER') && (
              <GlassCard variant="elevated" padding="lg">
                <h3 className="section-title text-sm flex items-center gap-2 mb-3">
                  <Repeat className="w-4 h-4 text-primary-500" /> Account Type
                </h3>
                <p className="text-xs text-surface-500 mb-3">Switch between your accounts.</p>
                <RoleSwitcher />
              </GlassCard>
            )}

            {/* Admin Access */}
            {isAdmin && (
              <GlassCard variant="elevated" padding="lg" className="border-l-4 border-amber-500">
                <h3 className="section-title text-sm flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-amber-500" /> Admin Access
                </h3>
                <p className="text-xs text-surface-500 mb-4">You have administrative privileges.</p>
                <Link to="/admin/portal" className="btn-primary btn-sm w-full justify-center">
                  <Sparkles className="w-4 h-4" /> Admin Portal
                </Link>
              </GlassCard>
            )}

            {/* Account Settings */}
            <GlassCard variant="elevated" padding="lg">
              <h3 className="section-title text-sm flex items-center gap-2 mb-4">
                <Settings className="w-4 h-4 text-surface-500" /> Account
              </h3>
              <div className="space-y-2">
                <Link to="/verification" className="flex items-center justify-between p-3 rounded-2xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors group">
                  <span className="text-sm text-surface-700 dark:text-surface-300 flex items-center gap-2"><Lock className="w-4 h-4" /> Security Settings</span>
                  <ChevronRight className="w-4 h-4 text-surface-400 group-hover:text-primary-500 transition-colors" />
                </Link>
                <button className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors text-danger-500">
                  <span className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Delete Account</span>
                </button>
              </div>
            </GlassCard>

            {/* Logout */}
            <button onClick={logout} className="w-full btn-outline text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 border-danger-200 dark:border-danger-800/30">
              <LogOut className="w-4 h-4" /> Sign Out
            </button>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

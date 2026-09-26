import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, UserPlus, X, Loader2, KeyRound, Check, FileDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminApi } from '../../lib/api'
import { exportTableToPdf } from '../../lib/pdfExport'
import { useAuth } from '../../lib/auth'

interface AdminAccount {
  id: string
  email: string
  phone?: string
  fullName: string
  status: string
  role: string
  activeRole?: string
  createdAt: string
  permissions?: string[] | null
  adminProfile?: { department?: string; role?: { name: string; permissions?: string } } | null
}

// Roles that delegate platform admin powers. Must match the backend's
// ASSIGNABLE_ADMIN_ROLES so creation never fails with INVALID_ROLE.
const ASSIGNABLE_ROLES = ['MODERATOR', 'SUPPORT', 'FINANCE', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'KYC_ADMIN', 'MARKETING_ADMIN', 'PARTNER_ADMIN']

// ---------------------------------------------------------------------------
// Permission picker — real backend tokens in `SECTION.ACTION` form.
// The backend enforces these exactly via requireSectionAction() (never trusts
// the UI), so the keys here MUST match rbac/sections.ts on the server.
// ---------------------------------------------------------------------------
type Action = 'VIEW' | 'CREATE' | 'EDIT' | 'APPROVE' | 'REJECT' | 'DELETE' | 'EXPORT'

const SECTION_LABELS: Record<string, string> = {
  USERS: 'Users',
  PARTNERS: 'Partners',
  KYC: 'KYC / Verification',
  BOOKINGS: 'Bookings',
  JOBS: 'Jobs',
  DISPATCH: 'Dispatch',
  PAYMENTS: 'Payments',
  REFUNDS: 'Refunds',
  WALLETS: 'Wallets',
  WITHDRAWALS: 'Withdrawals',
  PRICING: 'Pricing',
  OFFERS: 'Offers',
  COUPONS: 'Coupons',
  COMMUNITIES: 'Communities',
  EVENTS: 'Events',
  DATING: 'Dating',
  MOVIES: 'Movies',
  REPORTS: 'Reports',
  AGREEMENTS: 'Agreements',
  SUPPORT: 'Support tickets',
  NOTIFICATIONS: 'Notifications',
  ANALYTICS: 'Analytics',
  CONTENT_MODERATION: 'Content moderation',
  SECURITY: 'Security',
  ADMIN_MANAGEMENT: 'Admin management',
  SYSTEM_SETTINGS: 'System settings',
  AUDIT_LOGS: 'Audit logs',
}

const ACTION_LABELS: Record<Action, string> = {
  VIEW: 'View',
  CREATE: 'Create',
  EDIT: 'Edit',
  APPROVE: 'Approve',
  REJECT: 'Reject',
  DELETE: 'Delete',
  EXPORT: 'Export',
}

// Which actions are shown per section (keeps the form usable without dumping
// all 26×7 pairs at once).
const SECTION_ACTIONS: Record<string, Action[]> = {
  USERS: ['VIEW', 'EDIT'],
  PARTNERS: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'],
  KYC: ['VIEW', 'EDIT', 'APPROVE', 'REJECT', 'EXPORT'],
  BOOKINGS: ['VIEW', 'EDIT'],
  JOBS: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'],
  DISPATCH: ['VIEW'],
  PAYMENTS: ['VIEW', 'EXPORT'],
  REFUNDS: ['VIEW', 'APPROVE', 'REJECT'],
  WALLETS: ['VIEW', 'EDIT'],
  WITHDRAWALS: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'],
  PRICING: ['VIEW', 'EDIT'],
  OFFERS: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
  COUPONS: ['VIEW', 'CREATE', 'EDIT', 'DELETE'],
  COMMUNITIES: ['VIEW', 'CREATE', 'EDIT'],
  EVENTS: ['VIEW', 'CREATE', 'EDIT'],
  DATING: ['VIEW'],
  MOVIES: ['VIEW'],
  REPORTS: ['VIEW', 'APPROVE', 'REJECT'],
  SUPPORT: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'],
  NOTIFICATIONS: ['VIEW', 'CREATE'],
  ANALYTICS: ['VIEW'],
  CONTENT_MODERATION: ['VIEW', 'APPROVE', 'REJECT'],
  SECURITY: ['VIEW', 'EDIT'],
  ADMIN_MANAGEMENT: ['VIEW', 'EDIT'],
  SYSTEM_SETTINGS: ['VIEW', 'EDIT'],
  AUDIT_LOGS: ['VIEW', 'EXPORT'],
  AGREEMENTS: ['VIEW', 'EXPORT'],
}

const PERMISSION_GROUPS = [
  { group: 'People', sections: ['USERS', 'PARTNERS', 'KYC', 'REPORTS', 'SUPPORT'] },
  { group: 'Money', sections: ['PAYMENTS', 'REFUNDS', 'WALLETS', 'WITHDRAWALS', 'PRICING'] },
  { group: 'Operations', sections: ['BOOKINGS', 'JOBS', 'DISPATCH', 'COMMUNITIES', 'EVENTS'] },
  { group: 'Growth', sections: ['OFFERS', 'COUPONS', 'NOTIFICATIONS', 'DATING', 'MOVIES'] },
  { group: 'System', sections: ['CONTENT_MODERATION', 'SECURITY', 'ADMIN_MANAGEMENT', 'SYSTEM_SETTINGS', 'AUDIT_LOGS', 'AGREEMENTS'] },
]

function tokensForAction(section: string, action: Action): string {
  return `${section}.${action}`
}

const ALL_PERMISSIONS: string[] = Object.entries(SECTION_ACTIONS).flatMap(([section, actions]) =>
  actions.map((a) => tokensForAction(section, a))
)

// Role templates mirroring backend rbac/sections.ts ROLE_TEMPLATES, so picking
// a role pre-fills its intended default access matrix.
const ROLE_TEMPLATES: Record<string, Record<string, Action[]>> = {
  MODERATOR: { USERS: ['VIEW'], REPORTS: ['VIEW'], CONTENT_MODERATION: ['VIEW', 'APPROVE', 'REJECT'] },
  SUPPORT: { USERS: ['VIEW', 'EDIT'], BOOKINGS: ['VIEW'], REPORTS: ['VIEW', 'APPROVE', 'REJECT'], SUPPORT: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'] },
  FINANCE: { WALLETS: ['VIEW', 'EDIT'], REFUNDS: ['VIEW', 'APPROVE', 'REJECT'], WITHDRAWALS: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'], PAYMENTS: ['VIEW', 'EXPORT'], ANALYTICS: ['VIEW'], REPORTS: ['VIEW'], BOOKINGS: ['VIEW'], AGREEMENTS: ['VIEW', 'EXPORT'] },
  SUPPORT_ADMIN: { USERS: ['VIEW', 'EDIT'], REPORTS: ['VIEW', 'APPROVE', 'REJECT'], SUPPORT: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'], BOOKINGS: ['VIEW'], COMMUNITIES: ['VIEW'], EVENTS: ['VIEW'], NOTIFICATIONS: ['VIEW', 'CREATE'], AUDIT_LOGS: ['VIEW'], AGREEMENTS: ['VIEW', 'EXPORT'] },
  KYC_ADMIN: { KYC: ['VIEW', 'EDIT', 'APPROVE', 'REJECT', 'EXPORT'], USERS: ['VIEW'], REPORTS: ['VIEW'], CONTENT_MODERATION: ['VIEW', 'APPROVE', 'REJECT'], AGREEMENTS: ['VIEW'] },
  FINANCE_ADMIN: { WALLETS: ['VIEW', 'EDIT'], REFUNDS: ['VIEW', 'APPROVE', 'REJECT'], WITHDRAWALS: ['VIEW', 'APPROVE', 'REJECT', 'EXPORT'], PAYMENTS: ['VIEW', 'EXPORT'], ANALYTICS: ['VIEW'], REPORTS: ['VIEW'], BOOKINGS: ['VIEW'], AGREEMENTS: ['VIEW', 'EXPORT'] },
  MARKETING_ADMIN: { OFFERS: ['VIEW', 'CREATE', 'EDIT', 'DELETE'], COUPONS: ['VIEW', 'CREATE', 'EDIT', 'DELETE'], COMMUNITIES: ['VIEW', 'CREATE', 'EDIT'], EVENTS: ['VIEW', 'CREATE', 'EDIT'], NOTIFICATIONS: ['VIEW', 'CREATE'], ANALYTICS: ['VIEW'] },
  PARTNER_ADMIN: { PARTNERS: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'], JOBS: ['VIEW', 'EDIT', 'APPROVE', 'REJECT'], BOOKINGS: ['VIEW'], DISPATCH: ['VIEW'], REPORTS: ['VIEW'], COMMUNITIES: ['VIEW'] },
}

function templateTokens(role: string): string[] {
  const tpl = ROLE_TEMPLATES[role] || {}
  return Object.entries(tpl).flatMap(([section, actions]) => actions.map((a) => tokensForAction(section, a)))
}

function PermissionPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((g) => (
        <div key={g.group} className="p-3 rounded-xl bg-gray-950/60 border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{g.group}</span>
            <button
              type="button"
              onClick={() => {
                const keys = g.sections.flatMap((s) => (SECTION_ACTIONS[s] || []).map((a) => tokensForAction(s, a)))
                const allOn = keys.every((k) => selected.includes(k))
                onChange(allOn ? selected.filter((k) => !keys.includes(k)) : Array.from(new Set([...selected, ...keys])))
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white transition"
            >
              {g.sections.every((s) => (SECTION_ACTIONS[s] || []).every((a) => selected.includes(tokensForAction(s, a)))) ? 'None' : 'All'}
            </button>
          </div>
          <div className="space-y-3">
            {g.sections.map((section) => (
              <div key={section}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-600 mb-1">{SECTION_LABELS[section] || section}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(SECTION_ACTIONS[section] || []).map((action) => {
                    const key = tokensForAction(section, action)
                    const on = selected.includes(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onChange(on ? selected.filter((k) => k !== key) : [...selected, key])}
                        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition ${
                          on ? 'bg-emerald-900/30 text-emerald-300' : 'bg-gray-800/60 text-gray-400 hover:text-white'
                        }`}
                      >
                        <span className={`w-3.5 h-3.5 shrink-0 rounded flex items-center justify-center border ${on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-600'}`}>
                          {on && <Check className="w-3 h-3" />}
                        </span>
                        {ACTION_LABELS[action]}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AdminAdminsPage() {
  const { user } = useAuth()
  const isSuperAdmin = String(user?.role || '').toUpperCase() === 'SUPER_ADMIN'

  const [admins, setAdmins] = useState<AdminAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', role: 'SUPPORT_ADMIN', department: '' })
  const [selectedPerms, setSelectedPerms] = useState<string[]>([...templateTokens('SUPPORT_ADMIN')])

  // Per-admin access editor
  const [editing, setEditing] = useState<AdminAccount | null>(null)
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [savingPerms, setSavingPerms] = useState(false)
  const [resetPw, setResetPw] = useState<{ email: string; newPassword: string } | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.getAdminAccounts()
      const d = res.data?.data || res.data
      setAdmins(Array.isArray(d?.items) ? d.items : [])
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load admin accounts'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSuperAdmin) load()
    else setLoading(false)
  }, [isSuperAdmin])

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      await adminApi.createAdminAccount({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        role: form.role,
        department: form.department || undefined,
        permissions: selectedPerms,
      })
      toast.success('Admin account created with access rights')
      setShowForm(false)
      setForm({ fullName: '', email: '', phone: '', password: '', role: 'SUPPORT_ADMIN', department: '' })
      setSelectedPerms([...templateTokens('SUPPORT_ADMIN')])
      load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create admin account'))
    } finally {
      setCreating(false)
    }
  }

  const toggleStatus = async (acc: AdminAccount) => {
    if (busyId) return
    const next = acc.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
    setBusyId(acc.id)
    try {
      await adminApi.updateAdminAccount(acc.id, { status: next })
      toast.success(`${acc.email} is now ${next}`)
      load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update account'))
    } finally {
      setBusyId(null)
    }
  }

  const openEditor = (acc: AdminAccount) => {
    setEditing(acc)
    const known = (acc.permissions || []).filter((p) => ALL_PERMISSIONS.includes(p))
    setEditPerms(known.length ? known : [...templateTokens(acc.role)])
  }

  const savePerms = async () => {
    if (!editing || savingPerms) return
    setSavingPerms(true)
    try {
      await adminApi.updateAdminAccount(editing.id, { permissions: editPerms })
      toast.success(`Access updated for ${editing.fullName}`)
      setEditing(null)
      load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update access'))
    } finally {
      setSavingPerms(false)
    }
  }

  const resetPassword = async (acc: AdminAccount) => {
    if (busyId) return
    setBusyId(acc.id)
    try {
      const res = await adminApi.resetAdminPassword(acc.id)
      const d = res.data?.data || res.data
      setResetPw({ email: acc.email, newPassword: d?.newPassword || '' })
      toast.success(`Password reset for ${acc.email}`)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to reset password'))
    } finally {
      setBusyId(null)
    }
  }

  const accessBadges = (acc: AdminAccount) => {
    if (acc.role === 'SUPER_ADMIN') {
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 font-bold">FULL ACCESS</span>
    }
    const perms = (acc.permissions ?? []).filter((p) => ALL_PERMISSIONS.includes(p) || p === '*')
    const effective = perms.length ? perms : templateTokens(acc.role)
    if (effective.length === 0) {
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 font-bold">NO ACCESS</span>
    }
    return (
      <>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 font-bold">{effective.length} PERM{effective.length === 1 ? '' : 'S'}</span>
        <span className="text-[10px] text-gray-500 truncate max-w-[220px]" title={effective.join(', ')}>
          {effective.slice(0, 3).join(', ')}{effective.length > 3 ? ` +${effective.length - 3}` : ''}
        </span>
      </>
    )
  }

  return (
    <div className="bg-gray-950 p-4 sm:p-6 rounded-3xl">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold font-display text-white">Admin Accounts</h1>
              <p className="text-gray-400 text-sm mt-1">Provision platform administrators and control their access</p>
            </div>
            <button
              onClick={() =>
                exportTableToPdf({
                  title: 'Admin Accounts',
                  subtitle: `${admins.length} account(s)`,
                  columns: ['Name', 'Email', 'Phone', 'Role', 'Access', 'Status'],
                  rows: admins.map((a) => [
                    a.fullName || '-',
                    a.email || '-',
                    a.phone || '-',
                    a.role || '-',
                    a.role === 'SUPER_ADMIN' ? 'FULL ACCESS' : (a.permissions ?? []).length === 0 ? 'NO ACCESS' : `${(a.permissions ?? []).length} perms`,
                    a.status || '-',
                  ]),
                  fileName: `nabri-admins-${new Date().toISOString().slice(0, 10)}`,
                  landscape: true,
                })
              }
              disabled={admins.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 hover:text-white text-sm transition"
            >
              <FileDown className="w-4 h-4" /> PDF
            </button>
          </div>
          {isSuperAdmin && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition"
            >
              <UserPlus className="w-4 h-4" /> Add Admin
            </button>
          )}
        </div>

        {!isSuperAdmin && (
          <div className="mb-6 p-4 rounded-xl bg-amber-900/20 border border-amber-700/40 text-amber-300 text-sm">
            Only the primary Super Admin can view and provision admin accounts.
          </div>
        )}

        {showForm && isSuperAdmin && (
          <form onSubmit={handleCreate} className="mb-8 p-6 rounded-2xl bg-gray-900 border border-gray-800 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-white flex items-center gap-2"><UserPlus className="w-4 h-4" /> New Admin Account</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 hover:text-white transition" aria-label="Close form">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input required placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none" />
              <select value={form.role} onChange={(e) => { const r = e.target.value; setForm({ ...form, role: r }); setSelectedPerms([...templateTokens(r)]) }}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white focus:border-emerald-500 focus:outline-none">
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none" />
              <input required placeholder="Phone (+91…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none" />
              <input required type="password" minLength={8} placeholder="Temporary password (min 8 chars)" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none" />
              <input placeholder="Department (optional)" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                className="px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder:text-gray-500 focus:border-emerald-500 focus:outline-none" />
            </div>

            <div>
              <p className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
                <KeyRound className="w-4 h-4 text-emerald-400" /> Access Rights
                <span className="text-xs font-normal text-gray-500">— choose exactly what this admin can do ({selectedPerms.length} of {ALL_PERMISSIONS.length} selected)</span>
              </p>
              <PermissionPicker selected={selectedPerms} onChange={setSelectedPerms} />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={creating}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition ${creating ? 'opacity-60 pointer-events-none' : ''}`}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {creating ? 'Creating…' : 'Create Account'}
              </button>
              <span className="text-xs text-gray-500">New admins sign in with these credentials immediately.</span>
            </div>
          </form>
        )}

        {/* Per-admin access editor */}
        {editing && (
          <div className="mb-8 p-6 rounded-2xl bg-gray-900 border border-sky-800/50 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white flex items-center gap-2"><KeyRound className="w-4 h-4 text-sky-400" /> Access for {editing.fullName} <span className="text-xs text-gray-500 font-normal">({editing.role})</span></h2>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-500 hover:text-white transition" aria-label="Close editor">
                <X className="w-5 h-5" />
              </button>
            </div>
            <PermissionPicker selected={editPerms} onChange={setEditPerms} />
            <div className="flex items-center gap-3">
              <button onClick={savePerms} disabled={savingPerms}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition disabled:opacity-60">
                {savingPerms ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {savingPerms ? 'Saving…' : 'Save Access'}
              </button>
              <button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition">Cancel</button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            <div className="py-16 text-center text-gray-500">Loading admin accounts…</div>
          ) : admins.length === 0 ? (
            <div className="py-16 text-center text-gray-500">No admin accounts yet.</div>
          ) : (
            admins.map((acc) => (
              <div key={acc.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-5 rounded-2xl bg-gray-900 border border-gray-800">
                <div className="w-11 h-11 shrink-0 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white">{acc.fullName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${
                      acc.role === 'SUPER_ADMIN' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-blue-900/40 text-blue-300'
                    }`}>{acc.role}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${
                      acc.status === 'ACTIVE' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                    }`}>{acc.status}</span>
                    {accessBadges(acc)}
                  </div>
                  <p className="text-sm text-gray-400 truncate mt-0.5">{acc.email}{acc.phone ? ` · ${acc.phone}` : ''}</p>
                  {acc.adminProfile?.department && <p className="text-xs text-gray-500">Dept: {acc.adminProfile.department}</p>}
                </div>
                {isSuperAdmin && acc.role !== 'SUPER_ADMIN' && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => openEditor(acc)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-900/40 text-sky-300 hover:bg-sky-900/60 text-xs font-bold transition"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Access
                    </button>
                    <button
                      onClick={() => resetPassword(acc)}
                      disabled={busyId === acc.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-900/40 text-amber-300 hover:bg-amber-900/60 text-xs font-bold transition disabled:opacity-50"
                    >
                      <KeyRound className="w-3.5 h-3.5" /> Reset PW
                    </button>
                    <button
                      onClick={() => toggleStatus(acc)}
                      disabled={busyId === acc.id}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
                        acc.status === 'ACTIVE'
                          ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60'
                          : 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60'
                      } ${busyId === acc.id ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {busyId === acc.id ? 'Working…' : acc.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {resetPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setResetPw(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">New password</h3>
            <p className="text-sm text-gray-400">Share this securely with <span className="text-white">{resetPw.email}</span>. It replaces their old password immediately.</p>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-950 border border-gray-800">
              <code className="flex-1 text-emerald-300 text-sm break-all">{resetPw.newPassword}</code>
              <button
                onClick={() => { navigator.clipboard?.writeText(resetPw.newPassword); toast.success('Copied') }}
                className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition"
              >
                Copy
              </button>
            </div>
            <button onClick={() => setResetPw(null)} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
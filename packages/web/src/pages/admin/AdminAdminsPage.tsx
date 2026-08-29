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

const ASSIGNABLE_ROLES = ['ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE']

// Every permission the backend's requirePermission() can check, grouped for the UI
const PERMISSION_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: 'People',
    items: [
      { key: 'users.manage', label: 'Manage users' },
      { key: 'kyc.review', label: 'Review KYC' },
      { key: 'partners.manage', label: 'Manage partners' },
      { key: 'reports.manage', label: 'Handle reports' },
    ],
  },
  {
    group: 'Money',
    items: [
      { key: 'payments.view', label: 'View payments & stats' },
      { key: 'withdrawals.manage', label: 'Approve withdrawals' },
      { key: 'revenue.view', label: 'View revenue analytics' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { key: 'bookings.view', label: 'View bookings' },
      { key: 'pricing.manage', label: 'Pricing config' },
      { key: 'coupons.manage', label: 'Coupons' },
      { key: 'areas.manage', label: 'Service areas' },
      { key: 'campaigns.manage', label: 'Campaigns' },
    ],
  },
  {
    group: 'System',
    items: [
      { key: 'audit.view', label: 'View audit logs' },
      { key: 'notifications.send', label: 'Send notifications' },
    ],
  },
]

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key))

function PermissionPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {PERMISSION_GROUPS.map((g) => (
        <div key={g.group} className="p-3 rounded-xl bg-gray-950/60 border border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{g.group}</span>
            <button
              type="button"
              onClick={() => {
                const keys = g.items.map((i) => i.key)
                const allOn = keys.every((k) => selected.includes(k))
                onChange(allOn ? selected.filter((k) => !keys.includes(k)) : Array.from(new Set([...selected, ...keys])))
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white transition"
            >
              {g.items.every((i) => selected.includes(i.key)) ? 'None' : 'All'}
            </button>
          </div>
          <div className="space-y-1.5">
            {g.items.map((item) => {
              const on = selected.includes(item.key)
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onChange(on ? selected.filter((k) => k !== item.key) : [...selected, item.key])}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition ${
                    on ? 'bg-emerald-900/30 text-emerald-300' : 'bg-gray-800/60 text-gray-400 hover:text-white'
                  }`}
                >
                  <span className={`w-4 h-4 shrink-0 rounded flex items-center justify-center border ${on ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-600'}`}>
                    {on && <Check className="w-3 h-3" />}
                  </span>
                  {item.label}
                </button>
              )
            })}
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
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', role: 'MODERATOR', department: '' })
  const [selectedPerms, setSelectedPerms] = useState<string[]>([...ALL_PERMISSIONS])

  // Per-admin access editor
  const [editing, setEditing] = useState<AdminAccount | null>(null)
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [savingPerms, setSavingPerms] = useState(false)

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
      setForm({ fullName: '', email: '', phone: '', password: '', role: 'MODERATOR', department: '' })
      setSelectedPerms([...ALL_PERMISSIONS])
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
    setEditPerms(acc.permissions?.length ? acc.permissions : [...ALL_PERMISSIONS])
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

  const accessBadges = (acc: AdminAccount) => {
    if (acc.role === 'SUPER_ADMIN') {
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 font-bold">FULL ACCESS</span>
    }
    const perms = acc.permissions ?? []
    if (perms.length === 0) {
      return <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 font-bold">NO ACCESS</span>
    }
    return (
      <>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 font-bold">{perms.length} PERM{perms.length === 1 ? '' : 'S'}</span>
        <span className="text-[10px] text-gray-500 truncate max-w-[220px]" title={perms.join(', ')}>
          {perms.slice(0, 3).join(', ')}{perms.length > 3 ? ` +${perms.length - 3}` : ''}
        </span>
      </>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-white">Admin Accounts</h1>
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
                  fileName: `rentbuddy-admins-${new Date().toISOString().slice(0, 10)}`,
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
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
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
    </div>
  )
}
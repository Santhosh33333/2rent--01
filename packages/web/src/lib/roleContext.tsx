import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { api } from './api'
import { useAuth } from './auth'
import { isAdminTierRole, normalizeRole, resolveAccountRole } from './roles'
import type { UserRole } from './roles'

export interface RoleInfo {
  label: string
  icon: string
  color: string
  description: string
}

export const ROLE_META: Record<string, RoleInfo> = {
  USER: { label: 'User', icon: '👤', color: '#55795b', description: 'Browse, book, connect' },
  PARTNER: { label: 'Partner', icon: '🤝', color: '#22c55e', description: 'Accept jobs, earn money' },
  ADMIN: { label: 'Admin', icon: '👨‍💼', color: '#ef4444', description: 'Platform administration' },
  SUPER_ADMIN: { label: 'Super Admin', icon: '👑', color: '#ef4444', description: 'Full platform control' },
  MODERATOR: { label: 'Moderator', icon: '🛡️', color: '#8c7925', description: 'Content moderation' },
  SUPPORT: { label: 'Support', icon: '🎧', color: '#14b8a6', description: 'Help & support' },
  FINANCE: { label: 'Finance', icon: '💰', color: '#10b981', description: 'Financial management' },
  SUPPORT_ADMIN: { label: 'Support Admin', icon: '🎧', color: '#06b6d4', description: 'Support management' },
  FINANCE_ADMIN: { label: 'Finance Admin', icon: '💎', color: '#059669', description: 'Finance management' },
  KYC_ADMIN: { label: 'KYC Admin', icon: '🪪', color: '#8b5cf6', description: 'KYC verification' },
  MARKETING_ADMIN: { label: 'Marketing Admin', icon: '📣', color: '#f59e0b', description: 'Marketing campaigns' },
  PARTNER_ADMIN: { label: 'Partner Admin', icon: '🤝', color: '#16a34a', description: 'Partner management' },
}

interface RoleContextType {
  approvedRoles: UserRole[]
  activeRole: UserRole
  accountRole: UserRole
  loading: boolean
  switchRole: (role: UserRole) => Promise<void>
  applyForRole: (role: UserRole) => Promise<void>
  refreshRoles: () => Promise<void>
  isPartner: boolean
  isAdmin: boolean
  isUser: boolean
}

const RoleContext = createContext<RoleContextType | undefined>(undefined)

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, refreshProfile } = useAuth()
  const [approvedRoles, setApprovedRoles] = useState<UserRole[]>(['USER'])
  const [activeRole, setActiveRole] = useState<UserRole>(() => {
    // An admin-tier account must not boot into a customer preview that a
    // previous session persisted. Only trust the cached preview for accounts
    // that are not administrators.
    const accountRole = resolveAccountRole(user)
    if (isAdminTierRole(accountRole)) return accountRole
    return normalizeRole(localStorage.getItem('activeRole') || user?.activeRole || user?.role || 'USER')
  })
  const [loading, setLoading] = useState(false)

  // The account type, recomputed from the auth profile. This is the value that
  // grants admin access; `activeRole` is only the surface being previewed.
  const accountRole = resolveAccountRole(user)

  // A newly promoted admin holds a preview their account could never own
  // ("USER" from before the promotion). Snap it to the account type exactly
  // once, when the account type changes, so a deliberate preview is never
  // silently reverted by the periodic role poll.
  const lastAccountRoleRef = useRef<UserRole | null>(null)
  useEffect(() => {
    if (lastAccountRoleRef.current === accountRole) return
    const first = lastAccountRoleRef.current === null
    lastAccountRoleRef.current = accountRole
    if (first) return
    if (isAdminTierRole(accountRole)) {
      setActiveRole((current) => (isAdminTierRole(current) ? current : accountRole))
    }
  }, [accountRole])

  const refreshRoles = useCallback(async () => {
    try {
      const res = await api.get('/roles/my-roles')
      const data = res.data?.data
      if (data) {
        const roles = (data.approvedRoles || ['USER']).map(normalizeRole)
        setApprovedRoles(roles)
        // `baseRole` is the account type. It is the fallback whenever the stored
        // preview is missing or is not a role this account is actually approved
        // for, so a promoted admin never inherits a preview their account cannot
        // back. A preview the user picked deliberately is left alone.
        const baseRole = normalizeRole(data.baseRole || data.activeRole || 'USER')
        const preview = normalizeRole(data.activeRole || baseRole)
        const ar = roles.includes(preview) ? preview : baseRole
        setActiveRole(ar)
        localStorage.setItem('activeRole', ar)
      }
    } catch (err) {
      // API might not be available — fall back to the account type first so a
      // failed request can never strand an admin on the customer surface.
      const account = resolveAccountRole(user)
      if (isAdminTierRole(account)) {
        setActiveRole(account)
      } else {
        const saved = localStorage.getItem('activeRole')
        if (saved) setActiveRole(normalizeRole(saved))
        else if (user?.activeRole) setActiveRole(normalizeRole(user.activeRole))
        else if (user?.role) setActiveRole(normalizeRole(user.role))
      }
    } finally {
      setLoading(false)
    }
  }, [user])


  useEffect(() => {
    if (user) {
      refreshRoles()
    }
  }, [user?.id, user?.role, user?.activeRole, refreshRoles])

  // A super admin can grant access while this account is already signed in.
  // Revalidate when the app regains focus and periodically while it stays open
  // so the new role and account details appear without forcing a logout.
  useEffect(() => {
    if (!user) return
    let inFlight = false
    const syncAccess = () => {
      if (inFlight || document.visibilityState === 'hidden') return
      inFlight = true
      void Promise.allSettled([refreshRoles(), refreshProfile()]).finally(() => {
        inFlight = false
      })
    }
    window.addEventListener('focus', syncAccess)
    document.addEventListener('visibilitychange', syncAccess)
    const interval = window.setInterval(syncAccess, 60_000)
    return () => {
      window.removeEventListener('focus', syncAccess)
      document.removeEventListener('visibilitychange', syncAccess)
      window.clearInterval(interval)
    }
  }, [user?.id, refreshProfile, refreshRoles])

  // Boot parallel: fetch roles as soon as a token exists instead of waiting
  // for the profile fetch to finish (profile + roles used to waterfall,
  // doubling time-to-interactive on slow networks).
  useEffect(() => {
    if (!user && typeof window !== 'undefined' && localStorage.getItem('token')) {
      refreshRoles()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchRole = useCallback(
    async (role: UserRole) => {
      try {
        await api.post('/roles/switch', { role })
        setActiveRole(role)
        localStorage.setItem('activeRole', role)
        // Re-sync the full user profile + roles so downstream data (partner
        // profile, wallet, permissions) reflects the newly active role.
        await Promise.all([refreshRoles(), refreshProfile?.()])
      } catch (err) {
        console.error('Failed to switch role:', err)
        throw err
      }
    },
    [refreshRoles, refreshProfile],
  )

  const applyForRole = useCallback(async (role: UserRole) => {
    try {
      await api.post('/roles/apply', { role })
      await refreshRoles()
    } catch (err) {
      console.error('Failed to apply for role:', err)
      throw err
    }
  }, [refreshRoles])

  const isPartner = activeRole === 'PARTNER'
  // Admin capability follows the account type, so a customer preview an admin
  // deliberately switched into cannot hide the admin affordances.
  const isAdmin = isAdminTierRole(accountRole)
  const isUser = !isAdmin && activeRole === 'USER'

  return (
    <RoleContext.Provider value={{
      approvedRoles,
      activeRole,
      accountRole,
      loading,
      switchRole,
      applyForRole,
      refreshRoles,
      isPartner,
      isAdmin,
      isUser,
    }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const context = useContext(RoleContext)
  if (!context) {
    throw new Error('useRole must be used within a RoleProvider')
  }
  return context
}

// Role vocabulary now lives in ./roles so the many call sites that each kept
// their own copy of the admin list cannot drift apart again.
export type { UserRole }
export { normalizeRole }

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from './api'
import { useAuth } from './auth'

export type UserRole = 
  | 'USER' 
  | 'PARTNER'
  | 'MODERATOR'
  | 'SUPPORT'
  | 'FINANCE'
  | 'SUPER_ADMIN'
  | 'ADMIN'

export interface RoleInfo {
  label: string
  icon: string
  color: string
  description: string
}

export const ROLE_META: Record<string, RoleInfo> = {
  USER: { label: 'User', icon: '👤', color: '#6366f1', description: 'Browse, book, connect' },
  PARTNER: { label: 'Partner', icon: '🤝', color: '#22c55e', description: 'Accept jobs, earn money' },
  ADMIN: { label: 'Admin', icon: '👨‍💼', color: '#ef4444', description: 'Platform administration' },
  SUPER_ADMIN: { label: 'Super Admin', icon: '👑', color: '#ef4444', description: 'Full platform control' },
  MODERATOR: { label: 'Moderator', icon: '🛡️', color: '#f97316', description: 'Content moderation' },
  SUPPORT: { label: 'Support', icon: '🎧', color: '#14b8a6', description: 'Help & support' },
  FINANCE: { label: 'Finance', icon: '💰', color: '#10b981', description: 'Financial management' },
}

interface RoleContextType {
  approvedRoles: UserRole[]
  activeRole: UserRole
  loading: boolean
  switchRole: (role: UserRole) => Promise<void>
  applyForRole: (role: UserRole) => Promise<void>
  refreshRoles: () => Promise<void>
  isPartner: boolean
  isAdmin: boolean
  isUser: boolean
}

const RoleContext = createContext<RoleContextType | undefined>(undefined)

function normalizeRole(raw: any): UserRole {
  if (!raw) return 'USER'
  return String(raw).toUpperCase().replace(/\s+/g, '_') as UserRole
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, refreshProfile } = useAuth()
  const [approvedRoles, setApprovedRoles] = useState<UserRole[]>(['USER'])
  const [activeRole, setActiveRole] = useState<UserRole>(() => {
    return normalizeRole(localStorage.getItem('activeRole') || user?.activeRole || user?.role || 'USER')
  })
  const [loading, setLoading] = useState(false)

  const refreshRoles = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    try {
      const res = await api.get('/roles/my-roles')
      const data = res.data?.data
      if (data) {
        const roles = (data.approvedRoles || ['USER']).map(normalizeRole)
        setApprovedRoles(roles)
        const ar = normalizeRole(data.activeRole || data.baseRole || 'USER')
        setActiveRole(ar)
        localStorage.setItem('activeRole', ar)
      }
    } catch (err) {
      // API might not be available — use cached role
      const saved = localStorage.getItem('activeRole')
      if (saved) setActiveRole(normalizeRole(saved))
      else if (user?.activeRole) setActiveRole(normalizeRole(user.activeRole))
      else if (user?.role) setActiveRole(normalizeRole(user.role))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) {
      refreshRoles()
    }
  }, [user?.id])

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
  const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE'].includes(activeRole)
  const isUser = activeRole === 'USER'

  return (
    <RoleContext.Provider value={{
      approvedRoles,
      activeRole,
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

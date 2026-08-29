import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from './api'
import { disconnectGlobalSocket } from '../hooks/useSocket'
import type { RegisterInput } from '../types/api'

interface User {
  id: string
  email: string
  name: string
  phone?: string
  role?: string
  activeRole?: string
  accountType?: string
  isVerified?: boolean
  trustScore?: number
  kycStatus?: string
  kycRejectionReason?: string | null
  partnerStatus?: string | null
  fullName?: string
  city?: string
  bio?: string
  country?: string
  gender?: string
  avatarUrl?: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: RegisterInput) => Promise<void>
  logout: () => void
  updateUser: (data: Partial<User>) => void
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

function buildUserFromPayload(payload: Record<string, unknown>, fallbackName?: string): User {
  const rawRole = (payload?.role || payload?.activeRole || 'USER') as string
  const role = normalizeRole(rawRole)
  const accountType = normalizeRole((payload?.accountType || payload?.userType || payload?.activeRole || payload?.role || 'USER') as string)
  return {
    id: (payload?.id as string) || `local-${Date.now()}`,
    email: (payload?.email as string) || fallbackName || 'user@rentbuddy.local',
    name: (payload?.fullName as string) || (payload?.name as string) || fallbackName || 'RentBuddy User',
    phone: payload?.phone as string,
    role,
    activeRole: normalizeRole((payload?.activeRole || payload?.role || role) as string),
    accountType,
    isVerified: Boolean(payload?.isVerified || payload?.emailVerified || payload?.mobileVerified),
    trustScore: payload?.trustScore as number,
    kycStatus: payload?.kycStatus as string,
    kycRejectionReason: (payload?.kycRejectionReason as string) ?? null,
    partnerStatus: (payload?.partnerStatus as string) ?? null,
    fullName: (payload?.fullName as string) || (payload?.name as string) || fallbackName || 'RentBuddy User',
    city: payload?.city as string,
    bio: payload?.bio as string,
    country: payload?.country as string,
    gender: payload?.gender as string,
    avatarUrl: payload?.avatarUrl as string,
  }
}

function clearSessionData(): void {
  // Session/auth state
  localStorage.removeItem('token')
  localStorage.removeItem('refreshToken')
  localStorage.removeItem('user')
  localStorage.removeItem('activeRole')
  // Routing-state flags must not leak to the next user on a shared device.
  // NOTE: 'theme' / UI prefs intentionally persist — they are device settings,
  // not session state.
  localStorage.removeItem('onboarding_complete')
  localStorage.removeItem('profile_complete')
}

function isDemoSessionToken(value: string | null): boolean {
  return Boolean(value && (value === 'local-demo-token' || value.startsWith('local-demo-')))
}

function loadUser(): User | null {
  try {
    const token = localStorage.getItem('token')
    if (isDemoSessionToken(token)) {
      clearSessionData()
      return null
    }
    const saved = localStorage.getItem('user')
    if (token && saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return null
}

function normalizeRole(raw: string | null | undefined): string {
  if (!raw) return 'USER'
  return String(raw).toUpperCase().replace(/\s+/g, '_')
}

async function restoreSessionFromRefreshToken(): Promise<User | null> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken || isDemoSessionToken(refreshToken)) {
    clearSessionData()
    return null
  }

  const response = await api.post('/auth/refresh-token', { refreshToken })
  const payload = response.data?.data || response.data
  const accessToken = payload?.accessToken
  const nextRefreshToken = payload?.refreshToken
  if (!accessToken) return null

  localStorage.setItem('token', accessToken)
  if (nextRefreshToken) localStorage.setItem('refreshToken', nextRefreshToken)

  const profileRes = await api.get('/users/profile')
  const p = profileRes.data?.data || profileRes.data
  if (!p || !p.id) return null

  const u: User = {
    id: p.id,
    email: p.email,
    name: p.fullName || p.name || 'User',
    phone: p.phone,
    role: normalizeRole(p.role),
    activeRole: normalizeRole(p.activeRole || p.role),
    accountType: normalizeRole(p.accountType || p.userType || p.activeRole || p.role),
    isVerified: p.emailVerified || p.mobileVerified,
    trustScore: p.trustScore,
    kycStatus: p.kycStatus,
    kycRejectionReason: p.kycRejectionReason ?? null,
    partnerStatus: p.partnerStatus ?? null,
    fullName: p.fullName,
    city: p.city,
    bio: p.bio,
    country: p.country,
    gender: p.gender,
  }
  localStorage.setItem('user', JSON.stringify(u))
  return u
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadUser())
  const [loading] = useState(false)

  const refreshProfile = useCallback(async () => {
    const token = localStorage.getItem('token')
    if (!token || isDemoSessionToken(token)) {
      clearSessionData()
      setUser(null)
      return
    }
    try {
      const res = await api.get('/users/profile')
      const p = res.data?.data || res.data
      if (p && p.id) {
        const u = buildUserFromPayload(p, user?.name)
        localStorage.setItem('user', JSON.stringify(u))
        setUser(u)
      }
    } catch {
      const saved = localStorage.getItem('user')
      if (saved) {
        try {
          setUser(JSON.parse(saved))
        } catch {
          // ignore
        }
      }
    }
  }, [user?.name])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const refreshToken = localStorage.getItem('refreshToken')
    if (token && user) {
      refreshProfile()
    } else if (!token && refreshToken && !user) {
      restoreSessionFromRefreshToken()
        .then((restored) => {
          if (restored) setUser(restored)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password })
    const payload = response.data?.data || response.data || {}
    const success = response.data?.success !== false
    if (!success) {
      throw new Error(response.data?.error || response.data?.message || 'Login failed')
    }

    const apiUser = payload.user || payload
    const accessToken = payload.accessToken || payload.token
    const refreshToken = payload.refreshToken

    if (!accessToken || !refreshToken) {
      throw new Error('Authentication tokens were not returned by the server.')
    }

    const u = buildUserFromPayload(
      {
        ...apiUser,
        email: apiUser?.email || email,
        id: apiUser?.id || `user-${Date.now()}`,
        role: apiUser?.role || 'USER',
        activeRole: apiUser?.activeRole || apiUser?.role || 'USER',
        accountType: apiUser?.accountType || apiUser?.userType || apiUser?.activeRole || apiUser?.role || 'USER',
      },
      email
    )

    localStorage.setItem('token', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(u))
    localStorage.setItem('activeRole', u.activeRole || u.role || 'USER')
    setUser(u)
  }

  const register = async (data: RegisterInput) => {
    const payload = {
      fullName: data.fullName || data.name,
      email: data.email,
      phone: data.phone,
      password: data.password,
      dateOfBirth: data.dateOfBirth || '2000-01-01',
      gender: data.gender || 'MALE',
    }

    const response = await api.post('/auth/register', payload)
    const serverPayload = response.data?.data || response.data || {}
    const success = response.data?.success !== false
    if (!success) {
      throw new Error(response.data?.error || response.data?.message || 'Registration failed')
    }

    const apiUser = serverPayload.user || {
      id: `user-${Date.now()}`,
      email: payload.email,
      fullName: payload.fullName,
      role: 'USER',
    }

    const accessToken = serverPayload.accessToken || serverPayload.token
    const refreshToken = serverPayload.refreshToken
    if (!accessToken || !refreshToken) {
      throw new Error('Authentication tokens were not returned by the server.')
    }

    const u = buildUserFromPayload(
      {
        ...apiUser,
        email: apiUser?.email || payload.email,
        fullName: apiUser?.fullName || payload.fullName,
        role: apiUser?.role || 'USER',
        activeRole: apiUser?.activeRole || apiUser?.role || 'USER',
        accountType: apiUser?.accountType || apiUser?.userType || apiUser?.activeRole || apiUser?.role || 'USER',
      },
      payload.fullName || payload.email
    )

    localStorage.setItem('token', accessToken)
    localStorage.setItem('refreshToken', refreshToken)
    localStorage.setItem('user', JSON.stringify(u))
    localStorage.setItem('activeRole', u.activeRole || u.role || 'USER')
    setUser(u)
  }

  const logout = () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (refreshToken && !isDemoSessionToken(refreshToken)) {
      api.post('/auth/logout', { refreshToken }).catch(() => {})
    }
    clearSessionData()
    // Tear down the realtime socket so the session doesn't stay alive server-side
    disconnectGlobalSocket()
    setUser(null)
  }

  const updateUser = (data: Partial<User>) => {
    if (user) {
      const updated = { ...user, ...data }
      setUser(updated)
      localStorage.setItem('user', JSON.stringify(updated))
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

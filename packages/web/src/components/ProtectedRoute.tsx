import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useRole } from '../lib/roleContext'
import {
  ADMIN_TIER_ROLES,
  ROLE_DASHBOARDS,
  isAdminTierRole,
  isSuperAdminRole,
  resolveAccountRole,
} from '../lib/roles'

interface ProtectedRouteProps {
  children?: React.ReactNode
  allowedRoles?: string[]
}

const SUPER_ADMIN_ONLY_PREFIXES = ['/admin/admins', '/admin/audit-logs', '/admin/settings']

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, loading } = useAuth()
  const { activeRole } = useRole()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-primary-200 dark:border-primary-800 border-t-primary-500 animate-spin" />
          <p className="text-sm text-surface-500 animate-pulse">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Administrative access is decided by the account type, never by the
  // role the account happens to be previewing. Reading `activeRole` here used
  // to let a stale "USER" value lock an administrator out of /admin entirely.
  const accountRole = resolveAccountRole(user)
  const isAdminUser = isAdminTierRole(accountRole)
  const isSuperAdmin = isSuperAdminRole(accountRole)
  const isAdminRoute = location.pathname.startsWith('/admin')

  // A non-admin account is governed by the surface it is previewing.
  const effectiveRole = isAdminUser ? accountRole : (activeRole || accountRole)

  // ---- ADMIN ROLE GATING ----
  // Admins bypass profile/KYC gates on USER routes, but on admin routes
  // we still enforce allowedRoles and SUPER_ADMIN-only routes.
  if (isAdminUser) {
    if (isAdminRoute) {
      // Enforce SUPER_ADMIN-only routes
      const needsSuperAdmin = SUPER_ADMIN_ONLY_PREFIXES.some((p) => location.pathname.startsWith(p))
      if (needsSuperAdmin && !isSuperAdmin) {
        return <Navigate to="/admin/dashboard" replace />
      }
      // Enforce allowedRoles on admin routes
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(accountRole)) {
        return <Navigate to="/admin/dashboard" replace />
      }
    }
    return children ? <>{children}</> : <Outlet />
  }

  // ---- NON-ADMIN: USER-SURFACE GATES ----

  const profileComplete = localStorage.getItem('profile_complete') === 'true' || Boolean(user.city)
  const isProfileRoute = location.pathname === '/profile/complete'
  const isAuthRoute = ['/login', '/register', '/forgot-password', '/verify-email', '/verify-mobile', '/onboarding'].includes(location.pathname)

  // Only USER-surface routes enforce the shared completion page.
  if (!profileComplete && !isProfileRoute && !isAuthRoute && effectiveRole === 'USER') {
    return <Navigate to="/profile/complete" replace />
  }

  // ---- KYC GATE (USER surface): no features until admin-approved KYC ----
  const kycOk = user.kycStatus === 'VERIFIED' || user.kycStatus === 'APPROVED'
  if (effectiveRole === 'USER' && !kycOk) {
    const kycAllowedPrefixes = ['/verification', '/profile', '/settings', '/notifications']
    const isKycAllowed = kycAllowedPrefixes.some((p) => location.pathname.startsWith(p))
    if (!isKycAllowed) {
      return <Navigate to="/verification" replace />
    }
  }

  // Check if user has access to this route based on their active role
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(effectiveRole)) {
    const dashboard = ROLE_DASHBOARDS[effectiveRole] || '/dashboard'
    return <Navigate to={dashboard} replace />
  }

  // ---- PARTNER GATE: partner surfaces stay locked until admin approval ----
  if (effectiveRole === 'PARTNER' && (location.pathname.startsWith('/partner') || location.pathname.startsWith('/carry')) && location.pathname !== '/partner/pending') {
    if (user.partnerStatus !== 'APPROVED') {
      return <Navigate to="/partner/pending" replace />
    }
  }

  return children ? <>{children}</> : <Outlet />
}

export { ROLE_DASHBOARDS, ADMIN_TIER_ROLES }


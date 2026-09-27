/**
 * Canonical role definitions.
 *
 * This module is the single source of truth for the web app's role vocabulary.
 * It used to be duplicated across `ProtectedRoute`, `Layout`, `roleContext`,
 * `RoleSwitcher`, `LoginPage`, `SplashPage`, `AdminLoginPage`, `ProfilePage` and
 * the dead `AdminRoute` — and those copies had already drifted (one list had 5
 * entries, another 3, while the backend allowed 10), so privileged roles
 * silently lost access to the admin console.
 *
 * The most important distinction encoded here:
 *
 *   `role`  — the account *type* stored in the database. This is the only value
 *             that may grant administrative access.
 *   `activeRole` — the surface the account is currently *previewing*. Admins can
 *             deliberately switch to USER/PARTNER to inspect those experiences.
 *
 * Because `activeRole` is persisted (DB + localStorage) and is never empty, it
 * used to be read as the session role everywhere. A single switch to "User" then
 * permanently demoted an administrator to the customer UI, with the profile and
 * KYC gates re-asserting the wrong role on every boot. Admin gating must
 * therefore be derived from the account type, never from the preview.
 */

export type UserRole =
  | 'USER'
  | 'PARTNER'
  | 'MODERATOR'
  | 'SUPPORT'
  | 'FINANCE'
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'SUPPORT_ADMIN'
  | 'FINANCE_ADMIN'
  | 'KYC_ADMIN'
  | 'MARKETING_ADMIN'
  | 'PARTNER_ADMIN'

/**
 * Every role that counts as "this account administers the platform".
 * Must stay in sync with `ADMIN_TIER_ROLES` in the backend
 * (`middleware/auth.ts`, `rbac/adminSecurity.ts`, `rbac/sections.ts`,
 * `roleController.ts`) — all of which already agree on these 10.
 */
export const ADMIN_TIER_ROLES: readonly string[] = [
  'ADMIN',
  'SUPER_ADMIN',
  'MODERATOR',
  'SUPPORT',
  'FINANCE',
  'SUPPORT_ADMIN',
  'FINANCE_ADMIN',
  'KYC_ADMIN',
  'MARKETING_ADMIN',
  'PARTNER_ADMIN',
] as const

/** Roles the backend lets a user switch into as a view. */
export const SWITCHABLE_ROLES: readonly string[] = ['USER', 'PARTNER'] as const

export const ROLE_DASHBOARDS: Record<string, string> = {
  USER: '/dashboard',
  PARTNER: '/partner/dashboard',
  ADMIN: '/admin/dashboard',
  SUPER_ADMIN: '/admin/dashboard',
  MODERATOR: '/admin/dashboard',
  SUPPORT: '/admin/dashboard',
  FINANCE: '/admin/dashboard',
  SUPPORT_ADMIN: '/admin/dashboard',
  FINANCE_ADMIN: '/admin/dashboard',
  KYC_ADMIN: '/admin/dashboard',
  MARKETING_ADMIN: '/admin/dashboard',
  PARTNER_ADMIN: '/admin/dashboard',
}

export function normalizeRole(raw: unknown): UserRole {
  if (!raw) return 'USER'
  return String(raw).toUpperCase().replace(/\s+/g, '_') as UserRole
}

export function isAdminTierRole(raw: unknown): boolean {
  if (!raw) return false
  return ADMIN_TIER_ROLES.includes(normalizeRole(raw))
}

export function isSuperAdminRole(raw: unknown): boolean {
  return normalizeRole(raw) === 'SUPER_ADMIN'
}

export function dashboardForRole(raw: unknown): string {
  return ROLE_DASHBOARDS[normalizeRole(raw)] || '/dashboard'
}

interface RoleBearingUser {
  role?: string | null
  activeRole?: string | null
  accountType?: string | null
  baseRole?: string | null
}

/**
 * The account type — the only value that decides whether this account is an
 * administrator. Prefers `role` (and the `/roles/my-roles` `baseRole`), and
 * deliberately ignores `activeRole` so a preview can never revoke access.
 */
export function resolveAccountRole(user: RoleBearingUser | null | undefined): UserRole {
  if (!user) return 'USER'
  const candidates = [user.role, user.baseRole, user.accountType, user.activeRole]
  for (const candidate of candidates) {
    if (isAdminTierRole(candidate)) return normalizeRole(candidate)
  }
  return normalizeRole(user.role || user.baseRole || user.accountType || user.activeRole)
}

/**
 * Where to land after sign-in / cold boot.
 *
 * Admin-tier accounts always land in the admin console. Landing them on the
 * customer surface (because a stale `activeRole` said "USER") is what made
 * administrators believe they had been demoted.
 */
export function resolveLandingRole(
  user: RoleBearingUser | null | undefined,
  activeRole?: string | null,
): UserRole {
  const accountRole = resolveAccountRole(user)
  if (isAdminTierRole(accountRole)) return accountRole
  const preview = normalizeRole(activeRole)
  if (SWITCHABLE_ROLES.includes(preview)) return preview
  return accountRole
}

const ADMIN_TIER_ROLES = [
  "SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE",
  "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN",
];

const ADMIN_VIEW_ROLES = new Set(["USER", "PARTNER"]);

/**
 * Keep delegated admins' explicitly selected USER/PARTNER view, while healing
 * stale admin roles after a promotion or demotion.
 */
export function resolveActiveRole(role?: string | null, activeRole?: string | null): string | undefined {
  if (!role) return activeRole || undefined;
  if (!ADMIN_TIER_ROLES.includes(role)) return activeRole || role;

  if (activeRole === role || (activeRole && ADMIN_VIEW_ROLES.has(activeRole))) {
    return activeRole;
  }
  return role;
}

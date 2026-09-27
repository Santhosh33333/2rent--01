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
  if (!ADMIN_TIER_ROLES.includes(role)) {
    // An account that is not admin-tier can never resolve to an admin-tier role.
    // Without this, demoting an administrator (role -> USER) left their
    // `activeRole` behind at the old admin value, and because every admin guard
    // keys off `activeRole` the demoted account kept full admin access.
    if (activeRole && ADMIN_TIER_ROLES.includes(activeRole)) return role;
    return activeRole || role;
  }

  if (activeRole === role || (activeRole && ADMIN_VIEW_ROLES.has(activeRole))) {
    return activeRole;
  }
  return role;
}

export function isAdminTierRole(role?: string | null): boolean {
  return Boolean(role && ADMIN_TIER_ROLES.includes(role));
}

export { ADMIN_TIER_ROLES };

/**
 * The session role an authentication response should advertise.
 *
 * `resolveActiveRole` deliberately honours a delegated admin's USER/PARTNER
 * preview, which is correct for a *request already in flight*. It is wrong for
 * the response that ends a sign-in, though: the web client persists whatever it
 * receives and uses it to pick the landing surface, so a preview left over from
 * an earlier session made administrators boot into the customer app. Only
 * email+password login healed this, so OTP / phone-OTP / Google / Apple /
 * verify-password sign-ins all re-introduced the stale value.
 *
 * Every auth response therefore heals an admin-tier account back to its own
 * account type. Re-selecting a preview afterwards is an explicit, deliberate
 * action, not something a cold sign-in can inherit.
 */
export function resolveSessionActiveRole(role?: string | null, activeRole?: string | null): string | undefined {
  if (isAdminTierRole(role)) return role ?? undefined;
  return resolveActiveRole(role, activeRole);
}

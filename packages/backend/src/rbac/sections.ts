/**
 * RENTBUDDY — Advanced Admin RBAC
 * -------------------------------------------------------------
 * The platform follows a strict trust chain:
 *
 *   SUPER_ADMIN  ->  ROLE  ->  SECTION  ->  PERMISSION  ->  ACTION  ->  AUDIT LOG
 *
 * Every admin action is gated by a (section, action) permission check performed
 * on the BACKEND (never relying on hidden frontend menus). Each section supports
 * the same set of granular actions so Super Admin can compose precisely scoped
 * delegated roles.
 */

export const SECTIONS = [
  "USERS",
  "PARTNERS",
  "KYC",
  "BOOKINGS",
  "JOBS",
  "DISPATCH",
  "PAYMENTS",
  "REFUNDS",
  "WALLETS",
  "WITHDRAWALS",
  "PRICING",
  "OFFERS",
  "COUPONS",
  "COMMUNITIES",
  "EVENTS",
  "DATING",
  "MOVIES",
  "REPORTS",
  "SUPPORT",
  "NOTIFICATIONS",
  "ANALYTICS",
  "CONTENT_MODERATION",
  "SECURITY",
  "ADMIN_MANAGEMENT",
  "SYSTEM_SETTINGS",
  "AUDIT_LOGS",
] as const;

export type Section = (typeof SECTIONS)[number];

export const ACTIONS = [
  "VIEW",
  "CREATE",
  "EDIT",
  "APPROVE",
  "REJECT",
  "DELETE",
  "EXPORT",
] as const;

export type Action = (typeof ACTIONS)[number];

/** Build a canonical permission token, e.g. `PRICING.EDIT`. */
export function perm(section: Section, action: Action): string {
  return `${section}.${action}`;
}

/** Wildcard tokens. */
export const ALL_SECTIONS_WILDCARD = "*";
export function sectionWildcard(section: Section): string {
  return `${section}.*`;
}

/** Roles that are platform admins (vs end users / partners). */
export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "SUPPORT_ADMIN",
  "FINANCE_ADMIN",
  "KYC_ADMIN",
  "MARKETING_ADMIN",
  "PARTNER_ADMIN",
  "ADMIN",
  "MODERATOR",
  "SUPPORT",
  "FINANCE",
] as const;

export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

/**
 * Delegated admin role templates.
 * Each template maps a section to the list of actions the role may perform.
 * These are the DEFAULTS — Super Admin can narrow or widen them per account via
 * the `permissions` override stored on AdminUser.
 *
 * The matrices below are intentionally tight so the FINAL SECURITY TEST passes:
 *  - Support Admin  : NO Pricing / Wallet / Withdrawals / Admin Management
 *  - Finance Admin  : NO Admin Management / KYC documents
 *  - Marketing Admin: NO Wallet / Withdrawals (and therefore no payment secrets)
 *  - KYC Admin      : NO Payment secrets
 */
export const ROLE_TEMPLATES: Record<string, Partial<Record<Section, Action[]>>> = {
  SUPPORT_ADMIN: {
    USERS: ["VIEW", "EDIT"],
    REPORTS: ["VIEW", "CREATE", "APPROVE", "REJECT", "EXPORT"],
    SUPPORT: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT"],
    BOOKINGS: ["VIEW"],
    COMMUNITIES: ["VIEW"],
    EVENTS: ["VIEW"],
    NOTIFICATIONS: ["VIEW", "CREATE"],
    AUDIT_LOGS: ["VIEW"],
  },
  KYC_ADMIN: {
    KYC: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "EXPORT"],
    USERS: ["VIEW"],
    REPORTS: ["VIEW"],
    CONTENT_MODERATION: ["VIEW", "APPROVE", "REJECT"],
  },
  FINANCE_ADMIN: {
    WALLETS: ["VIEW", "CREATE", "EDIT", "EXPORT"],
    REFUNDS: ["VIEW", "CREATE", "APPROVE", "REJECT", "EXPORT"],
    WITHDRAWALS: ["VIEW", "APPROVE", "REJECT", "EXPORT"],
    PAYMENTS: ["VIEW", "EXPORT"],
    ANALYTICS: ["VIEW"],
    REPORTS: ["VIEW"],
    BOOKINGS: ["VIEW"],
  },
  MARKETING_ADMIN: {
    OFFERS: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "DELETE", "EXPORT"],
    COUPONS: ["VIEW", "CREATE", "EDIT", "DELETE", "EXPORT"],
    COMMUNITIES: ["VIEW", "CREATE", "EDIT"],
    EVENTS: ["VIEW", "CREATE", "EDIT"],
    NOTIFICATIONS: ["VIEW", "CREATE"],
    ANALYTICS: ["VIEW"],
  },
  PARTNER_ADMIN: {
    PARTNERS: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT", "EXPORT"],
    JOBS: ["VIEW", "CREATE", "EDIT", "APPROVE", "REJECT"],
    BOOKINGS: ["VIEW"],
    DISPATCH: ["VIEW"],
    REPORTS: ["VIEW"],
    COMMUNITIES: ["VIEW"],
  },
};

/** Flatten a role template (or any section->actions map) into a permission list. */
export function expandTemplate(map: Partial<Record<Section, Action[]>>): string[] {
  const out: string[] = [];
  for (const section of Object.keys(map) as Section[]) {
    for (const action of map[section] ?? []) {
      out.push(perm(section, action));
    }
  }
  return out;
}

/** Resolve the effective permission list for a delegated role name. */
export function permissionsForRole(roleName: string): string[] {
  const template = ROLE_TEMPLATES[roleName];
  if (!template) return [];
  return expandTemplate(template);
}

/** Every (section, action) pair — useful for UI checkboxes & documentation. */
export function allPermissionPairs(): { section: Section; action: Action; token: string }[] {
  const out: { section: Section; action: Action; token: string }[] = [];
  for (const section of SECTIONS) {
    for (const action of ACTIONS) {
      out.push({ section, action, token: perm(section, action) });
    }
  }
  return out;
}

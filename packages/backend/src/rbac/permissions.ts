import { Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { ADMIN_ROLES, Action, Section, SUPER_ADMIN_ROLE, perm } from "./sections";
import { isAdminTierRole } from "./activeRole";

function parsePerms(raw: unknown): string[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === "string");
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  return [];
}

/**
 * Resolve an admin's effective permission set.
 * Precedence: Super Admin -> full access. Otherwise the per-account override
 * (AdminUser.permissions) wins; falls back to the role's template.
 */
export async function resolveAdminPermissions(adminUserId: string): Promise<{
  role: string;
  permissions: string[];
  isSuper: boolean;
}> {
  const adminUser = await prisma.adminUser.findUnique({
    where: { userId: adminUserId },
    include: { role: true, user: { select: { role: true, activeRole: true } } },
  });
  // The account's real `role` is authoritative. `activeRole` can legitimately
  // hold a USER/PARTNER preview, and reading it first meant a super admin with
  // the preview selected was never recognised as super - silently losing the
  // wildcard grant below.
  const role = adminUser?.user.role || (adminUser?.role as any)?.name || "USER";
  if (role === SUPER_ADMIN_ROLE) {
    return { role, permissions: ["*"], isSuper: true };
  }
  const override = parsePerms((adminUser as any)?.permissions);
  const base = override.length
    ? override
    : parsePerms(adminUser?.role?.permissions);
  return { role, permissions: base, isSuper: false };
}

/** Synchronous permission check against an already-resolved permission list. */
export function hasPermission(
  permissions: string[],
  section: Section,
  action: Action
): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes(`${section}.*`)) return true;
  return permissions.includes(perm(section, action));
}

/**
 * The role an admin guard must authorize against: the account's real `role`,
 * and nothing else.
 *
 * `activeRole` is a *view* an admin deliberately selected, and every guard
 * previously consulted it ahead of the real role. That cut both ways:
 *
 *   - too strict: an administrator browsing the customer app resolved to
 *     "USER" and lost every admin route, including the screens they need to
 *     fix a user's phone number or answer a support ticket;
 *   - too loose: a demoted account (role demoted to USER) that still had the
 *     old admin value in `activeRole` was handed admin authority back.
 *
 * The auth middleware always populates `role` from the database, so it is the
 * only trustworthy input here. `activeRole` is never used for authorization.
 */
export function guardRole(user?: { role?: string | null; activeRole?: string | null } | null): string | undefined {
  return user?.role ?? user?.activeRole ?? undefined;
}

/**
 * Backend middleware: enforce a single (section, action) permission.
 * Never trust the frontend — every protected admin route passes through this.
 */
export function requireSectionAction(section: Section, action: Action) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = guardRole(req.user);
      if (!role) {
        sendError(res, "Authentication required.", 401, "UNAUTHORIZED");
        return;
      }
      if (role === SUPER_ADMIN_ROLE) {
        next();
        return;
      }
      // End users & partners are never admins.
      if (!ADMIN_ROLES.includes(role as any) || role === "USER" || role === "PARTNER") {
        sendError(res, "Admin access required.", 403, "FORBIDDEN");
        return;
      }
      const { permissions } = await resolveAdminPermissions(req.user!.userId);
      if (hasPermission(permissions, section, action)) {
        next();
        return;
      }
      sendError(
        res,
        `You do not have permission to ${action} in ${section}.`,
        403,
        "PERMISSION_DENIED"
      );
    } catch {
      sendError(res, "Authorization check failed.", 500, "INTERNAL_ERROR");
    }
  };
}

/** Allow if the admin holds ANY of the given (section, action) pairs. */
export function requireAnySectionAction(pairs: { section: Section; action: Action }[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const role = guardRole(req.user);
      if (!role) {
        sendError(res, "Authentication required.", 401, "UNAUTHORIZED");
        return;
      }
      if (role === SUPER_ADMIN_ROLE) {
        next();
        return;
      }
      if (!ADMIN_ROLES.includes(role as any) || role === "USER" || role === "PARTNER") {
        sendError(res, "Admin access required.", 403, "FORBIDDEN");
        return;
      }
      const { permissions } = await resolveAdminPermissions(req.user!.userId);
      const ok = pairs.some((p) => hasPermission(permissions, p.section, p.action));
      if (ok) {
        next();
        return;
      }
      sendError(res, "You do not have permission for this action.", 403, "PERMISSION_DENIED");
    } catch {
      sendError(res, "Authorization check failed.", 500, "INTERNAL_ERROR");
    }
  };
}

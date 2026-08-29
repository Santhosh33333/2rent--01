import { Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt";
import { prisma } from "../config/database";
import { sendError } from "../utils/response";
import { AuthedRequest, AuthenticatedUser, UserRole } from "./authTypes";

export function verifyToken(token: string): { userId: string; email: string; role?: string } | null {
  try {
    const payload = verifyAccessToken(token);
    return {
      userId: payload.userId,
      email: payload.email,
    };
  } catch {
    return null;
  }
}

export async function authenticateToken(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      sendError(res, "Authentication token is missing.", 401, "UNAUTHORIZED");
      return;
    }

    const token = authHeader.split(" ")[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, status: true, role: true, activeRole: true, suspendedUntil: true },
    });

    if (!user) {
      sendError(res, "User no longer exists.", 401, "UNAUTHORIZED");
      return;
    }

    if (user.status === "SUSPENDED" && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE", suspendedUntil: null, suspensionReason: null } });
      user.status = "ACTIVE";
    }

    if (user.status !== "ACTIVE") {
      const until = user.suspendedUntil ? ` until ${user.suspendedUntil.toISOString()}` : "";
      sendError(res, `Account is not active${until}.`, 403, "ACCOUNT_INACTIVE");
      return;
    }

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      activeRole: (user.activeRole as UserRole) || (user.role as UserRole),
    };
    next();
  } catch (err) {
    sendError(res, "Invalid or expired token.", 401, "INVALID_TOKEN");
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user?.activeRole || !roles.includes(req.user.activeRole)) {
      sendError(res, "Access denied for current role.", 403, "FORBIDDEN");
      return;
    }
    next();
  };
}

export async function requireVerification(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, "Authentication required.", 401, "UNAUTHORIZED");
      return;
    }
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user.userId },
      select: { status: true },
    });
    if (!verification || verification.status !== "VERIFIED") {
      sendError(res, "Account verification required.", 403, "VERIFICATION_REQUIRED");
      return;
    }
    next();
  } catch {
    sendError(res, "Verification check failed.", 500, "INTERNAL_ERROR");
  }
}

export async function requireWalkingPartner(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, "Authentication required.", 401, "UNAUTHORIZED");
      return;
    }
    const partner = await prisma.partner.findUnique({
      where: { userId: req.user.userId },
      select: { status: true },
    });
    if (!partner || partner.status !== "APPROVED") {
      sendError(res, "Approved partner status required.", 403, "PARTNER_REQUIRED");
      return;
    }
    next();
  } catch {
    sendError(res, "Partner check failed.", 500, "INTERNAL_ERROR");
  }
}

export async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.activeRole || !["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE"].includes(req.user.activeRole)) {
      sendError(res, "Admin access required.", 403, "FORBIDDEN");
      return;
    }
    next();
  } catch {
    sendError(res, "Authorization check failed.", 500, "INTERNAL_ERROR");
  }
}

export async function requirePartner(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({
      where: { userId: req.user?.userId },
      select: { id: true, status: true },
    });
    if (!partner || partner.status !== "APPROVED") {
      sendError(res, "Approved partner status required.", 403, "PARTNER_REQUIRED");
      return;
    }
    next();
  } catch {
    sendError(res, "Partner check failed.", 500, "INTERNAL_ERROR");
  }
}

// KYC gate: no app features until the user's verification is admin-approved.
// Account/KYC/profile routes stay open so users can complete verification.
export async function requireKycVerified(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      sendError(res, "Authentication required.", 401, "UNAUTHORIZED");
      return;
    }
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user.userId },
      select: { status: true },
    });
    // Admin KYC approval sets status=VERIFIED (see adminController.reviewKyc)
    if (!verification || verification.status !== "VERIFIED") {
      sendError(
        res,
        !verification
          ? "Complete your KYC verification to use app features."
          : "Your verification is under review. You can use features once an admin approves it.",
        403,
        !verification ? "KYC_REQUIRED" : "KYC_PENDING"
      );
      return;
    }
    next();
  } catch {
    sendError(res, "Verification check failed.", 500, "INTERNAL_ERROR");
  }
}

export async function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.activeRole || req.user.activeRole !== "SUPER_ADMIN") {
      sendError(res, "Super admin access required.", 403, "FORBIDDEN");
      return;
    }
    next();
  } catch {
    sendError(res, "Authorization check failed.", 500, "INTERNAL_ERROR");
  }
}

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE"];

export function requirePermission(permission: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const activeRole = req.user?.activeRole;
      if (!activeRole || !ADMIN_ROLES.includes(activeRole)) {
        sendError(res, "Admin access required.", 403, "FORBIDDEN");
        return;
      }
      if (activeRole === "SUPER_ADMIN" || activeRole === "ADMIN") {
        next();
        return;
      }
      const adminUser = await prisma.adminUser.findUnique({
        where: { userId: req.user!.userId },
        include: { role: { select: { permissions: true } } },
      });
      let perms: string[] = [];
      // Per-admin access override (set by super admin) takes precedence over
      // the role's default permission set.
      const override = (adminUser as { permissions?: string | null } | null)?.permissions;
      if (typeof override === "string") {
        try {
          const parsedOverride: unknown = JSON.parse(override);
          if (Array.isArray(parsedOverride)) perms = parsedOverride.filter((p): p is string => typeof p === "string");
        } catch {
          perms = [];
        }
      }
      if (perms.length === 0) {
        try {
          const parsed: unknown = JSON.parse(adminUser?.role.permissions ?? "[]");
          if (Array.isArray(parsed)) perms = parsed.filter((p): p is string => typeof p === "string");
        } catch {
          perms = [];
        }
      }
      if (!perms.includes(permission)) {
        sendError(res, "You do not have permission to perform this action.", 403, "PERMISSION_DENIED");
        return;
      }
      next();
    } catch {
      sendError(res, "Authorization check failed.", 500, "INTERNAL_ERROR");
    }
  };
}

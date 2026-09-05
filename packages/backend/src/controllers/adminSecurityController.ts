import { Request, Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { enforceAdminSessionLimit, revokeAdminSession } from "../rbac/adminSecurity";
import { resolveAdminPermissions } from "../rbac/permissions";

function maskPhone(phone: string): string {
  const p = phone.replace(/\D/g, "");
  if (p.length < 4) return phone;
  return p.slice(0, 2) + "****" + p.slice(-2);
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return "***" + email.slice(at);
  return email.slice(0, 2) + "****" + email.slice(at);
}

// Self-service: every authenticated admin can manage their own security posture.
export async function getMySecurity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const admin = await prisma.adminUser.findUnique({
      where: { userId: req.user!.userId },
      select: {
        twoFactorEnabled: true, ipAllowList: true, sessionLimit: true, loginAlertsEnabled: true,
        requirePasswordRotation: true, lastLoginIp: true, failedLoginAttempts: true, lockedUntil: true, lastLoginAt: true,
      },
    });
    if (!admin) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { email: true } });
    sendSuccess(res, { ...admin, emailOtp: true, emailHint: user?.email ? maskEmail(user.email) : null }, "Security settings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve security settings.", 500, "INTERNAL_ERROR");
  }
}

export async function updateMySecurity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { ipAllowList, sessionLimit, loginAlertsEnabled } = req.body;
    const data: any = {};
    if (Array.isArray(ipAllowList)) data.ipAllowList = ipAllowList.map((x: string) => String(x).trim()).filter(Boolean);
    if (typeof sessionLimit === "number") data.sessionLimit = Math.max(1, Math.min(20, Math.floor(sessionLimit)));
    if (typeof loginAlertsEnabled === "boolean") data.loginAlertsEnabled = loginAlertsEnabled;
    const admin = await prisma.adminUser.update({ where: { userId: req.user!.userId }, data });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "ADMIN_SECURITY_UPDATED", entityType: "AdminUser", entityId: req.user!.userId, metadata: JSON.stringify({ fields: Object.keys(data) }) },
    });
    sendSuccess(res, { ipAllowList: admin.ipAllowList, sessionLimit: admin.sessionLimit, loginAlertsEnabled: admin.loginAlertsEnabled }, "Security settings updated.");
  } catch (err) {
    sendError(res, "Failed to update security settings.", 500, "INTERNAL_ERROR");
  }
}

export async function listMySessions(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!admin) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    const sessions = await prisma.adminSession.findMany({
      where: { adminUserId: admin.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, ipAddress: true, userAgent: true, location: true, createdAt: true, expiresAt: true },
    });
    sendSuccess(res, { sessions }, "Active admin sessions retrieved.");
  } catch (err) {
    sendError(res, "Failed to list sessions.", 500, "INTERNAL_ERROR");
  }
}

export async function revokeMySession(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { sessionId } = req.params;
    const admin = await prisma.adminUser.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!admin) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    await prisma.adminSession.updateMany({
      where: { id: sessionId, adminUserId: admin.id },
      data: { revokedAt: new Date(), location: "revoked-by-admin" },
    });
    sendSuccess(res, undefined, "Session revoked.");
  } catch (err) {
    sendError(res, "Failed to revoke session.", 500, "INTERNAL_ERROR");
  }
}

// ===================== SUPER-ADMIN ONLY =====================

export async function getAdminSecurity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const admin = await prisma.adminUser.findUnique({
      where: { userId },
      select: {
        userId: true, twoFactorEnabled: true, ipAllowList: true, sessionLimit: true, loginAlertsEnabled: true,
        requirePasswordRotation: true, lastLoginIp: true, failedLoginAttempts: true, lockedUntil: true, lastLoginAt: true,
      },
    });
    if (!admin) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    sendSuccess(res, admin, "Admin security settings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve admin security settings.", 500, "INTERNAL_ERROR");
  }
}

export async function updateAdminSecurity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { ipAllowList, sessionLimit, loginAlertsEnabled, requirePasswordRotation, status } = req.body;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || !["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"].includes(target.role)) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    const data: any = {};
    if (Array.isArray(ipAllowList)) data.ipAllowList = ipAllowList.map((x: string) => String(x).trim()).filter(Boolean);
    if (typeof sessionLimit === "number") data.sessionLimit = Math.max(1, Math.min(20, Math.floor(sessionLimit)));
    if (typeof loginAlertsEnabled === "boolean") data.loginAlertsEnabled = loginAlertsEnabled;
    if (typeof requirePasswordRotation === "boolean") data.requirePasswordRotation = requirePasswordRotation;
    const admin = await prisma.$transaction(async (tx) => {
      const updated = await tx.adminUser.update({ where: { userId }, data });
      if (status && ["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) {
        await tx.user.update({ where: { id: userId }, data: { status } });
      }
      return updated;
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "SUPER_ADMIN_SECURITY_UPDATED", entityType: "AdminUser", entityId: userId, metadata: JSON.stringify({ fields: Object.keys(data) }) },
    });
    sendSuccess(res, { ipAllowList: admin.ipAllowList, sessionLimit: admin.sessionLimit, loginAlertsEnabled: admin.loginAlertsEnabled, requirePasswordRotation: admin.requirePasswordRotation }, "Admin security settings updated.");
  } catch (err) {
    sendError(res, "Failed to update admin security settings.", 500, "INTERNAL_ERROR");
  }
}

export async function resetAdminMfa(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const admin = await prisma.adminUser.update({
      where: { userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, failedLoginAttempts: 0, lockedUntil: null },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "SUPER_ADMIN_MFA_RESET", entityType: "AdminUser", entityId: userId },
    });
    sendSuccess(res, { twoFactorEnabled: admin.twoFactorEnabled }, "Admin MFA reset.");
  } catch (err) {
    sendError(res, "Failed to reset admin MFA.", 500, "INTERNAL_ERROR");
  }
}

// Re-export to keep import surface small for routes.
export { enforceAdminSessionLimit, revokeAdminSession };

// Returns the caller's identity plus the effective permission set the backend
// enforces — so the console can render only the sections this admin may use.
export async function getAdminProfile(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { id: true, email: true, fullName: true, role: true, activeRole: true, status: true },
    });
    const { role, permissions } = await resolveAdminPermissions(req.user!.userId);
    sendSuccess(res, { user, adminRole: role, permissions }, "Admin profile retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve admin profile.", 500, "INTERNAL_ERROR");
  }
}

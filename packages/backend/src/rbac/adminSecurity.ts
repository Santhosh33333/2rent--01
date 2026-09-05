import { Request } from "express";
import { prisma } from "../config/database";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Central definition of admin-tier roles (includes the fine-grained delegated roles).
export const ADMIN_TIER_ROLES = [
  "SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE",
  "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN",
];

export function isAdminRole(role?: string | null): boolean {
  return !!role && ADMIN_TIER_ROLES.includes(role);
}

export function getClientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  if (Array.isArray(xff) && xff.length) return xff[0].trim();
  return (req.socket?.remoteAddress || "unknown").replace("::ffff:", "");
}

export function isIpAllowed(ipAllowList: string[], ip: string): boolean {
  if (!ipAllowList || ipAllowList.length === 0) return true;
  return ipAllowList.some((entry) => {
    const e = entry.trim();
    if (!e) return false;
    if (e.includes("/")) {
      // CIDR support (IPv4)
      const [base, bitsStr] = e.split("/");
      const bits = Number(bitsStr);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      const ipInt = ipv4ToInt(ip);
      const baseInt = ipv4ToInt(base);
      if (ipInt === null || baseInt === null) return ip === base;
      return (ipInt & mask) === (baseInt & mask);
    }
    if (e.endsWith(".")) return ip.startsWith(e); // prefix match, e.g. "192.168.1."
    return ip === e;
  });
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (Number.isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

export class AdminLockoutError extends Error {
  lockedUntil: Date;
  constructor(lockedUntil: Date) {
    super("Account temporarily locked due to failed login attempts.");
    this.name = "AdminLockoutError";
    this.lockedUntil = lockedUntil;
  }
}

export async function checkAdminLockout(adminId: string): Promise<void> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { lockedUntil: true } });
  if (admin?.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    throw new AdminLockoutError(admin.lockedUntil);
  }
}

export async function recordFailedLogin(adminId: string): Promise<void> {
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { failedLoginAttempts: true } });
  const attempts = (admin?.failedLoginAttempts ?? 0) + 1;
  const data: any = { failedLoginAttempts: attempts };
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    data.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
  }
  await prisma.adminUser.update({ where: { id: adminId }, data });
}

export async function resetFailedLogin(adminId: string): Promise<void> {
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

export async function createAdminSession(adminId: string, sessionToken: string, ip: string, userAgent?: string): Promise<void> {
  await prisma.adminSession.create({
    data: {
      adminUserId: adminId,
      sessionToken,
      ipAddress: ip,
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS),
    },
  });
}

export async function revokeAdminSession(sessionToken: string): Promise<void> {
  await prisma.adminSession.updateMany({ where: { sessionToken }, data: { revokedAt: new Date() } });
}

export async function enforceAdminSessionLimit(adminId: string, limit: number): Promise<void> {
  if (limit <= 0) limit = 1;
  const active = await prisma.adminSession.findMany({
    where: { adminUserId: adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (active.length > limit) {
    const toRevoke = active.slice(0, active.length - limit);
    if (toRevoke.length) {
      await prisma.adminSession.updateMany({
        where: { id: { in: toRevoke.map((s) => s.id) } },
        data: { revokedAt: new Date(), location: "revoked-session-limit" },
      });
    }
  }
}

export async function flagNewDevice(adminId: string, ip: string, actorId: string): Promise<void> {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { lastLoginIp: true, loginAlertsEnabled: true },
  });
  const isNew = admin?.lastLoginIp && admin.lastLoginIp !== ip;
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { lastLoginIp: ip, lastLoginAt: new Date() },
  });
  if (isNew && admin?.loginAlertsEnabled) {
    await prisma.adminNotification.create({
      data: {
        adminUserId: adminId,
        type: "LOGIN_ALERT",
        title: "New admin login location",
        body: `An admin sign-in was detected from a new IP address: ${ip}. If this wasn't you, secure the account immediately.`,
        link: "/admin/security/sessions",
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId,
        actorType: "ADMIN",
        action: "ADMIN_NEW_DEVICE_LOGIN",
        entityType: "AdminUser",
        entityId: adminId,
        metadata: JSON.stringify({ ip }),
      },
    });
  }
}

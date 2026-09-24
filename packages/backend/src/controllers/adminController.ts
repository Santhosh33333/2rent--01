import { Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../config/database";
import { SERVICE_CATALOG, isServiceEnabled } from "../services/serviceCatalog";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { createImpersonationSession } from "./authController";
import { env } from "../config/env";
import * as bookingEngine from "../services/bookingEngine";
import { PRICING_VERSION_KEY } from "../services/bookingEngine";
import { isDemoEmail, DEMO_WALLET_CEILING } from "../utils/demo";
import { moneyTransaction } from "../utils/db";
import { invalidateConfigCache } from "../services/pricingEngine";
import { ensureAdminUser } from "../services/adminProvision";
import { SERVICE_KEYS } from "../services/serviceCatalog";
import * as partnerMatching from "../services/partnerMatchingEngine";
import { sendEmail, emailStatus } from "../services/emailService";

// ============================================================================
// SECTION 1: DASHBOARD & ANALYTICS
// ============================================================================

export async function getDashboardStats(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [
      totalUsers,
      activeUsers,
      verifiedUsers,
      totalCommunities,
      totalEvents,
      openWalkRequests,
      totalWalletBalance,
      pendingWithdrawals,
      pendingKyc,
      totalPartners,
      activePartners,
      pendingPartnerApprovals,
      totalBookings,
      activeBookings,
      completedBookings,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { emailVerified: true } }),
      prisma.community.count(),
      prisma.event.count(),
      prisma.walkingRequest.count({ where: { status: "OPEN" } }),
      prisma.wallet.aggregate({ _sum: { balance: true } }),
      prisma.withdrawalRequest.count({ where: { status: "PENDING" } }),
      prisma.verification.count({ where: { status: { in: ["SUBMITTED", "PENDING_REVIEW", "UNDER_VERIFICATION"] } } }),
      prisma.partner.count(),
      prisma.partner.count({ where: { status: "APPROVED" } }),
      prisma.partner.count({ where: { status: "APPLIED" } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: { in: ["PARTNER_SEARCHING", "PARTNER_ACCEPTED", "OTP_GENERATED", "IN_PROGRESS"] } } }),
      prisma.booking.count({ where: { status: "COMPLETED" } }),
    ]);
    sendSuccess(res, {
      totalUsers,
      activeUsers,
      verifiedUsers,
      totalCommunities,
      totalEvents,
      openWalkRequests,
      totalWalletBalance: totalWalletBalance._sum.balance ?? 0,
      pendingWithdrawals,
      pendingKyc,
      totalPartners,
      activePartners,
      pendingPartnerApprovals,
      totalBookings,
      activeBookings,
      completedBookings,
    }, "Dashboard stats retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve dashboard stats.", 500, "INTERNAL_ERROR");
  }
}

export async function getUsers(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { email: { contains: req.query.search, mode: "insensitive" } },
        { fullName: { contains: req.query.search, mode: "insensitive" } },
        { phone: { contains: req.query.search } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, email: true, phone: true, fullName: true, role: true, activeRole: true, status: true, suspendedUntil: true, emailVerified: true, mobileVerified: true, createdAt: true },
      }),
      prisma.user.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve users.", 500, "INTERNAL_ERROR");
  }
}

export async function getUserById(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, phone: true, fullName: true, dateOfBirth: true, gender: true,
        role: true, activeRole: true, status: true, avatarUrl: true, bio: true, city: true, country: true,
        emailVerified: true, mobileVerified: true, trustScore: true, createdAt: true, updatedAt: true,
        verification: {
          select: {
            personalDetails: true,
            status: true, selfieUrl: true, govIdUrl: true, govIdType: true, addressProofUrl: true,
            rejectionReason: true, reviewedAt: true, createdAt: true,
          },
        },
        partner: {
          select: { id: true, status: true, providesWalking: true, providesCarry: true, bankAccountName: true, bankAccountNumber: true, bankIfsc: true, upiId: true, totalJobs: true, totalEarnings: true, completedJobs: true, createdAt: true },
        },
        wallet: {
          select: { balance: true },
        },
      },
    });
    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    sendSuccess(res, user, "User retrieved.");
} catch (err) {
    sendError(res, "Failed to retrieve user.", 500, "INTERNAL_ERROR");
  }
}

export async function impersonateUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const targetId = req.params.id || req.params.userId;
    const actor = req.user!;
    if (!targetId) {
      sendError(res, "User id is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (targetId === actor.userId) {
      sendError(res, "You cannot impersonate your own account.", 400, "VALIDATION_ERROR");
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, fullName: true, role: true, activeRole: true, status: true, avatarUrl: true },
    });
    if (!target) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    if (target.status !== "ACTIVE") {
      sendError(res, "Cannot impersonate an inactive account.", 403, "FORBIDDEN");
      return;
    }

    const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"];
    const targetIsAdmin = ADMIN_ROLES.includes(target.role || "");
    // Only SUPER_ADMIN may impersonate another admin account; regular admins
    // can only step into user or partner accounts.
    if (actor.activeRole !== "SUPER_ADMIN" && targetIsAdmin) {
      sendError(res, "Only a super admin can impersonate an admin account.", 403, "FORBIDDEN");
      return;
    }

    const { accessToken, refreshToken } = await createImpersonationSession(targetId, actor.userId, req);

    await prisma.auditLog.create({
      data: {
        actorId: actor.userId,
        actorType: "ADMIN",
        action: "IMPERSONATE_START",
        entityType: "User",
        entityId: targetId,
        metadata: JSON.stringify({ targetEmail: target.email, targetRole: target.role }),
      },
    });

    sendSuccess(res, {
      accessToken,
      refreshToken,
      user: {
        id: target.id,
        email: target.email,
        fullName: target.fullName,
        role: target.role,
        activeRole: target.activeRole || target.role || "USER",
        avatarUrl: target.avatarUrl,
        impersonatorId: actor.userId,
      },
    }, "Impersonation started. You are now viewing this account.");
} catch (err) {
    sendError(res, "Failed to start impersonation.", 500, "INTERNAL_ERROR");
  }
}

export async function updateUserStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const user = await prisma.user.update({ where: { id }, data: { status } });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "UPDATE_USER_STATUS", entityType: "User", entityId: id, metadata: JSON.stringify({ status }) },
    });
    sendSuccess(res, { id: user.id, status: user.status }, "User status updated.");
  } catch (err) {
    sendError(res, "Failed to update user status.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// BLOCK USER (works for regular users AND partners — partner accounts are
// user records; blocking prevents login and all API access until expiry)
// Body: { durationDays?, durationYears?, permanent?, reason? }
// ============================================================================
export async function blockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { durationDays, durationYears, permanent, reason } = req.body as {
      durationDays?: number; durationYears?: number; permanent?: boolean; reason?: string;
    };

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, role: true } });
    if (!target) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }
    if (target.role === "SUPER_ADMIN") {
      sendError(res, "Super admins cannot be blocked.", 403, "FORBIDDEN");
      return;
    }

    let suspendedUntil: Date | null = null;
    if (!permanent) {
      const days = Number(durationDays) || 0;
      const years = Number(durationYears) || 0;
      if (days <= 0 && years <= 0) {
        sendError(res, "Provide durationDays, durationYears, or permanent=true.", 400, "VALIDATION_ERROR");
        return;
      }
      suspendedUntil = new Date();
      suspendedUntil.setDate(suspendedUntil.getDate() + Math.floor(days));
      suspendedUntil.setFullYear(suspendedUntil.getFullYear() + Math.floor(years));
    }

    const user = await prisma.user.update({
      where: { id },
      data: { status: "SUSPENDED", suspendedUntil, suspensionReason: reason || null },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId, actorType: "ADMIN", action: "BLOCK_USER",
        entityType: "User", entityId: id,
        metadata: JSON.stringify({ permanent: !!permanent, suspendedUntil, reason }),
      },
    });

    try {
      await prisma.notification.create({
        data: {
          userId: id,
          title: "Account suspended",
          body: permanent
            ? `Your account has been permanently suspended. Reason: ${reason || "policy violation"}`
            : `Your account has been suspended until ${suspendedUntil!.toDateString()}. Reason: ${reason || "policy violation"}`,
          data: JSON.stringify({ kind: "ACCOUNT_SUSPENDED", permanent: !!permanent }),
        },
      });
    } catch { /* non-blocking */ }

    sendSuccess(res, { id: user.id, status: user.status, suspendedUntil: user.suspendedUntil, reason: user.suspensionReason }, "User blocked.");
  } catch (err) {
    sendError(res, "Failed to block user.", 500, "INTERNAL_ERROR");
  }
}

export async function unblockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const user = await prisma.user.update({
      where: { id },
      data: { status: "ACTIVE", suspendedUntil: null, suspensionReason: null },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "UNBLOCK_USER", entityType: "User", entityId: id, metadata: "{}" },
    });
    sendSuccess(res, { id: user.id, status: user.status }, "User unblocked.");
  } catch (err) {
    sendError(res, "Failed to unblock user.", 500, "INTERNAL_ERROR");
  }
}

// List SOS alerts for the safety queue (newest first). Lives alongside the
// admin inbox so alerts are visible even when nobody caught the socket.
export async function listSosAlerts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const page = Math.max(1, Number(req.query.page) || 1);
    const where: any = {};
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      prisma.sosAlert.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, phone: true, avatarUrl: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.sosAlert.count({ where }),
    ]);
    sendSuccess(res, { items, total, page, limit }, "SOS alerts retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve SOS alerts.", 500, "INTERNAL_ERROR");
  }
}

// Resolve an SOS alert (admin confirms the situation is handled).
export async function resolveSosAlert(req: AuthedRequest, res: Response): Promise<void> {  try {
    const { id } = req.params;
    const alert = await prisma.sosAlert.findUnique({ where: { id } });
    if (!alert) {
      sendError(res, "SOS alert not found.", 404, "NOT_FOUND");
      return;
    }
    const updated = await prisma.sosAlert.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "SOS_RESOLVED", entityType: "SosAlert", entityId: id, metadata: "{}" },
    });
    sendSuccess(res, updated, "SOS alert resolved.");
  } catch (err) {
    sendError(res, "Failed to resolve SOS alert.", 500, "INTERNAL_ERROR");
  }
}

// SUPER_ADMIN only — hard delete with cascade
export async function deleteUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (id === req.user!.userId) {
      sendError(res, "You cannot delete your own account.", 400, "VALIDATION_ERROR");
      return;
    }
    const target = await prisma.user.findUnique({ where: { id }, select: { email: true } });
    if (!target) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }
    // Audit first using admin as actor (log survives the delete)
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId, actorType: "ADMIN", action: "DELETE_USER",
        entityType: "User", entityId: id,
        metadata: JSON.stringify({ email: target.email }),
      },
    });
    await prisma.user.delete({ where: { id } });
    sendSuccess(res, { id }, "User deleted.");
  } catch (err: any) {
    if (err?.code === "P2003") {
      sendError(res, "Cannot delete: related records still reference this account.", 409, "FK_CONSTRAINT");
      return;
    }
    sendError(res, "Failed to delete user.", 500, "INTERNAL_ERROR");
  }
}

export async function getKycQueue(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    // Default to statuses produced by real submission flow
    const status = (req.query.status as string) || "SUBMITTED";
    const where = { status: status as any };
    const [items, total] = await Promise.all([
      prisma.verification.findMany({
        where,
        orderBy: { updatedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, userId: true, status: true,
          selfieUrl: true, govIdUrl: true, govIdType: true, addressProofUrl: true,
          rejectionReason: true, reviewedBy: true, reviewedAt: true,
          emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true,
          createdAt: true, updatedAt: true,
          user: { select: { id: true, fullName: true, email: true, phone: true, avatarUrl: true } },
        },
      }),
      prisma.verification.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve KYC queue.", 500, "INTERNAL_ERROR");
  }
}

async function reviewKyc(req: AuthedRequest, id: string, approve: boolean, reason?: string): Promise<void> {
  const verification = await prisma.verification.findUnique({ where: { id } });
  if (!verification) throw new Error("NOT_FOUND");
  const REVIEWABLE = ["SUBMITTED", "PENDING_REVIEW", "UNDER_VERIFICATION", "RESUBMIT_REQUIRED"];
  if (!REVIEWABLE.includes(verification.status)) {
    throw new Error("INVALID_STATUS");
  }
  await prisma.$transaction([
    prisma.verification.update({
      where: { id },
      data: { status: approve ? "VERIFIED" : "REJECTED", reviewedBy: req.user!.userId, reviewedAt: new Date(), rejectionReason: approve ? null : reason },
    }),
    // NOTE: deliberately NOT touching user.emailVerified — KYC approval grants
    // Verification.status=VERIFIED (what requireVerification gates on), it says
    // nothing about email ownership.
    prisma.verificationHistory.create({ data: { verificationId: id, status: approve ? "VERIFIED" : "REJECTED", note: reason, changedBy: req.user!.userId } }),
    prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: approve ? "KYC_APPROVE" : "KYC_REJECT", entityType: "Verification", entityId: id, metadata: reason ? JSON.stringify({ rejectionReason: reason }) : null } }),
  ]);
}

export async function approveKyc(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await reviewKyc(req, req.params.id, true);
    sendSuccess(res, undefined, "KYC approved.");
  } catch (err: any) {
    if (err?.message === "NOT_FOUND") {
      sendError(res, "Verification not found.", 404, "NOT_FOUND");
    } else if (err?.message === "INVALID_STATUS") {
      sendError(res, "This verification has already been reviewed.", 400, "INVALID_STATUS");
    } else {
      sendError(res, "Failed to approve KYC.", 500, "INTERNAL_ERROR");
    }
  }
}

export async function rejectKyc(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { reason } = req.body;
    await reviewKyc(req, req.params.id, false, reason);
    sendSuccess(res, undefined, "KYC rejected.");
  } catch (err: any) {
    if (err?.message === "NOT_FOUND") {
      sendError(res, "Verification not found.", 404, "NOT_FOUND");
    } else if (err?.message === "INVALID_STATUS") {
      sendError(res, "This verification has already been reviewed.", 400, "INVALID_STATUS");
    } else {
      sendError(res, "Failed to reject KYC.", 500, "INTERNAL_ERROR");
    }
  }
}

export async function getWalkingPartners(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.partner.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, fullName: true, email: true, phone: true } } } }),
      prisma.partner.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve walking partners.", 500, "INTERNAL_ERROR");
  }
}

export async function approveWalkingPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.update({ where: { id }, data: { status: "APPROVED" } });

    // Keep the separate WalkingPartner record in sync so the walking-request
    // feature reflects the approval.
    await prisma.walkingPartner.updateMany({
      where: { userId: partner.userId },
      data: { status: "APPROVED", reviewedBy: req.user!.userId, reviewedAt: new Date() },
    });
    await prisma.user.updateMany({ where: { id: partner.userId }, data: { activeRole: "PARTNER" } });

    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PARTNER_APPROVE", entityType: "Partner", entityId: id } });
    sendSuccess(res, partner, "Walking partner approved.");
  } catch (err) {
    sendError(res, "Failed to approve walking partner.", 500, "INTERNAL_ERROR");
  }
}

export async function suspendPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const partner = await prisma.partner.findUnique({ where: { id } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "NOT_FOUND");
      return;
    }

    await prisma.partner.update({ where: { id }, data: { status: "SUSPENDED", rejectionReason: reason ?? null } });
    await prisma.walkingPartner.updateMany({ where: { userId: partner.userId }, data: { status: "SUSPENDED", rejectionReason: reason ?? null, reviewedBy: req.user!.userId, reviewedAt: new Date() } });

    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PARTNER_SUSPEND", entityType: "Partner", entityId: id, metadata: JSON.stringify({ reason }) } });
    sendSuccess(res, { id, status: "SUSPENDED" }, "Partner suspended.");
  } catch (err) {
    sendError(res, "Failed to suspend partner.", 500, "INTERNAL_ERROR");
  }
}

export async function reactivatePartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({ where: { id } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "NOT_FOUND");
      return;
    }

    await prisma.partner.update({ where: { id }, data: { status: "APPROVED", rejectionReason: null } });
    await prisma.walkingPartner.updateMany({ where: { userId: partner.userId }, data: { status: "APPROVED", rejectionReason: null, reviewedBy: req.user!.userId, reviewedAt: new Date() } });

    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PARTNER_REACTIVATE", entityType: "Partner", entityId: id } });
    sendSuccess(res, { id, status: "APPROVED" }, "Partner reactivated.");
  } catch (err) {
    sendError(res, "Failed to reactivate partner.", 500, "INTERNAL_ERROR");
  }
}

export async function rejectWalkingPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const partner = await prisma.partner.update({ where: { id }, data: { status: "REJECTED" } });

    await prisma.walkingPartner.updateMany({
      where: { userId: partner.userId },
      data: { status: "REJECTED", rejectionReason: reason ?? null, reviewedBy: req.user!.userId, reviewedAt: new Date() },
    });

    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PARTNER_REJECT", entityType: "Partner", entityId: id } });
    sendSuccess(res, partner, "Walking partner rejected.");
  } catch (err) {
    sendError(res, "Failed to reject walking partner.", 500, "INTERNAL_ERROR");
  }
}

export async function getBookings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.serviceType) where.serviceType = req.query.serviceType;
    if (req.query.search) {
      where.OR = [
        { startLocation: { contains: req.query.search, mode: "insensitive" } },
        { endLocation: { contains: req.query.search, mode: "insensitive" } },
      ];
    }
    // Date range filters (ISO string or epoch ms)
    if (req.query.dateFrom || req.query.dateTo) {
      where.createdAt = {};
      if (req.query.dateFrom) {
        const from = new Date(String(req.query.dateFrom));
        if (!Number.isNaN(from.getTime())) where.createdAt.gte = from;
      }
      if (req.query.dateTo) {
        const to = new Date(String(req.query.dateTo));
        if (!Number.isNaN(to.getTime())) where.createdAt.lte = to;
      }
    }
    if (req.query.scheduledFrom || req.query.scheduledTo) {
      where.scheduledAt = {};
      if (req.query.scheduledFrom) {
        const from = new Date(String(req.query.scheduledFrom));
        if (!Number.isNaN(from.getTime())) where.scheduledAt.gte = from;
      }
      if (req.query.scheduledTo) {
        const to = new Date(String(req.query.scheduledTo));
        if (!Number.isNaN(to.getTime())) where.scheduledAt.lte = to;
      }
    }
    const [items, total] = await Promise.all([
      prisma.booking.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit,
        include: { user: { select: { id: true, fullName: true, email: true } }, partner: { select: { id: true, userId: true, user: { select: { fullName: true, email: true } } } } },
      }),
      prisma.booking.count({ where }),
    ]);

    // Attach each partner's last-known real GPS so the admin map can show the
    // current position even before a live socket push arrives.
    const partnerIds = items.map((b: any) => b.partnerId).filter(Boolean) as string[];
    const locs = partnerIds.length
      ? await prisma.partnerLocation.findMany({ where: { partnerId: { in: partnerIds } } })
      : [];
    const locMap = new Map(locs.map((l: any) => [l.partnerId, l]));
    const itemsWithLoc = items.map((b: any) => ({
      ...b,
      partnerLocation: b.partnerId ? (locMap.get(b.partnerId) ?? null) : null,
    }));

    sendSuccess(res, { items: itemsWithLoc, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve bookings.", 500, "INTERNAL_ERROR");
  }
}

export async function getBookingDetail(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id }, include: {
      user: { select: { id: true, fullName: true, email: true, phone: true } },
      partner: { select: { id: true, userId: true, user: { select: { fullName: true, email: true } } } },
    } });
    if (!booking) { sendError(res, "Booking not found.", 404, "NOT_FOUND"); return; }

    const [ratings, transactions, partnerLocation] = await Promise.all([
      prisma.rating.findMany({ where: { bookingId: id } }),
      prisma.transaction.findMany({ where: { bookingId: id } }),
      booking?.partnerId
        ? prisma.partnerLocation.findUnique({ where: { partnerId: booking.partnerId } })
        : Promise.resolve(null),
    ]);

    sendSuccess(res, { ...booking, partnerLocation: partnerLocation ?? null, ratings, transactions });
  } catch (err) {
    sendError(res, "Failed to retrieve booking.", 500, "INTERNAL_ERROR");
  }
}

export async function getWithdrawalRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({ where, orderBy: { createdAt: "asc" }, skip: (page - 1) * limit, take: limit, include: { user: { select: { id: true, fullName: true, email: true } } } }),
      prisma.withdrawalRequest.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve withdrawal requests.", 500, "INTERNAL_ERROR");
  }
}

// Wallet overview: every user wallet with owner + balance + 30d transaction count.
export async function getWallets(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.search) {
      where.user = {
        OR: [
          { fullName: { contains: req.query.search, mode: "insensitive" } },
          { email: { contains: req.query.search, mode: "insensitive" } },
        ],
      };
    }
    if (req.query.minBalance) {
      where.balance = { gte: Number(req.query.minBalance) };
    }
    const [items, total] = await Promise.all([
      prisma.wallet.findMany({
        where,
        orderBy: { balance: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, fullName: true, email: true, status: true } } },
      }),
      prisma.wallet.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve wallets.", 500, "INTERNAL_ERROR");
  }
}

// Live dispatch board: bookings currently in the dispatch / active lifecycle.
export async function getDispatchBoard(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const where: any = {
      status: { in: ["PARTNER_SEARCHING", "PARTNER_ACCEPTED", "OTP_GENERATED", "IN_PROGRESS"] },
    };
    if (req.query.serviceType) where.serviceType = req.query.serviceType;
    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, fullName: true, email: true } },
          partner: { select: { id: true, userId: true, user: { select: { fullName: true } } } },
          _count: { select: { dispatchRequests: true } },
        },
      }),
      prisma.booking.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve dispatch board.", 500, "INTERNAL_ERROR");
  }
}

// Service catalog: the real 14-service ecosystem, with runtime-enabled flags.
export async function getServices(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const items = SERVICE_CATALOG.map((s) => ({
      key: s.key,
      label: s.label,
      shortDescription: s.shortDescription,
      category: s.category,
      requiresItem: s.requiresItem,
      requiresDistance: s.requiresDistance,
      enabled: isServiceEnabled(s.key),
      pricing: s.pricing,
    }));
    sendSuccess(res, { items, total: items.length });
  } catch (err) {
    sendError(res, "Failed to retrieve service catalog.", 500, "INTERNAL_ERROR");
  }
}

// Chat reports (messaging safety moderation).
export async function getChatReports(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.chatReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { reporter: { select: { id: true, fullName: true, email: true } } },
      }),
      prisma.chatReport.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, 'Failed to retrieve chat reports.', 500, 'INTERNAL_ERROR');
  }
}

export async function resolveChatReport(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const report = await prisma.chatReport.findUnique({ where: { id } });
    if (!report) {
      sendError(res, 'Chat report not found.', 404, 'NOT_FOUND');
      return;
    }
    const updated = await prisma.chatReport.update({
      where: { id },
      data: { status: 'REVIEWED', reviewedBy: req.user!.userId, reviewedAt: new Date() },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: 'ADMIN',
        action: 'CHAT_REPORT_REVIEWED',
        entityType: 'ChatReport',
        entityId: id,
      },
    });
    sendSuccess(res, updated, 'Chat report reviewed.');
  } catch (err) {
    sendError(res, 'Failed to resolve chat report.', 500, 'INTERNAL_ERROR');
  }
}

export async function approveWithdrawal(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Withdrawal request not found.", 404, "WITHDRAWAL_NOT_FOUND");
      return;
    }
    if (request.status !== "PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
      return;
    }
    // Funds were held (debited) when the user requested the withdrawal.
    // Approval only settles the lifecycle — no further balance change.
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: req.user!.userId, reviewedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      // Settle the paired hold ledger row
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: { status: "COMPLETED", description: "Withdrawal approved and settled" },
      });

      await tx.auditLog.create({
        data: { actorId: req.user!.userId, actorType: "ADMIN", action: "WITHDRAWAL_APPROVE", entityType: "WithdrawalRequest", entityId: id },
      });
    });
sendSuccess(res, undefined, "Withdrawal approved.");
  } catch (err: any) {
    if (err?.message === "WITHDRAWAL_NOT_PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
    } else {
      sendError(res, "Failed to approve withdrawal.", 500, "INTERNAL_ERROR");
    }
  }
}

// Admin marks a withdrawal as paid and attaches the payout proof image
// (e.g. a transfer/UTI screenshot) in one step. Funds were already held
// (debited) when the user requested; approval only settles the lifecycle.
export async function approveWithdrawalWithProof(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!req.file) {
      sendError(res, "No payout proof image uploaded.", 400, "NO_FILE");
      return;
    }
    const request = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Withdrawal request not found.", 404, "WITHDRAWAL_NOT_FOUND");
      return;
    }
    if (request.status !== "PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
      return;
    }
    const payoutProofImageUrl = `/uploads/${(req.file as Express.Multer.File).filename}`;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "APPROVED",
          reviewedBy: req.user!.userId,
          reviewedAt: new Date(),
          payoutProofImageUrl,
        },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      // Settle the paired hold ledger row
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: { status: "COMPLETED", description: "Withdrawal paid (proof attached)" },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "ADMIN",
          action: "WITHDRAWAL_APPROVE_WITH_PROOF",
          entityType: "WithdrawalRequest",
          entityId: id,
          metadata: JSON.stringify({ payoutProofImageUrl }),
        },
      });
    });

    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: "Withdrawal paid",
        body: `Rs ${Number(request.amount)} was paid out to your ${request.method === "UPI" ? "UPI" : "bank"} account. A payout proof has been attached.`,
        data: JSON.stringify({ kind: "WITHDRAWAL_PAID", withdrawalId: id }),
      },
    });

    sendSuccess(res, { payoutProofImageUrl }, "Withdrawal approved and payout proof attached.");
  } catch (err: any) {
    if (err?.message === "WITHDRAWAL_NOT_PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
    } else {
      console.error("approveWithdrawalWithProof error:", err);
      sendError(res, "Failed to approve withdrawal.", 500, "INTERNAL_ERROR");
    }
  }
}

export async function rejectWithdrawal(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const request = await prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Withdrawal request not found.", 404, "WITHDRAWAL_NOT_FOUND");
      return;
    }
    if (request.status !== "PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
      return;
    }
    // Release the held funds exactly once (conditional claim prevents double-release)
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "REJECTED", reviewedBy: req.user!.userId, reviewedAt: new Date(), rejectionReason: reason || "Rejected by admin" },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      await tx.wallet.update({
        where: { id: request.walletId },
        data: { balance: { increment: request.amount } },
      });

      // Close the paired hold ledger row
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: { status: "FAILED", description: `Withdrawal rejected${reason ? `: ${reason}` : ""}; hold released` },
      });

      await tx.auditLog.create({
        data: { actorId: req.user!.userId, actorType: "ADMIN", action: "WITHDRAWAL_REJECT", entityType: "WithdrawalRequest", entityId: id, metadata: reason ? JSON.stringify({ reason }) : null },
      });
    });
    sendSuccess(res, undefined, "Withdrawal rejected.");
  } catch (err: any) {
    if (err?.message === "WITHDRAWAL_NOT_PENDING") {
      sendError(res, "Withdrawal already processed.", 400, "INVALID_STATUS");
    } else {
      sendError(res, "Failed to reject withdrawal.", 500, "INTERNAL_ERROR");
    }
  }
}

export async function getReports(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.report.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit, include: { reporter: { select: { id: true, fullName: true } }, target: { select: { id: true, fullName: true } } } }),
      prisma.report.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve reports.", 500, "INTERNAL_ERROR");
  }
}

export async function resolveReport(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const report = await prisma.report.update({ where: { id }, data: { status: "RESOLVED", resolvedBy: req.user!.userId, resolvedAt: new Date() } });
    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "REPORT_RESOLVE", entityType: "Report", entityId: id, metadata: note ? JSON.stringify({ note }) : null } });
    sendSuccess(res, report, "Report resolved.");
  } catch (err) {
    sendError(res, "Failed to resolve report.", 500, "INTERNAL_ERROR");
  }
}

export async function getAuditLogs(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const action = typeof req.query.action === "string" && req.query.action.trim() ? req.query.action.trim() : undefined;
    const where: any = action ? { action } : {};
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve audit logs.", 500, "INTERNAL_ERROR");
  }
}

export async function sendNotification(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId, title, body, data } = req.body;
    const notification = await prisma.notification.create({
      data: { userId, title, body, data: data ? JSON.stringify(data) : null },
    });
    sendSuccess(res, notification, "Notification sent.", 201);
  } catch (err) {
    sendError(res, "Failed to send notification.", 500, "INTERNAL_ERROR");
  }
}

// Admin inbox: SOS alerts and system notices addressed to this admin.
// (Rows are written by SOS fan-out, approvals, and system events.)
export async function getAdminNotifications(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { role: true, activeRole: true },
    });
    const profileId = await ensureAdminUser(req.user!.userId, me?.activeRole || me?.role || "ADMIN");
    const unreadOnly = req.query.unread === "true";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const where: any = { adminUserId: profileId };
    if (unreadOnly) where.isRead = false;
    const [items, unread] = await Promise.all([
      prisma.adminNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.adminNotification.count({ where: { adminUserId: profileId, isRead: false } }),
    ]);
    sendSuccess(res, { items, unread }, "Admin notifications retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve admin notifications.", 500, "INTERNAL_ERROR");
  }
}

export async function markAdminNotificationRead(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const me = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { role: true, activeRole: true },
    });
    const profileId = await ensureAdminUser(req.user!.userId, me?.activeRole || me?.role || "ADMIN");
    const updated = await prisma.adminNotification.updateMany({
      where: { id, adminUserId: profileId },
      data: { isRead: true },
    });
    if (updated.count !== 1) {
      sendError(res, "Notification not found.", 404, "NOT_FOUND");
      return;
    }
    sendSuccess(res, undefined, "Marked as read.");
  } catch (err) {
    sendError(res, "Failed to update notification.", 500, "INTERNAL_ERROR");
  }
}

// Broadcast email to all (or a role scope of) users with a real email address.
// Sends individually through the configured provider and reports a summary.
export async function broadcastEmail(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim().slice(0, 120) : "";
    const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 5000) : "";
    if (!subject || !body) {
      sendError(res, "subject and body are required.", 400, "VALIDATION_ERROR");
      return;
    }

    const scopes: Record<string, string[]> = { ALL: ["USER", "PARTNER"], USERS: ["USER"], PARTNERS: ["PARTNER"] };
    const roles = scopes[String(req.body?.audience || "ALL")] || scopes.ALL;

    const users = await prisma.user.findMany({
      where: { role: { in: roles } },
      select: { email: true },
    });

    const recipients = users
      .map((u) => (u.email || "").trim())
      .filter(
        (email) => email.length > 0 && !isDemoEmail(email) && !/sidebud|example\.com|\.test\b/i.test(email)
      );

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#D83D27;margin:0 0 8px">Nabri</h2><h3 style="margin:0 0 12px;color:#111">${esc(subject)}</h3><div style="font-size:14px;line-height:1.6;color:#111">${esc(body).replace(/\n/g, "<br/>")}</div><hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/><p style="color:#9ca3af;font-size:12px">Nabri · Your Partner for Every Side of Life. <br/> You are receiving this because you have a Nabri account.</p></div>`;

    let sent = 0;
    let failed = 0;
    const CHUNK = 10;
    for (let i = 0; i < recipients.length; i += CHUNK) {
      const results = await Promise.all(recipients.slice(i, i + CHUNK).map((to) => sendEmail(to, subject, html)));
      for (const r of results) {
        if (r.ok) sent += 1;
        else failed += 1;
      }
    }

    if (sent === 0 && recipients.length > 0) {
      sendError(res, "No emails could be delivered. Check the email provider configuration.", 502, "EMAIL_DELIVERY_FAILED");
      return;
    }

    sendSuccess(res, { total: recipients.length, sent, failed }, `Broadcast sent to ${sent} of ${recipients.length} recipients.`);
  } catch (err) {
    console.error("Broadcast email error:", err);
    sendError(res, "Failed to send broadcast email.", 500, "INTERNAL_ERROR");
  }
}

// Live email-provider status so the admin UI can block/surface a broadcast
// that would otherwise silently no-op.
export async function getEmailStatus(req: AuthedRequest, res: Response): Promise<void> {
  sendSuccess(res, { email: emailStatus() }, "Email provider status.");
}

// Send a single test email to an arbitrary address (admin tooling: verify the
// provider config BEFORE firing a broadcast to the whole platform).
export async function sendTestEmail(req: AuthedRequest, res: Response): Promise<void> {
  const to = String(req.body?.to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    sendError(res, "A valid recipient email is required.", 400, "VALIDATION_ERROR");
    return;
  }
  const result = await sendEmail(
    to,
    "Nabri test email",
    `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#D83D27;margin:0 0 8px">Nabri</h2><p>This is a test email from the Nabri admin panel to confirm your email provider is configured correctly.</p></div>`,
    "This is a test email from the Nabri admin panel to confirm your email provider is configured correctly."
  );
  if (!result.ok) {
    sendError(
      res,
      `Email not delivered — provider: ${result.provider}. ${result.error === "EMAIL_NOT_CONFIGURED" ? "Add SMTP or Resend credentials (email provider) on the server environment, then retry." : result.error}`,
      502,
      "EMAIL_DELIVERY_FAILED"
    );
    return;
  }
  sendSuccess(res, { to, provider: result.provider, messageId: result.messageId }, "Test email sent.");
}

// ============================================================================
// SECTION 2: PRICING CONFIG MANAGEMENT
// ============================================================================

// Complete dispatch timeline for one booking (Part 9): every partner the job
// was sent to, with sent/viewed/responded timestamps.
export async function getBookingDispatch(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, status: true, createdAt: true },
    });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    const requests = await prisma.dispatchRequest.findMany({
      where: { bookingId: id },
      orderBy: { sentAt: "asc" },
      include: {
        partner: {
          select: { id: true, user: { select: { fullName: true, email: true } } },
        },
      },
    });
    sendSuccess(res, {
      booking,
      timeline: requests.map((r) => ({
        id: r.id,
        partnerId: r.partnerId,
        partnerName: r.partner?.user.fullName ?? "Unknown",
        status: r.status,
        sentAt: r.sentAt,
        viewedAt: r.viewedAt,
        respondedAt: r.respondedAt,
        expiresAt: r.expiresAt,
      })),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve dispatch timeline.", 500, "INTERNAL_ERROR");
  }
}

// Booking state-change audit trail (Part 10 / BookingLog).
export async function getBookingLogs(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    const logs = await prisma.bookingLog.findMany({
      where: { bookingId: id },
      orderBy: { createdAt: "asc" },
    });
    sendSuccess(res, {
      booking,
      logs: logs.map((l) => ({
        id: l.id,
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        actorId: l.actorId,
        actorType: l.actorType,
        note: l.note,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve booking logs.", 500, "INTERNAL_ERROR");
  }
}

export async function getPricingConfigs(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const configs = await prisma.pricingConfig.findMany({ orderBy: { category: "asc" } });
    sendSuccess(res, configs, "Pricing configs retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve pricing configs.", 500, "INTERNAL_ERROR");
  }
}

export async function updatePricingConfig(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { value, description, isActive, serviceType } = req.body;
    const data: any = {};
    const existing = await prisma.pricingConfig.findUnique({ where: { id } });
    const oldValue = existing?.value;
    const oldActive = existing?.isActive;
    if (value !== undefined) {
      // Validate: value must be numeric to prevent NaN propagation in pricing engine
      const numValue = Number(value);
      if (typeof value === "string" && value.trim() !== "" && isNaN(numValue)) {
        sendError(res, "Pricing value must be a valid number.", 400, "INVALID_VALUE");
        return;
      }
      if (numValue < 0) {
        sendError(res, "Pricing value cannot be negative.", 400, "INVALID_VALUE");
        return;
      }
      data.value = String(value);
    }
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;
    if (serviceType !== undefined) data.serviceType = serviceType || null;
    const config = await prisma.pricingConfig.update({ where: { id }, data });
    const version = await bumpPricingVersion(req.user!.userId);
    invalidateConfigCache();
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "ADMIN",
        action: "PRICING_UPDATE",
        entityType: "PricingConfig",
        entityId: id,
        metadata: JSON.stringify({
          key: existing?.key,
          serviceType: existing?.serviceType,
          oldValue,
          newValue: data.value,
          oldActive,
          newActive: data.isActive ?? oldActive,
          version,
          timestamp: new Date().toISOString(),
        }),
      },
    });
    sendSuccess(res, config, "Pricing config updated.");
  } catch (err) {
    sendError(res, "Failed to update pricing config.", 500, "INTERNAL_ERROR");
  }
}

export async function createPricingConfig(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { key, value, description, category, serviceType } = req.body;
    const existing = await prisma.pricingConfig.findUnique({ where: { key } });
    if (existing) {
      sendError(res, "Config key already exists.", 400, "CONFIG_EXISTS");
      return;
    }
    const config = await prisma.pricingConfig.create({
      data: {
        key,
        value: String(value),
        description,
        category: category || "GENERAL",
        serviceType: serviceType || null,
      },
    });
    invalidateConfigCache();
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PRICING_CREATE", entityType: "PricingConfig", entityId: config.id, metadata: JSON.stringify({ key, value, serviceType: serviceType || null }) },
    });
    sendSuccess(res, config, "Pricing config created.", 201);
  } catch (err) {
    sendError(res, "Failed to create pricing config.", 500, "INTERNAL_ERROR");
  }
}

export async function deletePricingConfig(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.pricingConfig.delete({ where: { id } });
    await bumpPricingVersion(req.user!.userId);
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "PRICING_DELETE", entityType: "PricingConfig", entityId: id },
    });
    sendSuccess(res, undefined, "Pricing config deleted.");
  } catch (err) {
    sendError(res, "Failed to delete pricing config.", 500, "INTERNAL_ERROR");
  }
}

// Increments the global pricing version whenever admin changes pricing so each
// booking can freeze which pricing revision was in effect at creation time.
async function bumpPricingVersion(actorId: string): Promise<number> {
  try {
    const current = await prisma.pricingConfig.findUnique({ where: { key: PRICING_VERSION_KEY } });
    const next = current ? Math.floor(parseFloat(current.value) || 1) + 1 : 1;
    if (current) {
      await prisma.pricingConfig.update({ where: { key: PRICING_VERSION_KEY }, data: { value: String(next) } });
    } else {
      await prisma.pricingConfig.create({
        data: { key: PRICING_VERSION_KEY, value: String(next), description: "Global pricing version", category: "GENERAL" },
      });
    }
    await prisma.auditLog.create({
      data: { actorId, actorType: "ADMIN", action: "PRICING_VERSION_BUMP", entityType: "PricingConfig", entityId: PRICING_VERSION_KEY, metadata: JSON.stringify({ version: next }) },
    });
    return next;
  } catch {
    // Version bump is best-effort; pricing still applies without it.
    const current = await prisma.pricingConfig.findUnique({ where: { key: PRICING_VERSION_KEY } }).catch(() => null);
    return current ? Math.floor(parseFloat(current.value) || 1) : 1;
  }
}

// Admin "Test Price" simulator: preview the exact user charge, breakdown,
// platform fee and partner earnings for a service before activating changes.
export async function simulatePricing(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { serviceType, durationMinutes, distanceKm, draft } = req.body;
    const stype = typeof serviceType === "string" && SERVICE_KEYS.includes(serviceType) ? serviceType : "WALKING";
    const result = await bookingEngine.simulatePrice({
      serviceType: stype,
      durationMinutes: durationMinutes ? Number(durationMinutes) : 30,
      distanceKm: distanceKm ? Number(distanceKm) : 0,
      draft: draft && typeof draft === "object" ? draft : undefined,
    });
    sendSuccess(res, result, "Price simulation complete.");
  } catch (err) {
    sendError(res, "Failed to simulate price.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SECTION 3: COUPON MANAGEMENT
// ============================================================================

export async function getCoupons(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
    sendSuccess(res, coupons, "Coupons retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve coupons.", 500, "INTERNAL_ERROR");
  }
}

export async function createCoupon(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { code, description, discountType, discountValue, minAmount, maxDiscount, validFrom, validTo, usageLimit } = req.body;
    const existing = await prisma.coupon.findUnique({ where: { code } });
    if (existing) {
      sendError(res, "Coupon code already exists.", 400, "COUPON_EXISTS");
      return;
    }
    const coupon = await prisma.coupon.create({
      data: { code, description, discountType, discountValue, minAmount: minAmount || 0, maxDiscount, validFrom: new Date(validFrom), validTo: new Date(validTo), usageLimit },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "ADMIN", action: "COUPON_CREATE", entityType: "Coupon", entityId: coupon.id, metadata: JSON.stringify({ code }) },
    });
    sendSuccess(res, coupon, "Coupon created.", 201);
  } catch (err) {
    sendError(res, "Failed to create coupon.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCoupon(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { description, discountType, discountValue, minAmount, maxDiscount, validFrom, validTo, usageLimit, isActive } = req.body;
    const data: any = {};
    if (description !== undefined) data.description = description;
    if (discountType !== undefined) data.discountType = discountType;
    if (discountValue !== undefined) data.discountValue = discountValue;
    if (minAmount !== undefined) data.minAmount = minAmount;
    if (maxDiscount !== undefined) data.maxDiscount = maxDiscount;
    if (validFrom !== undefined) data.validFrom = new Date(validFrom);
    if (validTo !== undefined) data.validTo = new Date(validTo);
    if (usageLimit !== undefined) data.usageLimit = usageLimit;
    if (isActive !== undefined) data.isActive = isActive;
    const coupon = await prisma.coupon.update({ where: { id }, data });
    sendSuccess(res, coupon, "Coupon updated.");
  } catch (err) {
    sendError(res, "Failed to update coupon.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteCoupon(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.coupon.delete({ where: { id } });
    sendSuccess(res, undefined, "Coupon deleted.");
  } catch (err) {
    sendError(res, "Failed to delete coupon.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SECTION 4: SERVICE AREA MANAGEMENT
// ============================================================================

export async function getServiceAreas(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const areas = await prisma.serviceArea.findMany({ orderBy: { name: "asc" } });
    sendSuccess(res, areas, "Service areas retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve service areas.", 500, "INTERNAL_ERROR");
  }
}

export async function createServiceArea(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { name, city, state, baseFeeMultiplier } = req.body;
    const area = await prisma.serviceArea.create({
      data: { name, city, state, baseFeeMultiplier: baseFeeMultiplier || 1.0 },
    });
    sendSuccess(res, area, "Service area created.", 201);
  } catch (err) {
    sendError(res, "Failed to create service area.", 500, "INTERNAL_ERROR");
  }
}

export async function updateServiceArea(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, city, state, isActive, baseFeeMultiplier } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (city !== undefined) data.city = city;
    if (state !== undefined) data.state = state;
    if (isActive !== undefined) data.isActive = isActive;
    if (baseFeeMultiplier !== undefined) data.baseFeeMultiplier = baseFeeMultiplier;
    const area = await prisma.serviceArea.update({ where: { id }, data });
    sendSuccess(res, area, "Service area updated.");
  } catch (err) {
    sendError(res, "Failed to update service area.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteServiceArea(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.serviceArea.delete({ where: { id } });
    sendSuccess(res, undefined, "Service area deleted.");
  } catch (err) {
    sendError(res, "Failed to delete service area.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SECTION 5: PROMOTIONAL CAMPAIGNS
// ============================================================================

export async function getCampaigns(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const campaigns = await prisma.promotionalCampaign.findMany({ orderBy: { createdAt: "desc" } });
    sendSuccess(res, campaigns, "Campaigns retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve campaigns.", 500, "INTERNAL_ERROR");
  }
}

export async function createCampaign(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { name, description, discountType, discountValue, minAmount, maxDiscount, startDate, endDate, budget, usageLimit } = req.body;
    const campaign = await prisma.promotionalCampaign.create({
      data: {
        name,
        description,
        discountType,
        discountValue,
        minAmount: minAmount || 0,
        maxDiscount,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        budget,
        usageLimit,
        createdBy: req.user!.userId,
      },
    });
    sendSuccess(res, campaign, "Campaign created.", 201);
  } catch (err) {
    sendError(res, "Failed to create campaign.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCampaign(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, description, discountType, discountValue, minAmount, maxDiscount, startDate, endDate, budget, usageLimit, isActive } = req.body;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (discountType !== undefined) data.discountType = discountType;
    if (discountValue !== undefined) data.discountValue = discountValue;
    if (minAmount !== undefined) data.minAmount = minAmount;
    if (maxDiscount !== undefined) data.maxDiscount = maxDiscount;
    if (startDate !== undefined) data.startDate = new Date(startDate);
    if (endDate !== undefined) data.endDate = new Date(endDate);
    if (budget !== undefined) data.budget = budget;
    if (usageLimit !== undefined) data.usageLimit = usageLimit;
    if (isActive !== undefined) data.isActive = isActive;
    const campaign = await prisma.promotionalCampaign.update({ where: { id }, data });
    sendSuccess(res, campaign, "Campaign updated.");
  } catch (err) {
    sendError(res, "Failed to update campaign.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteCampaign(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.promotionalCampaign.delete({ where: { id } });
    sendSuccess(res, undefined, "Campaign deleted.");
  } catch (err) {
    sendError(res, "Failed to delete campaign.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SECTION 6: REVENUE & ANALYTICS
// ============================================================================

export async function getRevenueAnalytics(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayRevenue, weeklyRevenue, monthlyRevenue, totalRevenue, totalPlatformFees, totalPartnerEarnings, totalCompletedJobs] = await Promise.all([
      prisma.earningDetail.aggregate({ _sum: { netAmount: true }, where: { createdAt: { gte: startOfToday }, status: "COMPLETED" } }),
      prisma.earningDetail.aggregate({ _sum: { netAmount: true }, where: { createdAt: { gte: startOfWeek }, status: "COMPLETED" } }),
      prisma.earningDetail.aggregate({ _sum: { netAmount: true }, where: { createdAt: { gte: startOfMonth }, status: "COMPLETED" } }),
      prisma.earningDetail.aggregate({ _sum: { netAmount: true }, where: { status: "COMPLETED" } }),
      prisma.earningDetail.aggregate({ _sum: { platformFee: true }, where: { status: "COMPLETED" } }),
      prisma.partnerEarnings.aggregate({ _sum: { lifetimeEarnings: true } }),
      prisma.walkingRequest.count({ where: { status: "COMPLETED" } }),
    ]);

    sendSuccess(res, {
      todayPartnerEarnings: todayRevenue._sum.netAmount || 0,
      weeklyPartnerEarnings: weeklyRevenue._sum.netAmount || 0,
      monthlyPartnerEarnings: monthlyRevenue._sum.netAmount || 0,
      totalPartnerEarnings: totalRevenue._sum.netAmount || 0,
      totalPlatformFees: totalPlatformFees._sum.platformFee || 0,
      totalLifetimePartnerEarnings: totalPartnerEarnings._sum.lifetimeEarnings || 0,
      totalCompletedJobs,
    }, "Revenue analytics retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve revenue analytics.", 500, "INTERNAL_ERROR");
  }
}

export async function getPartnerLevels(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const levels = await prisma.partnerLevel.findMany({
      orderBy: { points: "desc" },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    sendSuccess(res, levels, "Partner levels retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve partner levels.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// ADMIN PAYMENT CENTER — real Razorpay orders/payments (PaymentOrder ledger)
// ============================================================================

export async function getPayments(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.type) where.type = req.query.type;
    if (req.query.search) {
      where.OR = [
        { razorpayOrderId: { contains: String(req.query.search) } },
        { razorpayPaymentId: { contains: String(req.query.search) } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.paymentOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, fullName: true, email: true, phone: true } },
        },
      }),
      prisma.paymentOrder.count({ where }),
    ]);
    // Attach booking linkage from metadata for BOOKING-type payments
    const bookingIds = items
      .map((o) => {
        try { return (JSON.parse(o.metadata ?? "{}") as any).bookingId; } catch { return undefined; }
      })
      .filter((v): v is string => typeof v === "string");
    const bookings = bookingIds.length
      ? await prisma.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, serviceType: true, status: true, paymentStatus: true } })
      : [];
    const byId = new Map(bookings.map((b) => [b.id, b]));
    const enriched = items.map((o) => {
      let meta: any = {};
      try { meta = JSON.parse(o.metadata ?? "{}"); } catch {}
      return { ...o, booking: meta.bookingId ? byId.get(meta.bookingId) ?? null : null };
    });
    sendSuccess(res, { items: enriched, page, limit, total });
  } catch (err) {
    console.error("getPayments error:", err);
    sendError(res, "Failed to retrieve payments.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PAYMENT STATS — money overview for the admin payment center.
// ============================================================================
export async function getPaymentStats(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [
      completedOrders,
      failedOrders,
      pendingOrders,
      bookingFees,
      partnerEarnings,
      walletTopups,
      withdrawals,
      completedBookings,
      activePartners,
      activeUsers,
      cashBookings,
    ] = await Promise.all([
      prisma.paymentOrder.aggregate({ _sum: { amount: true }, _count: true, where: { status: "COMPLETED" } }),
      prisma.paymentOrder.count({ where: { status: "FAILED" } }),
      prisma.paymentOrder.count({ where: { status: { in: ["CREATED", "AUTHORIZED"] } } }),
      prisma.booking.aggregate({ _sum: { platformFee: true }, where: { status: "COMPLETED" } }),
      prisma.transaction.aggregate({ _sum: { amount: true }, where: { type: "PARTNER_EARNING", status: "COMPLETED" } }),
      prisma.paymentOrder.aggregate({ _sum: { amount: true }, _count: true, where: { status: "COMPLETED", type: "TOPUP" } }),
      prisma.withdrawalRequest.aggregate({ _sum: { amount: true }, where: { status: { in: ["PENDING", "APPROVED", "PROCESSED"] } } }).catch(() => ({ _sum: { amount: null } })),
      prisma.booking.count({ where: { status: "COMPLETED" } }),
      prisma.partner.count({ where: { status: "APPROVED" } }),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      // Cash paid directly to partners by users at the doorstep
      prisma.booking.aggregate({
        _sum: { estimatedAmount: true, platformFee: true },
        _count: true,
        where: { paymentStatus: "CASH_RECEIVED" },
      }),
    ]);
    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    const cash = cashBookings as { _sum: { estimatedAmount: unknown; platformFee: unknown }; _count: number };
    sendSuccess(res, {
      totalCollected: num(completedOrders._sum.amount),
      completedTransactions: completedOrders._count,
      failedTransactions: failedOrders,
      pendingTransactions: pendingOrders,
      platformFeesEarned: num(bookingFees._sum.platformFee),
      partnerPayouts: num(partnerEarnings._sum.amount),
      walletTopups: num(walletTopups._sum.amount),
      topupCount: walletTopups._count,
      pendingWithdrawalsAmount: num((withdrawals as any)._sum.amount),
      completedBookings,
      activePartners,
      activeUsers,
      cashCollectedByPartners: num(cash._sum.estimatedAmount),
      cashPlatformFeesDue: num(cash._sum.platformFee),
      cashBookingCount: cash._count || 0,
    });
  } catch (err) {
    console.error("getPaymentStats error:", err);
    sendError(res, "Failed to compute payment stats.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MANUAL UPI VERIFICATION QUEUE (admin confirms external UPI payments)
// ============================================================================

export async function listUpiPayments(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const status = (req.query.status as string) || "VERIFICATION_PENDING";
    const items = await prisma.upiPayment.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      include: {
        booking: { select: { id: true, serviceType: true, status: true, estimatedAmount: true, startLocation: true, endLocation: true } },
      },
    });
    const userIds = Array.from(new Set(items.map((i) => i.userId)));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, email: true, phone: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const enriched = items.map((i) => ({ ...i, user: userById.get(i.userId) ?? null }));
    sendSuccess(res, { items: enriched, total: enriched.length });
  } catch (err: any) {
    console.error("listUpiPayments error:", err);
    sendError(res, "Failed to list UPI payments.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyUpiPayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { action, note } = req.body; // VERIFY | REJECT | REQUEST_INFO

    const upi = await prisma.upiPayment.findUnique({ where: { id }, include: { booking: true } });
    if (!upi) {
      sendError(res, "UPI payment not found.", 404, "NOT_FOUND");
      return;
    }
    // A rejection or info-request without a reason leaves the user guessing
    // whether their proof was real or fake — the note IS the reply.
    if ((action === "REJECT" || action === "REQUEST_INFO") && !String(note || "").trim()) {
      sendError(res, "A note is required so the user knows why (real or fake, what to fix).", 400, "NOTE_REQUIRED");
      return;
    }
    if (upi.status === "VERIFIED" && action === "VERIFY") {
      sendSuccess(res, { status: "VERIFIED" }, "Already verified.");
      return;
    }

    const booking = upi.booking;
    const amount = Number(upi.amount);

    if (action === "VERIFY") {
      await moneyTransaction(async (tx) => {
        // Hold escrow only if this booking hasn't already been paid (idempotent).
        if (booking.paymentStatus !== "PAID") {
          const wallet = await tx.wallet.findUnique({ where: { userId: upi.userId } });
          if (!wallet) throw new Error("WALLET_MISSING");
          if (Number(wallet.balance) < amount) throw new Error("INSUFFICIENT_BALANCE");
          await tx.wallet.update({ where: { userId: upi.userId }, data: { balance: { decrement: amount } } });
          await tx.transaction.create({
            data: {
              userId: upi.userId,
              walletId: wallet.id,
              bookingId: booking.id,
              type: "WALLET_DEBIT",
              amount,
              status: "SUCCESS",
              description: `UPI booking payment - ${booking.serviceType}`,
            },
          });
        }
        await tx.upiPayment.update({
          where: { id },
          data: { status: "VERIFIED", verifiedByAdminId: req.user!.userId, verificationNote: note ?? null },
        });
        await tx.booking.updateMany({
          where: { id: booking.id, paymentStatus: "VERIFICATION_PENDING" },
          data: { status: "PARTNER_SEARCHING", paymentStatus: "PAID", paymentVerifiedAt: new Date(), paymentMethod: "UPI_MANUAL" },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.userId,
            actorType: "ADMIN",
            action: "UPI_PAYMENT_VERIFIED",
            entityType: "Booking",
            entityId: booking.id,
            metadata: JSON.stringify({ referenceNumber: upi.referenceNumber, amount, note }),
          },
        });
      });

      await prisma.notification.create({
        data: {
          userId: upi.userId,
          title: "Payment Verified",
          body: `Your UPI payment for booking ${booking.id.slice(0, 8)} is verified. Searching for a partner.`,
          data: JSON.stringify({ bookingId: booking.id }),
        },
      });
      // Trigger partner matching (same as the Razorpay verified path).
      partnerMatching
        .assignPartnerToBooking(booking.id, {
          serviceType: booking.serviceType,
          startLocation: booking.startLocation,
          endLocation: booking.endLocation,
          startLatitude: booking.startLatitude || undefined,
          startLongitude: booking.startLongitude || undefined,
          endLatitude: booking.endLatitude || undefined,
          endLongitude: booking.endLongitude || undefined,
          durationMinutes: booking.durationMinutes || undefined,
          userId: booking.userId,
        })
        .catch((e) => console.error("[UPI] dispatch error:", e));

      sendSuccess(res, { status: "VERIFIED" }, "Payment verified. Booking confirmed.");
    } else if (action === "REJECT") {
      await prisma.$transaction(async (tx) => {
        await tx.upiPayment.update({
          where: { id },
          data: { status: "REJECTED", verifiedByAdminId: req.user!.userId, verificationNote: note ?? null },
        });
        await tx.booking.updateMany({ where: { id: booking.id }, data: { paymentStatus: "REJECTED" } });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.userId,
            actorType: "ADMIN",
            action: "UPI_PAYMENT_REJECTED",
            entityType: "Booking",
            entityId: booking.id,
            metadata: JSON.stringify({ referenceNumber: upi.referenceNumber, note }),
          },
        });
      });
      await prisma.notification.create({
        data: {
          userId: upi.userId,
          title: "Payment Rejected",
          body: `Your UPI payment reference was rejected. ${note ?? ""}`.trim(),
          data: JSON.stringify({ bookingId: booking.id }),
        },
      });
      sendSuccess(res, { status: "REJECTED" }, "Payment rejected.");
    } else if (action === "REQUEST_INFO") {
      await prisma.upiPayment.update({
        where: { id },
        data: { status: "REQUEST_INFO", verificationNote: note ?? null },
      });
      await prisma.notification.create({
        data: {
          userId: upi.userId,
          title: "More info needed",
          body: `Admin needs more information for your UPI payment. ${note ?? ""}`.trim(),
          data: JSON.stringify({ bookingId: booking.id }),
        },
      });
      sendSuccess(res, { status: "REQUEST_INFO" }, "Information requested.");
    } else {
      sendError(res, "Action must be VERIFY, REJECT or REQUEST_INFO.", 400, "VALIDATION_ERROR");
    }
  } catch (err: any) {
    if (err?.message === "INSUFFICIENT_BALANCE") {
      sendError(res, "User has insufficient wallet balance to hold escrow.", 400, "INSUFFICIENT_BALANCE");
      return;
    }
    console.error("verifyUpiPayment error:", err);
    sendError(res, "Failed to verify UPI payment.", 500, "INTERNAL_ERROR");
  }
}

// Admin sets the platform's personal UPI QR (used for the manual UPI flow).
export async function setUpiConfig(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { upiId, accountName, qrUrl } = req.body;
    if (!upiId || !/^[\w.\-@]+$/.test(String(upiId))) {
      sendError(res, "A valid UPI ID (e.g. name@bank) is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const entries = [
      { key: "UPI_ID", value: String(upiId) },
      { key: "UPI_ACCOUNT_NAME", value: accountName ? String(accountName) : "" },
      { key: "UPI_QR_URL", value: qrUrl ? String(qrUrl) : "" },
    ];
    for (const e of entries) {
      await prisma.pricingConfig.upsert({
        where: { key: e.key },
        create: { key: e.key, value: e.value, description: "Platform UPI config", category: "PAYMENT" },
        update: { value: e.value },
      });
    }
    invalidateConfigCache();
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "ADMIN",
        action: "UPI_CONFIG_UPDATED",
        entityType: "Platform",
        entityId: "UPI",
        metadata: JSON.stringify({ upiId }),
      },
    });
    sendSuccess(res, { upiId, accountName, qrUrl }, "UPI configuration saved.");
  } catch (err: any) {
    console.error("setUpiConfig error:", err);
    sendError(res, "Failed to save UPI config.", 500, "INTERNAL_ERROR");
  }
}

// Admin reads the platform's configured UPI details.
export async function getUpiConfig(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [upiId, name, qr] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_QR_URL" } }),
    ]);
    sendSuccess(res, {
      upiId: upiId?.value ?? null,
      accountName: name?.value ?? null,
      qrUrl: qr?.value ?? null,
    });
  } catch (err: any) {
    console.error("getUpiConfig error:", err);
    sendError(res, "Failed to load UPI config.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// ADMIN ACCOUNT PROVISIONING — only SUPER_ADMIN can add/manage admins here.
// Public signup can never create admin accounts (register hardcodes USER).
// ============================================================================

const ADMIN_TIER = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"];
const ASSIGNABLE_ADMIN_ROLES = ["SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"];

async function ensureAdminRole(name: string, permissions?: string[]) {
  const existing = await prisma.adminRole.findUnique({ where: { name } });
  if (existing) return existing;
  return prisma.adminRole.create({ data: { name, displayName: name.charAt(0) + name.slice(1).toLowerCase(), permissions: JSON.stringify(permissions ?? []), isSystem: true } });
}

export async function getAdminAccounts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ADMIN_TIER } },
      select: {
        id: true, email: true, phone: true, fullName: true, status: true, role: true, activeRole: true, createdAt: true,
        adminProfile: { include: { role: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const items = admins.map((a) => {
      let permissions: string[] | null = null;
      const raw = (a.adminProfile as any)?.permissions;
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) permissions = parsed.filter((p: unknown): p is string => typeof p === "string");
        } catch { /* ignore malformed */ }
      } else if (Array.isArray(raw)) {
        permissions = raw as string[];
      }
      return { ...a, permissions };
    });
    sendSuccess(res, { items, total: items.length });
  } catch (err) {
    console.error("getAdminAccounts error:", err);
    sendError(res, "Failed to retrieve admin accounts.", 500, "INTERNAL_ERROR");
  }
}

export async function createAdminAccount(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { email, phone, password, fullName, role, department, permissions, sections } = req.body;
    if (!email || !password || !fullName || !role || !phone) {
      sendError(res, "Email, phone, password, full name and role are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!ASSIGNABLE_ADMIN_ROLES.includes(role)) {
      sendError(res, `Role must be one of: ${ASSIGNABLE_ADMIN_ROLES.join(", ")}.`, 400, "INVALID_ROLE");
      return;
    }
    if (String(password).length < 8) {
      sendError(res, "Password must be at least 8 characters.", 400, "WEAK_PASSWORD");
      return;
    }
    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) {
      sendError(res, "A user with this email/phone already exists.", 409, "DUPLICATE_USER");
      return;
    }

    // Resolve the effective permission set for this account.
    // 1) explicit `permissions` array (section.action tokens) wins,
    // 2) otherwise derive from the role template,
    // 3) `sections` convenience object { SECTION: [ACTIONS] } is also accepted.
    let effectivePermissions: string[] | undefined;
    if (Array.isArray(permissions) && permissions.length) {
      effectivePermissions = permissions;
    } else if (sections && typeof sections === "object") {
      effectivePermissions = Object.entries(sections).flatMap(([section, acts]) =>
        (acts as string[]).map((a) => `${section}.${a}`)
      );
    } else {
      const { permissionsForRole } = await import("../rbac/sections.js");
      effectivePermissions = permissionsForRole(role);
    }

    const passwordHash = await bcrypt.hash(String(password), env.BCRYPT_SALT_ROUNDS);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          fullName,
          dateOfBirth: new Date("1990-01-01"),
          gender: "OTHER",
          role,
          activeRole: role,
          status: "ACTIVE",
          emailVerified: true,
        },
      });
      const adminRole = await ensureAdminRole(role, effectivePermissions);
      await tx.adminUser.create({
        data: {
          userId: user.id,
          roleId: adminRole.id,
          ...(department ? { department } : {}),
          // Per-admin access override — what THIS account can access, chosen by
          // the super admin at creation time. Falls back to role defaults when unset.
          ...(effectivePermissions ? { permissions: JSON.stringify(effectivePermissions) } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "ADMIN_ACCOUNT_CREATED",
          entityType: "User",
          entityId: user.id,
          metadata: JSON.stringify({ newRole: role, department: department ?? null, permissions: effectivePermissions }),
        },
      });
      return user;
    });

    sendSuccess(res, { id: result.id, email: result.email, fullName: result.fullName, role: result.role, permissions: effectivePermissions }, "Admin account created.", 201);
  } catch (err) {
    console.error("createAdminAccount error:", err);
    sendError(res, "Failed to create admin account.", 500, "INTERNAL_ERROR");
  }
}

export async function updateAdminAccount(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { status, department, permissions, role } = req.body;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || !ADMIN_TIER.includes(target.role)) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    if (target.role === "SUPER_ADMIN") {
      sendError(res, "The primary super admin cannot be modified.", 403, "PROTECTED_ACCOUNT");
      return;
    }

    const data: any = {};
    if (status && ["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) data.status = status;
    if (department !== undefined) data.department = department;

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data, select: { id: true, email: true, fullName: true, role: true, status: true } });
      if ((role && ASSIGNABLE_ADMIN_ROLES.includes(role)) || Array.isArray(permissions)) {
        const effectiveRole = role && ASSIGNABLE_ADMIN_ROLES.includes(role) ? role : target.role;
        const adminRole = await ensureAdminRole(effectiveRole, permissions);
        const au = await tx.adminUser.upsert({
          where: { userId },
          update: { roleId: adminRole.id, ...(Array.isArray(permissions) ? { permissions: JSON.stringify(permissions) } : {}) },
          create: { userId, roleId: adminRole.id, ...(Array.isArray(permissions) ? { permissions: JSON.stringify(permissions) } : {}) },
        });
        if (role && role !== target.role) {
          await tx.user.update({ where: { id: userId }, data: { role, activeRole: role } });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "ADMIN_ACCOUNT_UPDATED",
          entityType: "User",
          entityId: userId,
          metadata: JSON.stringify({ status: status ?? null, role: role ?? null }),
        },
      });
      return user;
    });

    sendSuccess(res, updated, "Admin account updated.");
  } catch (err) {
    console.error("updateAdminAccount error:", err);
    sendError(res, "Failed to update admin account.", 500, "INTERNAL_ERROR");
  }
}

// Super-admin-only: reset a delegated admin's password and return the new
// plaintext so it can be shared securely. The primary SUPER_ADMIN is protected.
export async function resetAdminPassword(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || !ADMIN_TIER.includes(target.role)) {
      sendError(res, "Admin account not found.", 404, "NOT_FOUND");
      return;
    }
    if (target.role === "SUPER_ADMIN") {
      sendError(res, "The primary super admin password cannot be reset here.", 403, "PROTECTED_ACCOUNT");
      return;
    }
    const plain =
      crypto.randomBytes(9).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 12) + "Aa1!";
    const passwordHash = await bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "ADMIN_PASSWORD_RESET",
          entityType: "User",
          entityId: userId,
          metadata: JSON.stringify({ email: target.email }),
        },
      });
    });
    sendSuccess(
      res,
      { userId, email: target.email, newPassword: plain },
      "Password reset. Share the new password securely with the admin."
    );
  } catch (err) {
    console.error("resetAdminPassword error:", err);
    sendError(res, "Failed to reset admin password.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DEMO WALLET REFILL — SUPER_ADMIN only. Tops a DEMO sandbox account back up
// to the play-money ceiling. Refuses anything that is not a demo account,
// so real-money balances can never be touched through this endpoint.
// ============================================================================

export async function refillDemoWallet(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !isDemoEmail(email)) {
      sendError(res, "Refills are only allowed for demo sandbox accounts.", 403, "NOT_DEMO_ACCOUNT");
      return;
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, "Demo account not found.", 404, "NOT_FOUND");
      return;
    }
    const wallet = await prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, balance: 0 },
    });
    let refilled = 0;
    if (Number(wallet.balance) < DEMO_WALLET_CEILING) {
      refilled = DEMO_WALLET_CEILING - Number(wallet.balance);
      await prisma.$transaction(async (tx) => {
        await tx.wallet.update({ where: { userId: user.id }, data: { balance: { increment: refilled } } });
        await tx.transaction.create({
          data: {
            userId: user.id,
            walletId: wallet.id,
            type: "TOPUP",
            amount: refilled,
            status: "SUCCESS",
            description: "Demo sandbox refill (play money, no cash value)",
            referenceId: `DEMO-REFILL-${Date.now()}`,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.userId,
            actorType: "ADMIN",
            action: "DEMO_WALLET_REFILL",
            entityType: "User",
            entityId: user.id,
            metadata: JSON.stringify({ email, refilled }),
          },
        });
      });
    }
    const after = await prisma.wallet.findUnique({ where: { userId: user.id }, select: { balance: true } });
    sendSuccess(res, { email, balance: after?.balance ?? 0, refilled }, "Demo wallet refilled with play money.");
  } catch (err) {
    console.error("refillDemoWallet error:", err);
    sendError(res, "Failed to refill demo wallet.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MANUAL-UPI TOP-UP REVIEW — list + verify (credits the wallet).
// ============================================================================

export async function listTopupRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "VERIFICATION_PENDING";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const items = await prisma.topupRequest.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    const userIds = Array.from(new Set(items.map((i) => i.userId)));
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, email: true, phone: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    sendSuccess(res, { items: items.map((i) => ({ ...i, user: byId.get(i.userId) ?? null })), total: items.length }, "Top-up requests retrieved.");
  } catch (err) {
    sendError(res, "Failed to list top-up requests.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyTopupRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { action, note } = req.body; // VERIFY | REJECT | REQUEST_INFO
    const row = await prisma.topupRequest.findUnique({ where: { id } });
    if (!row) {
      sendError(res, "Top-up request not found.", 404, "NOT_FOUND");
      return;
    }
    if ((action === "REJECT" || action === "REQUEST_INFO") && !String(note || "").trim()) {
      sendError(res, "A note is required so the user knows why.", 400, "NOTE_REQUIRED");
      return;
    }
    if (action === "VERIFY") {
      await moneyTransaction(async (tx) => {
        const claimed = await tx.topupRequest.updateMany({
          where: { id, status: "VERIFICATION_PENDING" },
          data: { status: "VERIFIED", verifiedByAdminId: req.user!.userId, verificationNote: note ?? null },
        });
        if (claimed.count !== 1) throw new Error("ALREADY_SETTLED");
        const wallet = await tx.wallet.upsert({
          where: { userId: row.userId },
          update: { balance: { increment: Number(row.amount) } },
          create: { userId: row.userId, balance: Number(row.amount) },
        });
        await tx.transaction.create({
          data: {
            userId: row.userId,
            walletId: wallet.id,
            type: "TOPUP",
            amount: Number(row.amount),
            status: "SUCCESS",
            description: `Manual UPI top-up (UTR ${row.referenceNumber})`,
            referenceId: `TOPUP-${row.id.slice(0, 8)}`,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: req.user!.userId,
            actorType: "ADMIN",
            action: "TOPUP_VERIFIED",
            entityType: "TopupRequest",
            entityId: id,
            metadata: JSON.stringify({ amount: Number(row.amount), referenceNumber: row.referenceNumber }),
          },
        });
      });
      await prisma.notification.create({
        data: {
          userId: row.userId,
          title: "Wallet topped up",
          body: `Rs ${Number(row.amount)} added to your wallet. ${note || ""}`.trim(),
          data: JSON.stringify({ kind: "TOPUP_VERIFIED", topupId: id }),
        },
      });
      sendSuccess(res, { status: "VERIFIED" }, "Top-up verified. Wallet credited.");
    } else if (action === "REJECT") {
      await prisma.topupRequest.updateMany({
        where: { id, status: "VERIFICATION_PENDING" },
        data: { status: "REJECTED", verifiedByAdminId: req.user!.userId, verificationNote: note },
      });
      await prisma.notification.create({
        data: {
          userId: row.userId,
          title: "Top-up rejected",
          body: `Your top-up was not accepted. ${note}`.trim(),
          data: JSON.stringify({ kind: "TOPUP_REJECTED", topupId: id }),
        },
      });
      sendSuccess(res, { status: "REJECTED" }, "Top-up rejected.");
    } else if (action === "REQUEST_INFO") {
      await prisma.topupRequest.update({
        where: { id },
        data: { status: "REQUEST_INFO", verificationNote: note },
      });
      await prisma.notification.create({
        data: {
          userId: row.userId,
          title: "More info needed",
          body: `Admin needs more information for your top-up. ${note}`.trim(),
          data: JSON.stringify({ kind: "TOPUP_INFO", topupId: id }),
        },
      });
      sendSuccess(res, { status: "REQUEST_INFO" }, "Information requested.");
    } else {
      sendError(res, "Action must be VERIFY, REJECT or REQUEST_INFO.", 400, "VALIDATION_ERROR");
    }
  } catch (err: any) {
    if (err?.message === "ALREADY_SETTLED") {
      sendError(res, "This request was already settled.", 409, "ALREADY_SETTLED");
      return;
    }
    console.error("verifyTopupRequest error:", err);
    sendError(res, "Failed to verify top-up.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MANUAL WALLET CREDIT — SUPER_ADMIN only. Add money to ANY account by
// choice (goodwill, correction, campaign). Fully audited + notified.
// ============================================================================

export async function creditUserWallet(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const identifier = String(req.body?.identifier || "").trim();
    const amount = Number(req.body?.amount);
    const note = String(req.body?.note || "").trim().slice(0, 300);
    if (!identifier || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
      sendError(res, "Identifier and a positive amount (max 10,00,000) are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const user = await prisma.user.findUnique({
      where: identifier.includes("@") ? { email: identifier.toLowerCase() } : { id: identifier },
    });
    if (!user) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }
    const wallet = await prisma.wallet.upsert({
      where: { userId: user.id },
      update: { balance: { increment: amount } },
      create: { userId: user.id, balance: amount },
    });
    const tx = await prisma.transaction.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        type: "ADMIN_CREDIT",
        amount,
        status: "SUCCESS",
        description: note ? `Admin credit: ${note}` : "Admin credit",
        referenceId: `ADMIN-CREDIT-${Date.now()}`,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "ADMIN",
        action: "WALLET_CREDITED",
        entityType: "User",
        entityId: user.id,
        metadata: JSON.stringify({ amount, note, txId: tx.id }),
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: "Wallet credited",
        body: `Rs ${amount} added to your wallet. ${note}`.trim(),
        data: JSON.stringify({ kind: "ADMIN_CREDIT", amount }),
      },
    });
    sendSuccess(res, { email: user.email, balance: Number(wallet.balance), credited: amount }, "Wallet credited.");
  } catch (err) {
    console.error("creditUserWallet error:", err);
    sendError(res, "Failed to credit wallet.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PURGE TEST PAYMENT DATA — SUPER_ADMIN only. Removes test UPI references,
// test bookings and test ledger entries belonging to DEMO sandbox or
// @test.local accounts. Real users' records are NEVER touched: the email
// must be a demo address or a @test.local address, enforced below.
// ============================================================================

export async function purgeTestPayments(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const isTestScope = isDemoEmail(email) || email.endsWith("@test.local");
    if (!email || !isTestScope) {
      sendError(res, "Purge is only allowed for demo sandbox or @test.local accounts.", 403, "NOT_TEST_SCOPE");
      return;
    }
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      sendError(res, "Account not found.", 404, "NOT_FOUND");
      return;
    }

    // Never delete money that moved: only test UPI rows (never VERIFIED with
    // settled escrow beyond demo play funds) and non-completed bookings.
    const upiRows = await prisma.upiPayment.findMany({ where: { userId: user.id }, select: { id: true } });
    const bookings = await prisma.booking.findMany({
      where: { userId: user.id, status: { notIn: ["COMPLETED"] } },
      select: { id: true },
    });
    const bookingIds = bookings.map((b) => b.id);
    const testTx = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        OR: [{ referenceId: { startsWith: "DEMO-" } }, { referenceId: { startsWith: "E2E-" } }, { description: { contains: "test", mode: "insensitive" } }],
      },
      select: { id: true },
    });

    let deletedUpi = 0;
    let deletedBookings = 0;
    let deletedTx = 0;

    await prisma.$transaction(async (tx) => {
      if (upiRows.length > 0) {
        const r = await tx.upiPayment.deleteMany({ where: { id: { in: upiRows.map((u) => u.id) } } });
        deletedUpi = r.count;
      }
      if (bookingIds.length > 0) {
        await tx.dispatchRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await tx.bookingTimeout.deleteMany({ where: { bookingId: { in: bookingIds } } });
        await tx.bookingLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
        const r = await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
        deletedBookings = r.count;
      }
      if (testTx.length > 0) {
        const r = await tx.transaction.deleteMany({ where: { id: { in: testTx.map((t) => t.id) } } });
        deletedTx = r.count;
      }
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "ADMIN",
          action: "TEST_PAYMENTS_PURGED",
          entityType: "User",
          entityId: user.id,
          metadata: JSON.stringify({ email, deletedUpi, deletedBookings, deletedTx }),
        },
      });
    });

    sendSuccess(res, { email, deletedUpi, deletedBookings, deletedTransactions: deletedTx }, "Test payment data purged.");
  } catch (err) {
    console.error("purgeTestPayments error:", err);
    sendError(res, "Failed to purge test data.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PROMOTE USER TO SUPER_ADMIN (or any role) — SUPER_ADMIN only
// ============================================================================

const ALL_ASSIGNABLE_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"];

export async function promoteUserRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role || !ALL_ASSIGNABLE_ROLES.includes(role)) {
      sendError(res, `Role must be one of: ${ALL_ASSIGNABLE_ROLES.join(", ")}.`, 400, "INVALID_ROLE");
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, fullName: true } });
    if (!target) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    // Prevent self-demotion
    if (userId === req.user!.userId && role !== "SUPER_ADMIN") {
      sendError(res, "Cannot change your own role to a lower level.", 403, "FORBIDDEN");
      return;
    }

    const oldRole = target.role;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role, activeRole: role } });

      // Ensure the admin role template exists
      const adminRole = await tx.adminRole.findUnique({ where: { name: role } });
      if (!adminRole) {
        await tx.adminRole.create({ data: { name: role, displayName: role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, " "), permissions: JSON.stringify([]), isSystem: true } });
      }

      // Upsert AdminUser record
      const ar = await tx.adminRole.findUnique({ where: { name: role } });
      if (ar) {
        await tx.adminUser.upsert({ where: { userId }, update: { roleId: ar.id }, create: { userId, roleId: ar.id } });
      }

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "ADMIN",
          action: "USER_ROLE_PROMOTED",
          entityType: "User",
          entityId: userId,
          metadata: JSON.stringify({ from: oldRole, to: role }),
        },
      });
    });

    sendSuccess(res, { userId, email: target.email, fullName: target.fullName, from: oldRole, to: role }, `User promoted to ${role}.`);
  } catch (err) {
    console.error("promoteUserRole error:", err);
    sendError(res, "Failed to promote user.", 500, "INTERNAL_ERROR");
  }
}

export async function demoteUserRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const targetRole = role || "USER";

    if (!["USER", "PARTNER"].includes(targetRole)) {
      sendError(res, "Demotion target must be USER or PARTNER.", 400, "INVALID_ROLE");
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, fullName: true } });
    if (!target) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }
    if (target.role === "SUPER_ADMIN") {
      sendError(res, "Cannot demote a SUPER_ADMIN.", 403, "FORBIDDEN");
      return;
    }

    const oldRole = target.role;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role: targetRole, activeRole: targetRole } });
      // Remove admin record
      await tx.adminUser.deleteMany({ where: { userId } });
      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "ADMIN",
          action: "USER_ROLE_DEMOTED",
          entityType: "User",
          entityId: userId,
          metadata: JSON.stringify({ from: oldRole, to: targetRole }),
        },
      });
    });

    sendSuccess(res, { userId, email: target.email, fullName: target.fullName, from: oldRole, to: targetRole }, `User demoted to ${targetRole}.`);
  } catch (err) {
    console.error("demoteUserRole error:", err);
    sendError(res, "Failed to demote user.", 500, "INTERNAL_ERROR");
  }
}


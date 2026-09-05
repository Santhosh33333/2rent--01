import { Request, Response } from "express";
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";
import { Section, Action } from "../rbac/sections";

const DEC = (v: number | string) => new Prisma.Decimal(v);

async function getThreshold(key: string, fallback: number): Promise<number> {
  const row = await prisma.appSettings.findUnique({ where: { key } }).catch(() => null);
  if (row?.value) {
    const n = Number(row.value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

/**
 * SECTION 11/13 — Promotional credit ledger.
 * Cash value and promotional value are strictly separated. A grant never edits
 * the real wallet `balance`; it only moves `promotionalBalance` and writes a
 * ledger row so every rupee is traceable to the issuing admin.
 */
export async function grantPromotionalCredit(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId, amount, reason, creditType, expiresAt } = req.body as {
      userId?: string;
      amount?: number;
      reason?: string;
      creditType?: string;
      expiresAt?: string;
    };
    if (!userId || amount === undefined) {
      sendError(res, "userId and amount are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (typeof amount !== "number" || amount <= 0) {
      sendError(res, "Amount must be a positive number.", 400, "INVALID_AMOUNT");
      return;
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true } });
    if (!target) {
      sendError(res, "Target user not found.", 404, "USER_NOT_FOUND");
      return;
    }
    if (target.status !== "ACTIVE") {
      sendError(res, "Cannot issue credit to an inactive account.", 400, "INVALID_USER");
      return;
    }

    const threshold = await getThreshold("LARGE_CREDIT_THRESHOLD", 5000);

    // High-risk: route through two-step approval (spec sections 10/18).
    if (amount >= threshold) {
      const request = await prisma.adminApprovalRequest.create({
        data: {
          type: "LARGE_CREDIT",
          requestedById: req.user!.userId,
          requestedByRole: req.user!.activeRole ?? req.user!.role,
          status: "PENDING",
          targetEntityType: "User",
          targetEntityId: userId,
          reason: reason ?? "Large promotional credit",
          payload: {
            userId,
            amount,
            creditType: creditType ?? "PROMOTIONAL_CREDIT",
            expiresAt: expiresAt ?? null,
          },
        },
      });
      // Notify super admin (spec section 19).
      await notifySuperAdmins({
        type: "LARGE_CREDIT_PENDING",
        title: "Large promotional credit pending approval",
        body: `Admin ${req.user!.userId} requested ₹${amount} credit for user ${userId}.`,
      });
      await auditAdminAction({
        req,
        actorId: req.user!.userId,
        action: "PROMOTIONAL_CREDIT_REQUESTED",
        section: "WALLETS",
        targetType: "User",
        targetId: userId,
        newValue: { amount, creditType, expiresAt },
        reason,
      });
      sendSuccess(res, { approvalRequestId: request.id, status: "PENDING" }, "Large credit routed for Super Admin approval.", 202);
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId, balance: DEC(0), promotionalBalance: DEC(0) },
      });
      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { promotionalBalance: { increment: amount } },
      });
      const ledger = await tx.creditLedger.create({
        data: {
          userId,
          adminId: req.user!.userId,
          type: "PROMOTIONAL_CREDIT",
          creditType: creditType ?? "PROMOTIONAL_CREDIT",
          amount: DEC(amount),
          balanceAfter: updated.promotionalBalance,
          reason: reason ?? null,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          status: "COMPLETED",
        },
      });
      return { ledger, balance: updated.promotionalBalance };
    });

    await auditAdminAction({
      req,
      actorId: req.user!.userId,
      action: "PROMOTIONAL_CREDIT_ISSUED",
      section: "WALLETS",
      targetType: "User",
      targetId: userId,
      newValue: { amount, creditType, balanceAfter: result.balance.toString() },
      reason,
    });

    sendSuccess(res, result, "Promotional credit issued.", 201);
  } catch (err) {
    console.error("grantPromotionalCredit error:", err);
    sendError(res, "Failed to issue promotional credit.", 500, "INTERNAL_ERROR");
  }
}

export async function getCreditLedger(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const where: any = {};
    if (req.query.userId) where.userId = req.query.userId;
    if (req.query.type) where.type = req.query.type;
    if (req.query.status) where.status = req.query.status;
    const [items, total] = await Promise.all([
      prisma.creditLedger.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.creditLedger.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve credit ledger.", 500, "INTERNAL_ERROR");
  }
}

export async function reverseCredit(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body as { reason?: string };
    const entry = await prisma.creditLedger.findUnique({ where: { id } });
    if (!entry) {
      sendError(res, "Ledger entry not found.", 404, "NOT_FOUND");
      return;
    }
    if (entry.status !== "COMPLETED" || entry.type !== "PROMOTIONAL_CREDIT") {
      sendError(res, "Only a completed promotional credit can be reversed.", 400, "INVALID_STATE");
      return;
    }
    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId: entry.userId } });
      if (wallet && wallet.promotionalBalance.gte(entry.amount)) {
        await tx.wallet.update({ where: { id: wallet.id }, data: { promotionalBalance: { decrement: entry.amount.toNumber() } } });
      }
      const rev = await tx.creditLedger.create({
        data: {
          userId: entry.userId,
          adminId: req.user!.userId,
          type: "REVERSAL",
          creditType: entry.creditType,
          amount: entry.amount.negated(),
          balanceAfter: wallet ? wallet.promotionalBalance.minus(entry.amount) : DEC(0),
          reason: reason ?? "Admin reversal",
          referenceId: entry.id,
          status: "COMPLETED",
        },
      });
      await tx.creditLedger.update({ where: { id }, data: { status: "REVERSED" } });
      return rev;
    });
    await auditAdminAction({
      req,
      actorId: req.user!.userId,
      action: "PROMOTIONAL_CREDIT_REVERSED",
      section: "WALLETS",
      targetType: "CreditLedger",
      targetId: id,
      oldValue: { amount: entry.amount.toString() },
      reason,
    });
    sendSuccess(res, result, "Credit reversed.");
  } catch (err) {
    sendError(res, "Failed to reverse credit.", 500, "INTERNAL_ERROR");
  }
}

// ---- Credit policy rules (spec section 12) ----
export async function getCreditRules(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const defaults = {
      canPayBooking: true,
      canPayPlatformFees: true,
      canPayServiceFees: true,
      expires: false,
      expiryDays: 365,
      canBePartiallyUsed: true,
      canCombineWithCoupons: true,
      canBeRefunded: false,
      canBecomeWithdrawableCash: false,
    };
    const rows = await prisma.creditRule.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r]));
    sendSuccess(res, { global: map.__GLOBAL__ ?? defaults, perType: rows.filter((r) => r.key !== "__GLOBAL__") });
  } catch (err) {
    sendError(res, "Failed to retrieve credit rules.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCreditRules(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, any>;
    const data: any = { updatedBy: req.user!.userId };
    const allowed = [
      "canPayBooking", "canPayPlatformFees", "canPayServiceFees", "expires",
      "expiryDays", "canBePartiallyUsed", "canCombineWithCoupons", "canBeRefunded", "canBecomeWithdrawableCash",
    ];
    for (const k of allowed) if (body[k] !== undefined) data[k] = body[k];
    const rule = await prisma.creditRule.upsert({
      where: { key: "__GLOBAL__" },
      update: data,
      create: { key: "__GLOBAL__", ...data },
    });
    await auditAdminAction({
      req,
      actorId: req.user!.userId,
      action: "CREDIT_RULE_UPDATED",
      section: "WALLETS",
      targetType: "CreditRule",
      targetId: rule.id,
      newValue: data,
    });
    sendSuccess(res, rule, "Credit rules updated.");
  } catch (err) {
    sendError(res, "Failed to update credit rules.", 500, "INTERNAL_ERROR");
  }
}

async function notifySuperAdmins(n: { type: string; title: string; body: string }): Promise<void> {
  try {
    const supers = await prisma.user.findMany({ where: { activeRole: "SUPER_ADMIN", status: "ACTIVE" }, select: { id: true } });
    for (const s of supers) {
      await prisma.notification.create({
        data: { userId: s.id, title: n.title, body: n.body, data: JSON.stringify({ kind: n.type }) },
      });
    }
  } catch {
    /* non-blocking */
  }
}

export { notifySuperAdmins };

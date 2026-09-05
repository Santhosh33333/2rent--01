import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";
import { requireSuperAdmin } from "../middleware/auth";
import { notifySuperAdmins } from "./creditLedgerController";

const DEC = (v: number | string) => new Prisma.Decimal(v);

const APPROVAL_TYPES = [
  "LARGE_REFUND", "LARGE_CREDIT", "LARGE_PRICING_CHANGE", "PERMISSION_ESCALATION", "ADMIN_CREATION",
];

/**
 * SECTION 18 — Two-step approval for sensitive actions.
 * A delegated admin can REQUEST a high-risk action; it stays PENDING until a
 * Super Admin approves. Approving a LARGE_CREDIT actually executes the grant.
 */
export async function createApprovalRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { type, targetEntityType, targetEntityId, reason, payload } = req.body as any;
    if (!type || !APPROVAL_TYPES.includes(type)) {
      sendError(res, `type must be one of: ${APPROVAL_TYPES.join(", ")}.`, 400, "INVALID_TYPE");
      return;
    }
    const request = await prisma.adminApprovalRequest.create({
      data: {
        type,
        requestedById: req.user!.userId,
        requestedByRole: req.user!.activeRole ?? req.user!.role,
        status: "PENDING",
        targetEntityType: targetEntityType ?? null,
        targetEntityId: targetEntityId ?? null,
        reason: reason ?? null,
        payload: payload ?? Prisma.JsonNull,
      },
    });
    await notifySuperAdmins({
      type: "APPROVAL_PENDING",
      title: `Approval required: ${type}`,
      body: `Admin ${req.user!.userId} requested ${type} approval.`,
    });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "APPROVAL_REQUESTED", section: "ADMIN_MANAGEMENT", targetType: "AdminApprovalRequest", targetId: request.id, newValue: { type } });
    sendSuccess(res, request, "Approval request created.", 201);
  } catch (err) {
    sendError(res, "Failed to create approval request.", 500, "INTERNAL_ERROR");
  }
}

export async function listApprovalRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const where: any = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.type) where.type = req.query.type;
    // Delegated admins only see their own requests; Super Admin sees everything.
    if (req.user!.activeRole !== "SUPER_ADMIN") where.requestedById = req.user!.userId;
    const items = await prisma.adminApprovalRequest.findMany({ where, orderBy: { createdAt: "desc" } });
    sendSuccess(res, { items, total: items.length });
  } catch (err) {
    sendError(res, "Failed to retrieve approval requests.", 500, "INTERNAL_ERROR");
  }
}

export async function reviewApproval(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { decision, note } = req.body as { decision?: "APPROVE" | "REJECT"; note?: string };
    if (!decision || !["APPROVE", "REJECT"].includes(decision)) {
      sendError(res, "decision must be APPROVE or REJECT.", 400, "VALIDATION_ERROR");
      return;
    }
    const request = await prisma.adminApprovalRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Approval request not found.", 404, "NOT_FOUND");
      return;
    }
    if (request.status !== "PENDING") {
      sendError(res, "This request has already been reviewed.", 400, "INVALID_STATE");
      return;
    }

    if (decision === "REJECT") {
      await prisma.adminApprovalRequest.update({
        where: { id },
        data: { status: "REJECTED", reviewedById: req.user!.userId, reviewedAt: new Date(), reviewNote: note ?? null },
      });
      await auditAdminAction({ req, actorId: req.user!.userId, action: "APPROVAL_REJECTED", section: "ADMIN_MANAGEMENT", targetType: "AdminApprovalRequest", targetId: id, reason: note });
      sendSuccess(res, undefined, "Approval rejected.");
      return;
    }

    // APPROVE — execute the requested action where applicable.
    let executed: any = null;
    if (request.type === "LARGE_CREDIT" && request.payload) {
      const p = (request.payload ?? {}) as any;
      const wallet = await prisma.wallet.upsert({
        where: { userId: p.userId },
        update: {},
        create: { userId: p.userId, balance: DEC(0), promotionalBalance: DEC(0) },
      });
      const updated = await prisma.wallet.update({ where: { id: wallet.id }, data: { promotionalBalance: { increment: p.amount } } });
      const ledger = await prisma.creditLedger.create({
        data: {
          userId: p.userId,
          adminId: request.requestedById,
          type: "PROMOTIONAL_CREDIT",
          creditType: p.creditType ?? "PROMOTIONAL_CREDIT",
          amount: DEC(p.amount),
          balanceAfter: updated.promotionalBalance,
          reason: request.reason ?? "Approved large credit",
          expiresAt: p.expiresAt ? new Date(p.expiresAt) : null,
          status: "COMPLETED",
        },
      });
      executed = { ledgerId: ledger.id, balanceAfter: updated.promotionalBalance.toString() };
    }

    await prisma.adminApprovalRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: req.user!.userId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "APPROVAL_APPROVED", section: "ADMIN_MANAGEMENT", targetType: "AdminApprovalRequest", targetId: id, oldValue: { type: request.type }, newValue: executed ?? { approved: true } });
    sendSuccess(res, { executed }, "Approval granted and action executed.");
  } catch (err) {
    console.error("reviewApproval error:", err);
    sendError(res, "Failed to review approval.", 500, "INTERNAL_ERROR");
  }
}

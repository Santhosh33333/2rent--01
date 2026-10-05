import { z } from "zod";
import { prisma } from "../../config/database";
import { AgentToolError, registerTools, type AgentToolDef, type AgentToolContext } from "../toolRegistry";
import { approveWithdrawalRequest, WithdrawalError } from "../../services/withdrawalService";
import { resolveAdminPermissions, hasPermission } from "../../rbac/permissions";
import { SUPER_ADMIN_ROLE } from "../../rbac/sections";

/**
 * Admin tools.
 *
 * Every tool declares `adminPermission`, not just `permission: "admin"`. Being in
 * the admin tier is not authority: a delegated SUPPORT account passes the role
 * matrix while holding nothing in WITHDRAWALS, so the router re-checks the named
 * (section, action) grant against the account's real AdminUser row before the
 * handler runs. That check sits before confirmation, so a grant-less admin is
 * never even offered the dialog, and it re-runs on /agent/confirm, so a grant
 * revoked mid-flight still blocks the write.
 *
 * Read tools return the minimum needed to answer the question. Payout
 * destinations stay masked unless the caller can approve them, matching the
 * admin list endpoint, which is the one place that decision is already made.
 */

function rupees(amount: number): string {
  return `\u20b9${amount.toFixed(2)}`;
}

/** Mirrors adminController's reveal rule: approvers and super admins may see it. */
async function canSeeFullPayoutDestination(ctx: AgentToolContext): Promise<boolean> {
  const { role, permissions, isSuper } = await resolveAdminPermissions(ctx.userId);
  if (isSuper || role === SUPER_ADMIN_ROLE) return true;
  return hasPermission(permissions, "WITHDRAWALS", "APPROVE");
}

function maskAccount(detail: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!detail) return null;
  const masked: Record<string, unknown> = { ...detail };
  if (typeof masked.accountNumber === "string") {
    const digits = masked.accountNumber.replace(/\D/g, "");
    masked.accountNumber = digits.length > 4 ? `****${digits.slice(-4)}` : "****";
  }
  if (typeof masked.upiId === "string") {
    const [handle, domain] = masked.upiId.split("@");
    masked.upiId = handle && domain ? `${handle.slice(0, 2)}***@${domain}` : "***";
  }
  return masked;
}

/**
 * Shapes the payout destination for the reply.
 *
 * The admin list endpoint returns the holder's name to any role that can VIEW,
 * which is fine for a table a finance clerk is already looking at. This is a
 * different surface: the text goes into a model response, a transcript and the
 * audit trail, so the most identifying field in the blob is dropped for every
 * caller here rather than merely masked for some.
 */
function safeDetail(detail: Record<string, unknown> | null, reveal: boolean): Record<string, unknown> | null {
  if (!detail) return null;
  const copy = { ...detail };
  // Not needed to make a payout: the account number, IFSC and resolved bank name
  // are what finance acts on.
  delete copy.accountHolderName;
  return reveal ? copy : maskAccount(copy);
}

const adminTools: AgentToolDef[] = [
  // --- platform overview ---------------------------------------------------
  {
    name: "admin_get_platform_stats",
    description:
      "Get live platform counts: total and active users, partners, pending KYC, pending withdrawals and the value awaiting payout. Read-only.",
    inputSchema: z.object({}).strict(),
    permission: "admin",
    roles: ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "SUPPORT_ADMIN", "FINANCE", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"],
    adminPermission: { section: "ANALYTICS", action: "VIEW" },
    confirmationRequired: false,
    category: "admin",
    handler: async () => {
      const [users, activeUsers, partners, pendingKyc, pendingWithdrawals, payoutValue] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: "ACTIVE" } }),
        prisma.walkingPartner.count({ where: { status: "APPROVED" } }),
        // The full set of statuses a human still has to act on. Counting only
        // "PENDING" would have reported an empty queue while SUBMITTED and
        // UNDER_VERIFICATION reviews sat waiting, matching no admin screen.
        prisma.verification.count({
          where: { status: { in: ["SUBMITTED", "PENDING_REVIEW", "UNDER_VERIFICATION"] } },
        }),
        prisma.withdrawalRequest.count({ where: { status: "PENDING" } }),
        prisma.withdrawalRequest.aggregate({
          where: { status: "PENDING" },
          _sum: { amount: true },
        }),
      ]);

      const pendingTotal = Number(payoutValue._sum.amount ?? 0);

      return {
        users: { total: users, active: activeUsers },
        approvedPartners: partners,
        pendingKyc,
        withdrawals: {
          pendingCount: pendingWithdrawals,
          pendingAmount: pendingTotal,
          pendingAmountDisplay: rupees(pendingTotal),
        },
      };
    },
  },

  // --- look a user up ------------------------------------------------------
  {
    name: "admin_find_user",
    description:
      "Look up one user by id, email or phone and return their account standing: role, verification state, KYC status and wallet balance. Read-only.",
    inputSchema: z
      .object({
        id: z.string().uuid().optional(),
        email: z.string().trim().email().optional(),
        phone: z.string().trim().min(6).max(20).optional(),
      })
      .strict(),
    permission: "admin",
    roles: ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "SUPPORT_ADMIN", "FINANCE", "FINANCE_ADMIN", "KYC_ADMIN", "PARTNER_ADMIN"],
    adminPermission: { section: "USERS", action: "VIEW" },
    confirmationRequired: false,
    category: "admin",
    handler: async (_ctx, args) => {
      // Checked here rather than with .refine(): a refine() compiles the schema
      // into a ZodEffects, which the registry's zodToJsonSchema cannot render.
      // Registering that threw inside toolSchemasForRole, so /capabilities failed
      // for every role on the platform, not just for this tool's callers.
      if (!args.id && !args.email && !args.phone) {
        throw new AgentToolError(
          "Provide an id, email or phone to look the user up.",
          "MISSING_IDENTIFIER",
          400
        );
      }
      const user = await prisma.user.findFirst({
        where: args.id ? { id: args.id } : args.email ? { email: args.email } : { phone: args.phone },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          emailVerified: true,
          mobileVerified: true,
          accessUntil: true,
          createdAt: true,
          lastLoginAt: true,
          verification: { select: { status: true } },
          wallet: { select: { balance: true } },
          walkingPartner: { select: { status: true } },
        },
      });

      if (!user) {
        throw new AgentToolError("No user matched that identifier.", "USER_NOT_FOUND", 404);
      }

      return {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
        kycStatus: user.verification?.status ?? "NOT_STARTED",
        partnerStatus: user.walkingPartner?.status ?? null,
        walletBalance: user.wallet ? Number(user.wallet.balance) : null,
        accessUntil: user.accessUntil ? user.accessUntil.toISOString() : null,
        joinedAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      };
    },
  },

  // --- withdrawal queue ---------------------------------------------------
  {
    name: "admin_list_withdrawals",
    description:
      "List pending withdrawal requests with the amount, method and destination so a payout can be triaged. Destinations are masked unless the caller may also approve payouts. Read-only.",
    inputSchema: z
      .object({
        status: z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING"),
        limit: z.number().int().min(1).max(25).default(10),
      })
      .strict(),
    permission: "admin",
    roles: ["SUPER_ADMIN", "ADMIN", "FINANCE", "FINANCE_ADMIN"],
    adminPermission: { section: "WITHDRAWALS", action: "VIEW" },
    confirmationRequired: false,
    category: "admin",
    handler: async (ctx, args) => {
      const [rows, reveal] = await Promise.all([
        prisma.withdrawalRequest.findMany({
          where: { status: args.status },
          orderBy: { createdAt: "asc" },
          take: args.limit,
          select: {
            id: true,
            amount: true,
            method: true,
            status: true,
            createdAt: true,
            accountDetail: true,
            user: { select: { id: true, fullName: true, email: true } },
          },
        }),
        canSeeFullPayoutDestination(ctx),
      ]);

      return {
        status: args.status,
        count: rows.length,
        destinationVisible: reveal,
        withdrawals: rows.map((row) => {
          let detail: Record<string, unknown> | null = null;
          try {
            detail = row.accountDetail ? (JSON.parse(row.accountDetail) as Record<string, unknown>) : null;
          } catch {
            detail = null;
          }
          return {
            id: row.id,
            amount: Number(row.amount),
            amountDisplay: rupees(Number(row.amount)),
            method: row.method,
            requestedAt: row.createdAt.toISOString(),
            user: { id: row.user.id, fullName: row.user.fullName, email: row.user.email },
            destination: safeDetail(detail, reveal),
          };
        }),
      };
    },
  },

  // --- settle a payout ----------------------------------------------------
  {
    name: "admin_approve_withdrawal",
    description:
      "Mark a pending withdrawal request as approved, settling the held funds. Moves real money to a user, so it always requires an explicit confirmation naming the amount, method and destination.",
    inputSchema: z
      .object({
        withdrawalId: z.string().min(1),
      })
      .strict(),
    permission: "admin",
    roles: ["SUPER_ADMIN", "ADMIN", "FINANCE", "FINANCE_ADMIN"],
    adminPermission: { section: "WITHDRAWALS", action: "APPROVE" },
    confirmationRequired: true,
    category: "admin",
    handler: async (ctx, args) => {
      // Resolved before settling so the confirmation the admin approved named
      // the same destination that will actually be paid.
      const request = await prisma.withdrawalRequest.findUnique({
        where: { id: args.withdrawalId },
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          accountDetail: true,
          user: { select: { fullName: true, email: true } },
        },
      });

      if (!request) {
        throw new AgentToolError("Withdrawal request not found.", "WITHDRAWAL_NOT_FOUND", 404);
      }
      if (request.status !== "PENDING") {
        throw new AgentToolError(
          `That withdrawal is already ${request.status}.`,
          "INVALID_STATUS",
          400
        );
      }

      try {
        const result = await approveWithdrawalRequest(request.id, ctx.userId);
        return {
          withdrawalId: result.id,
          status: result.status,
          amount: result.amount,
          amountDisplay: rupees(result.amount),
          method: result.method,
          recipient: request.user.fullName ?? request.user.email,
          note: "Marked as paid. The held balance has been settled and the payout ledger closed.",
        };
      } catch (err) {
        if (err instanceof WithdrawalError) {
          throw new AgentToolError(err.message, err.code, err.statusCode);
        }
        throw err;
      }
    },
    confirmationSummary: (args) =>
      `Approve withdrawal ${args.withdrawalId} and settle the held funds as paid. This releases real money to the payout destination on file.`,
  },
];

registerTools(adminTools);
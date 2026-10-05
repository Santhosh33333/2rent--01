import { z } from "zod";
import { prisma } from "../../config/database";
import { AgentToolError, registerTools, type AgentToolDef } from "../toolRegistry";
import { getPartnerEarnings } from "../../services/pricingEngine";
import { createWithdrawalRequest, WithdrawalError } from "../../services/withdrawalService";

/**
 * Partner tools.
 *
 * Scoped to `permission: "partner"`, so a plain user account cannot see or call
 * any of them, and the schemas are withheld from the model for those callers.
 *
 * Two deliberate choices:
 *
 *  - There is no "availability" tool. The schema has no online/availability
 *    concept for partners (only WalkingPartner.status), so a tool claiming to set
 *    availability would report on something the database cannot store. The status
 *    tool instead reports the real gates: approval, KYC, rating and payout
 *    destination.
 *
 *  - Withdrawal does not reimplement any money rule. It calls withdrawalService,
 *    which is the same code POST /wallet/withdraw runs, so the per-user lock,
 *    the config-driven minimum/maximum/fee, the balance re-check inside the
 *    transaction and the single-pending-withdrawal guard all still apply.
 */

function rupees(amount: number): string {
  return `\u20b9${amount.toFixed(2)}`;
}

/** Mirrors requireWalkingPartner: an APPROVED WalkingPartner row is required. */
async function requireApprovedPartner(userId: string): Promise<void> {
  const partner = await prisma.walkingPartner.findUnique({
    where: { userId },
    select: { status: true },
  });
  // Checked explicitly rather than by presence alone: a REJECTED or SUSPENDED
  // row exists but must not be treated as an active partner.
  if (!partner || partner.status !== "APPROVED") {
    throw new AgentToolError(
      partner
        ? "Your walking partner application is not approved yet."
        : "You have not applied to be a walking partner yet.",
      partner ? "PARTNER_NOT_APPROVED" : "PARTNER_REQUIRED",
      403
    );
  }
}

const partnerTools: AgentToolDef[] = [
  // --- earnings ------------------------------------------------------------
  {
    name: "get_my_earnings",
    description:
      "Get the signed-in partner's own earnings: today, this week, this month, lifetime, pending, withdrawable balance, plus the most recent individual earning entries. Read-only.",
    inputSchema: z.object({}).strict(),
    permission: "partner",
    confirmationRequired: false,
    category: "partner",
    handler: async (ctx) => {
      await requireApprovedPartner(ctx.userId);

      const summary = await getPartnerEarnings(ctx.userId);

      // The wallet is what actually holds the money. Earnings are an
      // accounting view; a partner asking "can I withdraw X" needs the balance,
      // and the two are not guaranteed to be identical.
      const wallet = await prisma.wallet.findUnique({
        where: { userId: ctx.userId },
        select: { balance: true, promotionalBalance: true, heldBalance: true },
      });

      const recent = await prisma.earningDetail.findMany({
        where: { earnings: { userId: ctx.userId } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          amount: true,
          netAmount: true,
          platformFee: true,
          type: true,
          status: true,
          createdAt: true,
          walkingRequestId: true,
          bookingId: true,
        },
      });

      return {
        today: summary.todayEarnings,
        thisWeek: summary.weeklyEarnings,
        thisMonth: summary.monthlyEarnings,
        lifetime: summary.lifetimeEarnings,
        pending: summary.pendingEarnings,
        withdrawable: summary.withdrawableBalance,
        bonuses: summary.bonuses,
        incentives: summary.incentives,
        commissionDeducted: summary.commissionDeduction,
        completedJobs: summary.completedJobs,
        cancelledJobs: summary.cancelledJobs,
        averageRating: summary.averageRating,
        walletBalance: wallet ? Number(wallet.balance) : null,
        // Held funds are committed elsewhere, so the spendable figure is derived
        // rather than being the raw balance.
        spendableBalance: wallet ? Number(wallet.balance) - Number(wallet.heldBalance) : null,
        recentEntries: recent.map((r) => ({
          id: r.id,
          netAmount: Number(r.netAmount),
          platformFee: Number(r.platformFee),
          type: r.type,
          status: r.status,
          at: r.createdAt.toISOString(),
          ref: r.walkingRequestId ?? r.bookingId ?? null,
        })),
      };
    },
  },

  // --- partner status / what is blocking them -----------------------------
  {
    name: "get_my_partner_status",
    description:
      "Get the signed-in user's walking partner standing: approval status, rating, completed and cancelled jobs, whether KYC is complete, and whether a payout destination is on file. Read-only.",
    inputSchema: z.object({}).strict(),
    permission: "partner",
    confirmationRequired: false,
    category: "partner",
    handler: async (ctx) => {
      const [partner, verification, openApplications, wallet] = await Promise.all([
        prisma.walkingPartner.findUnique({
          where: { userId: ctx.userId },
          select: {
            status: true,
            rating: true,
            totalWalks: true,
            totalEarnings: true,
            bankIfsc: true,
            upiId: true,
            rejectionReason: true,
          },
        }),
        prisma.verification.findUnique({
          where: { userId: ctx.userId },
          select: { status: true },
        }),
        prisma.walkingRequestApplication.count({
          where: { applicant: { userId: ctx.userId }, status: "PENDING" },
        }),
        prisma.wallet.findUnique({ where: { userId: ctx.userId }, select: { balance: true } }),
      ]);

      if (!partner) {
        return {
          isPartner: false,
          status: "NONE",
          message: "This account has not applied to be a walking partner.",
        };
      }

      const hasPayoutDestination = Boolean(partner.bankIfsc || partner.upiId);
      const isApproved = partner.status === "APPROVED";

      // Stated explicitly so the assistant can answer "why can't I work?" from
      // real state instead of guessing.
      const blockers: string[] = [];
      if (!isApproved) blockers.push(`Partner status is ${partner.status}.`);
      if (verification?.status !== "VERIFIED" && verification?.status !== "APPROVED") {
        blockers.push("KYC verification is not complete.");
      }
      if (!hasPayoutDestination) blockers.push("No bank or UPI payout destination is on file.");

      return {
        isPartner: true,
        status: partner.status,
        isApproved,
        rating: Number(partner.rating),
        totalWalks: partner.totalWalks,
        lifetimeEarnings: Number(partner.totalEarnings),
        kycStatus: verification?.status ?? "NOT_STARTED",
        hasPayoutDestination,
        pendingApplications: openApplications,
        walletBalance: wallet ? Number(wallet.balance) : null,
        rejectionReason: partner.rejectionReason ?? null,
        canAcceptWalks: isApproved && blockers.length === 0,
        blockers,
      };
    },
  },

  // --- withdrawal history --------------------------------------------------
  {
    name: "get_my_withdrawals",
    description:
      "List the signed-in user's own withdrawal requests with their status and amounts. Read-only.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
    permission: "partner",
    confirmationRequired: false,
    category: "partner",
    handler: async (ctx, args) => {
      const rows = await prisma.withdrawalRequest.findMany({
        where: { userId: ctx.userId },
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          reviewedAt: true,
        },
      });

      const pending = rows.find((r) => r.status === "PENDING" || r.status === "PROCESSING");

      return {
        count: rows.length,
        // Surfaced because only one withdrawal may be open at a time; without
        // this the assistant would offer to start one that will be rejected.
        hasOpenWithdrawal: Boolean(pending),
        openWithdrawalId: pending?.id ?? null,
        withdrawals: rows.map((r) => ({
          id: r.id,
          amount: Number(r.amount),
          amountDisplay: rupees(Number(r.amount)),
          method: r.method,
          status: r.status,
          rejectionReason: r.rejectionReason ?? null,
          requestedAt: r.createdAt.toISOString(),
          reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        })),
      };
    },
  },

  // --- request a withdrawal (money out) -----------------------------------
  {
    name: "request_withdrawal",
    description:
      "Request a payout of the signed-in user's wallet balance to a bank account or UPI ID. Moves money, so it always needs explicit confirmation showing the amount and destination.",
    inputSchema: z
      .object({
        amount: z.number().positive().max(500000),
        method: z.enum(["BANK_TRANSFER", "UPI"]),
        /**
         * Optional: when omitted the destination already on the partner profile
         * is used. The model cannot invent a payout destination, and one that is
         * supplied must match the stored value rather than silently replacing it.
         */
        accountDetail: z
          .object({
            accountNumber: z.string().trim().min(4).max(20).optional(),
            ifsc: z.string().trim().min(4).max(11).optional(),
            bankName: z.string().trim().max(80).optional(),
            accountHolderName: z.string().trim().max(80).optional(),
            upiId: z.string().trim().max(80).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    permission: "partner",
    confirmationRequired: true,
    category: "partner",
    handler: async (ctx, args) => {
      const wallet = await prisma.wallet.findUnique({
        where: { userId: ctx.userId },
        select: { balance: true },
      });
      if (!wallet) {
        throw new AgentToolError("No wallet was found for this account.", "WALLET_NOT_FOUND", 404);
      }

      // Fall back to the destination already on the partner profile so the user
      // does not have to read their IFSC back to the assistant.
      let destination = args.accountDetail ?? null;
      if (!destination) {
        const partner = await prisma.walkingPartner.findUnique({
          where: { userId: ctx.userId },
          select: { bankAccountNumber: true, bankIfsc: true, upiId: true, bankAccountName: true },
        });
        if (partner?.upiId) {
          destination = { upiId: partner.upiId };
        } else if (partner?.bankAccountNumber && partner.bankIfsc) {
          destination = {
            accountNumber: partner.bankAccountNumber,
            ifsc: partner.bankIfsc,
            accountHolderName: partner.bankAccountName ?? undefined,
          };
        }
        if (!destination) {
          throw new AgentToolError(
            "No bank account or UPI ID is saved on your profile. Add one before requesting a payout.",
            "NO_PAYOUT_DESTINATION",
            400
          );
        }
      }

      const user = await prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { email: true },
      });

      try {
        const result = await createWithdrawalRequest({
          userId: ctx.userId,
          email: user?.email,
          amount: args.amount,
          method: args.method,
          accountDetail: destination,
        });

        return {
          withdrawalId: result.id,
          status: result.status,
          amount: result.amount,
          amountDisplay: rupees(result.amount),
          method: result.method,
          withdrawalFee: result.withdrawalFee,
          // "Pending review", not "paid": the money is held, not sent.
          note: "Your balance has been held and the request is pending review. Funds are not sent until an admin approves it.",
        };
      } catch (err) {
        // Typed service errors carry the exact rule that refused, so the reply
        // explains the real reason rather than a generic failure.
        if (err instanceof WithdrawalError) {
          throw new AgentToolError(err.message, err.code, err.statusCode);
        }
        throw err;
      }
    },
    confirmationSummary: (args) => {
      const destination =
        args.method === "UPI"
          ? args.accountDetail?.upiId ?? "your saved UPI ID"
          : args.accountDetail?.accountNumber
            ? `bank account ending ${args.accountDetail.accountNumber.slice(-4)}`
            : "your saved bank account";
      return `Withdraw ${rupees(args.amount)} to ${destination} via ${args.method.replace("_", " ")}. The amount is held from your balance now and paid out only after an admin reviews it.`;
    },
  },
];

registerTools(partnerTools);
import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";
import { isDemoEmail } from "../utils/demo";
import { moneyTransaction } from "../utils/db";
import { withUserLock } from "../utils/userLock";
import { bankNameFromIfsc, isValidIfsc } from "./bankLookup";
import { sendWithdrawalPaidEmail, sendWithdrawalRejectedEmail, sendWithdrawalRequestedEmail } from "./emailService";

/**
 * Withdrawal creation, extracted from the HTTP controller.
 *
 * The agent's request_withdrawal tool and POST /wallet/withdraw both call this,
 * so there is exactly one implementation of the rules that decide whether money
 * may leave a wallet: the demo-account gate, destination validation, the
 * config-driven minimum/maximum/fee, the per-user lock, the transactional
 * re-check of the balance, and the single-pending-withdrawal guard. Re-deriving
 * any of that in a second place is how a balance check ends up being skipped.
 *
 * Errors are thrown as typed WithdrawalError so each caller can map them to its
 * own response shape.
 */

export class WithdrawalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

export interface WithdrawalInput {
  userId: string;
  email?: string | null;
  amount: number;
  method: string;
  /**
   * The payout destination. Accepts either a decoded object or the JSON string
   * that the web client's requestWithdrawal() sends, because both callers
   * reach this function with the wire shape they already had.
   */
  accountDetail?: Record<string, unknown> | string | null;
}

const VALID_METHODS = ["BANK_TRANSFER", "UPI"];

/**
 * Decodes a payout destination without ever trusting its shape.
 *
 * This was a real latent break: the REST path forwards req.body.accountDetail
 * untouched and the web client declares that field as a JSON *string*, so a
 * plain `as { accountNumber?: string }` cast turned a valid request into
 * "Bank account number and IFSC are required" while satisfying the compiler.
 * Anything that is not a plain object after decoding is rejected outright rather
 * than cast and silently read as an absent field.
 */
function normalizeAccountDetail(input: WithdrawalInput["accountDetail"]): Record<string, unknown> | undefined {
  if (input == null) return undefined;

  let decoded: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    try {
      decoded = JSON.parse(trimmed);
    } catch {
      throw new WithdrawalError("Payout destination details are malformed.", "INVALID_ACCOUNT", 400);
    }
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new WithdrawalError("Payout destination details are malformed.", "INVALID_ACCOUNT", 400);
  }
  return decoded as Record<string, unknown>;
}

export interface WithdrawalResult extends Record<string, unknown> {
  id: string;
  amount: number;
  method: string;
  status: string;
  createdAt: Date;
  withdrawalFee: number;
  accountDetail: Record<string, unknown> | null;
}

/**
 * Admin settlement of a withdrawal, extracted from adminController.
 *
 * Both the admin UI's approve/reject buttons and the agent's
 * admin_approve_withdrawal tool call these, so the conditional PENDING claim,
 * the ledger settlement, the PartnerEarnings adjustment and the audit row exist
 * once. The claim is what makes this safe to expose to an LLM: approving the
 * same request twice is a no-op rather than a second ledger movement.
 */

export interface SettlementResult {
  id: string;
  status: string;
  amount: number;
  method: string;
  userId: string;
}

async function loadPendingWithdrawal(id: string): Promise<{
  id: string;
  userId: string;
  walletId: string;
  amount: unknown;
  method: string;
  status: string;
}> {
  const request = await prisma.withdrawalRequest.findUnique({ where: { id } });
  if (!request) {
    throw new WithdrawalError("Withdrawal request not found.", "WITHDRAWAL_NOT_FOUND", 404);
  }
  if (request.status !== "PENDING") {
    throw new WithdrawalError("Withdrawal already processed.", "INVALID_STATUS", 400);
  }
  return request as unknown as {
    id: string;
    userId: string;
    walletId: string;
    amount: unknown;
    method: string;
    status: string;
  };
}

/** Not-found / already-processed are caller-facing; the claim race is not. */
function rethrowClaimRace(err: unknown): never {
  if (err instanceof WithdrawalError) throw err;
  if (err instanceof Error && err.message === "WITHDRAWAL_NOT_PENDING") {
    throw new WithdrawalError("Withdrawal already processed.", "INVALID_STATUS", 400);
  }
  throw err;
}

export async function approveWithdrawalRequest(id: string, adminUserId: string): Promise<SettlementResult> {
  const request = await loadPendingWithdrawal(id);

  // Funds were held (debited) when the user requested the withdrawal. Approval
  // only settles the lifecycle, so there is no further balance change here.
  try {
    await moneyTransaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "APPROVED", reviewedBy: adminUserId, reviewedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      // Settle the paired hold ledger row.
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: { status: "COMPLETED", description: "Withdrawal approved and settled" },
      });

      // `PartnerEarnings.withdrawableBalance` is the figure the partner dashboard
      // reports as "Available to withdraw". It was only ever incremented on
      // booking completion, so it kept growing after payouts and disagreed with
      // the `Wallet.balance` the withdrawal gate validates against. Settle it
      // down as the money leaves.
      //
      // The new value is computed in JS rather than with `{ decrement }`: a
      // decrement that would go negative is rejected by Postgres, and catching
      // that mid-transaction aborts the whole interactive transaction (Prisma
      // opens no savepoint per statement), taking the approval down with it.
      const earnings = await tx.partnerEarnings.findUnique({
        where: { userId: request.userId },
        select: { withdrawableBalance: true },
      });
      if (earnings) {
        const remaining = Number(earnings.withdrawableBalance) - Number(request.amount);
        await tx.partnerEarnings.update({
          where: { userId: request.userId },
          data: { withdrawableBalance: Number.isFinite(remaining) ? Math.max(0, remaining) : 0 },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          actorType: "ADMIN",
          action: "WITHDRAWAL_APPROVE",
          entityType: "WithdrawalRequest",
          entityId: id,
        },
      });
    });
  } catch (err) {
    rethrowClaimRace(err);
  }

  // Notify out of band: an unconfigured mailer must never fail the approval.
  const paidUser = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { email: true, fullName: true },
  });
  if (paidUser) {
    void sendWithdrawalPaidEmail(paidUser.email, paidUser.fullName || "there", {
      withdrawalId: request.id,
      amount: Number(request.amount),
      method: request.method,
      status: "APPROVED",
      processedAt: new Date(),
    }).catch((err) => console.error("[EMAIL] Withdrawal paid email failed:", err));
  }

  return {
    id: request.id,
    status: "APPROVED",
    amount: Number(request.amount),
    method: request.method,
    userId: request.userId,
  };
}

export async function rejectWithdrawalRequest(
  id: string,
  adminUserId: string,
  reason?: string
): Promise<SettlementResult> {
  const request = await loadPendingWithdrawal(id);

  // Release the held funds exactly once.
  try {
    await moneyTransaction(async (tx) => {
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedBy: adminUserId,
          reviewedAt: new Date(),
          rejectionReason: reason || "Rejected by admin",
        },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      await tx.wallet.update({
        where: { id: request.walletId },
        data: { balance: { increment: request.amount } },
      });

      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: {
          status: "FAILED",
          description: `Withdrawal rejected${reason ? `: ${reason}` : ""}; hold released`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          actorType: "ADMIN",
          action: "WITHDRAWAL_REJECT",
          entityType: "WithdrawalRequest",
          entityId: id,
          metadata: reason ? JSON.stringify({ reason }) : null,
        },
      });
    });
  } catch (err) {
    rethrowClaimRace(err);
  }

  const rejectedUser = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { email: true, fullName: true },
  });
  if (rejectedUser) {
    void sendWithdrawalRejectedEmail(rejectedUser.email, rejectedUser.fullName || "there", {
      withdrawalId: request.id,
      amount: Number(request.amount),
      method: request.method,
      status: "REJECTED",
      processedAt: new Date(),
      rejectionReason: reason || undefined,
    }).catch((err) => console.error("[EMAIL] Withdrawal rejected email failed:", err));
  }

  return {
    id: request.id,
    status: "REJECTED",
    amount: Number(request.amount),
    method: request.method,
    userId: request.userId,
  };
}

export async function createWithdrawalRequest(input: WithdrawalInput): Promise<WithdrawalResult> {
  const { userId, amount, method } = input;

  // Demo sandbox money has no cash value and can never leave the platform.
  if (isDemoEmail(input.email ?? undefined)) {
    throw new WithdrawalError("Demo accounts cannot withdraw play money.", "DEMO_NO_WITHDRAW", 403);
  }

  if (!method || !VALID_METHODS.includes(method)) {
    throw new WithdrawalError("Invalid withdrawal method.", "INVALID_METHOD", 400);
  }

const accountDetail = normalizeAccountDetail(input.accountDetail);

/**
 * Reads a string field off the untrusted destination. Values arrive as
 * `unknown` because the shape comes from a request body, and coercing them
 * blindly would turn a numeric account number into a truthy string that passes
 * validation.
 */
function text(field: string): string {
  const value = accountDetail?.[field];
  return typeof value === "string" ? value.trim() : "";
}

// A payout destination is mandatory and must be well-formed.
if (method === "BANK_TRANSFER") {
  const accountNumber = text("accountNumber");
  const ifsc = text("ifsc");

  if (!accountNumber || !ifsc) {
    throw new WithdrawalError("Bank account number and IFSC are required.", "INVALID_ACCOUNT", 400);
  }
  // A malformed IFSC is rejected rather than merely failing to resolve a bank
  // name. Enrichment cannot save it, and accepting one files a payout that
  // finance cannot execute while the balance is already held.
  if (!isValidIfsc(ifsc)) {
    throw new WithdrawalError("The IFSC code is not valid.", "INVALID_ACCOUNT", 400);
  }
  // Enrich with the resolved bank name so finance sees it without looking the
  // IFSC up. Never trust a client-supplied name over the IFSC table.
  accountDetail!.bankName = bankNameFromIfsc(ifsc) || text("bankName") || undefined;
} else if (method === "UPI") {
  const upiId = text("upiId");
  if (!/^[\w.\-]+@[a-zA-Z]{2,}$/.test(upiId)) {
    throw new WithdrawalError("A valid UPI ID is required.", "INVALID_ACCOUNT", 400);
  }
  accountDetail!.upiId = upiId;
}

  const [minWithdrawal, maxWithdrawal, withdrawalFee] = await Promise.all([
    getConfig("MIN_WITHDRAWAL_AMOUNT", 100),
    getConfig("MAX_WITHDRAWAL_AMOUNT", 500000),
    getConfig("WITHDRAWAL_FEE_FLAT", 0),
  ]);

  if (!amount || amount <= 0 || amount < minWithdrawal) {
    throw new WithdrawalError(
      `Minimum withdrawal amount is ${minWithdrawal.toLocaleString("en-IN")}.`,
      "VALIDATION_ERROR",
      400
    );
  }
  if (amount > maxWithdrawal) {
    throw new WithdrawalError(
      `Maximum withdrawal amount is ${maxWithdrawal.toLocaleString("en-IN")}.`,
      "AMOUNT_EXCEEDS_LIMIT",
      400
    );
  }
  // The fee must not consume the entire payout.
  if (withdrawalFee >= amount) {
    throw new WithdrawalError("Amount must exceed the withdrawal fee.", "VALIDATION_ERROR", 400);
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    throw new WithdrawalError("Wallet not found.", "WALLET_NOT_FOUND", 404);
  }
  if (amount > Number(wallet.balance)) {
    throw new WithdrawalError("Insufficient wallet balance.", "INSUFFICIENT_FUNDS", 400);
  }

  const withdrawal = await withUserLock(userId, () =>
    moneyTransaction(async (tx) => {
      const lockedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });

      if (!lockedWallet || amount > Number(lockedWallet.balance)) {
        throw new WithdrawalError("Insufficient wallet balance.", "INSUFFICIENT_FUNDS", 400);
      }

      // Anti-duplicate: re-checked inside the serialised transaction so two
      // parallel requests cannot both pass the pre-check and create two payouts.
      const openWithdrawal = await tx.withdrawalRequest.findFirst({
        where: { userId, status: { in: ["PENDING", "PROCESSING"] } },
        select: { id: true },
      });
      if (openWithdrawal) {
        throw new WithdrawalError("You already have a withdrawal being processed.", "DUPLICATE_WITHDRAWAL", 409);
      }

      // Hold the funds immediately: a single debit for the whole lifecycle.
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } });

      const created = await tx.withdrawalRequest.create({
        data: {
          userId,
          walletId: wallet.id,
          amount,
          method,
          accountDetail: JSON.stringify(accountDetail ?? {}),
          status: "PENDING",
        },
      });

      // Paused ledger row: PENDING until settled (approved) or released
      // (rejected/cancelled).
      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: "WITHDRAWAL",
          status: "PENDING",
          amount,
          description: "Withdrawal held pending review",
          referenceId: created.id,
        },
      });

      return created;
    })
  );

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorType: "USER",
      action: "WITHDRAWAL_REQUEST",
      entityType: "WithdrawalRequest",
      entityId: withdrawal.id,
      metadata: JSON.stringify({ amount, method, withdrawalFee, via: "withdrawalService" }),
    },
  });

  // Confirmation email is best-effort and must never fail the withdrawal.
  if (input.email) {
    const requester = await prisma.user
      .findUnique({ where: { id: userId }, select: { email: true, fullName: true } })
      .catch(() => null);
    if (requester?.email) {
      void sendWithdrawalRequestedEmail(requester.email, requester.fullName || "there", {
        withdrawalId: withdrawal.id,
        amount,
        method,
        status: "PENDING",
        createdAt: withdrawal.createdAt,
      }).catch((err) => console.error("[EMAIL] Withdrawal requested email failed:", err));
    }
  }

  let parsedDetail: Record<string, unknown> | null = null;
  try {
    parsedDetail = JSON.parse((withdrawal as unknown as { accountDetail?: string }).accountDetail || "null");
  } catch {
    parsedDetail = null;
  }

  return {
    // Spread the created row so this endpoint keeps returning the same shape it
    // always did. withdrawalFee is additive and lets the caller explain the
    // deduction without a second lookup.
    ...(withdrawal as unknown as Record<string, unknown>),
    id: withdrawal.id,
    amount: Number(withdrawal.amount),
    method: withdrawal.method,
    status: withdrawal.status,
    createdAt: withdrawal.createdAt,
    withdrawalFee,
    accountDetail: parsedDetail,
  };
}
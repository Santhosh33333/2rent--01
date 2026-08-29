import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { getPartnerEarnings, getConfig } from "../services/pricingEngine";

// Serializes concurrent money-affecting operations per user so the app-level
// "one open withdrawal at a time" rule cannot be raced by two parallel requests
// on a single server instance. (For multi-instance deployments, replace with a
// distributed lock such as Redis.)
function createMutex() {
  let lock: Promise<unknown> = Promise.resolve();
  return (fn: () => Promise<unknown>) => {
    const result = lock.then(fn, fn);
    lock = result.catch(() => {});
    return result;
  };
}
const userMutexes = new Map<string, ReturnType<typeof createMutex>>();
function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  let m = userMutexes.get(userId);
  if (!m) {
    m = createMutex();
    userMutexes.set(userId, m);
  }
  return m(fn as () => Promise<unknown>) as Promise<T>;
}


// ============================================================================
// GET WALLET
// ============================================================================

export async function getWallet(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND");
      return;
    }

    sendSuccess(res, wallet, "Wallet retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve wallet.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// TOPUP WALLET
// ============================================================================

export async function topupWallet(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { amount } = req.body;
    const maxTopup = await getConfig("MAX_TOPUP_AMOUNT", 100000);

    if (!amount || amount <= 0) {
      sendError(res, "Invalid topup amount.", 400, "VALIDATION_ERROR");
      return;
    }

    if (amount > maxTopup) {
      sendError(res, `Maximum topup amount is ${maxTopup.toLocaleString("en-IN")}.`, 400, "AMOUNT_EXCEEDS_LIMIT");
      return;
    }

    // TODO: Integrate with Razorpay payment gateway
    // For now, create pending transaction pending payment

    let wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId: req.user!.userId } });
    }

    const transaction = await prisma.transaction.create({
      data: {
        userId: req.user!.userId,
        walletId: wallet.id,
        type: "TOPUP",
        amount,
        status: "PENDING",
        description: `Wallet topup - ${amount}`,
      },
    });

    // Real top-up funds are credited only after a genuine Razorpay capture via
    // POST /payments/verify — never automatically. This endpoint just records the
    // request; no balance is changed here.
    const finalTx = transaction;
    const balance = wallet.balance;

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "WALLET_TOPUP",
        entityType: "Wallet",
        entityId: wallet.id,
        metadata: JSON.stringify({ amount, autoCredited: false }),
      },
    });

    sendSuccess(
      res,
      { ...finalTx, walletBalance: balance },
      "Topup request created. Complete the Razorpay payment to add funds.",
      201
    );
  } catch (err: any) {
    sendError(res, "Failed to topup wallet.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// WALLET CONFIG (rules shown to clients)
// ============================================================================

export async function getWalletConfig(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [minWithdrawal, maxWithdrawal, maxTopup] = await Promise.all([
      getConfig("MIN_WITHDRAWAL_AMOUNT", 100),
      getConfig("MAX_WITHDRAWAL_AMOUNT", 500000),
      getConfig("MAX_TOPUP_AMOUNT", 100000),
    ]);
    sendSuccess(res, { minWithdrawal, maxWithdrawal, maxTopup });
  } catch (err: any) {
    sendError(res, "Failed to retrieve wallet config.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET TRANSACTIONS
// ============================================================================

export async function getTransactions(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const type = req.query.type as string;

    const where: any = { userId: req.user!.userId };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve transactions.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET WITHDRAWAL HISTORY
// ============================================================================

export async function getWithdrawalHistory(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string;

    const where: any = { userId: req.user!.userId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.withdrawalRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.withdrawalRequest.count({ where }),
    ]);

    const parsed = items.map((w: any) => {
      try { return { ...w, accountDetail: JSON.parse(w.accountDetail) }; } catch { return w; }
    });

    sendSuccess(res, { items: parsed, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve withdrawal history.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REQUEST WITHDRAWAL
// ============================================================================

export async function requestWithdrawal(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { amount, method, accountDetail } = req.body;

    const validMethods = ["BANK_TRANSFER", "UPI"];
    if (!method || !validMethods.includes(method)) {
      sendError(res, "Invalid withdrawal method.", 400, "INVALID_METHOD");
      return;
    }

    // A payout destination is mandatory and must be well-formed.
    if (method === "BANK_TRANSFER") {
      const ad = accountDetail as { accountNumber?: string; ifsc?: string } | undefined;
      if (!ad?.accountNumber || !ad?.ifsc) {
        sendError(res, "Bank account number and IFSC are required.", 400, "INVALID_ACCOUNT");
        return;
      }
    } else if (method === "UPI") {
      const ad = accountDetail as { upiId?: string } | undefined;
      if (!ad?.upiId || !/^[\w.\-]+@[a-zA-Z]{2,}$/.test(ad.upiId)) {
        sendError(res, "A valid UPI ID is required.", 400, "INVALID_ACCOUNT");
        return;
      }
    }

    const [minWithdrawal, maxWithdrawal, withdrawalFee] = await Promise.all([
      getConfig("MIN_WITHDRAWAL_AMOUNT", 100),
      getConfig("MAX_WITHDRAWAL_AMOUNT", 500000),
      getConfig("WITHDRAWAL_FEE_FLAT", 0),
    ]);

    if (!amount || amount <= 0 || amount < minWithdrawal) {
      sendError(res, `Minimum withdrawal amount is ${minWithdrawal.toLocaleString("en-IN")}.`, 400, "VALIDATION_ERROR");
      return;
    }

    if (amount > maxWithdrawal) {
      sendError(res, `Maximum withdrawal amount is ${maxWithdrawal.toLocaleString("en-IN")}.`, 400, "AMOUNT_EXCEEDS_LIMIT");
      return;
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND");
      return;
    }

    // Fee must not exceed the payout itself.
    if (withdrawalFee >= amount) {
      sendError(res, "Amount must exceed the withdrawal fee.", 400, "VALIDATION_ERROR");
      return;
    }

    if (amount > wallet.balance) {
      sendError(res, "Insufficient wallet balance.", 400, "INSUFFICIENT_FUNDS");
      return;
    }

    const withdrawal = await withUserLock(req.user!.userId, () =>
      prisma.$transaction(async (tx) => {
        const lockedWallet = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        if (!lockedWallet || amount > lockedWallet.balance) {
          throw new Error("INSUFFICIENT_FUNDS");
        }

        // Anti-duplicate (Part 28): re-checked inside the serialized transaction so
        // two parallel requests cannot both pass the pre-check and create two payouts.
        const openWithdrawal = await tx.withdrawalRequest.findFirst({
          where: { userId: req.user!.userId, status: { in: ["PENDING", "PROCESSING"] } },
          select: { id: true },
        });
        if (openWithdrawal) {
          const e: any = new Error("Duplicate withdrawal");
          e.code = "DUPLICATE_WITHDRAWAL";
          throw e;
        }

        // Hold funds immediately (single debit for the whole lifecycle)
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: amount } },
      });

      const created = await tx.withdrawalRequest.create({
        data: {
          userId: req.user!.userId,
          walletId: wallet.id,
          amount,
          method,
          accountDetail: JSON.stringify(accountDetail),
          status: "PENDING",
        },
      });

      // Paused ledger row: PENDING until settled (approved) or released (rejected/cancelled)
      await tx.transaction.create({
        data: {
          userId: req.user!.userId,
          walletId: wallet.id,
          type: "WITHDRAWAL",
          status: "PENDING",
          amount,
          description: "Withdrawal held pending review",
          referenceId: created.id,
        },
      });

      return created;
    }),
    );

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "WITHDRAWAL_REQUEST",
        entityType: "WithdrawalRequest",
        entityId: withdrawal.id,
        metadata: JSON.stringify({ amount, method, withdrawalFee }),
      },
    });

    let out: any = withdrawal;
    try { out = { ...withdrawal, accountDetail: JSON.parse((withdrawal as any).accountDetail) }; } catch { /* keep as-is */ }
    sendSuccess(res, out, "Withdrawal request submitted.", 201);
  } catch (err: any) {
    if (err?.code === "DUPLICATE_WITHDRAWAL") {
      sendError(res, "You already have a withdrawal being processed.", 409, "DUPLICATE_WITHDRAWAL");
    } else if (err?.message === "INSUFFICIENT_FUNDS") {
      sendError(res, "Insufficient wallet balance.", 400, "INSUFFICIENT_FUNDS");
    } else {
      sendError(res, "Failed to request withdrawal.", 500, "INTERNAL_ERROR");
    }
  }
}

// ============================================================================
// CANCEL WITHDRAWAL
// ============================================================================

export async function cancelWithdrawal(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const withdrawal = await prisma.withdrawalRequest.findUnique({ where: { id } });

    if (!withdrawal || withdrawal.userId !== req.user!.userId) {
      sendError(res, "Withdrawal request not found.", 404, "WITHDRAWAL_NOT_FOUND");
      return;
    }

    if (withdrawal.status !== "PENDING") {
      sendError(res, "Only pending withdrawals can be cancelled.", 400, "INVALID_STATUS");
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Conditional claim: only one concurrent cancel can flip PENDING -> CANCELLED
      const claimed = await tx.withdrawalRequest.updateMany({
        where: { id, userId: req.user!.userId, status: "PENDING" },
        data: { status: "CANCELLED", rejectionReason: "Cancelled by user" },
      });

      if (claimed.count !== 1) {
        throw new Error("WITHDRAWAL_NOT_PENDING");
      }

      // Release held funds exactly once
      await tx.wallet.update({
        where: { id: withdrawal.walletId },
        data: { balance: { increment: withdrawal.amount } },
      });

      // Close the paired hold ledger row
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "WITHDRAWAL", status: "PENDING" },
        data: { status: "FAILED", description: "Withdrawal cancelled by user; hold released" },
      });

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "WITHDRAWAL_CANCEL",
          entityType: "WithdrawalRequest",
          entityId: id,
        },
      });
    });

    sendSuccess(res, undefined, "Withdrawal cancelled.");
  } catch (err: any) {
    if (err?.message === "WITHDRAWAL_NOT_PENDING") {
      sendError(res, "Only pending withdrawals can be cancelled.", 400, "INVALID_STATUS");
    } else {
      sendError(res, "Failed to cancel withdrawal.", 500, "INTERNAL_ERROR");
    }
  }
}

// ============================================================================
// EARNINGS ENDPOINTS
// ============================================================================

export async function getEarningsSummary(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const earnings = await getPartnerEarnings(userId);

    sendSuccess(res, earnings, "Earnings summary retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve earnings summary.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EARNING DETAILS
// ============================================================================

export async function getEarningDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const type = req.query.type as string | undefined;

    const earnings = await prisma.partnerEarnings.findUnique({ where: { userId } });

    if (!earnings) {
      sendSuccess(res, { items: [], page, limit, total: 0 });
      return;
    }

    const where: any = { earningsId: earnings.id };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.earningDetail.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          walkingRequest: {
            select: {
              id: true,
              startLocation: true,
              endLocation: true,
              durationMinutes: true,
            },
          },
        },
      }),
      prisma.earningDetail.count({ where }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve earning details.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EARNINGS CHART
// ============================================================================

export async function getEarningsChart(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const days = Number(req.query.days) || 7;

    const earnings = await prisma.partnerEarnings.findUnique({
      where: { userId },
    });

    if (!earnings) {
      sendSuccess(res, { chart: [], totalEarnings: 0 });
      return;
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const details = await prisma.earningDetail.findMany({
      where: {
        earningsId: earnings.id,
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by date
    const chartMap = new Map<
      string,
      {
        date: string;
        earnings: number;
        fees: number;
        netAmount: number;
        count: number;
      }
    >();

    details.forEach((d) => {
      const dateKey = d.createdAt.toISOString().split("T")[0];
      const existing = chartMap.get(dateKey) || {
        date: dateKey,
        earnings: 0,
        fees: 0,
        netAmount: 0,
        count: 0,
      };

      existing.earnings += Number(d.amount);
      existing.fees += Number(d.platformFee) + Number(d.commissionDeduction);
      existing.netAmount += Number(d.netAmount);
      existing.count += 1;
      chartMap.set(dateKey, existing);
    });

    const chart = Array.from(chartMap.values());
    const totalEarnings = details.reduce((s, d) => s + Number(d.netAmount), 0);

    sendSuccess(res, { chart, totalEarnings });
  } catch (err: any) {
    sendError(res, "Failed to retrieve earnings chart.", 500, "INTERNAL_ERROR");
  }
}

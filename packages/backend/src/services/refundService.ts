import { prisma } from "../config/database";
import { ADMIN_ROLES, type AdminRoleName } from "../rbac/sections";

/**
 * Refunds for settled wallet top-ups, and the local access window they control.
 *
 * Why this exists: the one-off payment webhook had no refund branch, so a refund
 * issued from the Cashfree dashboard left our order COMPLETED and the wallet
 * credited. Nothing called the existing refundEngine either, and that engine is
 * booking-shaped -- a wallet top-up has no booking. So refunds were being
 * dropped silently, which is the worst failure mode for money: the books drift
 * from the gateway with no alert.
 *
 * Two invariants:
 *   1. Idempotency. Cashfree redelivers webhooks. cashfreeRefundId is the latch;
 *      a repeat delivery returns applied: false and moves no money.
 *   2. Never debit more than was credited. The wallet is only debited when the
 *      balance covers the refund, so a refund cannot drive a balance negative
 *      and silently corrupt later payouts.
 */

/** Days of access a settled top-up grants. */
export const ACCESS_DAYS = 30;

/**
 * Grants or extends the user's access window.
 *
 * Deliberately additive from the current expiry rather than from "now", so
 * paying early does not waste paid days. Access is a plain timestamp
 * comparison, which means it works with no provider round-trip and cannot be
 * silently lost while Cashfree Subscriptions is unavailable.
 */
export async function grantAccessWindow(
  userId: string,
  days: number = ACCESS_DAYS,
  source: string = "TOPUP",
): Promise<Date | null> {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accessUntil: true },
  });
  if (!user) return null;

  // Extend from the later of now and the current expiry.
  const base =
    user.accessUntil && user.accessUntil > now ? user.accessUntil : now;
  const accessUntil = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: { accessUntil, accessSource: source },
  });
  return accessUntil;
}

/**
 * Revokes access immediately, used when a payment is fully refunded so a
 * refunded user does not keep premium features.
 */
export async function revokeAccessWindow(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { accessUntil: new Date(0), accessSource: "REVOKED_REFUND" },
  });
}

/**
 * True when the user currently has unexpired access.
 *
 * Deliberately reads the local timestamp rather than counting ACTIVE
 * Subscription rows. hasActiveSubscription() can only ever be satisfied by the
 * gateway, and Cashfree Subscriptions is not activated on the merchant account,
 * so that check locked everyone out. A payment is what grants access here.
 */
export async function hasAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accessUntil: true, role: true },
  });
  if (!user) return false;
  // Admins are never paywalled. Staff need the gated features to do their job,
  // and making the platform charge its own administrators to test it is the kind
  // of lockout that gets discovered in production, not in review. Checked on
  // role rather than a grant timestamp so it cannot expire.
  if (ADMIN_ROLES.includes(user.role as AdminRoleName)) return true;
  return Boolean(user.accessUntil && user.accessUntil > new Date());
}

/** Milliseconds until access lapses, or null when there is no window. */
export async function accessRemainingMs(userId: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accessUntil: true, role: true },
  });
  if (user && ADMIN_ROLES.includes(user.role as AdminRoleName)) {
    // Matches hasAccess: admins are entitled without a window. A null here
    // alongside hasAccess === true would read as "no access" in the UI.
    return Number.POSITIVE_INFINITY;
  }
  if (!user?.accessUntil) return null;
  return Math.max(0, user.accessUntil.getTime() - Date.now());
}

function toMinor(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export type RefundResult =
  | { applied: true; refundId: string; amount: number; accessRevoked: boolean }
  | { applied: false; reason: string };

/**
 * Applies a gateway refund to a settled top-up.
 *
 * The refund amount is taken from our stored order, never from the webhook
 * payload, for the same reason settlement ignores the payload amount: the
 * payload is untrusted. A payload that disagrees with the stored order is
 * flagged by the caller and not applied here.
 */
export async function applyRefund(input: {
  gatewayRefundId?: string;
  gatewayPaymentId?: string;
  payloadAmount?: number;
}): Promise<RefundResult> {
  const { gatewayRefundId, gatewayPaymentId, payloadAmount } = input;

  // Without a refund id there is no idempotency key, so a redelivery would
  // double-debit. Refuse rather than guess.
  if (!gatewayRefundId) {
    return { applied: false, reason: "No refund id; cannot guarantee idempotency" };
  }

  const order = await prisma.paymentOrder.findFirst({
    where: gatewayPaymentId ? { cashfreePaymentId: gatewayPaymentId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    return { applied: false, reason: "No settled order for that payment id" };
  }

  // Latch: the unique index on cashfreeRefundId makes a duplicate insert fail,
  // which is how a redelivery is stopped from moving money twice.
  const existing = await prisma.refundLog.findFirst({
    where: { cashfreeRefundId: gatewayRefundId },
  });
  if (existing?.status === "COMPLETED") {
    return { applied: false, reason: "Refund already applied" };
  }

  const orderMinor = toMinor(order.amount);
  const payloadMinor =
    payloadAmount === undefined ? orderMinor : toMinor(payloadAmount);

  if (payloadMinor !== orderMinor) {
    // Amount disagreement is a reconciliation problem, not something to
    // auto-apply. Recorded as FAILED so it is visible rather than silent.
    await prisma.refundLog.upsert({
      where: { id: existing?.id ?? "pending" },
      create: {
        bookingId: null,
        userId: order.userId,
        amount: Number(order.amount),
        reason: "AMOUNT_MISMATCH",
        type: "FULL",
        cashfreeRefundId: gatewayRefundId,
        paymentOrderId: order.id,
        status: "FAILED",
        initiatedBy: "SYSTEM",
      },
      update: { status: "FAILED", reason: "AMOUNT_MISMATCH" },
    });
    return {
      applied: false,
      reason: `Amount mismatch: order ${orderMinor} vs payload ${payloadMinor}`,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.refundLog.create({
      data: {
        bookingId: null,
        userId: order.userId,
        amount: Number(order.amount),
        reason: "Gateway refund",
        type: "FULL",
        cashfreeRefundId: gatewayRefundId,
        paymentOrderId: order.id,
        status: "COMPLETED",
        initiatedBy: "SYSTEM",
        completedAt: new Date(),
      },
    }).catch((err: unknown) => {
      // Unique violation on cashfreeRefundId means a concurrent delivery won.
      if (typeof err === "object" && err !== null && "code" in err &&
          (err as { code?: string }).code === "P2002") {
        return null;
      }
      throw err;
    });

    // Lost the race to a parallel delivery; that delivery did the work.
    if (!claimed) return null;

    const wallet = await tx.wallet.findUnique({ where: { id: order.walletId } });
    if (!wallet) throw new Error("Wallet missing for refunded order");

    const balanceMinor = toMinor(wallet.balance);
    if (balanceMinor < orderMinor) {
      // Recorded so it is visible for manual handling rather than applied.
      await tx.refundLog.update({
        where: { id: claimed.id },
        data: {
          status: "FAILED",
          reason: `Insufficient wallet balance: ${balanceMinor} < ${orderMinor}`,
        },
      });
      return null;
    }

    // Conditional update, not a read-then-write. The check above happens in the
    // same transaction, but a sibling transaction can still commit a debit
    // between it and this write, so a plain update would drive the balance
    // negative and corrupt every later payout. Re-asserting balance >= amount as
    // a WHERE predicate makes the guard atomic in the database. Zero rows matched
    // means it lost that race.
    const debited = await tx.wallet.updateMany({
      where: { id: order.walletId, balance: { gte: order.amount } },
      data: { balance: { decrement: order.amount } },
    });
    if (debited.count !== 1) {
      await tx.refundLog.update({
        where: { id: claimed.id },
        data: {
          status: "FAILED",
          reason: "Wallet balance changed concurrently; refund not debited",
        },
      });
      return null;
    }

    await tx.transaction.create({
      data: {
        walletId: order.walletId,
        userId: order.userId,
        type: "DEBIT",
        status: "COMPLETED",
        amount: Number(order.amount),
        description: "Refund via Cashfree webhook",
        referenceId: gatewayRefundId,
      },
    });

    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "REFUNDED",
        refundedAmount: order.amount,
        refundedAt: new Date(),
      },
    });

    // A refunded user must not keep premium access.
    await tx.user.update({
      where: { id: order.userId },
      data: { accessUntil: new Date(0), accessSource: "REVOKED_REFUND" },
    });

    await tx.notification.create({
      data: {
        userId: order.userId,
        title: "Payment Refunded",
        // The gateway returns the money to the card, and the wallet credit that
        // this payment created is reversed. Saying it was refunded *to* the
        // wallet would describe the opposite of what happened.
        body: `₹${Number(order.amount)} has been refunded to your payment method and the matching wallet credit has been reversed.`,
        data: JSON.stringify({ refundId: gatewayRefundId, amount: Number(order.amount) }),
      },
    });

    return claimed;
  });

  if (!result) {
    return { applied: false, reason: "Refund not applied (duplicate or insufficient balance)" };
  }

  return {
    applied: true,
    refundId: gatewayRefundId,
    amount: Number(order.amount),
    accessRevoked: true,
  };
}
/**
 * Collecting a subscription payment with no gateway.
 *
 * THE RAIL IS THE WALLET FIRST, THEN MANUAL UPI. A gateway mandate is gone, so a
 * plan is paid for in one of two ways:
 *
 *   1. The wallet covers the price, in which case the plan is active the moment
 *      the debit succeeds. Nothing for the user to do and nothing to verify.
 *   2. The wallet is short (or there is no wallet), in which case a
 *      SubscriptionPayment is raised and the user pays the platform QR. The plan
 *      stays unactivated until an admin verifies the UTR against the bank
 *      statement - never automatically, because that is the only check that
 *      money actually arrived.
 *
 * WHY RENEWAL REUSES EXACTLY THIS FUNCTION: a renewal must not have a different
 * rule from the purchase, or a user who could subscribe on day one would be
 * charged by a different mechanism on day thirty. collectForPeriod is the only
 * place that decides, and both the initial purchase and the sweeper call it.
 *
 * WHY PAST_DUE AND NOT CANCELLED: failing to collect is not the user asking to
 * leave. The plan is held so access continues and the subscription can be
 * revived by paying, and it keeps trying on the next sweep.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  sendSubscriptionEmail,
  sendSubscriptionPaymentRequiredEmail,
  type EmailResult,
} from "./emailService";

/**
 * Ledger type for the wallet charge. Anything other than CREDIT renders as a
 * debit in the wallet ledger, which is why the amount below stays POSITIVE - the
 * same convention datingService uses.
 */
export const SUBSCRIPTION_TRANSACTION_TYPE = "SUBSCRIPTION";

/** Statuses that mean "not currently charging anything". */
const CLOSED_STATUSES = ["CANCELLED", "EXPIRED", "COMPLETED", "CUSTOMER_CANCELLED"];

export type CollectionSource = "WALLET" | "UPI";

export interface CollectResult {
  source: CollectionSource;
  subscriptionId: string;
  /** Set when source is UPI: the request an admin verifies. */
  paymentId?: string;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  /** Wallet balance after the charge, when it came from the wallet. */
  walletBalance?: number;
}

/** Two decimals, matching the Decimal(10,2) money columns. */
function toMoney(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

/** Days from today, never zero: a plan that paid for no days is not a plan. */
export function periodFrom(planDays: number, from: Date = new Date()): { start: Date; end: Date } {
  const days = Number.isFinite(planDays) && planDays > 0 ? Math.floor(planDays) : 30;
  const start = new Date(from);
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  return { start, end };
}

export class InsufficientSubscriptionBalanceError extends Error {
  readonly code = "INSUFFICIENT_BALANCE";
  /** What is actually spendable, so the client can say how short it is. */
  readonly available: number;
  readonly required: number;
  constructor(available: number, required: number) {
    super("Wallet balance is too low for this plan.");
    this.available = available;
    this.required = required;
  }
}

/**
 * Take the plan price out of the wallet, or report that it cannot be taken.
 *
 * Race-safe by construction: the debit is a single conditional UPDATE whose WHERE
 * carries the balance test, so two concurrent renewals can never both pass the
 * check and drive the balance negative. Checking first and then decrementing would
 * be a race; Prisma's updateMany returns the row count, which is the receipt.
 *
 * Respects heldBalance. Funds held for a metered call are not spendable, so the
 * test is "balance covers held plus the price", not "balance covers the price" -
 * otherwise a call in progress could be paid for out of the subscription.
 */
export async function debitWalletForPlan(
  userId: string,
  amount: number,
  description: string,
  referenceId: string,
): Promise<{ charged: boolean; balance?: number }> {
  const price = toMoney(amount);
  if (price <= 0) return { charged: false };

  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return { charged: false };

  const held = toMoney(wallet.heldBalance);
  // Decimal arithmetic, never float: balance is Decimal(10,2) in the database and
  // comparing in JS would let a fractional-paisa value slip through the guard.
  const required = new Prisma.Decimal(held).plus(new Prisma.Decimal(price));

  const debited = await prisma.wallet.updateMany({
    where: { id: wallet.id, balance: { gte: required } },
    data: { balance: { decrement: new Prisma.Decimal(price) } },
  });
  if (debited.count !== 1) return { charged: false };

  await prisma.transaction.create({
    data: {
      userId,
      walletId: wallet.id,
      type: SUBSCRIPTION_TRANSACTION_TYPE,
      // Positive amount, debit-implying type - see the constant above.
      amount: new Prisma.Decimal(price),
      status: "SUCCESS",
      description,
      referenceId,
    },
  });

  const after = await prisma.wallet.findUnique({
    where: { id: wallet.id },
    select: { balance: true },
  });
  return { charged: true, balance: toMoney(after?.balance) };
}

/**
 * Try the wallet, and fall back to a manual-UPI request when it is short.
 *
 * This is the single decision point for paying for a subscription period. Both
 * paths end with the subscription carrying the period they paid for, so nothing
 * downstream has to care which rail was used.
 */
export async function collectForPeriod(input: {
  userId: string;
  subscriptionId: string;
  planId: string;
  amount: number;
  planDays: number;
  planName: string;
  kind: "activated" | "renewed";
  /**
   * When the period begins. A purchase uses now; a renewal must use the end of
   * the period already paid for, or a renewal collected a day late silently
   * shortens the month the user paid for.
   */
  periodStart?: Date;
}): Promise<CollectResult> {
  const { userId, subscriptionId, planId, planName, kind } = input;
  const price = toMoney(input.amount);
  const { start, end } = periodFrom(input.planDays, input.periodStart ?? new Date());

  const wallet = await debitWalletForPlan(
    userId,
    price,
    `${planName} ${kind === "renewed" ? "renewal" : "subscription"} paid from wallet`,
    `SUB-${subscriptionId.slice(0, 8)}`,
  );

  if (wallet.charged) {
    await activatePeriod({ subscriptionId, start, end, kind });
    await emailConfirmation({ userId, planName, amount: price, start, end, kind, method: "wallet", walletBalance: wallet.balance });
    return { source: "WALLET", subscriptionId, amount: price, periodStart: start, periodEnd: end, walletBalance: wallet.balance };
  }

  const payment = await openManualUpiRequest({ userId, subscriptionId, planId, amount: price, start, end });
  return {
    source: "UPI",
    subscriptionId,
    paymentId: payment.id,
    amount: price,
    periodStart: start,
    periodEnd: end,
  };
}

/**
 * Raise the manual-UPI request for a period the wallet could not cover.
 *
 * Reuses the subscription row rather than adding one per attempt, so a user who
 * declines the QR and tries again cannot end up with several live requests for
 * the same period - an admin could then verify one and be paid twice for a
 * single period.
 */
async function openManualUpiRequest(input: {
  userId: string;
  subscriptionId: string;
  planId: string;
  amount: number;
  start: Date;
  end: Date;
}) {
  const data = {
    userId: input.userId,
    planId: input.planId,
    amount: new Prisma.Decimal(toMoney(input.amount)),
    periodStart: input.start,
    periodEnd: input.end,
    status: "VERIFICATION_PENDING",
  };
  return prisma.subscriptionPayment.upsert({
    where: { subscriptionId: input.subscriptionId },
    create: { subscriptionId: input.subscriptionId, ...data },
    update: data,
  });
}

/**
 * Write the paid period onto the subscription.
 *
 * nextBillingAt is set to the END of the period just paid for, not to now plus
 * the plan length. Those differ whenever a renewal is collected late, and using
 * "now plus length" would silently shorten every late-renewed month.
 */
export async function activatePeriod(input: {
  subscriptionId: string;
  start: Date;
  end: Date;
  kind: "activated" | "renewed";
}): Promise<void> {
  await prisma.subscription.updateMany({
    where: { id: input.subscriptionId, status: { notIn: CLOSED_STATUSES } },
    data: {
      status: "ACTIVE",
      authorizationStatus: "SUCCESS",
      startedAt: input.start,
      nextBillingAt: input.end,
      pastDueAt: null,
      autoRenew: true,
    },
  });
}

async function emailConfirmation(input: {
  userId: string;
  planName: string;
  amount: number;
  start: Date;
  end: Date;
  kind: "activated" | "renewed";
  walletBalance?: number;
  referenceNumber?: string | null;
  method: "wallet" | "upi";
}): Promise<EmailResult | null> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return null;
  return sendSubscriptionEmail(user.email, user.fullName || "there", {
    planName: input.planName,
    amount: input.amount,
    method: input.method,
    kind: input.kind,
    periodStart: input.start.toISOString(),
    periodEnd: input.end.toISOString(),
    nextBillingAt: input.end.toISOString(),
    walletBalance: input.walletBalance ?? null,
    referenceNumber: input.referenceNumber ?? null,
  });
}

/**
 * Settle a manual-UPI subscription payment. Called only from the admin verify
 * path, never from the user side.
 *
 * The wallet is deliberately NOT credited: this money bought the billing period
 * and has already been spent on the service. Crediting it would let the user pay
 * once for a plan and then have the balance to spend on calls and bookings.
 */
export async function settleSubscriptionPayment(input: {
  paymentId: string;
  adminUserId: string;
  note?: string;
}): Promise<{ status: string; alreadySettled: boolean }> {
  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id: input.paymentId },
    include: { subscription: { include: { plan: true } } },
  });
  if (!payment) throw new Error("SUBSCRIPTION_PAYMENT_NOT_FOUND");

  // Guarded on the status, so two admins verifying at once (or a retry after a
  // timeout) cannot double-apply the period or send the mail twice.
  const claimed = await prisma.subscriptionPayment.updateMany({
    where: { id: input.paymentId, status: "VERIFICATION_PENDING" },
    data: {
      status: "VERIFIED",
      verifiedByAdminId: input.adminUserId,
      verificationNote: input.note ?? null,
    },
  });
  if (claimed.count !== 1) {
    return { status: payment.status, alreadySettled: true };
  }

  const plan = payment.subscription.plan;
  const isRenewal = Boolean(payment.subscription.startedAt);
  await activatePeriod({
    subscriptionId: payment.subscriptionId,
    start: payment.periodStart,
    end: payment.periodEnd,
    kind: isRenewal ? "renewed" : "activated",
  });

  await emailConfirmation({
    userId: payment.userId,
    planName: plan.name,
    amount: toMoney(payment.amount),
    start: payment.periodStart,
    end: payment.periodEnd,
    kind: isRenewal ? "renewed" : "activated",
    method: "upi",
    referenceNumber: payment.referenceNumber,
  });

  return { status: "VERIFIED", alreadySettled: false };
}

export interface SweepResult {
  scanned: number;
  renewed: number;
  pastDue: number;
  failed: number;
  /** Subscriptions skipped because a collection request is already open. */
  awaitingPayment: number;
}

/**
 * Collect every subscription whose period has ended.
 *
 * Rules that matter:
 *
 * - Only autoRenew plans are touched. A user who turned auto-renew off must never
 *   be charged, whatever their balance holds.
 * - The sweep claims each subscription with a guarded update BEFORE collecting,
 *   so a second pass (another instance, a slow run overlapping the next tick)
 *   cannot charge the same period twice. This is the same claim-then-act shape
 *   the escrow sweeper uses.
 * - An open SubscriptionPayment means a human is already involved, so the sweep
 *   leaves it alone rather than issuing a second QR for the same period.
 */
export async function sweepDueSubscriptions(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, renewed: 0, pastDue: 0, failed: 0, awaitingPayment: 0 };

  const due = await prisma.subscription.findMany({
    where: {
      autoRenew: true,
      status: { in: ["ACTIVE", "PAST_DUE"] },
      nextBillingAt: { lte: now },
    },
    include: { plan: true, payment: true },
    take: 100,
  });
  result.scanned = due.length;

  for (const sub of due) {
    try {
      // A live request already exists: an admin is verifying or the user is
      // about to pay. Issuing another would double the money owed for one period.
      if (sub.payment && sub.payment.status === "VERIFICATION_PENDING") {
        result.awaitingPayment += 1;
        continue;
      }

      // Claim: push nextBillingAt to the end of the period about to be collected
      // BEFORE collecting, so an overlapping run (second instance, or a slow pass
      // meeting the next tick) skips it. A crash between the claim and the collect
      // costs one missed renewal, which is recoverable; charging twice is not.
      const periodStart = sub.nextBillingAt ?? now;
      const period = periodFrom(sub.plan.durationDays, periodStart);
      const claimed = await prisma.subscription.updateMany({
        where: { id: sub.id, nextBillingAt: periodStart },
        data: { nextBillingAt: period.end },
      });
      if (claimed.count !== 1) continue;

      const collected = await collectForPeriod({
        userId: sub.userId,
        subscriptionId: sub.id,
        planId: sub.planId,
        // Always the ordinary price. A renewal runs against a subscription that
        // already exists, so the account has by definition had one before and a
        // first-period offer cannot apply - the new-user price is decided in
        // resolveFirstPeriodPrice at purchase time and never resurfaces here.
        amount: sub.plan.price,
        planDays: sub.plan.durationDays,
        planName: sub.plan.name,
        kind: "renewed",
        // The period is anchored to the billing date that just came due, not to
        // now, so a late sweep does not shorten the month already paid for.
        periodStart,
      });

      if (collected.source === "WALLET") {
        result.renewed += 1;
      } else {
        // Could not take it from the wallet, so a payment request is open and an
        // admin is now involved. nextBillingAt already points at the requested
        // period's end from the claim, so this retry waits for that rather than
        // re-firing every tick. PAST_DUE rather than CANCELLED: a short balance is
        // not the user asking to leave, so access continues and paying revives it.
        await prisma.subscription.updateMany({
          where: { id: sub.id },
          data: { status: "PAST_DUE", pastDueAt: new Date() },
        });
        await emailPaymentRequired({
          userId: sub.userId,
          planName: sub.plan.name,
          amount: sub.plan.price,
          periodEnd: collected.periodEnd,
        });
        result.pastDue += 1;
      }
    } catch (err) {
      // One bad row must not stop the rest of the batch.
      result.failed += 1;
      console.error(`[SUBSCRIPTION] sweep failed for ${sub.id}:`, err);
    }
  }

  return result;
}

async function emailPaymentRequired(input: {
  userId: string;
  planName: string;
  amount: number;
  periodEnd: Date;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return;
  await sendSubscriptionPaymentRequiredEmail(user.email, user.fullName || "there", {
    planName: input.planName,
    amount: toMoney(input.amount),
    periodStart: new Date().toISOString(),
    periodEnd: input.periodEnd.toISOString(),
  });
}


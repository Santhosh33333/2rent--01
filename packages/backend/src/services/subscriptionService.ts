import { prisma } from "../config/database";
import { createSubscription, createPlan, cancelSubscription, changePlan } from "./cashfreeSubscriptionGateway";
import { isGatewayLive } from "./paymentProvider";
import { getTrialSettings } from "./trialAccessService";

/**
 * Subscription pricing is admin-configurable, never hardcoded in the frontend.
 * Prices are stored in paise-safe rupees as Float to match the rest of the
 * pricing models, but every amount sent to Cashfree is integer rupees.
 */

export type BillingInterval = "MONTH" | "YEAR";

export interface PlanInput {
  planId: string;
  planName: string;
  amount: number;
  interval: BillingInterval;
  trialDays?: number;
  maxAmount?: number;
}

const VALID_INTERVALS: BillingInterval[] = ["MONTH", "YEAR"];

function toRupees(value: number): number {
  return Math.round(Number(value));
}

/**
 * Mirrors a plan to Cashfree so recurring billing has a server-side definition.
 * Cashfree keeps its own copy; ours stays the source of truth for display.
 */
export async function syncPlanToGateway(input: PlanInput) {
  if (!VALID_INTERVALS.includes(input.interval)) {
    throw new Error("INVALID_INTERVAL");
  }
  const amount = toRupees(input.amount);
  if (amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  return createPlan({
    planId: input.planId,
    planName: input.planName,
    planType: "PERIODIC",
    planCurrency: "INR",
    planRecurringAmount: amount,
    planMaxAmount: toRupees(input.maxAmount ?? amount),
    planIntervals: 1,
    planIntervalType: input.interval,
  });
}

/**
 * Active plans for the pricing screen and the landing pages.
 *
 * `trialDays` is returned as the *effective* global trial length, not the plan's
 * own stored column. That is the whole reason this is a function and not a bare
 * findMany.
 *
 * The landing pages take max(plan.trialDays) and print it as "N days free", while
 * access is decided by User.accessUntil written from the global setting. So the
 * plan column was decoration: an admin editing it changed the advert and not the
 * product, and the two could disagree silently. Overriding it here means the
 * number the marketing copy shows is the number a new account actually receives,
 * with no frontend change.
 *
 * The plan's own value is still returned as planTrialDays, so an admin can see
 * that the column exists and is no longer what is being advertised.
 */
export async function getActivePlans() {
  const [plans, trial] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        durationDays: true,
        price: true,
        currency: true,
        trialDays: true,
        isActive: true,
        displayOrder: true,
        gatewayPlanId: true,
      },
    }),
    getTrialSettings(),
  ]);

  return plans.map((plan) => ({
    ...plan,
    planTrialDays: plan.trialDays,
    trialDays: trial.days,
  }));
}

export async function getPlanByCode(code: string) {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { code, isActive: true },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  return plan;
}

export interface StartSubscriptionInput {
  userId: string;
  planCode: string;
  email: string;
  phone: string;
  fullName: string;
}

/**
 * Start a subscription. Cashfree returns a `subscription_session_id` for the
 * hosted checkout SDK; until the mandate is authorized the subscription stays
 * INITIALIZED and grants nothing.
 */
export async function startSubscription(input: StartSubscriptionInput) {
  // Subscriptions run through the hosted gateway only - a recurring plan needs a
  // mandate, which a one-off UPI transfer cannot create. So unlike bookings there
  // is no manual fallback here, and the check has to come first: without it this
  // made a live HTTP call to a provider whose credentials are no longer deployed,
  // which is slow, logs a stack trace on every attempt, and reaches the browser
  // as a generic failure the user cannot act on. Failing here says what is
  // actually true: there is no rail to take this payment on.
  if (!(await isGatewayLive())) {
    throw new Error("SUBSCRIPTIONS_UNAVAILABLE");
  }

  const plan = await getPlanByCode(input.planCode);

  const result = await createSubscription({
    subscriptionId: `nabri_sub_${input.userId.slice(0, 8)}_${Date.now()}`,
    customerEmail: input.email,
    customerPhone: input.phone,
    customerName: input.fullName,
    planId: plan.gatewayPlanId ?? plan.code,
  });

  await prisma.subscription.create({
    data: {
      subscriptionId: result.subscriptionId,
      userId: input.userId,
      planId: plan.id,
      status: result.status ?? "INITIALIZED",
      authorizationStatus: "PENDING",
    },
  });

  return {
    subscriptionId: result.subscriptionId,
    subscriptionSessionId: result.subscriptionSessionId,
    plan: { code: plan.code, name: plan.name, price: plan.price, currency: plan.currency },
  };
}

/**
 * Cancel a subscription.
 *
 * Local only. There is no mandate to revoke any more, so there is nothing to call
 * out to - and the previous version called the retired gateway, which meant the
 * one control on the subscription screen failed with a network error for every
 * user.
 *
 * Cancelling stops FUTURE collection, not entitlement already paid for:
 * autoRenew goes false so the renewal sweep never picks this plan up again, and
 * nextBillingAt is deliberately left alone. Paid-through access is governed
 * separately by the access window (GET /payments/access), so revoking it here
 * would not shorten it and must not be claimed to.
 */
export async function cancelUserSubscription(userId: string, reason?: string) {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: ["ACTIVE", "PAST_DUE", "ON_HOLD", "PAUSED", "INITIALIZED", "PENDING", "BANK_APPROVAL_PENDING"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

  const updated = await prisma.subscription.updateMany({
    where: { id: sub.id, status: { notIn: ["CANCELLED", "EXPIRED", "COMPLETED", "CUSTOMER_CANCELLED"] } },
    data: {
      status: "CUSTOMER_CANCELLED",
      autoRenew: false,
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    },
  });
  // Someone cancelled the same plan between the read and the write. Reporting it
  // as a success is still true - it is cancelled - so this is not an error.
  if (updated.count !== 1) throw new Error("SUBSCRIPTION_NOT_FOUND");

  return { subscriptionId: sub.subscriptionId, status: "CUSTOMER_CANCELLED", accessUntil: sub.nextBillingAt };
}

/**
 * Move an active subscription onto a different plan.
 *
 * The plan is swapped immediately, but the price difference is NOT settled here:
 * the new plan's first period is collected by collectForPeriod on the next
 * billing date, through the same wallet-or-UPI path as every other payment.
 * Pretending the change was prorated would mean either charging a difference the
 * user never agreed to or silently losing one, and there is no gateway to settle
 * a proration against any more.
 */
export async function changeUserPlan(userId: string, newPlanCode: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "PAST_DUE"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

  const plan = await getPlanByCode(newPlanCode);
  if (plan.id === sub.planId) {
    return { subscriptionId: sub.subscriptionId, planCode: plan.code, status: sub.status, changed: false };
  }

  await prisma.subscription.updateMany({
    where: { id: sub.id },
    data: { planId: plan.id },
  });

  // The outstanding request, if any, was raised at the old plan's price, so it is
  // voided rather than verified later for an amount nobody agreed to.
  await prisma.subscriptionPayment.updateMany({
    where: { subscriptionId: sub.id, status: "VERIFICATION_PENDING" },
    data: { status: "SUPERSEDED", verificationNote: `Plan changed to ${plan.code} before this payment was verified.` },
  });

  return { subscriptionId: sub.subscriptionId, planCode: plan.code, status: sub.status, changed: true };
}

/** Whether the user currently has entitlement to premium features. */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const count = await prisma.subscription.count({
    where: { userId, status: "ACTIVE" },
  });
  return count > 0;
}

/**
 * Trial state for the subscription screen. Never deletes the account when a
 * trial lapses; the user simply loses premium access.
 */
export async function getTrialState(userId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { plan: true, payment: true },
  });
  if (!sub) {
    return {
      state: "NONE" as const,
      plan: null,
      trialEndsAt: null,
      nextBillingAt: null,
      // Always an array: a caller must not have to null-check before iterating,
      // and the shape stays the same whether or not a payment is outstanding.
      pendingPayment: null,
    };
  }
  // The live collection request, when there is one. Carried here so a page
  // reload can rebuild the QR: without it the user is left with an unpaid request
  // and no way to pay it, which is the exact failure this replaced.
  const openPayment =
    sub.payment && sub.payment.status === "VERIFICATION_PENDING"
      ? {
          id: sub.payment.id,
          amount: Number(sub.payment.amount),
          currency: sub.payment.currency,
          status: sub.payment.status,
          referenceNumber: sub.payment.referenceNumber,
          createdAt: sub.payment.createdAt,
        }
      : null;
  return {
    state: sub.status,
    plan: sub.plan ? { code: sub.plan.code, name: sub.plan.name, price: sub.plan.price } : null,
    trialEndsAt: sub.trialEndsAt,
    nextBillingAt: sub.nextBillingAt,
    pendingPayment: openPayment,
    // What is owed since, for the admin queue and the "action needed" copy.
    pastDueAt: sub.pastDueAt,
  };
}
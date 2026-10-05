import { prisma } from "../config/database";
import { createSubscription, createPlan, cancelSubscription, changePlan } from "./cashfreeSubscriptionGateway";
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

export async function cancelUserSubscription(userId: string, reason?: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ["ACTIVE", "ON_HOLD", "PAUSED", "INITIALIZED", "BANK_APPROVAL_PENDING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

  const result = await cancelSubscription(sub.subscriptionId);

  await prisma.subscription.update({
    where: { subscriptionId: sub.subscriptionId },
    data: {
      status: result.status ?? "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    },
  });

  return { subscriptionId: sub.subscriptionId, status: result.status ?? "CANCELLED" };
}

export async function changeUserPlan(userId: string, newPlanCode: string) {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) throw new Error("SUBSCRIPTION_NOT_FOUND");

  const plan = await getPlanByCode(newPlanCode);
  const result = await changePlan(sub.subscriptionId, plan.gatewayPlanId ?? plan.code);

  await prisma.$transaction([
    prisma.subscription.update({
      where: { subscriptionId: sub.subscriptionId },
      data: { planId: plan.id },
    }),
    prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  return { subscriptionId: sub.subscriptionId, planCode: plan.code, status: result.status };
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
    include: { plan: true },
  });
  if (!sub) {
    return { state: "NONE" as const, plan: null, trialEndsAt: null, nextBillingAt: null };
  }
  return {
    state: sub.status,
    plan: sub.plan ? { code: sub.plan.code, name: sub.plan.name, price: sub.plan.price } : null,
    trialEndsAt: sub.trialEndsAt,
    nextBillingAt: sub.nextBillingAt,
  };
}
import { prisma } from "../config/database";
import { getTrialSettings } from "./trialAccessService";

/**
 * Subscription pricing is admin-configurable, never hardcoded in the frontend.
 * Prices are stored in paise-safe rupees as Float to match the rest of the
 * pricing models.
 *
 * The gateway mirror that used to sit here is gone. Pushing a plan to Cashfree
 * only existed so the hosted checkout SDK had a server-side definition to
 * subscribe against, and with the gateway retired nothing reads one. Keeping it
 * would have meant a plan edit still calling a provider whose credentials are no
 * longer deployed - slow, and failing in a way the admin could not act on, for a
 * write whose result nothing consumed.
 */

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
export async function getActivePlans(userId?: string) {
  const [plans, trial, everSubscribed] = await Promise.all([
    prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        durationDays: true,
        price: true,
        listPrice: true,
        offerPrice: true,
        currency: true,
        trialDays: true,
        isActive: true,
        displayOrder: true,
        gatewayPlanId: true,
      },
    }),
    getTrialSettings(),
    userId ? hasEverSubscribed(userId) : Promise.resolve(false),
  ]);

  return plans.map((plan) => {
    // An offer is a new-customer price, so it is offered only to an account that
    // has never held a subscription. With no session - this route is deliberately
    // public so the paywall renders before login - the visitor is treated as a
    // prospective new account, which is what the pricing screen is advertising to.
    // The server still decides again at purchase; this only controls the drawing.
    const eligibleForOffer = !everSubscribed && plan.offerPrice !== null;

    return {
      ...plan,
      planTrialDays: plan.trialDays,
      trialDays: trial.days,
      /** What this viewer pays for the first period. */
      effectivePrice: eligibleForOffer ? (plan.offerPrice as number) : plan.price,
      eligibleForOffer,
      /**
       * The struck-through anchor. Deliberately null whenever there is no offer
       * in play: showing a "was" price to someone paying the ordinary price
       * claims a discount they are not being given.
       */
      listPrice: eligibleForOffer ? plan.listPrice : null,
    };
  });
}

/**
 * Whether this account has ever held a subscription.
 *
 * Decided by history rather than by what is currently active, because a
 * subscriber who cancelled still had their intro period. Keying the offer off
 * current status would hand the new-user price to anyone patient enough to
 * cancel first, which is the whole discount leaking.
 *
 * Any subscription row counts, including a failed or abandoned one: a false
 * negative costs a user a ticket, a false positive gives away money that was
 * never meant to be discounted.
 */
export async function hasEverSubscribed(userId: string): Promise<boolean> {
  const count = await prisma.subscription.count({ where: { userId } });
  return count > 0;
}

export interface FirstPeriodPrice {
  /** What is actually charged for this period. */
  amount: number;
  /** Struck-through price to draw beside it, or null when no offer applies. */
  listPrice: number | null;
  /** True when the new-user price was used. */
  offerApplied: boolean;
}

/**
 * The price of a subscription's first period for one specific account.
 *
 * Kept as its own function because the number has to be decided in exactly one
 * place and read in two: the pricing screen draws it, and `subscribe` charges
 * it. Renewals deliberately do not come through here - by the time the renewal
 * sweep runs, the account has a subscription, so it is no longer a first period.
 */
export async function resolveFirstPeriodPrice(
  plan: { price: number; listPrice: number | null; offerPrice: number | null },
  userId: string,
): Promise<FirstPeriodPrice> {
  if (plan.offerPrice === null) {
    return { amount: plan.price, listPrice: null, offerApplied: false };
  }
  if (await hasEverSubscribed(userId)) {
    return { amount: plan.price, listPrice: null, offerApplied: false };
  }
  return { amount: plan.offerPrice, listPrice: plan.listPrice, offerApplied: true };
}

export async function getPlanByCode(code: string) {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { code, isActive: true },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");
  return plan;
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
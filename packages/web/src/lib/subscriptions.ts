import { api } from "./api";

/**
 * Subscription API client.
 *
 * Every price on screen comes from `GET /subscriptions/plans`. Nothing here
 * hardcodes an amount, and no plan value is ever trusted from the client.
 */

export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  durationDays: number;
  price: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
  displayOrder: number;
  gatewayPlanId: string | null;
}

export interface MySubscription {
  state: string;
  isActive: boolean;
  plan: { code: string; name: string; price: number } | null;
  trialEndsAt: string | null;
  nextBillingAt: string | null;
}

export interface SubscribeResult {
  subscriptionId: string;
  subscriptionSessionId: string;
  plan: { code: string; name: string; price: number; currency: string };
}

/**
 * Paid access, as reported by GET /payments/access.
 *
 * This is the state to gate on, not `isActive` from /subscriptions/me. That
 * field reflects a Cashfree subscription mandate, which can only become ACTIVE
 * via a gateway webhook, so it reads false even for a user who has paid. A
 * settled payment grants a local window instead, which is why access is tracked
 * here.
 */
export interface AccessStatus {
  hasAccess: boolean;
  accessUntil: string | null;
  accessSource: string | null;
  daysRemaining: number;
  accessWindowDays: number;
  refundPolicy: string;
}

/** States that mean the user has paid and is entitled to premium. */
export const ENTITLED_STATES = new Set(["ACTIVE"]);
export const TRIAL_STATES = new Set(["INITIALIZED", "PENDING"]);

export const subscriptionsApi = {
  /** Public. Readable before login so the paywall can render. */
  getPlans: () =>
    api.get<{ data: { plans: SubscriptionPlan[] } }>("/subscriptions/plans"),

  /** Requires a session. */
  getMe: () => api.get<{ data: MySubscription }>("/subscriptions/me"),

  /**
   * Requires a session. The authoritative paid-access check: reads the local
   * access window rather than a subscription mandate, so it is correct whether
   * or not Cashfree Subscriptions is active.
   */
  getAccess: () => api.get<{ data: AccessStatus }>("/payments/access"),

  /**
   * Starts a subscription. Returns a mandate session for the hosted checkout
   * SDK. This grants nothing on its own: entitlement starts when Cashfree's
   * authorization webhook confirms it.
   */
  subscribe: (planCode: string) =>
    api.post<{ data: SubscribeResult }>("/subscriptions/subscribe", { planCode }),

  cancel: (reason?: string) =>
    api.post("/subscriptions/cancel", { reason }, { timeout: 60000 }),

  changePlan: (planCode: string) =>
    api.post("/subscriptions/change-plan", { planCode }, { timeout: 60000 }),
};

export function formatPrice(price: number, currency: string): string {
  const symbol = currency === "INR" ? "₹" : "";
  return `${symbol}${price.toFixed(price % 1 === 0 ? 0 : 2)}`;
}

/** Human billing cadence from the plan duration, not from a hardcoded label. */
export function billingLabel(plan: SubscriptionPlan): string {
  const days = plan.durationDays;
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? "year" : `${years} years`;
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "month" : `${months} months`;
  }
  return `${days} days`;
}

/** Only show a savings badge when the real yearly price supports it. */
export function savingsPercent(monthly?: SubscriptionPlan, yearly?: SubscriptionPlan): number | null {
  if (!monthly || !yearly || monthly.price <= 0 || yearly.price <= 0) return null;
  if (yearly.durationDays % 365 !== 0 || monthly.durationDays % 30 !== 0) return null;

  const monthsCovered = yearly.durationDays / monthly.durationDays;
  const baseline = monthly.price * monthsCovered;
  if (baseline <= yearly.price) return null;

  return Math.round(((baseline - yearly.price) / baseline) * 100);
}

export function isTrialState(state: string): boolean {
  return TRIAL_STATES.has(state);
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
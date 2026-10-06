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
  /**
   * The unpaid manual-UPI request, when the wallet could not cover the plan.
   *
   * Read on every page load, not only from the subscribe response, so a refresh
   * or a return visit still shows the QR. Without this a user who closed the tab
   * mid-payment had no way back to it.
   */
  pendingPayment: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    referenceNumber: string | null;
    createdAt: string;
  } | null;
  /** When a renewal first could not be collected. */
  pastDueAt?: string | null;
}

/**
 * Result of POST /subscriptions/subscribe.
 *
 * `source` is what the caller must branch on, and it replaced a
 * `subscriptionSessionId` that is now always absent. There is no hosted checkout:
 * the server either took the money from the wallet (plan already active) or opened
 * a manual-UPI request (plan NOT active until an admin verifies the UTR). Treating
 * both as "payment started" is what left users waiting on a checkout that would
 * never open.
 */
export interface SubscribeResult {
  source: "WALLET" | "UPI";
  plan: { code: string; name: string; price: number; currency: string };
  amount: number;
  periodStart: string;
  periodEnd: string;
  /** Wallet path only. */
  walletBalance?: number;
  /** UPI path only: the request an admin verifies. */
  paymentId?: string;
  /** True only when the plan is live now. */
  active: boolean;
}

/**
 * The QR for a plan payment collected by manual UPI.
 *
 * `payable: false` is the important field: the server says so when the payment is
 * already verified or rejected, and the UI must then hide the QR rather than keep
 * inviting a payment that would be lost.
 */
export interface SubscriptionUpiDetails {
  payable: boolean;
  status: string;
  paymentId?: string;
  upiId?: string;
  accountName?: string | null;
  qrUrl?: string | null;
  upiUri?: string;
  qrReference?: string;
  qrExpiresAt?: string;
  qrExpiresInSeconds?: number;
  amount?: number;
  currency?: string;
  planName?: string;
  referenceNumber?: string | null;
  active?: boolean;
}

/**
 * Paid access, as reported by GET /payments/access.
 *
 * This is the state to gate on, not `isActive` from /subscriptions/me, because
 * access is tracked as a local window granted by a settled payment rather than
 * as a remote mandate.
 */
export interface AccessStatus {
  hasAccess: boolean;
  accessUntil: string | null;
  accessSource: string | null;
  /** Null when access is unlimited by role (admin), so there is no window to count. */
  daysRemaining: number | null;
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
   * Starts a subscription. The server collects it: from the wallet if the balance
   * covers the price, otherwise by opening a manual-UPI request. Branch on
   * `source` - `active` is true only on the wallet path.
   */
  subscribe: (planCode: string) =>
    api.post<{ data: SubscribeResult }>("/subscriptions/subscribe", { planCode }),

  /**
   * The QR for a plan payment the wallet could not cover.
   *
   * Fetched separately from the subscribe response on purpose: a reload must be
   * able to rebuild the QR, otherwise the user is left holding a payment request
   * they have no way to pay. `payable: false` means it is already settled and the
   * UI should stop offering a QR the user could still scan and lose money on.
   */
  getPaymentUpiDetails: (paymentId: string) =>
    api.get<{ data: SubscriptionUpiDetails }>(`/subscriptions/payments/${paymentId}/upi-details`),

  /**
   * The UTR from the user's bank app. Recording it does not activate the plan -
   * an admin still checks the bank statement - but without it there is nothing to
   * match, so this is what lets a payment actually be settled.
   */
  submitPaymentReference: (paymentId: string, referenceNumber: string) =>
    api.post<{ data: { status: string; referenceNumber: string } }>(
      `/subscriptions/payments/${paymentId}/reference`,
      { referenceNumber },
    ),

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
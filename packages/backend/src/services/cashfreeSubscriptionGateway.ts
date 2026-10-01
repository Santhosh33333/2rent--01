import { env } from "../config/env";
import { CASHFREE_API_VERSION, isSuccessfulStatus } from "./cashfreeService";

/**
 * Cashfree Subscriptions / Plans gateway calls.
 *
 * Separate from cashfreeService because subscriptions use different endpoints
 * (`/pg/plans`, `/pg/subscriptions`) and never share an order's lifecycle.
 * Version stays on 2025-01-01: the 2026-01-01 Create Subscription body is a
 * breaking restructure and buys nothing for periodic fixed-amount plans.
 */

const IS_SANDBOX =
  env.CASHFREE_API_ENV === "test" ||
  /^(test|sandbox)/i.test(env.CASHFREE_APP_ID || "");

const BASE = IS_SANDBOX
  ? "https://sandbox.cashfree.com/pg"
  : "https://api.cashfree.com/pg";

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-client-id": env.CASHFREE_APP_ID,
    "x-client-secret": env.CASHFREE_SECRET_KEY,
    "x-api-version": CASHFREE_API_VERSION,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`CASHFREE_INVALID_JSON_${res.status}`);
  }

  if (!res.ok) {
    const message =
      (parsed as { message?: string })?.message ?? `CASHFREE_${res.status}`;
    throw new Error(message);
  }
  return parsed as T;
}

export interface CreatePlanInput {
  planId: string;
  planName: string;
  planType: "PERIODIC" | "ON_DEMAND";
  planCurrency?: string;
  planRecurringAmount: number;
  planMaxAmount: number;
  planIntervals?: number;
  planIntervalType: "DAY" | "WEEK" | "MONTH" | "YEAR";
}

export async function createPlan(input: CreatePlanInput) {
  return post("/plans", {
    plan_id: input.planId,
    plan_name: input.planName,
    plan_type: input.planType,
    plan_currency: input.planCurrency ?? "INR",
    plan_recurring_amount: input.planRecurringAmount,
    plan_max_amount: input.planMaxAmount,
    plan_intervals: input.planIntervals ?? 1,
    plan_interval_type: input.planIntervalType,
  });
}

export interface CreateSubscriptionInput {
  subscriptionId: string;
  customerEmail: string;
  customerPhone: string;
  customerName?: string;
  planId: string;
  authorizationAmount?: number;
  returnUrl?: string;
}

export interface CreateSubscriptionResponse {
  subscription_id?: string;
  subscription_session_id?: string;
  subscription_status?: string;
  authorization_status?: string;
  message?: string;
}

export async function createSubscription(input: CreateSubscriptionInput) {
  const res = await post<CreateSubscriptionResponse>("/subscriptions", {
    subscription_id: input.subscriptionId,
    customer_details: {
      customer_email: input.customerEmail,
      customer_phone: input.customerPhone,
      ...(input.customerName ? { customer_name: input.customerName } : {}),
    },
    plan_details: { plan_id: input.planId },
    ...(input.authorizationAmount !== undefined
      ? {
          authorization_details: {
            authorization_amount: input.authorizationAmount,
            authorization_amount_refund: true,
          },
        }
      : {}),
    subscription_meta: {
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      notification_channel: ["EMAIL"],
    },
  });

  return {
    subscriptionId: res.subscription_id ?? input.subscriptionId,
    subscriptionSessionId: res.subscription_session_id ?? "",
    status: res.subscription_status ?? "INITIALIZED",
    authorizationStatus: res.authorization_status ?? "PENDING",
  };
}

export async function fetchSubscription(subscriptionId: string) {
  const res = await fetch(`${BASE}/subscriptions/${subscriptionId}`, {
    headers: authHeaders(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("SUBSCRIPTION_FETCH_FAILED");
  return text ? JSON.parse(text) : {};
}

export async function manageSubscription(
  subscriptionId: string,
  action: "CANCEL" | "PAUSE" | "ACTIVATE" | "CHANGE_PLAN",
  planId?: string,
) {
  const res = await post<{ subscription_status?: string; message?: string }>(
    `/subscriptions/${subscriptionId}/manage`,
    { action, ...(planId ? { plan_id: planId } : {}) },
  );
  return { status: res.subscription_status ?? "ACTIVE" };
}

export async function cancelSubscription(subscriptionId: string) {
  return manageSubscription(subscriptionId, "CANCEL");
}

export async function changePlan(subscriptionId: string, planId: string) {
  return manageSubscription(subscriptionId, "CHANGE_PLAN", planId);
}

/** Recurring debit. UPI Autopay retries up to 3x hourly; eNACH/cards do not retry. */
export async function raiseCharge(input: {
  subscriptionId: string;
  paymentId: string;
  paymentAmount: number;
  scheduleDate?: Date;
}) {
  const res = await post<{
    payment_status?: string;
    payment_id?: string;
    message?: string;
  }>("/subscriptions/pay", {
    subscription_id: input.subscriptionId,
    payment_id: input.paymentId,
    payment_type: "CHARGE",
    payment_amount: input.paymentAmount,
    ...(input.scheduleDate
      ? { payment_schedule_date: input.scheduleDate.toISOString() }
      : {}),
  });

  return {
    paymentId: res.payment_id ?? input.paymentId,
    status: res.payment_status ?? "PENDING",
    isSuccessful: isSuccessfulStatus(res.payment_status),
  };
}

export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status === "ACTIVE";
}
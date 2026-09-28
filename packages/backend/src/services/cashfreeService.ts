/**
 * Cashfree Order API (PG) client.
 *
 * Replaces Razorpay as the payment gateway. Two independent secrets are in
 * play and they are NOT interchangeable:
 *
 *   - CASHFREE_SECRET_KEY      signs and verifies client-side payment proofs,
 *                              and authenticates our calls to Cashfree.
 *   - CASHFREE_SECRET_KEY       signs inbound webhooks as well as API calls.
 *
 * Conflating them is how deployments end up accepting unsigned webhooks, so
 * they are separate variables and each is checked independently.
 *
 * Amounts are in major currency units (rupees), not paise.
 */
import crypto from "crypto"
import { env } from "../config/env"

const CASHFREE_API_BASE = "https://api.cashfree.com/pg"
// The header is `x-api-version`. An earlier `x-cf-version` was silently ignored
// by Cashfree, which would have left every order call on a default API version.
// Pinning the version explicitly keeps order, fetch and refund calls on the same
// contract.
const CASHFREE_API_VERSION = "2025-01-01"

export interface CashfreeOrderRequest {
  orderId: string
  amount: number
  currency?: string
  customerId: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  returnUrl?: string
  paymentMethods?: string
}

export interface CashfreeOrderResponse {
  order_id: string
  order_status: string
  order_amount: number
  order_currency: string
  payment_url?: string
}

export interface CashfreePayment {
  payment_id: string
  order_id: string
  payment_status: string
  payment_amount: number
  payment_currency: string
  payment_method?: string
}

function requireCredentials(): { appId: string; secret: string } {
  const appId = env.CASHFREE_APP_ID?.trim()
  const secret = env.CASHFREE_SECRET_KEY?.trim()

  if (!appId || !secret) {
    throw new Error("Cashfree credentials are not configured")
  }
  if (env.isProduction && isPlaceholder(appId)) {
    throw new Error("CASHFREE_APP_ID is a placeholder; refusing to create live orders")
  }
  if (env.isProduction && isPlaceholder(secret)) {
    throw new Error("CASHFREE_SECRET_KEY is a placeholder; refusing to create live orders")
  }
  return { appId, secret }
}

function isPlaceholder(value: string): boolean {
  const lowered = value.toLowerCase()
  return (
    !value ||
    lowered.includes("placeholder") ||
    lowered.includes("your_") ||
    lowered.includes("changeme")
  )
}

function headers(appId: string, secret: string): Record<string, string> {
  return {
    "x-client-id": appId,
    "x-client-secret": secret,
    "x-api-version": CASHFREE_API_VERSION,
    "Content-Type": "application/json",
  }
}

/** Fail fast rather than holding a user's payment screen open indefinitely. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

async function cashfreeFetch<T>(
  path: string,
  init: { method: string; body?: unknown },
  timeoutMs = 12000
): Promise<T> {
  const { appId, secret } = requireCredentials()

  const response = await withTimeout(
    fetch(`${CASHFREE_API_BASE}${path}`, {
      method: init.method,
      headers: headers(appId, secret),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    timeoutMs,
    "Cashfree request"
  )

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const detail =
      (parsed as { message?: string } | null)?.message || text.slice(0, 200) || response.statusText
    throw new Error(`Cashfree ${init.method} ${path} failed (${response.status}): ${detail}`)
  }

  return parsed as T
}

export async function createOrder(input: CashfreeOrderRequest): Promise<CashfreeOrderResponse> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error(`Order amount must be greater than zero (got ${input.amount})`)
  }

  return cashfreeFetch<CashfreeOrderResponse>("/orders", {
    method: "POST",
    body: {
      order_id: input.orderId,
      order_amount: Number(input.amount.toFixed(2)),
      order_currency: input.currency || "INR",
      customer_details: {
        customer_id: input.customerId,
        customer_name: input.customerName || "Nabri user",
        ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
        ...(input.customerPhone ? { customer_phone: input.customerPhone } : {}),
      },
      order_meta: {
        return_url: input.returnUrl,
        ...(input.paymentMethods ? { payment_methods: input.paymentMethods } : {}),
      },
    },
  })
}

/**
 * Verifies the proof the browser returns after checkout.
 *
 * Cashfree signs `order_id + payment_id` with the secret key. This proves the
 * browser is describing an order we created; it does NOT prove the money
 * arrived. Confirming that requires fetchOrder/fetchPayments against the API.
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const { secret } = requireCredentials();
  return isValidPaymentSignature(orderId, paymentId, signature, secret);
}

/**
 * Pure form of the above: takes the secret explicitly so it can be tested
 * without mutating process.env, which would re-trigger full env validation.
 */
export function isValidPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  if (!orderId || !paymentId || !signature || !secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}${paymentId}`)
    .digest("hex");

  // Constant-time compare: a plain === leaks the correct prefix via timing.
  return timingSafeEquals(expected, signature);
}

/**
 * Verifies an inbound webhook.
 *
 * MUST be called with the exact raw request bytes. Re-serialising the parsed
 * body produces different bytes and the HMAC will not match, which is why
 * app.ts captures req.rawBody before the JSON parser runs.
 *
 * Cashfree signs `timestamp + rawBody` and sends the result base64-encoded, so
 * the timestamp is part of the signed payload rather than metadata. A checksum
 * over the body alone would not match, and hex encoding would not either.
 *
 * The signing key is the same PG secret key used for API calls. If keys have
 * been rotated, this must be the oldest active key pair.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  timestamp: string | undefined
): boolean {
  const secret = env.CASHFREE_SECRET_KEY?.trim();
  if (!secret || !signature) return false;

  if (env.isProduction && isPlaceholder(secret)) {
    // Fail closed. An unset secret must never mean "accept anything", because
    // that is precisely the forged-payment path.
    throw new Error("CASHFREE_SECRET_KEY is a placeholder; refusing to trust webhooks");
  }

  return isValidWebhookSignature(rawBody, signature, secret, timestamp);
}

/** Pure form of the webhook check. See isValidPaymentSignature for rationale. */
export function isValidWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  secret: string,
  timestamp: string | undefined
): boolean {
  if (!signature || !secret || !timestamp) return false;

  const signedPayload = `${timestamp}${rawBody.toString()}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("base64");
  return timingSafeEquals(expected, signature);
}

function timingSafeEquals(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Authoritative order state, straight from Cashfree. */
export async function fetchOrder(orderId: string): Promise<CashfreeOrderResponse> {
  return cashfreeFetch<CashfreeOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  })
}

/** Authoritative payment list for an order. */
export async function fetchPayments(orderId: string): Promise<CashfreePayment[]> {
  const body = await cashfreeFetch<{ payments?: CashfreePayment[] } | CashfreePayment[]>(
    `/orders/${encodeURIComponent(orderId)}/payments`,
    { method: "GET" }
  )
  if (Array.isArray(body)) return body
  return Array.isArray(body?.payments) ? body.payments : []
}

export async function refund(
  orderId: string,
  paymentId: string,
  amount?: number,
  reason = "customer_request"
): Promise<{ refund_id: string; refund_status: string; refund_amount: number }> {
  return cashfreeFetch(`/orders/${encodeURIComponent(orderId)}/refunds`, {
    method: "POST",
    body: {
      refund_amount: amount ? Number(amount.toFixed(2)) : undefined,
      refund_reason: reason,
      refund_note: `refund for ${paymentId}`,
    },
  })
}

/** Terminal-success states reported by Cashfree. */
export function isSuccessfulStatus(status: string | undefined | null): boolean {
  const value = (status || "").toUpperCase()
  return value === "PAID" || value === "CAPTURED"
}

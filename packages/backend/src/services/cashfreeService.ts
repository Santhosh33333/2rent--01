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

// Cashfree keeps test and production on separate hosts with separate
// credentials, and a test key is rejected by the production host. Hardcoding the
// production URL meant there was no way to exercise the flow without real money,
// so the base is selectable: CASHFREE_API_ENV=test points at the sandbox.
const CASHFREE_API_IS_SANDBOX =
  (env.CASHFREE_API_ENV || "").trim().toLowerCase() === "test"
const CASHFREE_API_BASE = CASHFREE_API_IS_SANDBOX
  ? "https://sandbox.cashfree.com/pg"
  : "https://api.cashfree.com/pg"
// The header is `x-api-version`. An earlier `x-cf-version` was silently ignored
// by Cashfree, which would have left every order call on a default API version.
// Pinning the version explicitly keeps order, fetch and refund calls on the same
// contract.
export const CASHFREE_API_VERSION = "2025-01-01"

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
  /**
   * Cashfree does not return one single checkout field across API versions.
   * Older versions answer with `payment_url`; from 2023-08-01 the supported
   * checkout link is `payment_links.web`, and current versions also return a
   * `payment_session_id` for the hosted SDK. Reading only `payment_url` (as
   * this did) produced orders that succeeded server-side and then handed the
   * client no way to pay, which is indistinguishable from the order having
   * failed at all.
   */
  payment_url?: string
  payment_links?: { web?: string; android?: string; ios?: string }
  payment_session_id?: string
  order_token?: string
  cf_order_id?: string
  order_expiry_time?: string
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
  init: { method: string; body?: unknown; extraHeaders?: Record<string, string> },
  timeoutMs = 12000,
  /**
   * Order Pay is declared `security: []` in Cashfree's spec: it is authorised by
   * the session id alone. Sending the merchant secret to an endpoint that does
   * not need it would widen the blast radius of a mistake here for no gain, so
   * it can be called unauthenticated.
   */
  withAuth = true
): Promise<T> {
  const { appId, secret } = withAuth ? requireCredentials() : { appId: "", secret: "" }

  const response = await withTimeout(
    fetch(`${CASHFREE_API_BASE}${path}`, {
      method: init.method,
      headers: {
        ...(withAuth ? headers(appId, secret) : { "x-api-version": CASHFREE_API_VERSION }),
        "Content-Type": "application/json",
        ...(init.extraHeaders || {}),
      },
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

    // A 401/403 on a signed request almost always means the credentials are
    // wrong, not that the order was malformed. Say so explicitly, because the
    // generic "authentication Failed" from Cashfree is identical whether the
    // secret is truncated, belongs to another account, or is still a dashboard
    // placeholder -- and the operator needs to know it is a credentials problem
    // before hunting for a code bug.
    if ((response.status === 401 || response.status === 403) && withAuth) {
      console.error(
        `[CASHFREE] ${init.method} ${path} -> ${response.status} ${detail}. ` +
          "Credentials rejected: check CASHFREE_APP_ID and CASHFREE_SECRET_KEY match each " +
          "other, are not placeholders, and belong to this Cashfree account."
      )
    }

    throw new Error(`Cashfree ${init.method} ${path} failed (${response.status}): ${detail}`)
  }

  return parsed as T
}

export async function createOrder(input: CashfreeOrderRequest): Promise<CashfreeOrderResponse> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error(`Order amount must be greater than zero (got ${input.amount})`)
  }

  // Cashfree documents customer_phone as a required member of customer_details
  // and rejects the whole order when it is absent. Sending an order without it
  // produced a bare 500 from /orders, so refuse locally with a precise reason
  // instead of spending a network round trip on a guaranteed rejection.
  if (!input.customerPhone) {
    throw new Error(
      "Cashfree requires customer_phone; this user has no usable phone number on file."
    )
  }
  // Cashfree documents the return_url as needing an {order_id} placeholder so
  // the payer can be matched to the order on the way back. A URL without one
  // (or one pointing at loopback) is a silent production hazard: the order may
  // be created but the payer is never returned to a real page afterwards.
  if (!input.returnUrl) {
    throw new Error("Cashfree requires order_meta.return_url; none was configured.")
  }
  if (!input.returnUrl.includes("{order_id}")) {
    throw new Error("order_meta.return_url must contain the {order_id} placeholder.")
  }
  // Loopback is only a hazard when real money is involved. A sandbox order
  // created with a localhost return_url is exactly how the flow is meant to be
  // tested on a developer machine, and refusing it made the sandbox untestable
  // from local without also standing up a public origin. So the refusal is
  // scoped to the live host, where a payer would be stranded on 127.0.0.1 after
  // paying.
  if (!CASHFREE_API_IS_SANDBOX) {
    let returnUrlHost: string
    try {
      returnUrlHost = new URL(input.returnUrl.replace("{order_id}", "probe")).hostname
    } catch {
      throw new Error("order_meta.return_url is not a valid absolute URL.")
    }
    if (returnUrlHost === "localhost" || returnUrlHost === "127.0.0.1" || returnUrlHost === "::1") {
      throw new Error(
        `Refusing to create a live order with a loopback return_url (${returnUrlHost}). ` +
          "Set PUBLIC_ORIGIN to the public https site, or use CASHFREE_API_ENV=test to test on the sandbox."
      )
    }
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

export interface CashfreeSessionResponse {
  payment_method?: string
  channel?: string
  action?: string
  cf_payment_id?: string
  payment_amount?: number
  data?: { url?: string; content_type?: string; method?: string }
}

/**
 * Ask Cashfree for a hosted UPI page and return its URL.
 *
 * Create Order only yields a `payment_session_id`; on current API versions
 * that session is not itself a link, so an order created on its own leaves the
 * customer with nothing to open. Order Pay with `upi.channel: "link"` turns the
 * session into a hosted checkout the customer can pay by UPI (intent/collect
 * handled by Cashfree) and answers with `action: "link"` plus `data.url`.
 *
 * `link` is the channel that suits an unknown VPA. `collect` would need the
 * customer to already have typed their UPI id into our form, which is the
 * manual flow this replaces.
 *
 * Returns undefined instead of throwing when no link is produced: the session
 * id remains a valid handle for a client-side checkout, so the order itself is
 * still usable and only the convenience link is missing.
 */
export async function createHostedUpiCheckout(
  paymentSessionId: string,
  orderId: string
): Promise<string | undefined> {
  if (!paymentSessionId) return undefined

  let session: CashfreeSessionResponse
  try {
    session = await cashfreeFetch<CashfreeSessionResponse>(
      "/orders/sessions",
      {
        method: "POST",
        body: {
          payment_session_id: paymentSessionId,
          payment_method: { upi: { channel: "link" } },
        },
        // Keyed by order id so a retried create-order cannot open a second
        // payment attempt against the same order.
        extraHeaders: { "x-idempotency-key": `${orderId}` },
      },
      12000,
      false
    )
  } catch (err) {
    console.warn(
      `[CASHFREE] Hosted UPI link unavailable for order ${orderId}:`,
      err instanceof Error ? err.message : err
    )
    return undefined
  }

  const url = session?.data?.url
  if (session?.action === "link" && url) return url

  console.warn(
    `[CASHFREE] Order Pay for ${orderId} returned action=${session?.action} ` +
      `with no usable link; falling back to session checkout.`
  )
  return undefined
}

/** Terminal-success states reported by Cashfree. */
export function isSuccessfulStatus(status: string | undefined | null): boolean {
  const value = (status || "").toUpperCase()
  return value === "PAID" || value === "CAPTURED"
}

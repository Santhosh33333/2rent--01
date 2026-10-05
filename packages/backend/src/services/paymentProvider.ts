/**
 * Provider-agnostic payment layer.
 *
 * Both the wallet top-up flow and the booking flow need the same thing: create
 * an order at a gateway, and later turn whatever the browser sends back into a
 * statement of fact that money actually arrived. Keeping that in one place
 * means the security rules cannot drift between the two flows.
 *
 * The central rule: the browser is never trusted. It may tell us which payment
 * and which order it is talking about, but every fact used to move money
 * (amount, currency, status) is read back from the gateway, and the whole
 * outcome is re-checked against the order we stored ourselves.
 */
import crypto from "crypto";
import { env } from "../config/env";
import { getStringConfig } from "./pricingEngine";
import * as cashfreeService from "./cashfreeService";

/**
 * Cashfree is the only gateway the code has ever had left after Razorpay was
 * removed. It is now RETIRED: payments are collected manually against the
 * platform UPI QR and credited after an admin verifies the bank statement.
 *
 * The gateway code is still here because the schema, the refund engine and the
 * historical order ledger all reference it, but it is unreachable unless an
 * admin explicitly sets PAYMENT_MODE="gateway" (see below). The provider name is
 * still "cashfree" because that string is persisted on existing rows; renaming
 * it would mean a data migration for no behavioural gain.
 */
export type Provider = "cashfree";

export const ACTIVE_PROVIDER: Provider = "cashfree";

/** Why a verification attempt was refused. Mapped to an API error code. */
export type VerifyFailure =
  | "MISSING_PARAMS"
  | "INVALID_SIGNATURE"
  | "NOT_CAPTURED"
  | "AMOUNT_MISMATCH"
  | "CURRENCY_MISMATCH"
  | "GATEWAY_UNAVAILABLE"
  | "NO_MATCHING_PAYMENT";

export class PaymentVerificationError extends Error {
  constructor(
    public readonly reason: VerifyFailure,
    message: string
  ) {
    super(message);
    this.name = "PaymentVerificationError";
  }
}

export interface CreateOrderInput {
  /** Stable, unique-per-attempt id we choose; becomes the gateway order id. */
  orderId: string;
  amountRupees: number;
  customerId: string;
  customerEmail?: string;
  customerPhone?: string;
  customerName?: string;
  description: string;
  metadata?: Record<string, unknown>;
  currency?: string;
  /** Cashfree needs this to offer UPI intent deep links. Harmless elsewhere. */
  returnUrl?: string;
}

export interface CreatedOrder {
  provider: Provider;
  gatewayOrderId: string;
  amountRupees: number;
  currency: string;
  /** Cashfree returns a hosted checkout URL the browser is sent to. */
  paymentUrl?: string;
  sessionId?: string;
}

export interface VerifyInput {
  provider: Provider;
  gatewayOrderId: string;
  gatewayPaymentId?: string;
  /** Signature from the browser. Verified when the provider supplies one. */
  signature?: string;
  /** The amount and currency we recorded when we created the order. */
  expectedAmountRupees: number;
  expectedCurrency: string;
}

export interface VerifiedPayment {
  provider: Provider;
  gatewayPaymentId: string;
  amountRupees: number;
  currency: string;
}

/**
 * True when the gateway is usable. Callers must not fall back to a fake
 * "success" when this is false.
 */
export function isGatewayConfigured(provider: Provider = ACTIVE_PROVIDER): boolean {
  if (provider !== "cashfree") return false;
  const appId = (env.CASHFREE_APP_ID || "").trim();
  const secret = (env.CASHFREE_SECRET_KEY || "").trim();
  return Boolean(appId && secret) && !appId.includes("placeholder") && !secret.includes("placeholder");
}

// ============================================================================
// PAYMENT MODE
// ============================================================================

export const PAYMENT_MODE_KEY = "PAYMENT_MODE";

/** Online checkout. Reachable only when an admin sets the mode to this value. */
export const GATEWAY_MODE = "gateway";

/** Pay against the platform UPI QR, credited once an admin verifies the UTR. */
export const MANUAL_UPI_MODE = "manual_upi";

/**
 * Manual UPI is the default, not the gateway.
 *
 * This is the one default that has to be safe rather than convenient: an unset
 * or unreadable mode previously meant "gateway", so a missing config row sent
 * users to hosted checkout that could not complete. Defaulting to manual UPI
 * means the worst case is a slower payment, never a dead end or a charge the
 * platform cannot verify.
 */
export const DEFAULT_PAYMENT_MODE = MANUAL_UPI_MODE;

/**
 * Which rails are live: the hosted gateway, or manual UPI settled by an admin.
 *
 * isGatewayConfigured only asks whether credentials exist. That is necessary but
 * not sufficient - a gateway can be fully configured and still not be usable,
 * because the merchant account behind it is not activated. That is exactly the
 * state a merchant is in while onboarding is still being reviewed, and it is
 * invisible from here: keys are present, so the app keeps sending users to a
 * checkout that cannot complete.
 *
 * So the mode is a separate, admin-set switch. "gateway" means online checkout,
 * "manual_upi" means collect against the platform QR and credit on verification.
 * Both the order and verify paths consult it, so turning it off cannot leave an
 * order that no longer has anywhere to be paid.
 *
 * Cashfree is retired and its credentials are no longer deployed, so selecting
 * "gateway" today resolves to isGatewayConfigured() === false and the gateway
 * stays off regardless. Turning it back on therefore takes two deliberate acts -
 * setting the mode AND restoring keys - not one.
 */
export async function getPaymentMode(): Promise<string> {
  return getStringConfig(PAYMENT_MODE_KEY, DEFAULT_PAYMENT_MODE);
}

/**
 * True only when online checkout can actually be completed right now: the admin
 * has not switched to manual UPI, and credentials are present.
 *
 * This is the check the payment paths must use. isGatewayConfigured stays for
 * "are the keys there", which is a weaker and separately useful question.
 */
export async function isGatewayLive(provider: Provider = ACTIVE_PROVIDER): Promise<boolean> {
  if ((await getPaymentMode()) !== GATEWAY_MODE) return false;
  return isGatewayConfigured(provider);
}

/**
 * Why online checkout is unavailable, or null when it is available.
 *
 * One place decides this so the three payment paths cannot drift into telling
 * the user different things. The distinction matters to the client: "not
 * configured" is an operator problem, while "switched off" is the deliberate,
 * working state where the correct next step is to pay against the UPI QR - so
 * the app can offer that instead of showing an error.
 */
export async function gatewayUnavailableReason(
  provider: Provider = ACTIVE_PROVIDER
): Promise<"switched_off" | "not_configured" | null> {
  if ((await getPaymentMode()) !== GATEWAY_MODE) return "switched_off";
  if (!isGatewayConfigured(provider)) return "not_configured";
  return null;
}

// ============================================================================
// ORDER CREATION
// ============================================================================

export async function createGatewayOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const amountRupees = Number(input.amountRupees);
  // Validate before any network call so a bad amount can never become a charge.
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    throw new Error("Order amount must be greater than zero.");
  }

    const order = await cashfreeService.createOrder({
      orderId: input.orderId,
      amount: amountRupees,
      customerId: input.customerId,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      customerName: input.customerName,
      returnUrl: input.returnUrl,
    });

    // Create Order hands back a session, not a link. Without this the order
    // exists but the customer has nothing to open, so every client that
    // redirects to a hosted page (web and the mobile browser) is dead on
    // arrival. Best-effort: a missing link still leaves a usable session.
    const hostedLink = await cashfreeService.createHostedUpiCheckout(
      order.payment_session_id || "",
      order.order_id
    );

    return {
      provider: "cashfree",
      gatewayOrderId: order.order_id,
      amountRupees: order.order_amount,
      currency: order.order_currency,
      paymentUrl: hostedLink || order.payment_url || order.payment_links?.web || undefined,
      sessionId: order.payment_session_id || undefined,
    };
}

// ============================================================================
// VERIFICATION - the security-critical half
// ============================================================================

/**
 * Turns a client callback into a fact about money that actually arrived.
 *
 * Throws PaymentVerificationError on every refusal. There is deliberately no
 * "verified = false, carry on" path, because every caller would have to decide
 * what to do with a false that might be a failure or might be a forgery, and
 * getting that decision wrong is how wallets get over-credited.
 */
export async function verifyGatewayPayment(input: VerifyInput): Promise<VerifiedPayment> {
  return verifyCashfree(input);
}

async function verifyCashfree(input: VerifyInput): Promise<VerifiedPayment> {
  if (!input.gatewayOrderId) {
    throw new PaymentVerificationError("MISSING_PARAMS", "Missing payment verification details.");
  }

  // Step 1: if the client sent a payment id, its signature must be genuine.
  // Cashfree's signature covers orderId+paymentId, so a mismatch means the
  // client is describing an order that is not ours.
  if (input.gatewayPaymentId) {
    if (!input.signature) {
      throw new PaymentVerificationError("MISSING_PARAMS", "Missing payment signature.");
    }
    if (!cashfreeService.verifyPaymentSignature(input.gatewayOrderId, input.gatewayPaymentId, input.signature)) {
      throw new PaymentVerificationError("INVALID_SIGNATURE", "Payment verification failed.");
    }
  }

  // Step 2: ask Cashfree what actually happened. This is the authoritative
  // step; the client callback above is only a hint about which payment to look
  // for. We deliberately do not let the client's payment id select the record
  // without also confirming it is on our order.
  const payments = await cashfreeService
    .fetchPayments(input.gatewayOrderId)
    .catch(() => null);

  if (!payments) {
    throw new PaymentVerificationError(
      "GATEWAY_UNAVAILABLE",
      "Payment verification is temporarily unavailable. Please retry."
    );
  }

  const successful = payments.filter((p) => cashfreeService.isSuccessfulStatus(p.payment_status));
  if (successful.length === 0) {
    throw new PaymentVerificationError("NOT_CAPTURED", "Payment not captured.");
  }

  // When the client named a payment, use that one; otherwise take the gateway's
  // own successful payment for the order.
  const payment = input.gatewayPaymentId
    ? successful.find((p) => p.payment_id === input.gatewayPaymentId)
    : successful[0];

  if (!payment) {
    // The signature was valid for a payment that is not a successful payment
    // on this order. Treat as forged rather than "not captured".
    throw new PaymentVerificationError("NO_MATCHING_PAYMENT", "Payment verification failed.");
  }

  const amountRupees = Number(payment.payment_amount);
  const currency = normalizeCurrency(payment.payment_currency);
  assertAmountAndCurrency(amountRupees, input.expectedAmountRupees, currency, input.expectedCurrency);

  return {
    provider: "cashfree",
    gatewayPaymentId: payment.payment_id,
    amountRupees,
    currency,
  };
}

/**
 * Amount and currency are compared in integer minor units.
 *
 * Comparing floats is how ₹99.9999999 ends up "equal" to ₹100. Working in
 * paise means the two sides are always integers, so the comparison is exact.
 */
function assertAmountAndCurrency(
  actualRupees: number,
  expectedRupees: number,
  actualCurrency: string,
  expectedCurrency: string
): void {
  const actualMinor = toMinorUnits(actualRupees);
  const expectedMinor = toMinorUnits(expectedRupees);

  if (!Number.isFinite(actualMinor)) {
    throw new PaymentVerificationError("AMOUNT_MISMATCH", "Gateway returned an unusable amount.");
  }
  if (actualMinor !== expectedMinor) {
    throw new PaymentVerificationError("AMOUNT_MISMATCH", "Amount mismatch.");
  }
  if (normalizeCurrency(actualCurrency) !== normalizeCurrency(expectedCurrency)) {
    throw new PaymentVerificationError("CURRENCY_MISMATCH", "Currency mismatch.");
  }
}

export function toMinorUnits(rupees: number): number {
  return Math.round(Number(rupees) * 100);
}

function normalizeCurrency(currency: string | undefined | null): string {
  return (currency || "INR").trim().toUpperCase();
}

/** Signature verification for an inbound webhook, dispatched by provider. */
export function verifyInboundWebhook(
  provider: Provider,
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>
): boolean {
  if (provider !== "cashfree") return false;
  const signature = firstHeader(headers["x-webhook-signature"]);
  // The timestamp is part of Cashfree's signed payload, not just metadata.
  const timestamp = firstHeader(headers["x-webhook-timestamp"]);
  return cashfreeService.verifyWebhookSignature(rawBody, signature, timestamp);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Random suffix so two orders created in the same second cannot collide. */
export function buildOrderId(prefix: string, seed: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Reduce a stored phone number to the bare 10-digit national form payment
 * gateways document. Returns null when there is no usable 10-digit number so
 * callers can refuse up front rather than send a request the gateway rejects
 * wholesale, which is how a simple top-up used to surface as an opaque 500.
 */
export function normalizeIndianPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  // Strip a leading country code so +91 / 91 prefixes land on the same 10 digits.
  const national = digits.length > 10 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(national) ? national : null;
}

/**
 * Customer names go to the gateway as a no-special-characters field, so reduce
 * punctuation rather than letting a decorative apostrophe or ampersand cause a
 * whole-order rejection.
 */
export function sanitizeCashfreeName(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 60) : undefined;
}

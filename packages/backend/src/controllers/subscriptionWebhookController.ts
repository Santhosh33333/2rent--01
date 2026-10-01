import { Request, Response } from "express";
import { prisma } from "../config/database";
import { verifyInboundWebhook } from "../services/paymentProvider";

/**
 * Cashfree subscription webhooks.
 *
 * Unauthenticated by design: authenticity comes from the signature over the raw
 * body, exactly like the payment webhook. Always answer 200 on a valid
 * signature even when the subscription is unknown, so Cashfree does not retry
 * into a loop for an id we already ignored.
 *
 * Subscription state is the authority for premium access. Never grant
 * entitlement from the browser's return URL.
 */

type SubscriptionEvent =
  | "SUBSCRIPTION_AUTH_STATUS"
  | "SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED"
  | "SUBSCRIPTION_PAYMENT_SUCCESS"
  | "SUBSCRIPTION_PAYMENT_FAILED"
  | "SUBSCRIPTION_PAYMENT_CANCELLED";

function rawBodyOf(req: Request): string | Buffer | undefined {
  const rb = (req as Request & { rawBody?: string | Buffer }).rawBody;
  if (rb) return rb;
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body;
  return req.body ? JSON.stringify(req.body) : undefined;
}

async function applyAuthStatus(subscriptionId: string, event: Record<string, unknown>) {
  const content = (event?.content as Record<string, unknown>) ?? {};
  const authStatus = String(content.authorization_status ?? "").toUpperCase();
  const subStatus = String(content.subscription_status ?? "").toUpperCase();

  await prisma.subscription.updateMany({
    where: { subscriptionId },
    data: {
      authorizationStatus: authStatus || undefined,
      ...(subStatus ? { status: subStatus } : {}),
      ...(subStatus === "ACTIVE" ? { startedAt: new Date() } : {}),
    },
  });
}

async function applyPaymentOutcome(
  subscriptionId: string,
  event: Record<string, unknown>,
  success: boolean,
) {
  const content = (event?.content as Record<string, unknown>) ?? {};

  await prisma.subscription.updateMany({
    where: { subscriptionId },
    data: {
      // A failed recurring debit does not cancel the mandate; Cashfree moves
      // the subscription to ON_HOLD and may retry (UPI only).
      ...(success ? { status: "ACTIVE", startedAt: new Date() } : { status: "ON_HOLD" }),
    },
  });

  // Next billing is driven off the gateway's own schedule, not our clock.
  const schedule = content.payment_schedule_date;
  if (success && typeof schedule === "string") {
    const next = new Date(schedule);
    if (!Number.isNaN(next.getTime())) {
      await prisma.subscription.updateMany({
        where: { subscriptionId },
        data: { nextBillingAt: next },
      });
    }
  }
}

export async function subscriptionWebhook(req: Request, res: Response): Promise<void> {
  const raw = rawBodyOf(req);
  if (!raw) {
    res.status(400).json({ received: false, reason: "Raw body unavailable" });
    return;
  }

  if (!verifyInboundWebhook("cashfree", raw, req.headers)) {
    // Log loudly: a rejected subscription webhook means an entitlement change
    // was missed, and Cashfree will not retry after a 2xx.
    const rejectedContent = (req.body?.content ?? {}) as Record<string, unknown>;
    const subscriptionId = String(rejectedContent.subscription_id ?? "unknown");
    console.error(
      `[cashfree-subscription-webhook] SIGNATURE REJECTED - subscription ` +
        `${subscriptionId} state was NOT applied. Check CASHFREE_SECRET_KEY is the ` +
        `oldest active key pair and that CASHFREE_API_ENV matches the configured keys.`,
    );
    res.status(200).json({ received: false, reason: "Invalid signature" });
    return;
  }

  const event = (req.body ?? {}) as Record<string, never>;
  const type = String(event.type ?? "").toUpperCase() as SubscriptionEvent;
  const content = (event.content ?? {}) as Record<string, never>;
  const subscriptionId = String(content.subscription_id ?? "");

  if (!subscriptionId) {
    res.status(200).json({ received: true, applied: false, reason: "No subscription id" });
    return;
  }

  try {
    switch (type) {
      case "SUBSCRIPTION_AUTH_STATUS":
        await applyAuthStatus(subscriptionId, event);
        break;
      case "SUBSCRIPTION_PAYMENT_SUCCESS":
        await applyPaymentOutcome(subscriptionId, event, true);
        break;
      case "SUBSCRIPTION_PAYMENT_FAILED":
        await applyPaymentOutcome(subscriptionId, event, false);
        break;
      case "SUBSCRIPTION_PAYMENT_CANCELLED":
        await prisma.subscription.updateMany({
          where: { subscriptionId },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        break;
      case "SUBSCRIPTION_PAYMENT_NOTIFICATION_INITIATED":
        // Pre-debit notice only. Nothing to mutate.
        break;
      default:
        res.status(200).json({ received: true, applied: false, reason: "Unhandled event" });
        return;
    }

    res.status(200).json({ received: true, applied: true });
  } catch (error) {
    // 500 makes Cashfree retry. Prefer that over silently dropping state.
    console.error(
      `[cashfree-subscription-webhook] failed to apply ${type} for ${subscriptionId}`,
      error,
    );
    res.status(500).json({ received: false, reason: "Apply failed" });
  }
}

export async function subscriptionWebhookHealth(_req: Request, res: Response): Promise<void> {
  // Never leak a count to an unauthenticated endpoint.
  res.status(200).json({ ok: true });
}
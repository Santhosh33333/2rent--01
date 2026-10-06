import { Response } from "express";
import * as subscriptionService from "../services/subscriptionService";
import * as subscriptionBilling from "../services/subscriptionBillingService";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { buildHourlyQr } from "../services/upiQr";
import { findReferenceConflict, referenceConflictMessage } from "../services/referenceUniqueness";

function fail(res: Response, error: unknown, fallback: string) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "PLAN_NOT_FOUND":
      sendError(res, "That plan is not available.", 404, code);
      return;
    case "SUBSCRIPTION_NOT_FOUND":
      sendError(res, "No active subscription found.", 404, code);
      return;
    case "INVALID_INTERVAL":
    case "INVALID_AMOUNT":
      sendError(res, "Plan configuration is invalid.", 400, code);
      return;
    // 503, not 500: nothing is broken, there is simply no rail configured to take
    // a recurring payment. The client shows this verbatim instead of a generic
    // failure, so "subscribe does nothing" becomes a sentence the user can read.
    case "SUBSCRIPTIONS_UNAVAILABLE":
      sendError(
        res,
        "Subscriptions are not available right now. Please contact support.",
        503,
        code,
      );
      return;
    default:
      sendError(res, fallback, 500, "SUBSCRIPTION_ERROR");
  }
}

/** GET /subscriptions/plans - the only pricing source the frontend may read. */
export async function listPlans(req: AuthedRequest, res: Response): Promise<void> {
  try {
    // The route sits above authenticateToken so the paywall renders before
    // login, which means req.user is often absent. getActivePlans treats that
    // as a prospective new account; passing a session lets it answer for real.
    const plans = await subscriptionService.getActivePlans(req.user?.userId);
    sendSuccess(res, { plans });
  } catch {
    sendError(res, "Could not load plans.", 500, "PLANS_FAILED");
  }
}

/** GET /subscriptions/me - plan, trial status, next billing date. */
export async function getMySubscription(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const trial = await subscriptionService.getTrialState(userId);
    const isActive = await subscriptionService.hasActiveSubscription(userId);
    sendSuccess(res, { ...trial, isActive });
  } catch {
    sendError(res, "Could not load subscription.", 500, "SUBSCRIPTION_FETCH_FAILED");
  }
}

/**
 * POST /subscriptions/subscribe
 *
 * Collects the plan price: from the wallet when the balance covers it, otherwise
 * by opening a manual-UPI request and returning the QR details. The response
 * says which happened in `source`, because the two need different next steps -
 * one is already active, the other is waiting on the user to pay and an admin to
 * verify.
 *
 * Never returns a gateway session id: there is no hosted checkout any more.
 */
export async function subscribe(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const { planCode } = req.body;
    if (!planCode || typeof planCode !== "string") {
      sendError(res, "Plan code is required.", 400, "PLAN_REQUIRED");
      return;
    }

    const plan = await subscriptionService.getPlanByCode(planCode);

    // An already-live plan must not be charged twice by a double-tap or a retry.
    const live = await prisma.subscription.findFirst({
      where: { userId, planId: plan.id, status: { in: ["ACTIVE", "PAST_DUE", "INITIALIZED", "PENDING"] } },
      select: { id: true, status: true },
    });
    if (live) {
      sendError(
        res,
        live.status === "ACTIVE"
          ? "You already have this plan active."
          : "You already have a payment pending for this plan.",
        409,
        "SUBSCRIPTION_EXISTS",
      );
      return;
    }

    // Resolved before the row below exists, not after. This account holding a
    // subscription is exactly what ends its eligibility for the new-user price,
    // so checking afterwards would read its own write and always answer
    // "returning" - charging first-timers the ordinary rate forever.
    const pricing = await subscriptionService.resolveFirstPeriodPrice(plan, userId);

    const subscription = await prisma.subscription.create({
      data: {
        // Kept for the legacy unique column and for the reference the admin queue
        // shows. No longer a gateway id - nothing polls Cashfree for it.
        subscriptionId: `nabri_sub_${userId.slice(0, 8)}_${Date.now()}`,
        userId,
        planId: plan.id,
        status: "PENDING",
        authorizationStatus: "PENDING",
      },
    });

    const collected = await subscriptionBilling.collectForPeriod({
      userId,
      subscriptionId: subscription.id,
      planId: plan.id,
      // What this account was quoted for its first period, which the pricing
      // screen drew before they tapped subscribe. Renewals never come through
      // here: by then the subscription exists, so it is no longer a first period.
      amount: pricing.amount,
      planDays: plan.durationDays,
      planName: plan.name,
      kind: "activated",
    });

    if (collected.source === "WALLET") {
      sendSuccess(
        res,
        {
          source: "WALLET",
          plan: { code: plan.code, name: plan.name, price: pricing.amount, currency: plan.currency },
          offerApplied: pricing.offerApplied,
          amount: collected.amount,
          periodStart: collected.periodStart,
          periodEnd: collected.periodEnd,
          walletBalance: collected.walletBalance,
          active: true,
        },
        "Payment taken from your wallet. Your plan is active.",
      );
      return;
    }

    sendSuccess(
      res,
      {
        source: "UPI",
        plan: { code: plan.code, name: plan.name, price: pricing.amount, currency: plan.currency },
        offerApplied: pricing.offerApplied,
        amount: collected.amount,
        periodStart: collected.periodStart,
        periodEnd: collected.periodEnd,
        paymentId: collected.paymentId,
        active: false,
      },
      "Your wallet balance was too low. Pay by UPI to activate the plan.",
    );
  } catch (error) {
    fail(res, error, "Could not start subscription.");
  }
}

/** POST /subscriptions/cancel - cancellation is never hidden. */
export async function cancel(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const result = await subscriptionService.cancelUserSubscription(
      userId,
      typeof req.body?.reason === "string" ? req.body.reason : undefined,
    );
    sendSuccess(res, result, "Subscription cancelled.");
  } catch (error) {
    fail(res, error, "Could not cancel subscription.");
  }
}

/**
 * GET /subscriptions/payments/:id/upi-details
 *
 * The QR for a plan payment the wallet could not cover. Separate from the
 * subscribe response because the user may reload, close the tab, or come back
 * tomorrow - the amount owed lives on the payment row, so the QR can always be
 * rebuilt from it.
 *
 * The reference rotates hourly, exactly as it does for bookings, so a screenshot
 * taken yesterday cannot be matched to a payment made today.
 */
export async function getSubscriptionUpiDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const { id } = req.params;
    const payment = await prisma.subscriptionPayment.findUnique({
      where: { id },
      include: { plan: { select: { name: true, code: true } } },
    });
    if (!payment) {
      sendError(res, "Payment request not found.", 404, "NOT_FOUND");
      return;
    }
    if (payment.userId !== userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }
    if (payment.status !== "VERIFICATION_PENDING") {
      // Nothing left to pay. Saying so is more useful than another QR, which a
      // user could still scan and lose money on.
      sendSuccess(
        res,
        { status: payment.status, payable: false },
        `This payment is already ${String(payment.status).toLowerCase()}.`,
      );
      return;
    }

    const [upiId, name, qr] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_QR_URL" } }),
    ]);
    if (!upiId?.value) {
      sendError(
        res,
        "UPI payment is not configured by the admin yet. You can top up your wallet instead.",
        503,
        "UPI_NOT_CONFIGURED",
      );
      return;
    }

    const dynamicQr = buildHourlyQr({
      payeeVpa: upiId.value,
      payeeName: name?.value ?? null,
      amount: Number(payment.amount),
      note: `Nabri ${payment.plan.name}`,
      scope: payment.id,
    });

    sendSuccess(
      res,
      {
        payable: true,
        paymentId: payment.id,
        upiId: upiId.value,
        accountName: name?.value ?? null,
        qrUrl: qr?.value ?? null,
        upiUri: dynamicQr.upiUri,
        qrReference: dynamicQr.reference,
        qrExpiresAt: dynamicQr.expiresAt,
        qrExpiresInSeconds: dynamicQr.expiresInSeconds,
        amount: Number(payment.amount),
        currency: payment.currency,
        planName: payment.plan.name,
        status: payment.status,
        referenceNumber: payment.referenceNumber,
        // The bank still has to confirm this, so the plan is not active yet.
        active: false,
      },
      "Scan the QR, pay externally, then enter the UTR/reference number.",
    );
  } catch (err) {
    console.error("getSubscriptionUpiDetails error:", err);
    sendError(res, "Failed to load UPI details.", 500, "INTERNAL_ERROR");
  }
}

/**
 * POST /subscriptions/payments/:id/reference
 *
 * The user submits the UTR after paying externally. It is stored against the
 * payment so an admin has the reference to match, but it never activates the
 * plan - only verifying against the bank statement does that.
 */
export async function submitSubscriptionReference(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const { id } = req.params;
    const referenceNumber = (req.body?.referenceNumber ?? "").toString().trim();
    if (!referenceNumber || referenceNumber.length < 6) {
      sendError(res, "Enter a valid UTR / reference number (min 6 chars).", 400, "INVALID_REFERENCE");
      return;
    }

    const payment = await prisma.subscriptionPayment.findUnique({ where: { id } });
    if (!payment) {
      sendError(res, "Payment request not found.", 404, "NOT_FOUND");
      return;
    }
    if (payment.userId !== userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }
    if (payment.status !== "VERIFICATION_PENDING") {
      sendError(
        res,
        `This payment is already ${String(payment.status).toLowerCase()}.`,
        409,
        "ALREADY_SUBMITTED",
      );
      return;
    }

    // Checked before storing because the unique index only guards this one table,
    // and one bank line must never settle two requests. `excludeId` is this row:
    // re-submitting the reference it already holds is not a clash, and without
    // the exclusion a user correcting nothing would be told their own UTR was
    // taken.
    const conflict = await findReferenceConflict(referenceNumber, { excludeId: id });
    if (conflict) {
      sendError(res, referenceConflictMessage(conflict), 409, "REFERENCE_ALREADY_USED");
      return;
    }

    await prisma.subscriptionPayment.update({
      where: { id },
      data: { referenceNumber },
    });
    sendSuccess(res, { status: "VERIFICATION_PENDING", referenceNumber }, "Reference received. We are verifying it now.");
  } catch (err) {
    console.error("submitSubscriptionReference error:", err);
    sendError(res, "Failed to save the reference.", 500, "INTERNAL_ERROR");
  }
}

/** POST /subscriptions/change-plan */
export async function changePlan(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const { planCode } = req.body;
    if (!planCode || typeof planCode !== "string") {
      sendError(res, "Plan code is required.", 400, "PLAN_REQUIRED");
      return;
    }
    const result = await subscriptionService.changeUserPlan(userId, planCode);
    sendSuccess(res, result, "Plan updated.");
  } catch (error) {
    fail(res, error, "Could not change plan.");
  }
}
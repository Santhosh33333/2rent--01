import { Response } from "express";
import * as subscriptionService from "../services/subscriptionService";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

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
    default:
      sendError(res, fallback, 500, "SUBSCRIPTION_ERROR");
  }
}

/** GET /subscriptions/plans - the only pricing source the frontend may read. */
export async function listPlans(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const plans = await subscriptionService.getActivePlans();
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
 * Returns the session id the hosted checkout SDK needs. This does NOT activate
 * anything: entitlement starts only when the mandate webhook confirms it.
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

    const profile = req.user as { email?: string; phone?: string; fullName?: string };
    const result = await subscriptionService.startSubscription({
      userId,
      planCode,
      email: profile.email ?? "",
      phone: profile.phone ?? "",
      fullName: profile.fullName ?? "",
    });

    if (!result.subscriptionSessionId) {
      sendError(
        res,
        "Payment session could not be created. Contact support if this persists.",
        502,
        "SESSION_CREATE_FAILED",
      );
      return;
    }

    sendSuccess(res, result, "Complete the payment to activate your plan.");
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
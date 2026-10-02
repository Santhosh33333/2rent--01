import type { NextFunction, Response } from "express";
import { AuthedRequest } from "./authTypes";
import { hasAccess } from "../services/refundService";

/**
 * Gate the paid surface on the local access window.
 *
 * Paid access is a timestamp on the user, not a Cashfree subscription mandate.
 * The mandate route cannot be satisfied while Subscriptions is inactive on the
 * merchant account, so gating on it locked every user out. When Cashfree
 * Subscriptions is activated, this is the one place that changes: add the
 * mandate as an alternative source of truth rather than replacing the window.
 *
 * Deliberately a 403 with a machine-readable code and a timestamp, not a
 * redirect. The client needs to distinguish "expired, offer renewal" from "not
 * allowed" in order to show the paywall instead of a generic error.
 *
 * The clock is read, never cached: the whole point is that access ends by
 * itself with no cron and no provider call. A cached decision would outlive the
 * window it was based on.
 *
 * Admins are exempt by role inside hasAccess. Staff need the gated features to
 * do their jobs, and a platform that paywalls its own administrators is a
 * lockout discovered in production rather than in review.
 */
export function requirePaidAccess(
  _req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  void (async () => {
    try {
      const userId = _req.user!.userId;
      if (await hasAccess(userId)) {
        next();
        return;
      }
      res.status(403).json({
        success: false,
        error: {
          code: "PAID_ACCESS_REQUIRED",
          message:
            "Your access has expired. Renew to keep using this feature.",
          // Lets the client show the exact shortfall rather than guessing.
          renewUrl: "/subscription",
        },
      });
    } catch {
      // Fail closed on a database error. Failing open here would silently grant
      // premium access to anyone hitting the endpoint while the DB is unhappy,
      // which is the same failure as having no gate at all.
      res.status(503).json({
        success: false,
        error: {
          code: "ACCESS_CHECK_UNAVAILABLE",
          message: "Could not verify access. Please try again.",
        },
      });
    }
  })();
}
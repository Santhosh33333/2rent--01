import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";
import { ADMIN_ROLES } from "../rbac/sections";
import {
  getTrialSettings,
  setTrialDays,
  grantTrialToAllUsers,
  setUserAccess,
  normaliseTrialDays,
  TRIAL_DAYS_KEY,
  MAX_TRIAL_DAYS,
} from "../services/trialAccessService";

/**
 * Admin pricing control.
 *
 * Prices live in SubscriptionPlan and the frontend only ever reads them from
 * GET /subscriptions/plans. Nothing here hardcodes an amount, and every change
 * is audited because it moves money.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function listPlans(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: { displayOrder: "asc" },
    });
    const counts = await prisma.subscription.groupBy({
      by: ["planId", "status"],
      _count: { _all: true },
    });

    const withCounts = plans.map((plan) => ({
      ...plan,
      subscriptions: counts
        .filter((c) => c.planId === plan.id)
        .map((c) => ({ status: c.status, count: c._count._all })),
      activeCount: counts
        .filter((c) => c.planId === plan.id && c.status === "ACTIVE")
        .reduce((sum, c) => sum + c._count._all, 0),
    }));

    sendSuccess(res, { plans: withCounts });
  } catch {
    sendError(res, "Could not load plans.", 500, "PLANS_LOAD_FAILED");
  }
}

/**
 * POST /admin/subscriptions/plans/:code
 * Partial update: only the fields present in the body are changed.
 */
export async function updatePlan(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const code = String(req.params.code ?? "");
    const {
      name,
      description,
      price,
      currency,
      durationDays,
      trialDays,
      isActive,
      displayOrder,
      reason,
    } = req.body ?? {};

    const existing = await prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!existing) {
      sendError(res, "Plan not found.", 404, "PLAN_NOT_FOUND");
      return;
    }

    if (price !== undefined) {
      const parsed = Number(price);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        sendError(res, "Price must be a positive number.", 400, "INVALID_PRICE");
        return;
      }
    }
    if (trialDays !== undefined) {
      const parsed = Number(trialDays);
      if (!Number.isInteger(parsed) || parsed < 0) {
        sendError(res, "Trial days must be a non-negative whole number.", 400, "INVALID_TRIAL");
        return;
      }
    }
    if (durationDays !== undefined) {
      const parsed = Number(durationDays);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        sendError(res, "Duration must be a positive whole number of days.", 400, "INVALID_DURATION");
        return;
      }
    }
    if (currency !== undefined && !/^[A-Z]{3}$/.test(String(currency))) {
      sendError(res, "Currency must be a 3-letter code.", 400, "INVALID_CURRENCY");
      return;
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = String(name).trim();
    if (description !== undefined) data.description = description === null ? null : String(description);
    if (price !== undefined) data.price = round2(Number(price));
    if (currency !== undefined) data.currency = String(currency).toUpperCase();
    if (durationDays !== undefined) data.durationDays = Number(durationDays);
    if (trialDays !== undefined) data.trialDays = Number(trialDays);
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (displayOrder !== undefined) data.displayOrder = Number(displayOrder);

    if (Object.keys(data).length === 0) {
      sendError(res, "No changes supplied.", 400, "NO_CHANGES");
      return;
    }

    const updated = await prisma.subscriptionPlan.update({ where: { code }, data });

    await auditAdminAction({
      req,
      actorId: req.user?.userId ?? "unknown",
      action: "PRICING_PLAN_UPDATE",
      section: "PRICING",
      targetType: "SubscriptionPlan",
      targetId: updated.id,
      oldValue: {
        name: existing.name,
        price: existing.price,
        currency: existing.currency,
        trialDays: existing.trialDays,
        durationDays: existing.durationDays,
        isActive: existing.isActive,
      },
      newValue: data,
      reason: typeof reason === "string" ? reason : undefined,
    });

    sendSuccess(res, { plan: updated }, "Plan updated.");
  } catch {
    sendError(res, "Could not update plan.", 500, "PLAN_UPDATE_FAILED");
  }
}

/**
 * POST /admin/subscriptions/plans
 * Creates a new plan. Yearly plans are allowed here but cannot be settled by
 * UPI Autopay, which does not support yearly frequencies.
 */
export async function createPlan(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { code, name, price, currency, durationDays, trialDays, displayOrder } = req.body ?? {};

    if (!code || !String(code).trim()) {
      sendError(res, "Plan code is required.", 400, "CODE_REQUIRED");
      return;
    }
    if (!name || !String(name).trim()) {
      sendError(res, "Plan name is required.", 400, "NAME_REQUIRED");
      return;
    }
    const parsedPrice = Number(price);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      sendError(res, "Price must be a positive number.", 400, "INVALID_PRICE");
      return;
    }
    const parsedDuration = Number(durationDays);
    if (!Number.isInteger(parsedDuration) || parsedDuration <= 0) {
      sendError(res, "Duration must be a positive whole number of days.", 400, "INVALID_DURATION");
      return;
    }

    const normalizedCode = String(code).trim().toLowerCase();
    const dupe = await prisma.subscriptionPlan.findUnique({ where: { code: normalizedCode } });
    if (dupe) {
      sendError(res, "A plan with that code already exists.", 409, "PLAN_EXISTS");
      return;
    }

    const plan = await prisma.subscriptionPlan.create({
      data: {
        code: normalizedCode,
        name: String(name).trim(),
        price: round2(parsedPrice),
        currency: currency ? String(currency).toUpperCase() : "INR",
        durationDays: parsedDuration,
        trialDays: trialDays === undefined ? 0 : Number(trialDays),
        displayOrder: displayOrder === undefined ? 99 : Number(displayOrder),
        gatewayPlanId: normalizedCode,
      },
    });

    await auditAdminAction({
      req,
      actorId: req.user?.userId ?? "unknown",
      action: "PRICING_PLAN_CREATE",
      section: "PRICING",
      targetType: "SubscriptionPlan",
      targetId: plan.id,
      newValue: plan,
    });

    sendSuccess(res, { plan }, "Plan created.");
  } catch {
    sendError(res, "Could not create plan.", 500, "PLAN_CREATE_FAILED");
  }
}

/**
 * POST /admin/subscriptions/plans/:code/toggle
 * Deactivating hides a plan from the paywall without deleting it, so existing
 * subscribers keep their plan reference intact.
 */
export async function togglePlan(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const code = String(req.params.code ?? "");
    const existing = await prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!existing) {
      sendError(res, "Plan not found.", 404, "PLAN_NOT_FOUND");
      return;
    }

    const next = !existing.isActive;

    if (!next) {
      const activeSubs = await prisma.subscription.count({
        where: { planId: existing.id, status: "ACTIVE" },
      });
      if (activeSubs > 0) {
        sendError(
          res,
          `Cannot deactivate: ${activeSubs} active subscriber(s) are on this plan.`,
          409,
          "PLAN_IN_USE",
        );
        return;
      }
    }

    const plan = await prisma.subscriptionPlan.update({
      where: { code },
      data: { isActive: next },
    });

    await auditAdminAction({
      req,
      actorId: req.user?.userId ?? "unknown",
      action: next ? "PRICING_PLAN_ACTIVATE" : "PRICING_PLAN_DEACTIVATE",
      section: "PRICING",
      targetType: "SubscriptionPlan",
      targetId: plan.id,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive: next },
    });

    sendSuccess(res, { plan }, next ? "Plan activated." : "Plan deactivated.");
  } catch {
    sendError(res, "Could not toggle plan.", 500, "PLAN_TOGGLE_FAILED");
  }
}

/** GET /admin/subscriptions/summary - counts for the admin dashboard. */
export async function subscriptionSummary(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [byStatus, total, active] = await Promise.all([
      prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.subscription.count(),
      prisma.subscription.count({ where: { status: "ACTIVE" } }),
    ]);

    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: "asc" },
      select: { id: true, code: true, name: true, price: true, trialDays: true },
    });

    sendSuccess(res, {
      total,
      active,
      byStatus: byStatus.map((b) => ({ status: b.status, count: b._count._all })),
      plans,
      // So the trial control in the admin UI starts from the real value rather
      // than a hardcoded 7 that silently disagrees with production.
      trial: await getTrialSettings(),
    });
  } catch {
    sendError(res, "Could not load subscription summary.", 500, "SUMMARY_FAILED");
  }
}

// ============================================================================
// FREE TRIAL
//
// The trial length is one admin-controlled number, and the landing pages read it.
// Before this, the advertised length came from SubscriptionPlan.trialDays while
// access was decided by User.accessUntil, and nothing ever wrote the second from
// the first - so editing the plan changed the advert and not the product, and
// new accounts got no trial at all.
// ============================================================================

function trialError(res: Response, err: unknown): void {
  const code = err instanceof Error ? err.message : "";
  if (code === "TRIAL_DAYS_INVALID") {
    sendError(res, "Trial days must be a whole number of at least 1.", 400, code);
    return;
  }
  if (code === `TRIAL_DAYS_MAX_${MAX_TRIAL_DAYS}`) {
    sendError(res, `Trial days cannot exceed ${MAX_TRIAL_DAYS}.`, 400, code);
    return;
  }
  if (code === "USER_NOT_FOUND") {
    sendError(res, "No account has that id.", 404, code);
    return;
  }
  console.error("[TRIAL] admin action failed:", err);
  sendError(res, "Could not update the trial.", 500, "TRIAL_UPDATE_FAILED");
}

/** GET /admin/subscriptions/trial - current settings plus how many hold access. */
export async function getTrialConfig(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [settings, usersWithAccess, usersWithoutAccess] = await Promise.all([
      getTrialSettings(),
      prisma.user.count({
        where: { accessUntil: { gt: new Date() }, role: { notIn: [...ADMIN_ROLES] } },
      }),
      prisma.user.count({
        where: { OR: [{ accessUntil: null }, { accessUntil: { lte: new Date() } }] },
      }),
    ]);

    sendSuccess(res, {
      ...settings,
      usersWithAccess,
      usersWithoutAccess,
      // Named explicitly because it is the operation with consequences: it moves
      // real access windows for every account, and an admin about to press it
      // should see the size of the change first.
      bulkGrantNote:
        "Setting days for all users only affects accounts without current access. Accounts that paid, or were granted access by an admin, are left untouched.",
    });
  } catch (err) {
    console.error("[TRIAL] read failed:", err);
    sendError(res, "Could not load trial settings.", 500, "TRIAL_READ_FAILED");
  }
}

/**
 * POST /admin/subscriptions/trial
 * Sets the length every future signup receives.
 */
export async function updateTrialConfig(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const before = await getTrialSettings();
    const days = await setTrialDays(req.body?.days);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;

    await auditAdminAction({
      req,
      actorId: req.user?.userId ?? "unknown",
      action: "TRIAL_DAYS_UPDATED",
      section: "PRICING",
      targetType: "Config",
      targetId: TRIAL_DAYS_KEY,
      oldValue: { days: before.days },
      newValue: { days },
      reason,
    });

    sendSuccess(res, await getTrialSettings(), `New accounts now get ${days} days.`);
  } catch (err) {
    trialError(res, err);
  }
}

/**
 * POST /admin/subscriptions/trial/grant-all
 * Applies a length to every account that does not already have access.
 */
export async function grantTrialToAll(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const actorId = req.user?.userId ?? "unknown";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = await grantTrialToAllUsers(req.body?.days, actorId);

    await auditAdminAction({
      req,
      actorId,
      action: "TRIAL_DAYS_APPLIED_TO_ALL",
      section: "PRICING",
      targetType: "Config",
      targetId: TRIAL_DAYS_KEY,
      newValue: result,
      reason,
    });

    sendSuccess(res, result, `${result.granted} account(s) given ${result.days} days.`);
  } catch (err) {
    trialError(res, err);
  }
}

/** POST /admin/subscriptions/trial/users/:id - per-user set or clear. */
export async function setUserTrial(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const actorId = req.user?.userId ?? "unknown";
    const raw = req.body?.days;
    // Explicit null means revoke. Absent means the caller sent nothing useful,
    // which must not be read as "revoke" - a UI bug would then silently strip
    // access from an account.
    if (raw === undefined) {
      sendError(res, "Provide days, or null to revoke access.", 400, "TRIAL_DAYS_INVALID");
      return;
    }
    const days = raw === null ? null : normaliseTrialDays(raw);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = await setUserAccess(String(req.params.id ?? ""), days, actorId, reason);

    await auditAdminAction({
      req,
      actorId,
      action: days === null ? "TRIAL_REVOKED" : "TRIAL_GRANTED_USER",
      section: "PRICING",
      targetType: "User",
      targetId: result.userId,
      newValue: result,
      reason,
    });

    sendSuccess(
      res,
      result,
      days === null ? "Access revoked." : `Access granted until ${result.accessUntil?.toISOString()}.`,
    );
  } catch (err) {
    trialError(res, err);
  }
}
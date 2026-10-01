import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";

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
    });
  } catch {
    sendError(res, "Could not load subscription summary.", 500, "SUMMARY_FAILED");
  }
}
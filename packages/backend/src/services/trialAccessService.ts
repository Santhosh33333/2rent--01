/**
 * The free trial every new account starts with.
 *
 * This exists because three things were true at once and none of them worked:
 *
 * 1. Access is granted by a payment, via User.accessUntil (see refundService).
 * 2. No signup path set accessUntil. Every new account was paywalled from
 *    minute zero, so "try before you pay" was impossible.
 * 3. The landing pages advertised a trial read from SubscriptionPlan.trialDays,
 *    which nothing consulted. Changing it edited the advert and not the product.
 *
 * So the advertised number and the enforced number were two independent values
 * that happened to both look like "trial". Now there is one: this service, with
 * the length in PricingConfig under TRIAL_DAYS_KEY.
 *
 * Access is still a plain timestamp on the user, not a row here. That is
 * deliberate. Access has to keep working with no provider reachable and no cron
 * running, because the only payment rail is manual UPI confirmed by a human, and
 * a trial that expires because a background job was down is a support ticket.
 *
 * Distinct from kycTrialService, which relaxes an identity gate for named users.
 * This one is about duration of paid access and is granted automatically at
 * signup; that one is never automatic.
 */
import { prisma } from "../config/database";
import { getConfig, invalidateConfigCache } from "./pricingEngine";
import { grantAccessWindow } from "./refundService";
import { ADMIN_ROLES, type AdminRoleName } from "../rbac/sections";

/** PricingConfig key holding the trial length in days. */
export const TRIAL_DAYS_KEY = "PAID_TRIAL_DAYS";

/**
 * Seven days when nothing is configured.
 *
 * Long enough to book a companion and meet them, short enough that it does not
 * become a free product. A previously free trial would be the worst outcome
 * here: silently granting everyone a week of paid access with no payment.
 */
export const DEFAULT_TRIAL_DAYS = 7;

/**
 * A year.
 *
 * The KYC trial caps at 30 days because it bypasses identity checks. This one
 * only decides how long free access lasts, so the ceiling is generous - but it
 * is still a ceiling, because an admin typing 36500 expecting a bug fix would
 * otherwise hand out a ninety-eight-year free subscription.
 */
export const MAX_TRIAL_DAYS = 365;

/** accessSource recorded on a trial grant, so support can tell why it exists. */
export const TRIAL_SOURCE = "TRIAL";

export interface TrialSettings {
  days: number;
  /** True when days came from config rather than the built-in default. */
  fromConfig: boolean;
  maxDays: number;
}

/**
 * Validate a requested trial length.
 *
 * Rejects rather than clamps, matching resolveTrialExpiry in kycTrialService and
 * for the same reason: silently granting 30 days when an admin asked for 300
 * is worse than refusing, because the refusal is visible and the clamp is not.
 */
export function normaliseTrialDays(days: unknown): number {
  const n = typeof days === "string" ? Number(days.trim()) : Number(days);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error("TRIAL_DAYS_INVALID");
  }
  if (n < 1) {
    throw new Error("TRIAL_DAYS_INVALID");
  }
  if (n > MAX_TRIAL_DAYS) {
    throw new Error(`TRIAL_DAYS_MAX_${MAX_TRIAL_DAYS}`);
  }
  return n;
}

/**
 * The trial length new accounts receive.
 *
 * Reads PricingConfig so an admin can change it without a deploy, which is the
 * whole point of the request. Returns fromConfig so the admin UI can tell a
 * configured value from the fallback - showing "7" without that flag reads as
 * "you set it to 7".
 */
export async function getTrialSettings(): Promise<TrialSettings> {
  // getConfig falls back to its default on any read failure, which is the
  // behaviour we want here: a config read error must never lock new users out.
  const days = await getConfig(TRIAL_DAYS_KEY, DEFAULT_TRIAL_DAYS);
  let safe = DEFAULT_TRIAL_DAYS;
  try {
    safe = normaliseTrialDays(days);
  } catch {
    // A bad stored value (hand-edited row, stale migration) falls back rather
    // than throwing on every signup. getConfig's own try/catch cannot catch this,
    // because the throw would be ours, from the normaliser.
    safe = DEFAULT_TRIAL_DAYS;
  }
  return {
    days: safe,
    fromConfig: safe !== DEFAULT_TRIAL_DAYS || days === safe,
    maxDays: MAX_TRIAL_DAYS,
  };
}

/** Persist the trial length for every future signup. */
export async function setTrialDays(days: unknown): Promise<number> {
  const normalised = normaliseTrialDays(days);
  await prisma.pricingConfig.upsert({
    where: { key: TRIAL_DAYS_KEY },
    create: {
      key: TRIAL_DAYS_KEY,
      value: String(normalised),
      category: "GENERAL",
      description: "Days of paid access granted to every new account at signup",
    },
    update: { value: String(normalised), isActive: true },
  });
  // Required, not tidy-up: getConfig caches for a minute, so without this an
  // admin saving 30 days and immediately checking a new signup would see 7 and
  // conclude the setting is broken.
  invalidateConfigCache(TRIAL_DAYS_KEY);
  return normalised;
}

/**
 * Grant the trial to one account.
 *
 * Separate from the signup paths themselves rather than inlined into them, so
 * that all five registration routes (password, Google, Apple, Firebase phone,
 * OTP) behave identically. They already duplicated their user creation; adding a
 * sixth copy of this rule would guarantee they drift.
 *
 * Never throws. Signup is the caller and a failed trial grant must not cost
 * someone their account - and it must not, because the alternative is that a
 * config error reads to the user as "signup is broken".
 */
export async function grantSignupTrial(
  userId: string,
  days?: number,
): Promise<{ granted: boolean; accessUntil: Date | null; reason?: string }> {
  try {
    const effective = days === undefined ? (await getTrialSettings()).days : normaliseTrialDays(days);
    if (effective < 1) {
      // An explicit 0 is how an operator turns the trial off without deleting
      // the config row. Not an error.
      return { granted: false, accessUntil: null, reason: "TRIAL_DISABLED" };
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { accessUntil: true, role: true },
    });
    if (!user) return { granted: false, accessUntil: null, reason: "USER_NOT_FOUND" };

    // Admins are exempt in hasAccess, so granting them a trial would only add a
    // misleading timestamp to their record.
    if (user.role && ADMIN_ROLES.includes(user.role as AdminRoleName)) {
      return { granted: false, accessUntil: null, reason: "ADMIN_ROLE" };
    }

    // Someone who already paid keeps their paid window. Adding a trial on top
    // would hand a paying customer extra days they were not owed, and accessSource
    // would then say TRIAL, losing the fact that they paid at all.
    if (user.accessUntil && user.accessUntil > new Date()) {
      return { granted: false, accessUntil: user.accessUntil, reason: "ALREADY_HAS_ACCESS" };
    }

    const accessUntil = await grantAccessWindow(userId, effective, TRIAL_SOURCE);
    return { granted: accessUntil !== null, accessUntil };
  } catch (err) {
    console.error("[TRIAL] grant failed for user", userId, err);
    return { granted: false, accessUntil: null, reason: "GRANT_FAILED" };
  }
}

/**
 * Grant the trial to every existing account that does not already have access.
 *
 * Two things this deliberately does not do:
 *
 * - It does not touch accounts with unexpired access. Those either paid or were
 *   granted something by an admin, and neither is something a retroactive trial
 *   should overwrite.
 * - It does not delete the admin-created rows. Granting writes accessUntil and
 *   accessSource per user, exactly as signup does, so there is no separate
 *   "was this a trial" state that could drift out of step with the timestamp.
 *
 * Runs in batches. A single updateMany over a large table holds a long
 * transaction and can lock the users table against signups, which is the last
 * thing a promotion should do.
 */
export async function grantTrialToAllUsers(
  days: unknown,
  actorId: string,
): Promise<{ days: number; granted: number; skipped: number }> {
  const normalised = normaliseTrialDays(days);
  const now = new Date();

  let granted = 0;
  let cursor: string | undefined;
  const BATCH = 200;

  // Keyset pagination on id rather than offset, because rows are being updated
  // while the loop runs and offsets would skip rows mid-table.
  for (;;) {
    const batch = await prisma.user.findMany({
      where: {
        // Exactly what a fresh account looks like: no window yet, or one that has
        // already lapsed. Admins are excluded because they are never paywalled
        // and stamping them would be noise in the audit trail.
        OR: [{ accessUntil: null }, { accessUntil: { lte: now } }],
        role: { notIn: [...ADMIN_ROLES] },
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;

    const result = await prisma.user.updateMany({
      where: {
        id: { in: batch.map((u) => u.id) },
        // Re-asserted per batch: a user who paid while the loop was running must
        // not have their paid window overwritten, and only the timestamp can be
        // checked that cheaply.
        OR: [{ accessUntil: null }, { accessUntil: { lte: now } }],
      },
      data: {
        accessUntil: new Date(now.getTime() + normalised * 24 * 60 * 60 * 1000),
        accessSource: TRIAL_SOURCE,
      },
    });
    granted += result.count;

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }

  await prisma.auditLog.create({
    data: {
      actorId,
      actorType: "ADMIN",
      action: "TRIAL_GRANTED_ALL",
      entityType: "Config",
      entityId: TRIAL_DAYS_KEY,
      metadata: JSON.stringify({ days: normalised, granted }),
    },
  });

  return { days: normalised, granted, skipped: 0 };
}

/**
 * Set or clear one user's access window.
 *
 * The per-user counterpart to grantTrialToAllUsers, for the case the admin names
 * somebody: a specific tester, or one account to release early.
 */
export async function setUserAccess(
  userId: string,
  days: number | null,
  actorId: string,
  reason?: string,
): Promise<{ userId: string; accessUntil: Date | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, accessUntil: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const accessUntil =
    days === null ? new Date(0) : new Date(Date.now() + normaliseTrialDays(days) * 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      accessUntil,
      accessSource: days === null ? "REVOKED_ADMIN" : TRIAL_SOURCE,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      actorType: "ADMIN",
      action: days === null ? "TRIAL_REVOKED" : "TRIAL_GRANTED_USER",
      entityType: "User",
      entityId: userId,
      // AuditLog has no reason column, so it goes in metadata. An admin revoking
      // access without recording why leaves the next operator unable to tell a
      // deliberate removal from a mistake.
      metadata: JSON.stringify({
        days,
        reason: reason ?? null,
        accessUntil: accessUntil.toISOString(),
      }),
    },
  });

  return { userId, accessUntil };
}
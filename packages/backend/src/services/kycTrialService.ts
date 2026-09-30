/**
 * KYC trial policy.
 *
 * An admin can let a specific user use the app without completing KYC for a
 * bounded number of days, after which the normal gate applies again. This
 * exists for a small, known set of people - early testers, a partner being
 * onboarded, a demo account - not as a way to bypass KYC generally.
 *
 * Kept as pure logic with an explicit clock so the expiry boundary can be
 * asserted rather than reasoned about. A trial that never expires, or one that
 * expires a day early because of an inclusive comparison, is the difference
 * between "we let a tester in for a week" and "a stranger can use the app
 * forever", so both edges are pinned by tests.
 */

/** Longest trial an admin may grant, in days. */
export const MAX_TRIAL_DAYS = 30;

/** Longest trial when the admin does not specify one. */
export const DEFAULT_TRIAL_DAYS = 7;

export type TrialDecision =
  | { allowed: true; reason: "approved" | "trial"; trialEndsAt: Date | null }
  | { allowed: false; reason: "missing" | "pending" | "trial_expired"; trialEndsAt: Date | null };

/** The terminal admin-approved states, matching requireKycVerified. */
const APPROVED = ["VERIFIED", "APPROVED"];

type VerificationLike = { status: string; trialEndsAt: Date | null } | null | undefined;

export function evaluateKycGate(
  verification: VerificationLike,
  now: Date = new Date()
): TrialDecision {
  if (!verification) {
    return { allowed: false, reason: "missing", trialEndsAt: null };
  }

  if (APPROVED.includes(verification.status)) {
    return { allowed: true, reason: "approved", trialEndsAt: verification.trialEndsAt };
  }

  // Strictly greater than: at the exact instant the trial ends the user is
  // back under the gate. Using >= would leave the last millisecond open.
  if (verification.trialEndsAt && verification.trialEndsAt.getTime() > now.getTime()) {
    return { allowed: true, reason: "trial", trialEndsAt: verification.trialEndsAt };
  }

  // Distinguish "you never had a trial" from "your trial ran out", because the
  // user-facing copy differs and only the second one should suggest finishing
  // verification now.
  const expired = !!verification.trialEndsAt && verification.trialEndsAt.getTime() <= now.getTime();
  return {
    allowed: false,
    reason: expired ? "trial_expired" : "pending",
    trialEndsAt: verification.trialEndsAt,
  };
}

/**
 * Turns a requested day count into an expiry instant.
 *
 * Rejects rather than clamping, so a mistyped 9999 cannot silently create a
 * multi-decade trial. Rejecting also keeps the caller's intent visible instead
 * of quietly granting something different from what was asked for.
 */
export function resolveTrialExpiry(days: number | undefined, from: Date = new Date()): Date {
  const requested = days === undefined || days === null ? DEFAULT_TRIAL_DAYS : Number(days);

  if (!Number.isFinite(requested) || !Number.isInteger(requested)) {
    throw new Error("TRIAL_DAYS_INVALID");
  }
  if (requested < 1) {
    throw new Error("TRIAL_DAYS_INVALID");
  }
  if (requested > MAX_TRIAL_DAYS) {
    throw new Error(`TRIAL_DAYS_MAX_${MAX_TRIAL_DAYS}`);
  }

  return new Date(from.getTime() + requested * 24 * 60 * 60 * 1000);
}

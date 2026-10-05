/**
 * Can a user delete their own account?
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DECIDES
 * ---------------------------------------------------------------------------
 * Self-service deletion is frozen until a fixed date. During the freeze nobody
 * can delete their own account; only an administrator can, through the existing
 * admin status endpoint (`PUT /admin/users/:id/status` -> `DEACTIVATED`). That
 * admin path is untouched and continues to work.
 *
 * ---------------------------------------------------------------------------
 * WHY A DATE AND NOT A BOOLEAN
 * ---------------------------------------------------------------------------
 * The requirement is "not for the next three months", which is a statement about
 * a window of time, so it is expressed as an absolute instant.
 *
 * The tempting shortcut is `Date.now() + 3 months` evaluated at call time. That
 * is worse than no lock at all: the deadline moves forward on every request, so
 * the freeze never lifts and nobody can ever delete an account. A freeze that
 * silently never expires is indistinguishable from a bug, and it is discovered
 * only when someone tries to leave.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT A PER-ACCOUNT RULE
 * ---------------------------------------------------------------------------
 * "An account cannot be deleted for three months" could also mean three months
 * after that account was created. This module implements the first reading - a
 * blanket freeze on self-deletion - because "for the NEXT three months" is
 * future tense about the platform, not about an individual signup date.
 *
 * The distinction matters and is recorded here so the choice is visible rather
 * than accidental. If the per-account rule was intended instead, this is the one
 * file to change.
 */

/**
 * When the freeze lifts.
 *
 * Three months from 2026-10-04. Overridable with the
 * `SELF_DELETION_FROZEN_UNTIL` environment variable, so the date is a
 * deployment decision rather than a code change - and so that lifting the
 * freeze later is a config edit, not a release.
 */
export const DEFAULT_SELF_DELETION_FROZEN_UNTIL = "2027-01-04";

export type SelfDeletionGate =
  | { allowed: true }
  | { allowed: false; code: "SELF_DELETION_FROZEN"; message: string; frozenUntil: Date };

/**
 * Read the configured end date.
 *
 * An unparseable value falls back to the default rather than to "no freeze".
 * That direction is deliberate: a typo in configuration must not quietly remove
 * a lock that exists to stop accounts being deleted. Failing closed is the only
 * safe way to be wrong here.
 */
export function resolveFreezeUntil(configured?: string | null): Date {
  const raw = (configured ?? "").trim();
  if (!raw) return new Date(`${DEFAULT_SELF_DELETION_FROZEN_UNTIL}T00:00:00.000Z`);

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn(
      `[accountDeletion] SELF_DELETION_FROZEN_UNTIL="${raw}" is not a valid date; ` +
        `falling back to ${DEFAULT_SELF_DELETION_FROZEN_UNTIL}.`,
    );
    return new Date(`${DEFAULT_SELF_DELETION_FROZEN_UNTIL}T00:00:00.000Z`);
  }
  return parsed;
}

/** Shown to the user in place of a form they can no longer submit. */
export function selfDeletionFrozenMessage(frozenUntil: Date): string {
  // An explicit, unambiguous date rather than "three months": the user is being
  // told to wait, so they need to know until when, in a form they cannot
  // misread. en-GB gives 4 January 2027.
  const until = frozenUntil.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    `Account self-deletion is paused until ${until}. ` +
    "Until then only a Nabri administrator can delete an account. " +
    "Contact Nabri support if you need your account removed."
  );
}

/**
 * The gate itself. Pure, so the date arithmetic can be tested without waiting
 * three months or freezing the system clock.
 *
 * `now` is injected rather than read from the clock so the boundary is testable.
 * The comparison is strict `<`, so the freeze is INCLUSIVE of its final
 * millisecond and the user may delete from the stated date itself - "paused
 * until 4 January 2027" must mean available ON 4 January 2027, or the app
 * contradicts the date it just showed them. That single character is the whole
 * boundary behaviour, so it is pinned by tests on both sides.
 */
export function selfDeletionGate(now: Date, freezeUntil: Date): SelfDeletionGate {
  // A NaN anywhere makes every comparison false, which would fall straight
  // through to `allowed: true` and unlock deletion. An unusable clock is treated
  // as "the freeze still applies", because the safe direction to be wrong in is
  // the one that keeps the lock on.
  const nowMs = now?.getTime?.();
  const untilMs = freezeUntil?.getTime?.();
  if (!Number.isFinite(nowMs) || !Number.isFinite(untilMs)) {
    return {
      allowed: false,
      code: "SELF_DELETION_FROZEN",
      message: selfDeletionFrozenMessage(
        Number.isFinite(untilMs) ? freezeUntil : new Date(`${DEFAULT_SELF_DELETION_FROZEN_UNTIL}T00:00:00.000Z`),
      ),
      frozenUntil: Number.isFinite(untilMs)
        ? freezeUntil
        : new Date(`${DEFAULT_SELF_DELETION_FROZEN_UNTIL}T00:00:00.000Z`),
    };
  }

  if (nowMs < untilMs) {
    return {
      allowed: false,
      code: "SELF_DELETION_FROZEN",
      message: selfDeletionFrozenMessage(freezeUntil),
      frozenUntil: freezeUntil,
    };
  }
  return { allowed: true };
}

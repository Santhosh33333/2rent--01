/**
 * Date-of-birth rules, shared by the self-service profile edit and the admin
 * override so the two can never drift apart.
 *
 * Two rules:
 *
 *   1. An account must belong to someone 18 or older. That is enforced at
 *      registration and at KYC, and it has to hold on the profile edit path
 *      too - that path used to accept any past date, so an adult could rewrite
 *      their date of birth to a child's and step around the 18+ gate.
 *
 *   2. Once a member has chosen their date of birth it is frozen, and only an
 *      administrator may change it (PUT /admin/users/:id/profile). This mirrors
 *      how name and gender already behave: a self-service edit is refused, and
 *      the supported route is a support request.
 *
 * Social / OTP sign-ups are created with a placeholder date (see
 * DEFAULT_SIGNUP_DOB). That placeholder is treated as "not chosen yet" so those
 * members may set their real date exactly once; everything else is locked.
 */

/** The value social and OTP sign-ups are created with, standing in for "unset". */
export const DEFAULT_SIGNUP_DOB = "2000-01-01";

/** Nabri is 18+ only. */
export const MIN_AGE_YEARS = 18;

/** Whole years between `birth` and `now`, treating both as UTC calendar dates. */
export function ageInYears(birth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/** "YYYY-MM-DD" for a Date, without pulling in a date library. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * True when the stored date is a real choice and therefore frozen. A missing
 * value, or the signup placeholder, is not locked.
 */
export function isDateOfBirthLocked(stored: Date | string | null | undefined): boolean {
  if (!stored) return false;
  return toIsoDate(new Date(stored)) !== DEFAULT_SIGNUP_DOB;
}

export type DateOfBirthResult =
  | { ok: true; date: Date }
  | { ok: false; reason: string };

/**
 * Parse and validate a "YYYY-MM-DD" date of birth, enforcing the 18+ rule.
 * Both callers word the failure identically because it lives here.
 */
export function parseDateOfBirth(input: unknown, now: Date = new Date()): DateOfBirthResult {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: false, reason: "Date of birth must use YYYY-MM-DD format." };
  }
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== input || parsed > now) {
    return { ok: false, reason: "Date of birth must be a valid date in the past." };
  }
  if (ageInYears(parsed, now) < MIN_AGE_YEARS) {
    return { ok: false, reason: `You must be at least ${MIN_AGE_YEARS} years old to use Nabri.` };
  }
  return { ok: true, date: parsed };
}

// ============================================================================
// Phone number visibility and verification state.
//
// Two rules, both enforced server-side:
//
// 1. The real number is shown only to the account owner and to an admin acting
//    on their behalf. Everyone else sees a masked form, because a full number
//    is personal data and the Privacy Policy promises it is not displayed by
//    default.
//
// 2. Phone verification by SMS OTP is currently DISABLED. Registration accepts
//    a number and the account is usable, but the number stays UNVERIFIED and is
//    reported as such everywhere, so nothing downstream can treat it as
//    proof of ownership. A support/admin can still set a number; doing so never
//    marks it verified.
//
// Consequence that matters: `mobileVerified` must be reset whenever the number
// changes. Otherwise an account keeps a "verified" badge for a number nobody
// has proven they control.
// ============================================================================

/** Why the number is unverified, so the UI can explain rather than just show a red dot. */
export const PHONE_VERIFICATION_UNAVAILABLE_MESSAGE =
  "Phone number verification is not available right now. Your number is saved but unverified. Verification will be enabled in a future update.";

export const PHONE_CHANGE_ADMIN_ONLY_MESSAGE =
  "Your mobile number cannot be changed from the app. Please contact Nabri support or an administrator to update it.";

export const PHONE_CHANGE_ADMIN_ONLY_CODE = "PHONE_CHANGE_ADMIN_ONLY";

/** Verification is off, so nothing may ever report the number as verified. */
export const PHONE_VERIFICATION_ENABLED = false;

/**
 * Mask every digit except the last two, keeping any leading `+`.
 *
 * `+919876543210` -> `+••••••••••10`
 *
 * The country code is deliberately NOT preserved. Splitting a number into
 * "country code" and "subscriber" is guesswork without carrier metadata, and
 * guessing wrong would leak the leading digits of the subscriber number. Two
 * visible digits is enough for a human to recognise their own contact.
 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const str = String(phone);
  const digits = str.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length <= 2) return "•".repeat(digits.length);
  const prefix = str.trimStart().startsWith("+") ? "+" : "";
  return `${prefix}${"•".repeat(digits.length - 2)}${digits.slice(-2)}`;
}

/**
 * The phone field as it should appear for a given viewer.
 * Returns the full number only when the viewer owns the account; admins reading
 * the user list are handled by the admin endpoints, which are separately
 * permission-gated.
 */
export function phoneForViewer(
  phone: string | null | undefined,
  viewerId: string | null | undefined,
  ownerId: string
): { phone: string | null; phoneVisible: boolean; phoneMasked: boolean } {
  const isOwner = Boolean(viewerId) && viewerId === ownerId;
  if (isOwner) {
    return { phone: phone ?? null, phoneVisible: true, phoneMasked: false };
  }
  return { phone: maskPhone(phone), phoneVisible: false, phoneMasked: true };
}

/** The verification block every profile response carries. */
export function phoneVerificationState(mobileVerified: boolean | null | undefined) {
  return {
    phoneVerified: mobileVerified === true,
    phoneVerificationEnabled: PHONE_VERIFICATION_ENABLED,
    phoneVerificationNotice: mobileVerified === true ? null : PHONE_VERIFICATION_UNAVAILABLE_MESSAGE,
  };
}

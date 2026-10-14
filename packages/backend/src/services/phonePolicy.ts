// ============================================================================
// Phone-number policy for accounts that were created without a real number.
//
// Google (and other social) sign-ups never hand back a phone number, but
// `User.phone` is a non-null unique column, so those accounts used to store a
// fabricated `+91<first 10 chars of the provider id>`. That looked like a real
// Indian mobile and could even collide with a genuine user's number.
//
// Two rules keep this honest, and both are enforced server-side:
//
//  1. A social account with no real number stores a *placeholder* that is
//     obviously not a phone (`pending:<provider id>`), so nothing downstream can
//     mistake it for a reachable number.
//  2. The owner may set a real number EXACTLY ONCE, and only while the stored
//     value is still a placeholder. After that the number is frozen and only an
//     administrator can change it - the same rule already applied to name,
//     gender and date of birth.
//
// The number itself is parsed by services/phoneNumber (the one Indian-mobile
// parser), so an entered number is validated and stored in the same E.164 form
// as every other entry point. Setting a number never marks it verified: SMS OTP
// is switched off, so `mobileVerified` stays false (services/phoneVisibility).
// ============================================================================

export const PLACEHOLDER_PHONE_PREFIX = "pending:";

/**
 * True when the account has no real number yet - either the column is empty or
 * it still holds the synthetic social-signup placeholder.
 */
export function isPlaceholderPhone(phone?: string | null): boolean {
  if (!phone) return true;
  return String(phone).startsWith(PLACEHOLDER_PHONE_PREFIX);
}

/**
 * The value stored for a social sign-up that did not supply a number. Unique
 * per account because the provider id is, and shaped so it can never be dialled
 * or mistaken for a real number.
 */
export function placeholderPhone(providerId: string): string {
  return `${PLACEHOLDER_PHONE_PREFIX}${providerId}`;
}

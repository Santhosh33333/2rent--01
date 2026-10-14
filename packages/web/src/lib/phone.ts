/**
 * Phone-number helpers shared by the profile screens.
 *
 * Mirrors `services/phonePolicy.ts` on the backend. A social (Google) sign-up
 * that never supplied a number stores a synthetic `pending:<provider id>`
 * placeholder rather than a fabricated real-looking mobile, and the owner gets
 * one chance to set their real number. These helpers keep the UI from ever
 * rendering that placeholder as if it were a phone number, and from offering an
 * edit that the server would reject.
 */
export const PLACEHOLDER_PHONE_PREFIX = 'pending:'

/** True when the account has no real number on file yet. */
export function isPlaceholderPhone(phone?: string | null): boolean {
  if (!phone) return true
  return String(phone).startsWith(PLACEHOLDER_PHONE_PREFIX)
}

/** Digits only, for the 10-digit mobile inputs. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** The last 10 digits, so a `+91` prefix typed by the user is harmless. */
export function toTenDigits(value: string): string {
  return digitsOnly(value).slice(-10)
}

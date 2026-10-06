import { MMKV } from 'react-native-mmkv';
import { post } from './api';

/**
 * Referral codes on the APK, held to the same contract the server enforces.
 *
 * The reason this is a module rather than a call inside the signup screen is
 * that signup does not always end with a token: when email verification is
 * still pending the register call returns a user and no accessToken, and
 * `/referrals/apply` is authenticated. A code typed at that point would be
 * dropped on the floor, which is exactly how a user does everything right and
 * the referral is still never recorded. Stashing the code and flushing it as
 * soon as any session carries a token removes that gap.
 *
 * The shape check mirrors the server's `/^RB-[0-9A-F]{8}$/`, so a malformed
 * invite link is reported as a bad link rather than as an account that
 * mysteriously failed to apply a perfectly good-looking code.
 */
const storage = new MMKV({ id: 'referral' });
const REFERRAL_CODE = /^RB-[0-9A-F]{8}$/;

/** Normalise what the user typed or what a link carried, or '' if unusable. */
export function normalizeReferralCode(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return REFERRAL_CODE.test(value) ? value : '';
}

export function stashReferralCode(code: string): void {
  const normalized = normalizeReferralCode(code);
  if (normalized) storage.set('pending', normalized);
}

export function peekStashedReferralCode(): string | null {
  return storage.getString('pending') ?? null;
}

export function clearStashedReferralCode(): void {
  storage.delete('pending');
}

/** The server's own error codes, for telling a permanent answer from a glitch. */
function errorCodeOf(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { error?: string } } }).response;
    return res?.data?.error;
  }
  return undefined;
}

/**
 * Answers that can never change on a retry. Anything else is kept parked so
 * the next authenticated session tries again rather than losing the referral.
 */
const PERMANENT_FAILURES = new Set([
  'ALREADY_REFERRED',
  'INVALID_CODE',
  'CODE_NOT_FOUND',
  'SELF_REFERRAL',
  'AMBIGUOUS_CODE',
]);

/**
 * Apply a code. Never throws and never rejects to the caller.
 *
 * A referral must not be able to fail a signup or a login - the account is the
 * point of those screens, the reward is not. The caller gets a boolean and
 * decides whether to tell the user.
 */
export async function applyReferralCode(code: string): Promise<boolean> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return false;
  try {
    const res = await post('/referrals/apply', { code: normalized });
    if (res.success) {
      clearStashedReferralCode();
      return true;
    }
    return false;
  } catch (err) {
    if (PERMANENT_FAILURES.has(errorCodeOf(err) ?? '')) clearStashedReferralCode();
    return false;
  }
}

/** Apply anything parked earlier. Safe to call on every authenticated entry. */
export async function flushStashedReferralCode(): Promise<boolean> {
  const pending = peekStashedReferralCode();
  if (!pending) return false;
  return applyReferralCode(pending);
}

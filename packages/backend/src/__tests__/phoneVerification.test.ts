// Rules about what the platform is allowed to claim regarding a phone number.
// These are honesty guarantees, so they are asserted directly rather than
// through a request round-trip.
import { describe, it, expect } from 'vitest';
import {
  PHONE_VERIFICATION_ENABLED,
  PHONE_VERIFICATION_UNAVAILABLE_MESSAGE,
  PHONE_CHANGE_ADMIN_ONLY_CODE,
  maskPhone,
  phoneVerificationState,
} from '../services/phoneVisibility.js';
import { isOtpDevEchoOnly } from '../services/otpService.js';

describe('Phone verification is switched off', () => {
  it('is disabled, so nothing may be gated on it being available', () => {
    expect(PHONE_VERIFICATION_ENABLED).toBe(false);
  });

  it('tells the user it will come later instead of silently failing', () => {
    expect(PHONE_VERIFICATION_UNAVAILABLE_MESSAGE).toMatch(/not available/i);
    expect(PHONE_VERIFICATION_UNAVAILABLE_MESSAGE).toMatch(/future/i);
  });

  it('uses a stable error code so clients can branch on it', () => {
    expect(PHONE_CHANGE_ADMIN_ONLY_CODE).toBe('PHONE_CHANGE_ADMIN_ONLY');
  });
});

describe('A saved number is never reported as verified', () => {
  it('reports unverified for a user that has a number but never proved it', () => {
    const state = phoneVerificationState(false);
    expect(state.phoneVerified).toBe(false);
    expect(state.phoneVerificationNotice).toBe(PHONE_VERIFICATION_UNAVAILABLE_MESSAGE);
  });

  it('treats a null/undefined database value as unverified', () => {
    // A null must not be coerced to "verified" by a truthiness check.
    expect(phoneVerificationState(null).phoneVerified).toBe(false);
    expect(phoneVerificationState(undefined).phoneVerified).toBe(false);
  });

  it('only reports verified when the flag is strictly true', () => {
    expect(phoneVerificationState(true).phoneVerified).toBe(true);
  });
});

describe('Masking hides the subscriber number', () => {
  it('keeps only the last two digits', () => {
    const masked = maskPhone('+919876543210')!;
    expect(masked.endsWith('10')).toBe(true);
    expect(masked).not.toContain('9876');
    expect(masked).not.toContain('543');
    expect(masked).not.toContain('91');
  });

  it('keeps the leading plus so it still reads as a number', () => {
    expect(maskPhone('+919876543210')!.startsWith('+')).toBe(true);
  });

  it('never leaks more than two digits for any length', () => {
    for (const value of ['9876543210', '+919876543210', '+14155552671', '12345']) {
      const masked = maskPhone(value)!;
      const revealed = (masked.match(/\d/g) || []).length;
      expect(revealed).toBeLessThanOrEqual(2);
    }
  });

  it('returns null for a missing number rather than a fake placeholder', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('')).toBeNull();
  });
});

describe('Dev-echoed codes are not evidence of ownership', () => {
  it('is detectable so callers can refuse to mark a number verified', () => {
    // The login path uses this: a code printed to the server console proves
    // only log access. In production it is always false.
    expect(typeof isOtpDevEchoOnly()).toBe('boolean');
    if (process.env.NODE_ENV === 'production') {
      expect(isOtpDevEchoOnly()).toBe(false);
    }
  });
});

// NOTE: env vars are set here AND the otp module is imported dynamically,
// because ES static imports hoist above these assignments while env.ts
// validates at import time.
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';
process.env.RAZORPAY_KEY_ID = 'rzp_test_placeholder';
process.env.RAZORPAY_KEY_SECRET = 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'test_webhook';
process.env.CLERK_SECRET_KEY = 'sk_test_placeholder';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_placeholder';
process.env.CLERK_JWKS_URL = 'https://test.clerk.accounts.dev/.well-known/jwks.json';
process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.SMTP_HOST = 'smtp.test.com';
process.env.SMTP_USER = 'test@test.com';
process.env.SMTP_PASS = 'testpass';
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
process.env.FIREBASE_SERVICE_ACCOUNT = '{"type":"service_account","project_id":"test"}';

import { describe, it, expect, beforeAll } from 'vitest';

let generateOTP: (length?: number) => string;
let hashOTP: (otp: string) => string;
let verifyOTP: (otp: string, hash: string) => boolean;

beforeAll(async () => {
  const mod = await import('../utils/otp.js');
  generateOTP = mod.generateOTP;
  hashOTP = mod.hashOTP;
  verifyOTP = mod.verifyOTP;
});

describe('OTP utilities', () => {
  it('generates a 6-digit OTP by default', () => {
    const otp = generateOTP();
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  it('generates OTP of specified length', () => {
    const otp = generateOTP(4);
    expect(otp).toHaveLength(4);
  });

  it('generates unique OTPs', () => {
    const otps = new Set(Array.from({ length: 50 }, () => generateOTP()));
    expect(otps.size).toBeGreaterThan(1);
  });

  it('hashOTP returns a sha256 hex string', () => {
    const hash = hashOTP('123456');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('hashOTP is deterministic', () => {
    expect(hashOTP('123456')).toBe(hashOTP('123456'));
  });

  it('verifyOTP returns true for matching pair', () => {
    const otp = '654321';
    expect(verifyOTP(otp, hashOTP(otp))).toBe(true);
  });

  it('verifyOTP returns false for wrong OTP', () => {
    expect(verifyOTP('000000', hashOTP('123456'))).toBe(false);
  });

  it('verifyOTP returns false for empty inputs', () => {
    expect(verifyOTP('', hashOTP('123456'))).toBe(false);
    expect(verifyOTP('123456', '')).toBe(false);
  });
});

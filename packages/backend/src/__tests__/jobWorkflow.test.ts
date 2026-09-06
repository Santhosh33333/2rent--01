import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    booking: { findUnique: mockFindUnique, findFirst: mockFindUnique, update: mockFindUnique, updateMany: mockFindUnique },
    partner: { findUnique: mockFindUnique },
    pricingConfig: { findFirst: mockFindUnique, findUnique: mockFindUnique, findMany: mockFindUnique },
    notification: { create: mockFindUnique },
    bookingLog: { create: mockFindUnique },
  },
}));

import { assertTransition, canTransition } from '../services/bookingStateMachine';
import {
  hashOtp,
  isExpired,
  isWithinStartWindow,
  verifyOtpHash,
} from '../services/jobWorkflowService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('job workflow state machine (spec 84/100/113)', () => {
  it('REJECTS instant completion after accept', () => {
    expect(canTransition('PARTNER_ACCEPTED', 'COMPLETED')).toBe(false);
    expect(() => assertTransition('PARTNER_ACCEPTED', 'COMPLETED')).toThrow();
  });

  it('REJECTS direct start after accept (must go via start OTP)', () => {
    expect(canTransition('PARTNER_ACCEPTED', 'IN_PROGRESS')).toBe(false);
    expect(() => assertTransition('PARTNER_ACCEPTED', 'IN_PROGRESS')).toThrow();
  });

  it('REJECTS direct completion from in-progress (must request + verify OTP)', () => {
    expect(canTransition('IN_PROGRESS', 'COMPLETED')).toBe(false);
    expect(() => assertTransition('IN_PROGRESS', 'COMPLETED')).toThrow();
  });

  it('ALLOWS the controlled path', () => {
    expect(canTransition('PARTNER_ACCEPTED', 'OTP_GENERATED')).toBe(true);
    expect(canTransition('OTP_GENERATED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'COMPLETION_REQUESTED')).toBe(true);
    expect(canTransition('COMPLETION_REQUESTED', 'COMPLETED')).toBe(true);
  });
});

describe('start/completion OTP (spec 90/95/113)', () => {
  it('verifies a correct OTP', () => {
    const otp = '482731';
    expect(verifyOtpHash(otp, hashOtp(otp))).toBe(true);
  });

  it('REJECTS a wrong OTP', () => {
    expect(verifyOtpHash('000000', hashOtp('482731'))).toBe(false);
  });

  it('REJECTS empty OTP inputs', () => {
    expect(verifyOtpHash('', hashOtp('482731'))).toBe(false);
    expect(verifyOtpHash('482731', '')).toBe(false);
  });

  it('detects expired OTPs', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 10 * 60_000).toISOString())).toBe(false);
  });
});

describe('scheduled time window (spec 87/88/113)', () => {
  it('REJECTS starting a future booking days early', () => {
    const scheduled = new Date(Date.now() + 3 * 24 * 60_000); // 3 days out
    expect(isWithinStartWindow(scheduled, new Date(), 30)).toBe(false);
  });

  it('ALLOWS starting inside the window', () => {
    const scheduled = new Date(Date.now() + 5 * 60_000); // in 5 min
    expect(isWithinStartWindow(scheduled, new Date(), 30)).toBe(true);
  });

  it('ALLOWS starting after the scheduled time', () => {
    const scheduled = new Date(Date.now() - 5 * 60_000); // 5 min ago
    expect(isWithinStartWindow(scheduled, new Date(), 30)).toBe(true);
  });
});

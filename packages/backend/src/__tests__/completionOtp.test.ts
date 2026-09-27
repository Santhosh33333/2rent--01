import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => {
  const booking = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  return { prismaMock: { booking } };
});

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/bookingLogService', () => ({ logBookingTransition: vi.fn(async () => undefined) }));
vi.mock('../services/aiMonitorService', () => ({ checkOtpAbuse: vi.fn(async () => undefined) }));
vi.mock('../services/pricingEngine', () => ({ getConfig: vi.fn(() => ({})) }));
vi.mock('../services/bookingStateMachine', () => ({ assertTransition: vi.fn() }));

import {
  COMPLETION_OTP_TTL_MIN,
  issueCompletionOtp,
  hashOtp,
  verifyOtpHash,
} from '../services/jobWorkflowService';

const USER_ID = 'user-1';
const BOOKING_ID = 'booking-1';

function bookingRow(notes: Record<string, any> | null) {
  return { id: BOOKING_ID, userId: USER_ID, status: 'COMPLETION_REQUESTED', notes: notes ? JSON.stringify(notes) : null };
}

let now: Date;

beforeEach(() => {
  vi.clearAllMocks();
  now = new Date('2026-09-27T10:00:00.000Z');
  prismaMock.booking.update.mockImplementation(async ({ data }: any) => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow(JSON.parse(data.notes)));
    return { id: BOOKING_ID };
  });
});

describe('issueCompletionOtp', () => {
  it('mints and returns a plaintext code when none is live', async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow(null));

    const result = await issueCompletionOtp(BOOKING_ID, USER_ID, now);

    expect(result).toHaveProperty('otp');
    expect((result as { otp: string }).otp).toMatch(/^\d{6}$/);
    expect(prismaMock.booking.update).toHaveBeenCalledTimes(1);
  });

  it('does NOT rotate a still-valid code, so a code already read out stays usable', async () => {
    // requestCompletion already issued this code and delivered the plaintext by
    // notification; the user may already have read it to the partner.
    const originalOtp = '123456';
    prismaMock.booking.findUnique.mockResolvedValue(
      bookingRow({
        completionOtp: {
          hash: hashOtp(originalOtp),
          expiresAt: new Date(now.getTime() + COMPLETION_OTP_TTL_MIN * 60_000).toISOString(),
          attempts: 0,
          verifiedAt: null,
        },
      }),
    );

    const result = await issueCompletionOtp(BOOKING_ID, USER_ID, now);

    // Must report the existing code rather than minting a replacement...
    expect(result).toEqual({ alreadyIssued: true, expiresAt: expect.any(String) });
    expect(result).not.toHaveProperty('otp');
    // ...and must not write a new hash, which is what invalidated it before.
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  it('mints a new code once the previous one has expired', async () => {
    prismaMock.booking.findUnique.mockResolvedValue(
      bookingRow({
        completionOtp: {
          hash: hashOtp('123456'),
          expiresAt: new Date(now.getTime() - 1000).toISOString(),
          attempts: 0,
          verifiedAt: null,
        },
      }),
    );

    const result = await issueCompletionOtp(BOOKING_ID, USER_ID, now);

    expect(result).toHaveProperty('otp');
    expect(prismaMock.booking.update).toHaveBeenCalledTimes(1);
  });

  it('mints a new code once the previous one is used up by wrong attempts', async () => {
    prismaMock.booking.findUnique.mockResolvedValue(
      bookingRow({
        completionOtp: {
          hash: hashOtp('123456'),
          expiresAt: new Date(now.getTime() + COMPLETION_OTP_TTL_MIN * 60_000).toISOString(),
          attempts: 5,
          verifiedAt: null,
        },
      }),
    );

    const result = await issueCompletionOtp(BOOKING_ID, USER_ID, now);

    expect(result).toHaveProperty('otp');
    expect(prismaMock.booking.update).toHaveBeenCalledTimes(1);
  });

  it('never returns a plaintext code for a code it did not just mint', async () => {
    // Guards the specific failure: rotating wrote a fresh hash, so the partner
    // holding the previously delivered code was rejected as INVALID_OTP until
    // the attempt limit locked the booking.
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow(null));
    const first = await issueCompletionOtp(BOOKING_ID, USER_ID, now);
    const firstOtp = (first as { otp: string }).otp;

    // Same booking, code still live: the stored hash must still match the
    // plaintext the user already received.
    const stored = JSON.parse(prismaMock.booking.update.mock.calls.at(-1)![0].data.notes);
    expect(verifyOtpHash(firstOtp, stored.completionOtp.hash)).toBe(true);

    const second = await issueCompletionOtp(BOOKING_ID, USER_ID, now);
    expect(second).not.toHaveProperty('otp');
    expect(verifyOtpHash(firstOtp, stored.completionOtp.hash)).toBe(true);
  });

  it('refuses to show the code to anyone but the booking owner', async () => {
    prismaMock.booking.findUnique.mockResolvedValue(bookingRow(null));

    await expect(issueCompletionOtp(BOOKING_ID, 'someone-else', now)).rejects.toThrow(/booking owner/);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  it('refuses before the partner has requested completion', async () => {
    prismaMock.booking.findUnique.mockResolvedValue({ ...bookingRow(null), status: 'IN_PROGRESS' });

    await expect(issueCompletionOtp(BOOKING_ID, USER_ID, now)).rejects.toThrow(/after the partner requests/);
  });
});

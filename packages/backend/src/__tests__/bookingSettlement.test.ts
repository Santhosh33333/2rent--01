import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfigFindFirst } = vi.hoisted(() => ({
  mockConfigFindFirst: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    pricingConfig: { findFirst: mockConfigFindFirst, findMany: vi.fn() },
  },
}));

import { finalizeBookingPrice } from '../services/bookingEngine';

// Flat 10/min, no distance/surcharges, no platform fee and no minimum floor, so
// the fare is exactly actualMinutes * 10 and the assertions stay readable.
// Platform-fee arithmetic is covered by pricing.test.ts; this file isolates the
// refund / overage / insufficient-balance settlement paths.
const SNAPSHOT = {
  baseFee: 0,
  perMinutePrice: 10,
  perKmPrice: 0,
  bookingFee: 0,
  serviceFee: 0,
  discountPercent: 0,
  taxPercent: 0,
  platformFeePercent: 0,
  minBooking: 0,
  perMinuteAfter30: 10,
  nightCharge: 0,
  rainCharge: 0,
  rainEnabled: 0,
  festivalEnabled: 0,
  surgeMultiplier: 1,
};

function makeTx(startingBalance: number) {
  const wallet = { id: 'wallet-1', userId: 'user-1', balance: startingBalance };
  const calls = {
    txn: [] as any[],
    notifications: [] as any[],
    decrements: [] as number[],
    increments: [] as number[],
  };
  const tx = {
    booking: {
      findUnique: async () => ({
        id: 'booking-1',
        userId: 'user-1',
        serviceType: 'HOME_CLEANING',
        estimatedAmount: 600, // 60 minutes booked
        pricingSnapshot: SNAPSHOT,
        startedAt: new Date('2026-09-27T10:00:00Z'),
        startLatitude: null,
        startLongitude: null,
        endLatitude: null,
        endLongitude: null,
      }),
      update: async () => ({}),
    },
    wallet: {
      upsert: async () => wallet,
      update: async (args: any) => {
        if (args.data.balance?.decrement !== undefined) {
          calls.decrements.push(Number(args.data.balance.decrement));
        }
        if (args.data.balance?.increment !== undefined) {
          calls.increments.push(Number(args.data.balance.increment));
        }
        return wallet;
      },
    },
    transaction: {
      create: async (args: any) => {
        calls.txn.push(args.data);
        return args.data;
      },
    },
    notification: {
      create: async (args: any) => {
        calls.notifications.push(args.data);
        return args.data;
      },
    },
  };
  return { tx, calls, startingBalance };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigFindFirst.mockResolvedValue(null);
});

describe('finalizeBookingPrice', () => {
  it('refunds the user when the job finished under the booked time', async () => {
    // Booked 60 min, actually ran 25 min -> fare 250, deposit was 600.
    const { tx, calls } = makeTx(0);
    const r = await finalizeBookingPrice('booking-1', 25, 0, tx);

    expect(r.finalAmount).toBe(250);
    expect(r.refunded).toBe(350);
    expect(r.extraDebited).toBe(0);
    expect(r.unpaidOverage).toBe(0);
    expect(calls.increments).toEqual([350]);
    expect(calls.txn.some((t) => t.type === 'REFUND' && Number(t.amount) === 350)).toBe(true);
    // Partner is paid only for the time actually worked.
    expect(r.partnerEarning).toBe(250);
  });

  it('debits the overage when the job outran the booked time', async () => {
    // Booked 60 min, actually ran 100 min -> fare 1000, deposit was 600.
    const { tx, calls, startingBalance } = makeTx(5000);
    const r = await finalizeBookingPrice('booking-1', 100, 0, tx);

    // This is the assertion the old Math.min() cap made impossible.
    expect(r.finalAmount).toBe(1000);
    expect(r.finalAmount).toBeGreaterThan(600);
    expect(r.refunded).toBe(0);
    expect(r.extraDebited).toBe(400);
    expect(r.unpaidOverage).toBe(0);
    expect(calls.decrements).toEqual([400]);
    // Never overdrafts a wallet that can afford it.
    expect(r.extraDebited).toBeLessThanOrEqual(startingBalance);
    expect(calls.txn.some((t) => t.type === 'DEBIT' && Number(t.amount) === 400)).toBe(true);
    expect(calls.notifications).toHaveLength(0);
    expect(r.partnerEarning).toBe(1000);
  });

  it('caps the overage at the available balance instead of going negative', async () => {
    // Overage is 400 but the user only has 150 in the wallet.
    const { tx, calls, startingBalance } = makeTx(150);
    const r = await finalizeBookingPrice('booking-1', 100, 0, tx);

    expect(r.finalAmount).toBe(1000);
    expect(r.extraDebited).toBe(150);
    expect(r.unpaidOverage).toBe(250);

    // The wallet is drained to exactly zero, never debited past what it held.
    expect(calls.decrements).toEqual([150]);
    expect(r.extraDebited).toBeLessThanOrEqual(startingBalance);
    expect(startingBalance - r.extraDebited).toBe(0);

    const collected = calls.txn.filter((t) => t.type === 'DEBIT' && t.status === 'SUCCESS');
    const pending = calls.txn.filter((t) => t.type === 'DEBIT' && t.status === 'PENDING');
    expect(collected).toHaveLength(1);
    expect(Number(collected[0].amount)).toBe(150);
    expect(pending).toHaveLength(1);
    expect(Number(pending[0].amount)).toBe(250);

    // The user is told to top up rather than silently owing money.
    expect(calls.notifications).toHaveLength(1);
    expect(calls.notifications[0].userId).toBe('user-1');
    expect(calls.notifications[0].body).toContain('250.00');
  });
});

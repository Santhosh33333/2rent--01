import { describe, expect, it, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

/**
 * The rules that make the event cost sheet safe to trust.
 *
 * These run against a mocked prisma so they assert the sequence of writes and
 * the conditional guards, not a database. The point being pinned down is that a
 * price edit after money has been collected must never rewrite history, and a
 * duplicate payment must never move money twice.
 */

const hoisted = vi.hoisted(() => ({
  eventShare: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  eventAttendee: { findMany: vi.fn(), findUnique: vi.fn(), findManyMany: undefined },
  event: { findUnique: vi.fn(), update: vi.fn() },
  wallet: { findUnique: vi.fn(), update: vi.fn() },
  walkingPartner: { findUnique: vi.fn() },
  transaction: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  // Added with the escrow. `payMyShare` no longer debits the wallet directly: it
  // parks the fee in `heldBalance` through a guarded raw UPDATE and writes a
  // ledger row, so both of these are part of the payment path now.
  eventEscrow: { findUnique: vi.fn(), create: vi.fn() },
  // The guarded reserve. Returning one row means "the hold was applied";
  // returning none is what makes an insufficient balance a refusal.
  // Named `$queryRaw` because this object is passed straight through as the
  // transaction client, and the service calls `tx.$queryRaw`.
  $queryRaw: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    eventShare: hoisted.eventShare,
    eventAttendee: hoisted.eventAttendee,
    event: hoisted.event,
    wallet: hoisted.wallet,
    walkingPartner: hoisted.walkingPartner,
    transaction: hoisted.transaction,
    auditLog: hoisted.auditLog,
    eventEscrow: hoisted.eventEscrow,
    $queryRaw: hoisted.$queryRaw,
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(hoisted),
  },
}));

import {
  MAX_SHARE_AMOUNT,
  MIN_SHARE_AMOUNT,
  EventPaymentError,
  getCostSheet,
  normaliseAmount,
  payMyShare,
  setPerPersonAmount,
  waiveShare,
} from '../services/eventPaymentService';

const ORG = 'organizer-1';
const PAYER = 'payer-1';
const OTHER = 'payer-2';

beforeEach(() => {
  vi.clearAllMocks();
  // In the future, so `payMyShare`'s "already started" guard does not fire and the
  // escrow deadline can be derived. The fixture previously had no times at all,
  // which read as undefined and would have thrown.
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  hoisted.event.findUnique.mockResolvedValue({
    id: 'ev1',
    title: 'Test event',
    organizerId: ORG,
    price: null,
    currency: 'INR',
    status: 'PUBLISHED',
    attendeeCount: 2,
    capacity: 10,
    startTime: soon,
    endTime: new Date(soon.getTime() + 2 * 60 * 60 * 1000),
  });
  hoisted.event.update.mockResolvedValue({});
  hoisted.auditLog.create.mockResolvedValue({});
  hoisted.transaction.create.mockResolvedValue({});
  // Only surfaced to the organizer, and only when they have one.
  hoisted.walkingPartner.findUnique.mockResolvedValue({ upiId: null });
  hoisted.eventEscrow.findUnique.mockResolvedValue(null);
  hoisted.eventEscrow.create.mockResolvedValue({ id: 'esc1' });
  // Default: the guarded reserve matched one row, i.e. funds were available.
  hoisted.$queryRaw.mockResolvedValue([{ id: 'w1' }]);
});

describe('normaliseAmount', () => {
  it('accepts whole numbers and numeric strings', () => {
    expect(Number(normaliseAmount(300))).toBe(300);
    expect(Number(normaliseAmount('450'))).toBe(450);
  });

  it('keeps paise precision rather than truncating', () => {
    expect(Number(normaliseAmount(275.5))).toBe(275.5);
  });

  it('rejects amounts that cannot be explained to a person', () => {
    expect(() => normaliseAmount(0)).toThrow(/at least/i);
    expect(() => normaliseAmount(-5)).toThrow(/at least/i);
    expect(() => normaliseAmount('abc')).toThrow(/valid amount/i);
    expect(() => normaliseAmount(Number.NaN)).toThrow(/valid amount/i);
    expect(() => normaliseAmount(MAX_SHARE_AMOUNT + 1)).toThrow(/cannot be more than/i);
  });

  it('exposes sane bounds', () => {
    expect(MIN_SHARE_AMOUNT).toBeGreaterThan(0);
    expect(MAX_SHARE_AMOUNT).toBeLessThanOrEqual(1_000_000);
  });
});

describe('getCostSheet', () => {
  it('reports the headcount even before a rate exists', async () => {
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER, status: 'REGISTERED' },
      { userId: OTHER, status: 'REGISTERED' },
    ]);
    hoisted.eventShare.findMany.mockResolvedValue([]);

    const sheet = await getCostSheet('ev1', ORG);

    expect(sheet.headcount).toBe(2);
    expect(sheet.perPerson).toBeNull();
    expect(sheet.total).toBeNull();
    expect(sheet.presets.length).toBeGreaterThan(0);
  });

  it('derives the total rather than reading one', async () => {
    hoisted.event.findUnique.mockResolvedValue({
      id: 'ev1',
      title: 'Test event',
      organizerId: ORG,
      price: 300,
      currency: 'INR',
      status: 'PUBLISHED',
      attendeeCount: 2,
      capacity: 10,
    });
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER, status: 'REGISTERED' },
      { userId: OTHER, status: 'REGISTERED' },
    ]);
    hoisted.eventShare.findMany.mockResolvedValue([
      { userId: PAYER, amount: 300, status: 'PAID', paidAt: new Date() },
      { userId: OTHER, amount: 300, status: 'PENDING', paidAt: null },
    ]);

    const sheet = await getCostSheet('ev1', ORG);

    expect(sheet.total).toBe(600);
    expect(sheet.collected).toBe(300);
    expect(sheet.outstanding).toBe(300);
  });

  it('does not charge a cancelled attendee', async () => {
    hoisted.event.findUnique.mockResolvedValue({
      id: 'ev1',
      title: 'Test event',
      organizerId: ORG,
      price: 300,
      currency: 'INR',
      status: 'PUBLISHED',
      attendeeCount: 2,
      capacity: null,
    });
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER, status: 'REGISTERED' },
      { userId: OTHER, status: 'CANCELLED' },
    ]);
    hoisted.eventShare.findMany.mockResolvedValue([]);

    const sheet = await getCostSheet('ev1', ORG);

    expect(sheet.headcount).toBe(1);
    expect(sheet.total).toBe(300);
  });

  it('hides the payment list from attendees', async () => {
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER, status: 'REGISTERED' },
    ]);
    hoisted.eventShare.findMany.mockResolvedValue([]);

    const attendee = await getCostSheet('ev1', PAYER);
    const organizer = await getCostSheet('ev1', ORG);

    expect(attendee.rows).toHaveLength(0);
    expect(organizer.rows).toHaveLength(1);
  });
});

describe('setPerPersonAmount', () => {
  it('refuses anyone who is not the organizer', async () => {
    await expect(setPerPersonAmount('ev1', PAYER, 300)).rejects.toThrow(EventPaymentError);
    expect(hoisted.event.update).not.toHaveBeenCalled();
  });

  it('creates a share for each registered attendee', async () => {
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER },
      { userId: OTHER },
    ]);
    hoisted.eventShare.findUnique.mockResolvedValue(null);
    hoisted.eventShare.findMany.mockResolvedValue([]);
    hoisted.eventAttendee.findMany.mockResolvedValue([
      { userId: PAYER, status: 'REGISTERED' },
      { userId: OTHER, status: 'REGISTERED' },
    ]);

    await setPerPersonAmount('ev1', ORG, 300);

    expect(hoisted.eventShare.create).toHaveBeenCalledTimes(2);
    expect(hoisted.event.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { price: 300 } }),
    );
  });

  it('re-prices only unpaid shares, so collected money is never rewritten', async () => {
    hoisted.eventAttendee.findMany.mockResolvedValue([{ userId: PAYER }, { userId: OTHER }]);
    hoisted.eventShare.findMany.mockResolvedValue([]);
    hoisted.eventAttendee.findMany
      .mockResolvedValueOnce([
        { userId: PAYER, status: 'REGISTERED' },
        { userId: OTHER, status: 'REGISTERED' },
      ])
      .mockResolvedValue([
        { userId: PAYER, status: 'REGISTERED' },
        { userId: OTHER, status: 'REGISTERED' },
      ]);
    // First attendee already paid, second has not.
    hoisted.eventShare.findUnique
      .mockResolvedValueOnce({ id: 's1', status: 'PAID' })
      .mockResolvedValueOnce({ id: 's2', status: 'PENDING' });

    await setPerPersonAmount('ev1', ORG, 500);

    expect(hoisted.eventShare.update).toHaveBeenCalledTimes(1);
    expect(hoisted.eventShare.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's2' } }),
    );
  });
});

describe('payMyShare', () => {
  beforeEach(() => {
    hoisted.eventAttendee.findUnique.mockResolvedValue({ id: 'att1' });
  });

  /**
   * The fee is HELD, not spent.
   *
   * This is the behaviour change that fixes the real bug: the old code called
   * `wallet.update({ balance: { decrement } })` and nothing ever credited the
   * organizer, so the money left the payer and reached no one. Now the money is
   * reserved via `heldBalance` and released to the organizer (or refunded) later
   * by the settlement service. `wallet.update` must therefore NOT be called on
   * this path at all - if it ever is again, the money is being destroyed.
   */
  it('holds the fee in escrow rather than spending it', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({
      id: 's1',
      amount: 300,
      status: 'PENDING',
    });
    hoisted.eventShare.updateMany.mockResolvedValue({ count: 1 });
    hoisted.wallet.findUnique.mockResolvedValue({ id: 'w1', balance: 5000, heldBalance: 0 });

    await payMyShare('ev1', PAYER);

    // The money must not leave the payer's balance here.
    expect(hoisted.wallet.update).not.toHaveBeenCalled();
    // It must be reserved with a guarded update, not a blind write.
    expect(hoisted.$queryRaw).toHaveBeenCalled();
    // And there must be a ledger row saying where the money went.
    expect(hoisted.eventEscrow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventShareId: 's1',
          payerId: PAYER,
          organizerId: ORG,
        }),
      }),
    );
    expect(hoisted.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'EVENT_ESCROW_HELD' }),
      }),
    );
  });

  it('refuses when the spendable balance cannot cover it', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', amount: 300, status: 'PENDING' });
    hoisted.wallet.findUnique.mockResolvedValue({ id: 'w1', balance: 100, heldBalance: 0 });

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/too low/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });

  it('counts money already reserved for something else as unavailable', async () => {
    // The regression this case pins: the old check read `balance` only, so a
    // user with 500 in their wallet but 500 reserved for a metered call could
    // commit the same 500 a second time.
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', amount: 300, status: 'PENDING' });
    hoisted.wallet.findUnique.mockResolvedValue({ id: 'w1', balance: 500, heldBalance: 400 });

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/too low/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });

  it('will not charge a share that was already paid', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', amount: 300, status: 'PAID' });

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/already paid/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });

  it('never guesses an amount the organizer has not set', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue(null);

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/has not set an amount/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });

  it('refuses a non-attendee', async () => {
    hoisted.eventAttendee.findUnique.mockResolvedValue(null);

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/not registered/i);
  });

  it('treats a lost conditional claim as already paid, not as a second charge', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', amount: 300, status: 'PENDING' });
    hoisted.wallet.findUnique.mockResolvedValue({ id: 'w1', balance: 5000, heldBalance: 0 });
    // A concurrent request took the share first.
    hoisted.eventShare.updateMany.mockResolvedValue({ count: 0 });

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/already paid/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });

  it('refuses to take a fee for an event that already started', async () => {
    // The organizer can no longer buy a seat for someone who arrives late, so
    // charging would be taking money for a service that cannot be delivered.
    const started = new Date(Date.now() - 60 * 60 * 1000);
    hoisted.event.findUnique.mockResolvedValue({
      id: 'ev1',
      title: 'Test event',
      organizerId: ORG,
      status: 'PUBLISHED',
      startTime: started,
      endTime: new Date(started.getTime() + 60 * 60 * 1000),
    });
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', amount: 300, status: 'PENDING' });

    await expect(payMyShare('ev1', PAYER)).rejects.toThrow(/already started/i);
    expect(hoisted.eventEscrow.create).not.toHaveBeenCalled();
  });
});

describe('waiveShare', () => {
  it('refuses after the money has already been collected', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', status: 'PAID' });

    await expect(waiveShare('ev1', ORG, PAYER)).rejects.toThrow(/already been paid/i);
    expect(hoisted.eventShare.update).not.toHaveBeenCalled();
  });

  it('refuses a non-organizer', async () => {
    hoisted.eventShare.findUnique.mockResolvedValue({ id: 's1', status: 'PENDING' });

    await expect(waiveShare('ev1', PAYER, PAYER)).rejects.toThrow(EventPaymentError);
    expect(hoisted.eventShare.update).not.toHaveBeenCalled();
  });
});

describe('bcrypt availability', () => {
  it('is importable for fixtures', () => {
    expect(typeof bcrypt.hashSync).toBe('function');
  });
});

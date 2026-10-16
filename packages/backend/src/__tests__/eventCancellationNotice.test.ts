import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cancelling an event used to be silent, and it used to leave the money alone.
 *
 * notificationController has carried an EVENT_CANCELLED builder since the
 * notifications were written, but nothing ever called it, so attendees kept
 * plans for an event that no longer existed. And because the escrow sweeper
 * releases any still-HELD hold once the event's own end time plus the dispute
 * window passes -- a deadline cancelling does not move -- a cancelled-and-paid
 * event would have paid the organizer for an event that never ran.
 *
 * updateEvent now refunds every unsettled hold (the amount was only ever
 * reserved in `heldBalance`, so refunding is an internal un-hold needing no
 * gateway call), freezes whatever a refund could not settle so it still cannot
 * auto-release, and only then fires the notice -- in that order, because the
 * money matters more than the message. Pinned here: who hears about it, that
 * the refund runs exactly once and first, and that a re-save or an ordinary
 * edit repeats neither.
 *
 * The refund loop and the freeze itself run against the real Prisma layer in
 * eventEscrow.test.ts; here they are spies so the controller's ordering is
 * visible.
 */

const prismaMock = vi.hoisted(() => ({
  event: { findUnique: vi.fn(), update: vi.fn() },
  eventAttendee: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../controllers/notificationController', () => ({ notifyEventUpdate: vi.fn() }));
// Spies rather than stubs: every other export stays real, so a new call from
// updateEvent into the escrow service still lands on real code instead of
// silently vanishing behind a mocked module.
vi.mock('../services/eventEscrowService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/eventEscrowService')>();
  return {
    ...actual,
    refundAllEscrowsForEvent: vi.fn().mockResolvedValue({ refunded: 2, skipped: 0, failed: 0 }),
    freezeAllEscrowsForEvent: vi.fn().mockResolvedValue(0),
  };
});

import { updateEvent } from '../controllers/eventController';
import { notifyEventUpdate } from '../controllers/notificationController';
import { refundAllEscrowsForEvent, freezeAllEscrowsForEvent } from '../services/eventEscrowService';

const ME = 'organizer-1';
const EVENT = 'event-1';

// 12:00 UTC is 17:30 IST, comfortably inside the 6 AM - 10 PM event window.
const START = new Date('2026-06-10T12:00:00Z');
const END = new Date('2026-06-10T13:00:00Z');

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function makeReq(body: Record<string, unknown>) {
  return { body, params: { id: EVENT }, user: { userId: ME } } as any;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

function publishedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    title: 'Rooftop Jam',
    description: null,
    location: 'Terrace',
    organizerId: ME,
    startTime: START,
    endTime: END,
    timezone: null,
    capacity: 20,
    status: 'PUBLISHED',
    coverImageUrl: null,
    category: 'music',
    subcategory: null,
    privacy: 'PUBLIC',
    price: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.event.findUnique.mockResolvedValue(publishedEvent());
  prismaMock.event.update.mockImplementation(async (args: any) => ({ ...publishedEvent(), ...args.data }));
  prismaMock.eventAttendee.findMany.mockResolvedValue([{ userId: 'friend-1' }, { userId: 'friend-2' }]);
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe('updateEvent — cancellation notice', () => {
  it('notifies the attendees who are still going, never the organizer', async () => {
    const res = makeRes();
    await updateEvent(makeReq({ status: 'CANCELLED' }), res);

    expect(body(res).success).toBe(true);
    expect(notifyEventUpdate).toHaveBeenCalledTimes(1);
    const [eventId, eventName, type, userIds] = (notifyEventUpdate as any).mock.calls[0];
    expect(eventId).toBe(EVENT);
    expect(eventName).toBe('Rooftop Jam');
    expect(type).toBe('EVENT_CANCELLED');
    expect(userIds).toEqual(['friend-1', 'friend-2']);

    // The audience query must exclude the organizer and cancelled RSVPs.
    const where = prismaMock.eventAttendee.findMany.mock.calls[0][0].where;
    expect(where.eventId).toBe(EVENT);
    expect(where.userId).toEqual({ not: ME });
    expect(where.status).toEqual({ not: 'CANCELLED' });
  });

  it('does not notify twice when an already-cancelled event is saved again', async () => {
    prismaMock.event.findUnique.mockResolvedValue(publishedEvent({ status: 'CANCELLED' }));

    const res = makeRes();
    await updateEvent(makeReq({ status: 'CANCELLED' }), res);

    expect(body(res).success).toBe(true);
    expect(notifyEventUpdate).not.toHaveBeenCalled();
    expect(prismaMock.eventAttendee.findMany).not.toHaveBeenCalled();
    // The money must not be touched again either: a second refund run would
    // be caught row by row, but the transition is the signal, not the body.
    expect(refundAllEscrowsForEvent).not.toHaveBeenCalled();
    expect(freezeAllEscrowsForEvent).not.toHaveBeenCalled();
  });

  it('treats an ordinary edit as an edit, not a cancellation', async () => {
    const res = makeRes();
    await updateEvent(makeReq({ title: 'Rooftop Jam (new name)' }), res);

    expect(body(res).success).toBe(true);
    expect(notifyEventUpdate).not.toHaveBeenCalled();
    // Renaming an event must never return anyone's money.
    expect(refundAllEscrowsForEvent).not.toHaveBeenCalled();
    expect(freezeAllEscrowsForEvent).not.toHaveBeenCalled();
  });
});

describe('updateEvent — cancellation escrow', () => {
  it('refunds the held fees, then freezes what is left, before it tells anyone', async () => {
    const res = makeRes();
    await updateEvent(makeReq({ status: 'CANCELLED' }), res);

    expect(body(res).success).toBe(true);

    expect(refundAllEscrowsForEvent).toHaveBeenCalledTimes(1);
    const [refundedEventId, note] = (refundAllEscrowsForEvent as any).mock.calls[0];
    expect(refundedEventId).toBe(EVENT);
    // This note is what the payer is shown, so it has to say both what happened
    // and that their money is coming back.
    expect(note).toMatch(/cancel/i);
    expect(note).toMatch(/refund/i);

    // The freeze is only the fallback for holds a refund could not settle, so
    // it must follow the refund: freezing first would dispute the very rows the
    // refund is about to return and leave the payer stuck in the admin queue.
    expect(freezeAllEscrowsForEvent).toHaveBeenCalledTimes(1);
    const [frozenEventId, frozenAt] = (freezeAllEscrowsForEvent as any).mock.calls[0];
    expect(frozenEventId).toBe(EVENT);
    expect(frozenAt).toBeInstanceOf(Date);

    const refundOrder = (refundAllEscrowsForEvent as any).mock.invocationCallOrder[0];
    const freezeOrder = (freezeAllEscrowsForEvent as any).mock.invocationCallOrder[0];
    const notifyOrder = (notifyEventUpdate as any).mock.invocationCallOrder[0];
    expect(refundOrder).toBeLessThan(freezeOrder);
    expect(freezeOrder).toBeLessThan(notifyOrder);
  });
});

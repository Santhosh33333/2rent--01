import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Cancelling an event used to be silent.
 *
 * notificationController has carried an EVENT_CANCELLED builder since the
 * notifications were written, but nothing ever called it, so attendees kept
 * plans for an event that no longer existed. updateEvent now fires it on the
 * transition into CANCELLED. These pin the three properties that matter: the
 * people who are still going hear about it, nobody hears twice, and an
 * ordinary edit is not a cancellation.
 */

const prismaMock = vi.hoisted(() => ({
  event: { findUnique: vi.fn(), update: vi.fn() },
  eventAttendee: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../controllers/notificationController', () => ({ notifyEventUpdate: vi.fn() }));

import { updateEvent } from '../controllers/eventController';
import { notifyEventUpdate } from '../controllers/notificationController';

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
  });

  it('treats an ordinary edit as an edit, not a cancellation', async () => {
    const res = makeRes();
    await updateEvent(makeReq({ title: 'Rooftop Jam (new name)' }), res);

    expect(body(res).success).toBe(true);
    expect(notifyEventUpdate).not.toHaveBeenCalled();
  });
});

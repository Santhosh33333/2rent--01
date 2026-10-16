import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Deleting an event is a hard delete, and EventEscrow cascades with it (via the
 * event and its EventShare). Settlement is the only code that un-holds a payer's
 * wallet, so deleting an event that still holds money would leave that money
 * reserved in the payer's heldBalance with no row left to refund it. deleteEvent
 * now refuses when any hold is still HELD or DISPUTED and points the organizer at
 * the cancel-then-settle path. These pin the refusal, the where it filters on,
 * and that a genuinely settled (or free) event still deletes.
 */

const prismaMock = vi.hoisted(() => ({
  event: { findUnique: vi.fn(), delete: vi.fn() },
  eventAttendee: { deleteMany: vi.fn() },
  eventEscrow: { count: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));

import { deleteEvent } from '../controllers/eventController';

const ME = 'organizer-1';
const EVENT = 'event-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function makeReq(userId = ME) {
  return { params: { id: EVENT }, user: { userId } } as any;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

const ownedEvent = {
  id: EVENT,
  title: 'Rooftop Jam',
  organizerId: ME,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.event.findUnique.mockResolvedValue(ownedEvent);
  prismaMock.event.delete.mockResolvedValue(ownedEvent);
  prismaMock.eventAttendee.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue([]);
});

describe('deleteEvent — held escrow guard', () => {
  it('refuses to delete while money is still held', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(2);

    const res = makeRes();
    await deleteEvent(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = body(res);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('EVENT_HAS_UNSETTLED_ESCROW');
    // Nothing destructive ran.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.event.delete).not.toHaveBeenCalled();
    // The check must cover both non-terminal states.
    expect(prismaMock.eventEscrow.count).toHaveBeenCalledWith({
      where: { eventId: EVENT, status: { in: ['HELD', 'DISPUTED'] } },
    });
  });

  it('deletes when nothing is held (settled or free)', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(0);

    const res = makeRes();
    await deleteEvent(makeReq(), res);

    expect(body(res).success).toBe(true);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('still refuses a non-organizer before touching escrow', async () => {
    const res = makeRes();
    await deleteEvent(makeReq('someone-else'), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prismaMock.eventEscrow.count).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

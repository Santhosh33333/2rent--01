import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The event thread is a person-to-person channel like any other chat, so the
 * personal-data guard has to hold there too. These pin the wiring itself — the
 * detector already has its own cases in personalDataGuard.test.ts — plus the
 * ordering: authorisation answers before the message body is ever examined.
 */

// Mock the prisma surface sendEventMessage touches. vi.mock factories are
// hoisted, so the mock object itself is hoisted with them.
const prismaMock = vi.hoisted(() => ({
  event: { findUnique: vi.fn() },
  eventAttendee: { findUnique: vi.fn(), findMany: vi.fn() },
  eventGroupMessage: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/socketService', () => ({ emitToUser: vi.fn() }));

import { sendEventMessage } from '../controllers/eventChatController';
import { emitToUser } from '../services/socketService';
import { PERSONAL_DATA_ERROR_CODE, PERSONAL_DATA_ERROR_MESSAGE } from '../services/piiGuard';

const ME = 'user-me';
const EVENT = 'event-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function makeReq(opts: { body?: Record<string, unknown>; params?: Record<string, string>; userId?: string } = {}) {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    user: { userId: opts.userId ?? ME },
  } as any;
}
function statusOf(res: any) {
  return res.status.mock.calls[res.status.mock.calls.length - 1][0];
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the caller organises the event, so membership passes immediately.
  prismaMock.event.findUnique.mockResolvedValue({ id: EVENT, organizerId: ME, status: 'ACTIVE' });
  prismaMock.eventAttendee.findMany.mockResolvedValue([]);
  prismaMock.eventGroupMessage.create.mockImplementation(async (args: any) => ({
    id: 'msg-1',
    ...args.data,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    sender: { id: ME, fullName: 'Me', avatarUrl: null },
  }));
});

describe('sendEventMessage — personal-data guard', () => {
  it('refuses a message carrying a phone number and never stores it', async () => {
    const res = makeRes();
    await sendEventMessage(makeReq({ params: { id: EVENT }, body: { content: 'call me on 9876543210' } }), res);

    expect(statusOf(res)).toBe(403);
    expect(body(res).error).toBe(PERSONAL_DATA_ERROR_CODE);
    expect(body(res).message).toBe(PERSONAL_DATA_ERROR_MESSAGE);
    expect(prismaMock.eventGroupMessage.create).not.toHaveBeenCalled();
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('guards the caption of an image message as well', async () => {
    const res = makeRes();
    await sendEventMessage(
      makeReq({
        params: { id: EVENT },
        body: { content: 'mail jane@example.com', messageType: 'IMAGE', mediaUrl: '/uploads/pic.jpg' },
      }),
      res,
    );

    expect(statusOf(res)).toBe(403);
    expect(body(res).error).toBe(PERSONAL_DATA_ERROR_CODE);
    expect(prismaMock.eventGroupMessage.create).not.toHaveBeenCalled();
  });

  it('lets ordinary event talk through, stores it and fans it out', async () => {
    prismaMock.eventAttendee.findMany.mockResolvedValue([{ userId: 'friend-1' }]);
    const res = makeRes();
    await sendEventMessage(makeReq({ params: { id: EVENT }, body: { content: 'See you at the venue at 7!' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(body(res).success).toBe(true);
    expect(prismaMock.eventGroupMessage.create).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith('friend-1', 'event_message', expect.anything());
  });

  it('answers NOT_ATTENDING for a non-member before the body is examined', async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: EVENT, organizerId: 'someone-else', status: 'ACTIVE' });
    prismaMock.eventAttendee.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await sendEventMessage(makeReq({ params: { id: EVENT }, body: { content: 'call me on 9876543210' } }), res);

    expect(statusOf(res)).toBe(403);
    expect(body(res).error).toBe('NOT_ATTENDING');
    expect(prismaMock.eventGroupMessage.create).not.toHaveBeenCalled();
  });
});

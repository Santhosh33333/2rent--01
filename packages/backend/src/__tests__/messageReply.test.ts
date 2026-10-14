import { describe, it, expect, vi, beforeEach } from 'vitest';

// The reply guard and the clientId echo both live in the controller, so mock
// the exact prisma surface sendMessage touches. vi.mock factories are hoisted,
// so the mock object itself has to be hoisted with them.
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  userBlock: { findFirst: vi.fn() },
  conversation: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  message: { findUnique: vi.fn(), create: vi.fn() },
  booking: { findUnique: vi.fn(), findFirst: vi.fn() },
  chatRequest: { findFirst: vi.fn() },
  friendship: { findFirst: vi.fn() },
  match: { findFirst: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/socketService', () => ({ emitToUser: vi.fn() }));

import { sendMessage } from '../controllers/messageController';
import { sendError } from '../utils/response';

const SENDER = 'sender-1';
const RECEIVER = 'receiver-1';
const CONVO = 'convo-1';
const PARENT = 'parent-msg-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(body: Record<string, unknown>) {
  return { body, user: { userId: SENDER } } as any;
}

describe('sendMessage reply handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ id: RECEIVER });
    prismaMock.userBlock.findFirst.mockResolvedValue(null);
    // The pair already has a thread, so the ask-before-you-message gate treats
    // them as connected and the reply-handling under test is what runs.
    prismaMock.conversation.findUnique.mockResolvedValue({ id: CONVO, _count: { messages: 1 } });
    prismaMock.booking.findFirst.mockResolvedValue(null);
    prismaMock.chatRequest.findFirst.mockResolvedValue(null);
    prismaMock.friendship.findFirst.mockResolvedValue(null);
    prismaMock.match.findFirst.mockResolvedValue(null);
    prismaMock.conversation.upsert.mockResolvedValue({ id: CONVO });
    prismaMock.conversation.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
    prismaMock.message.create.mockImplementation(async ({ data }: any) => ({
      id: 'new-msg-1',
      senderId: data.senderId,
      content: data.content,
      messageType: data.messageType,
      mediaUrl: null,
      bookingId: null,
      replyToId: data.replyToId,
      createdAt: new Date(),
      sender: { id: SENDER, fullName: 'Sender', avatarUrl: null },
    }));
  });

  it('accepts a reply whose parent is in the same conversation', async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: PARENT,
      content: 'parent text',
      senderId: RECEIVER,
      messageType: 'TEXT',
      conversationId: CONVO,
      status: 'SENT',
    });

    const res = makeRes();
    await sendMessage(makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: PARENT }), res);

    expect(prismaMock.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ replyToId: PARENT }) }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('REJECTS a reply whose parent lives in another conversation', async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: PARENT,
      content: 'parent text',
      senderId: RECEIVER,
      messageType: 'TEXT',
      conversationId: 'some-other-conversation',
      status: 'SENT',
    });

    const res = makeRes();
    await sendMessage(makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: PARENT }), res);

    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('REJECTS a reply to a parent that does not exist (e.g. an unsent placeholder id)', async () => {
    // This is the client-side optimistic-placeholder case: a temp id has no row,
    // so the parent lookup misses and the send is refused rather than silently
    // posted without the reply link.
    prismaMock.message.findUnique.mockResolvedValue(null);

    const res = makeRes();
    await sendMessage(makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: 'temp-1-0' }), res);

    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('REJECTS a reply to a DELETED parent', async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: PARENT,
      content: 'parent text',
      senderId: RECEIVER,
      messageType: 'TEXT',
      conversationId: CONVO,
      status: 'DELETED',
    });

    const res = makeRes();
    await sendMessage(makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: PARENT }), res);

    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('echoes a well-formed clientId so the caller can reconcile its own bubble', async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: PARENT,
      content: 'parent text',
      senderId: RECEIVER,
      messageType: 'TEXT',
      conversationId: CONVO,
      status: 'SENT',
    });

    const res = makeRes();
    await sendMessage(
      makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: PARENT, clientId: 'temp-123-0' }),
      res,
    );

    const body = res.json.mock.calls[0][0];
    expect(body.data.clientId).toBe('temp-123-0');
  });

  it('drops an oversized or non-string clientId instead of echoing it back', async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: PARENT,
      content: 'parent text',
      senderId: RECEIVER,
      messageType: 'TEXT',
      conversationId: CONVO,
      status: 'SENT',
    });

    for (const bad of ['x'.repeat(65), 12345, { a: 1 }]) {
      const res = makeRes();
      await sendMessage(
        makeReq({ receiverId: RECEIVER, content: 'a reply', replyToId: PARENT, clientId: bad }),
        res,
      );
      const body = res.json.mock.calls[0][0];
      expect(body.data.clientId).toBeNull();
    }
  });

  it('refuses a stranger until a request is accepted', async () => {
    // No thread, no accepted request/friendship, no match, no booking.
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await sendMessage(makeReq({ receiverId: RECEIVER, content: 'hi' }), res);

    expect(prismaMock.message.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].error).toBe('CHAT_REQUEST_REQUIRED');
  });

  it('lets an admin message a stranger', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);
    const req = {
      body: { receiverId: RECEIVER, content: 'hi' },
      user: { userId: SENDER, role: 'SUPER_ADMIN' },
    } as any;
    const res = makeRes();
    await sendMessage(req, res);

    expect(prismaMock.message.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('sendError helper', () => {
  it('is callable', () => {
    expect(typeof sendError).toBe('function');
  });
});

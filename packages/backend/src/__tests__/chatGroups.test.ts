import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the exact prisma surface the group controller touches. vi.mock factories
// are hoisted, so the mock object itself has to be hoisted with them.
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  chatGroup: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  chatGroupMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  chatGroupMessage: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  chatGroupInvite: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  notification: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/socketService', () => ({ emitToUser: vi.fn(), isUserOnline: vi.fn() }));
vi.mock('../services/blobStorage', () => ({ removeBlob: vi.fn().mockResolvedValue(undefined) }));

import {
  createGroup,
  sendMessage,
  getMessages,
  inviteToGroup,
  respondToInvite,
  addMembers,
  removeMember,
  deleteGroup,
  leaveGroup,
} from '../controllers/chatGroupController';
import { emitToUser, isUserOnline } from '../services/socketService';

const ME = 'user-me';
const OWNER = 'user-owner';
const GROUP = 'group-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function makeReq(opts: { body?: Record<string, unknown>; params?: Record<string, string>; query?: Record<string, unknown>; userId?: string } = {}) {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
    user: { userId: opts.userId ?? ME },
  } as any;
}
function statusOf(res: any) {
  return res.status.mock.calls[res.status.mock.calls.length - 1][0];
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

function member(role = 'MEMBER', extra: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    groupId: GROUP,
    userId: ME,
    role,
    lastReadAt: null,
    joinedAt: new Date(),
    group: { id: GROUP, name: 'Team', isActive: true, createdById: OWNER, avatarUrl: null },
    ...extra,
  };
}

describe('chat groups: creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );
    prismaMock.chatGroup.update.mockResolvedValue({});
    prismaMock.chatGroupMember.update.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({});
  });

  it('rejects an empty group name', async () => {
    const res = makeRes();
    await createGroup(makeReq({ body: { name: '   ' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(prismaMock.chatGroup.create).not.toHaveBeenCalled();
  });

  it('makes the creator the OWNER and adds invited members', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2' }]);
    prismaMock.chatGroup.create.mockResolvedValue({
      id: GROUP, name: 'Team', description: null, avatarUrl: null,
      createdById: ME, isActive: true, createdAt: new Date(), updatedAt: new Date(),
      _count: { members: 2 },
    });

    const res = makeRes();
    await createGroup(makeReq({ body: { name: 'Team', memberIds: [ME, 'u2'] } }), res);

    // ME self-excluded from memberIds, but still inserted as OWNER.
    const arg = prismaMock.chatGroup.create.mock.calls[0][0];
    expect(arg.data.createdById).toBe(ME);
    expect(arg.data.members.create).toEqual([
      { userId: ME, role: 'OWNER' },
      { userId: 'u2', role: 'MEMBER' },
    ]);
    expect(statusOf(res)).toBe(201);
  });

  it('refuses unknown members instead of silently skipping them', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2' }]);
    const res = makeRes();
    await createGroup(makeReq({ body: { name: 'Team', memberIds: ['u2', 'ghost'] } }), res);
    expect(statusOf(res)).toBe(400);
    expect(prismaMock.chatGroup.create).not.toHaveBeenCalled();
  });
});

describe('chat groups: membership access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );
    prismaMock.chatGroup.update.mockResolvedValue({});
    prismaMock.chatGroupMember.update.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({});
  });

  it('blocks a non-member from reading the thread', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await getMessages(makeReq({ params: { id: GROUP } }), res);
    expect(statusOf(res)).toBe(404);
    expect(prismaMock.chatGroupMessage.findMany).not.toHaveBeenCalled();
  });

  it('blocks a non-member from posting', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await sendMessage(makeReq({ params: { id: GROUP }, body: { content: 'hi' } }), res);
    expect(statusOf(res)).toBe(404);
    expect(prismaMock.chatGroupMessage.create).not.toHaveBeenCalled();
  });

  it('delivers to the other members and notifies nobody twice for the sender', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    // other members of the group, excluding ME
    prismaMock.chatGroupMember.findMany.mockResolvedValue([
      { userId: 'u2' },
      { userId: 'u3' },
    ]);
    prismaMock.chatGroupMessage.create.mockImplementation(async ({ data }: any) => ({
      id: 'msg-1',
      groupId: data.groupId,
      senderId: data.senderId,
      content: data.content,
      messageType: data.messageType,
      mediaUrl: null,
      replyToId: data.replyToId,
      reactions: {},
      status: 'SENT',
      createdAt: new Date(),
      sender: { id: ME, fullName: 'Me', avatarUrl: null },
      replyTo: null,
    }));
    // Both members are connected, so the socket already delivered their copy.
    (isUserOnline as unknown as { mockReturnValue: (v: boolean) => void }).mockReturnValue(true);

    const res = makeRes();
    await sendMessage(makeReq({ params: { id: GROUP }, body: { content: 'hello team' } }), res);

    expect(statusOf(res)).toBe(201);
    const notified = (emitToUser as any).mock.calls.map((c: any) => c[0]);
    expect(notified.sort()).toEqual(['u2', 'u3']);
    expect(notified).not.toContain(ME);
    // live event name is what the client subscribes to
    expect((emitToUser as any).mock.calls[0][1]).toBe('group_message');
    // Both members were online, so the socket already reached them — no push.
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('still writes an inbox notification for a member the socket cannot reach', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([{ userId: 'u2' }, { userId: 'u3' }]);
    // u2 is online (no notification), u3 is not (notification).
    (isUserOnline as unknown as { mockImplementation: (fn: (id: string) => boolean) => void }).mockImplementation(
      (id) => id === 'u2',
    )
    prismaMock.chatGroupMessage.create.mockResolvedValue({
      id: 'msg-1', groupId: GROUP, senderId: ME, content: 'hello', messageType: 'TEXT',
      mediaUrl: null, replyToId: null, reactions: {}, status: 'SENT', createdAt: new Date(),
      sender: { id: ME, fullName: 'Me', avatarUrl: null }, replyTo: null,
    });

    const res = makeRes();
    await sendMessage(makeReq({ params: { id: GROUP }, body: { content: 'hello' } }), res);

    expect(statusOf(res)).toBe(201);
    // Everyone still gets the live event…
    expect((emitToUser as any).mock.calls.map((c: any) => c[0])).toEqual(['u2', 'u3']);
    // …but only the offline member gets an inbox/push row.
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create.mock.calls[0][0].data.userId).toBe('u3');
  });

  it('clears the unread watermark when the thread is read', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    prismaMock.chatGroupMessage.findMany.mockResolvedValue([]);
    prismaMock.chatGroupMessage.count.mockResolvedValue(0);

    const res = makeRes();
    await getMessages(makeReq({ params: { id: GROUP } }), res);

    expect(statusOf(res)).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(prismaMock.chatGroupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId_userId: { groupId: GROUP, userId: ME } } }),
    );
  });
});

describe('chat groups: invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );
    prismaMock.chatGroupMember.update.mockResolvedValue({});
    prismaMock.notification.create.mockResolvedValue({});
  });

  it('re-opens a previously declined invite rather than failing on the unique pair', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([]); // target not a member
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2' }]);
    prismaMock.chatGroupInvite.upsert.mockResolvedValue({ id: 'inv-1' });

    const res = makeRes();
    await inviteToGroup(makeReq({ params: { id: GROUP }, body: { userIds: ['u2'] } }), res);

    expect(statusOf(res)).toBe(200);
    const arg = prismaMock.chatGroupInvite.upsert.mock.calls[0][0];
    expect(arg.where.groupId_inviteeId).toEqual({ groupId: GROUP, inviteeId: 'u2' });
    expect(arg.create.status).toBe('PENDING');
    expect(arg.update.status).toBe('PENDING');
  });

  it('skips people who are already in the group', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([{ userId: 'u2' }]);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2' }]);

    const res = makeRes();
    await inviteToGroup(makeReq({ params: { id: GROUP }, body: { userIds: ['u2'] } }), res);

    expect(body(res).data.skipped).toEqual(['u2']);
    expect(prismaMock.chatGroupInvite.upsert).not.toHaveBeenCalled();
  });

  it('accepting an invite enlists the invitee', async () => {
    prismaMock.chatGroupInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: GROUP,
      inviterId: OWNER,
      inviteeId: ME,
      status: 'PENDING',
      group: { id: GROUP, name: 'Team', isActive: true },
    });
    prismaMock.chatGroupMember.upsert.mockResolvedValue({ id: 'm-new' });
    prismaMock.chatGroupMember.findMany.mockResolvedValue([{ userId: OWNER }]);

    const res = makeRes();
    await respondToInvite(makeReq({ params: { inviteId: 'inv-1' }, body: { action: 'accept' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(prismaMock.chatGroupMember.upsert).toHaveBeenCalled();
    expect(prismaMock.chatGroupInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACCEPTED', respondedAt: expect.any(Date) } }),
    );
  });

  it('declining an invite does not create membership', async () => {
    prismaMock.chatGroupInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: GROUP,
      inviterId: OWNER,
      inviteeId: ME,
      status: 'PENDING',
      group: { id: GROUP, name: 'Team', isActive: true },
    });

    const res = makeRes();
    await respondToInvite(makeReq({ params: { inviteId: 'inv-1' }, body: { action: 'decline' } }), res);

    expect(statusOf(res)).toBe(200);
    expect(prismaMock.chatGroupMember.upsert).not.toHaveBeenCalled();
    expect(prismaMock.chatGroupInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'DECLINED', respondedAt: expect.any(Date) } }),
    );
  });

  it('refuses someone else answering my invitation', async () => {
    prismaMock.chatGroupInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: GROUP,
      inviterId: OWNER,
      inviteeId: 'someone-else',
      status: 'PENDING',
      group: { id: GROUP, name: 'Team', isActive: true },
    });
    const res = makeRes();
    await respondToInvite(makeReq({ params: { inviteId: 'inv-1' }, body: { action: 'accept' } }), res);
    expect(statusOf(res)).toBe(404);
    expect(prismaMock.chatGroupMember.upsert).not.toHaveBeenCalled();
  });

  it('rejects an invite that has already been answered', async () => {
    prismaMock.chatGroupInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      groupId: GROUP,
      inviterId: OWNER,
      inviteeId: ME,
      status: 'ACCEPTED',
      group: { id: GROUP, name: 'Team', isActive: true },
    });
    const res = makeRes();
    await respondToInvite(makeReq({ params: { inviteId: 'inv-1' }, body: { action: 'accept' } }), res);
    expect(statusOf(res)).toBe(409);
    expect(prismaMock.chatGroupMember.upsert).not.toHaveBeenCalled();
  });
});

describe('chat groups: roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );
  });

  it('only the owner may delete the group', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('ADMIN'));
    const res = makeRes();
    await deleteGroup(makeReq({ params: { id: GROUP } }), res);
    expect(statusOf(res)).toBe(403);
    expect(prismaMock.chatGroup.delete).not.toHaveBeenCalled();

    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('OWNER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([{ userId: 'u2' }]);
    prismaMock.chatGroup.delete.mockResolvedValue({});
    const res2 = makeRes();
    await deleteGroup(makeReq({ params: { id: GROUP } }), res2);
    expect(statusOf(res2)).toBe(200);
    expect(prismaMock.chatGroup.delete).toHaveBeenCalledWith({ where: { id: GROUP } });
  });

  it('only admins may add members directly', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('MEMBER'));
    const res = makeRes();
    await addMembers(makeReq({ params: { id: GROUP }, body: { userIds: ['u2'] } }), res);
    expect(statusOf(res)).toBe(403);
    expect(prismaMock.chatGroupMember.upsert).not.toHaveBeenCalled();
  });

  it('refuses to remove the owner, even for another admin', async () => {
    prismaMock.chatGroupMember.findUnique
      .mockResolvedValueOnce(member('ADMIN')) // caller
      .mockResolvedValueOnce({ ...member('OWNER'), userId: OWNER }); // target
    const res = makeRes();
    await removeMember(makeReq({ params: { id: GROUP, userId: OWNER } }), res);
    expect(statusOf(res)).toBe(403);
    expect(prismaMock.chatGroupMember.delete).not.toHaveBeenCalled();
  });
});

describe('chat groups: leaving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
    );
    prismaMock.chatGroupMember.update.mockResolvedValue({});
    prismaMock.chatGroup.update.mockResolvedValue({});
    prismaMock.chatGroup.delete.mockResolvedValue({});
  });

  it('an owner leaving hands ownership to a remaining member', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('OWNER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([{ userId: 'u2' }]); // others
    prismaMock.chatGroupMember.findFirst.mockResolvedValue({ userId: 'u2', role: 'ADMIN' });
    prismaMock.chatGroupMember.delete.mockResolvedValue({});

    const res = makeRes();
    await leaveGroup(makeReq({ params: { id: GROUP } }), res);

    expect(statusOf(res)).toBe(200);
    expect(prismaMock.chatGroupMember.delete).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: GROUP, userId: ME } },
    });
    expect(prismaMock.chatGroupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId_userId: { groupId: GROUP, userId: 'u2' } },
        data: { role: 'OWNER' },
      }),
    );
    expect(prismaMock.chatGroup.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { createdById: 'u2' } }),
    );
  });

  it('the last member leaving dissolves the group instead of orphaning it', async () => {
    prismaMock.chatGroupMember.findUnique.mockResolvedValue(member('OWNER'));
    prismaMock.chatGroupMember.findMany.mockResolvedValue([]); // nobody else

    const res = makeRes();
    await leaveGroup(makeReq({ params: { id: GROUP } }), res);

    expect(statusOf(res)).toBe(200);
    expect(body(res).data.dissolved).toBe(true);
    expect(prismaMock.chatGroup.delete).toHaveBeenCalledWith({ where: { id: GROUP } });
    expect(prismaMock.chatGroupMember.delete).not.toHaveBeenCalled();
  });
});

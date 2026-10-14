import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

/**
 * The official "Nabri Community".
 *
 * Every account belongs to it, it carries a pinned built-in welcome post, and
 * it is read-only for regular members: only SUPER_ADMIN/ADMIN accounts may
 * write. These tests lock down the role gate and the create-on-first-use /
 * lazy-join behaviour that the rest of the app depends on.
 */

const {
  communityFindFirst,
  communityCreate,
  communityUpdate,
  memberFindUnique,
  memberCreate,
  postCreate,
  uploadedFindUnique,
  uploadedCreate,
  userFindFirst,
  notificationCreateMany,
  memberFindMany,
  txCommunityCreate,
  txMemberCreate,
  txPostCreate,
  conversationUpsert,
  conversationUpdate,
  messageCreate,
  notificationCreate,
} = vi.hoisted(() => ({
  communityFindFirst: vi.fn(),
  communityCreate: vi.fn(),
  communityUpdate: vi.fn(),
  memberFindUnique: vi.fn(),
  memberCreate: vi.fn(),
  postCreate: vi.fn(),
  uploadedFindUnique: vi.fn(),
  uploadedCreate: vi.fn(),
  userFindFirst: vi.fn(),
  notificationCreateMany: vi.fn(),
  notificationCreate: vi.fn(),
  memberFindMany: vi.fn(),
  txCommunityCreate: vi.fn(),
  txMemberCreate: vi.fn(),
  txPostCreate: vi.fn(),
  conversationUpsert: vi.fn(),
  conversationUpdate: vi.fn(),
  messageCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    community: { findFirst: communityFindFirst, findUnique: vi.fn(), create: communityCreate, update: communityUpdate },
    communityMember: { findUnique: memberFindUnique, findMany: memberFindMany, create: memberCreate },
    communityPost: { create: postCreate, findMany: vi.fn(), count: vi.fn() },
    communityComment: { create: vi.fn() },
    communityPoll: { create: vi.fn() },
    uploadedFile: { findUnique: uploadedFindUnique, create: uploadedCreate },
    user: { findFirst: userFindFirst },
    conversation: { upsert: conversationUpsert, update: conversationUpdate },
    message: { create: messageCreate },
    notification: { create: notificationCreate, createMany: notificationCreateMany },
    $transaction: (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          community: { create: txCommunityCreate },
          communityMember: { create: txMemberCreate },
          communityPost: { create: txPostCreate },
        });
      }
      // Array form used by ensureOfficialMembership.
      return Promise.all(arg as Promise<unknown>[]);
    },
  },
}));

import {
  canPostInOfficialCommunity,
  getOrCreateOfficialCommunity,
  ensureOfficialMembership,
  sendOfficialWelcomeDM,
} from '../services/officialCommunity';
import { createPost } from '../controllers/communityPostController';
import { prisma } from '../config/database';

const prismaAny = prisma as any;

function makeReq(user: { userId: string; role?: string }, params: any, body: any = {}) {
  return { params, body, user } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

beforeEach(() => {
  vi.clearAllMocks();
  communityUpdate.mockResolvedValue({});
  memberCreate.mockResolvedValue({});
  uploadedCreate.mockResolvedValue({});
  notificationCreateMany.mockResolvedValue({ count: 0 });
  memberFindMany.mockResolvedValue([]);
});

describe('canPostInOfficialCommunity', () => {
  it('allows only SUPER_ADMIN and ADMIN', () => {
    expect(canPostInOfficialCommunity('SUPER_ADMIN')).toBe(true);
    expect(canPostInOfficialCommunity('ADMIN')).toBe(true);
    expect(canPostInOfficialCommunity('MODERATOR')).toBe(false);
    expect(canPostInOfficialCommunity('SUPPORT')).toBe(false);
    expect(canPostInOfficialCommunity('USER')).toBe(false);
    expect(canPostInOfficialCommunity(null)).toBe(false);
    expect(canPostInOfficialCommunity(undefined)).toBe(false);
  });
});

describe('getOrCreateOfficialCommunity', () => {
  it('returns the existing official community without creating another', async () => {
    const existing = { id: 'c-1', isOfficial: true };
    communityFindFirst.mockResolvedValue(existing);

    const result = await getOrCreateOfficialCommunity();

    expect(result).toBe(existing);
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(txCommunityCreate).not.toHaveBeenCalled();
  });

  it('creates the community with its owner membership and pinned welcome post', async () => {
    communityFindFirst.mockResolvedValue(null);
    userFindFirst.mockResolvedValue({ id: 'admin-1' });
    uploadedFindUnique.mockResolvedValue(null);
    txCommunityCreate.mockResolvedValue({ id: 'c-new', isOfficial: true });

    const result = await getOrCreateOfficialCommunity();

    expect(txCommunityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isOfficial: true, ownerId: 'admin-1' }) }),
    );
    expect(txMemberCreate).toHaveBeenCalled();
    expect(txPostCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPinned: true, communityId: 'c-new' }) }),
    );
    expect(result).toEqual({ id: 'c-new', isOfficial: true });
  });

  it('returns null when the database has no administrator yet', async () => {
    communityFindFirst.mockResolvedValue(null);
    userFindFirst.mockResolvedValue(null);

    await expect(getOrCreateOfficialCommunity()).resolves.toBeNull();
    expect(txCommunityCreate).not.toHaveBeenCalled();
  });
});

describe('ensureOfficialMembership', () => {
  it('does not re-add an existing member', async () => {
    communityFindFirst.mockResolvedValue({ id: 'c-1', isOfficial: true });
    memberFindUnique.mockResolvedValue({ id: 'm-1' });

    await ensureOfficialMembership('u-1');

    expect(memberCreate).not.toHaveBeenCalled();
    expect(communityUpdate).not.toHaveBeenCalled();
  });

  it('adds a new member and bumps the count', async () => {
    communityFindFirst.mockResolvedValue({ id: 'c-1', isOfficial: true });
    memberFindUnique.mockResolvedValue(null);

    await ensureOfficialMembership('u-1');

    expect(memberCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ communityId: 'c-1', userId: 'u-1' }) }),
    );
    expect(communityUpdate).toHaveBeenCalled();
  });
});

describe('sendOfficialWelcomeDM', () => {
  it('creates a 1:1 conversation with a welcome text and a welcome image', async () => {
    userFindFirst.mockResolvedValue({ id: 'admin-1' });
    uploadedFindUnique.mockResolvedValue({ key: 'nabri-community-welcome.svg' });
    conversationUpsert.mockResolvedValue({ id: 'conv-1' });
    messageCreate
      .mockResolvedValueOnce({ id: 'msg-1', createdAt: new Date(), sender: { id: 'admin-1', fullName: 'Nabri' } })
      .mockResolvedValueOnce({ id: 'msg-2', createdAt: new Date() });
    conversationUpdate.mockResolvedValue({});

    await sendOfficialWelcomeDM('u-1');

    // Find-or-create the pair (sorted participant ids), never a group.
    expect(conversationUpsert).toHaveBeenCalledTimes(1);
    expect(messageCreate).toHaveBeenCalledTimes(2);
    const calls = messageCreate.mock.calls.map((c) => c[0].data);
    expect(calls[0]).toEqual(expect.objectContaining({ messageType: 'TEXT', senderId: 'admin-1', receiverId: 'u-1' }));
    expect(calls[1]).toEqual(
      expect.objectContaining({ messageType: 'IMAGE', mediaUrl: '/uploads/nabri-community-welcome.svg' }),
    );
    expect(notificationCreate).toHaveBeenCalled();
  });

  it('does nothing (in a conversation sense) when there is no admin to send from', async () => {
    userFindFirst.mockResolvedValue(null);

    await sendOfficialWelcomeDM('u-1');

    expect(conversationUpsert).not.toHaveBeenCalled();
    expect(messageCreate).not.toHaveBeenCalled();
  });
});

describe('createPost in the official community', () => {
  it('refuses a regular member with 403 OFFICIAL_READ_ONLY', async () => {
    prismaAny.community.findUnique.mockResolvedValue({
      id: 'c-1', ownerId: 'admin-1', privacy: 'PUBLIC', isOfficial: true, name: 'Nabri Community',
    });
    memberFindUnique.mockResolvedValue({ communityId: 'c-1', userId: 'u-1', role: 'MEMBER' });

    const res = makeRes();
    await createPost(makeReq({ userId: 'u-1', role: 'USER' }, { id: 'c-1' }, { content: 'hello' }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'OFFICIAL_READ_ONLY' }));
    expect(postCreate).not.toHaveBeenCalled();
  });

  it('lets a Nabri admin post', async () => {
    prismaAny.community.findUnique.mockResolvedValue({
      id: 'c-1', ownerId: 'admin-1', privacy: 'PUBLIC', isOfficial: true, name: 'Nabri Community',
    });
    memberFindUnique.mockResolvedValue({ communityId: 'c-1', userId: 'admin-1', role: 'ADMIN' });
    postCreate.mockResolvedValue({ id: 'p-1', content: 'Update', author: { id: 'admin-1' } });

    const res = makeRes();
    await createPost(makeReq({ userId: 'admin-1', role: 'ADMIN' }, { id: 'c-1' }, { content: 'Update' }), res);

    expect(postCreate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

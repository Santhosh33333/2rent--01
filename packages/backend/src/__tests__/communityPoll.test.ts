import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindUnique, mockFindFirst, mockCreate, mockUpdate, mockTx } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockTx: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    community: { findUnique: mockFindUnique },
    communityMember: { findUnique: mockFindUnique },
    communityPost: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    communityComment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    communityPoll: { create: mockCreate, findMany: vi.fn(), findFirst: mockFindFirst, count: vi.fn(), delete: vi.fn(), findUnique: mockFindUnique },
    communityPollOption: { update: mockUpdate },
    communityPollVote: { findMany: vi.fn(), findUnique: mockFindFirst, create: mockCreate, update: mockUpdate },
    report: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: (fn: any) => mockTx(fn),
  },
}));

import { createPoll, votePoll } from '../controllers/communityPostController';

function makeReq(userId: string, params: any, body: any = {}) {
  return { params, body, user: { userId } } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

const community = { id: 'c-1', ownerId: 'owner-1', privacy: 'PUBLIC' };
const member = { communityId: 'c-1', userId: 'user-1', role: 'MEMBER' };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
});

describe('community polls', () => {
  it('REJECTS fewer than 2 options', async () => {
    mockFindUnique.mockResolvedValueOnce(community).mockResolvedValueOnce(member);
    const req = makeReq('user-1', { id: 'c-1' }, { question: 'Q?', options: ['only'] });
    const res = makeRes();
    await createPoll(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('member votes once; counts move transactionally', async () => {
    mockFindUnique.mockResolvedValueOnce(community).mockResolvedValueOnce(member);
    mockFindFirst.mockResolvedValueOnce({
      id: 'poll-1', closesAt: null,
      options: [{ id: 'o-1' }, { id: 'o-2' }],
    });
    mockTx.mockImplementation(async (fn: any) =>
      fn({
        communityPollVote: { findUnique: mockFindFirst, create: mockCreate, update: mockUpdate },
        communityPollOption: { update: mockUpdate },
      })
    );
    mockFindFirst.mockResolvedValueOnce(null); // no existing vote
    mockFindUnique.mockResolvedValueOnce({ id: 'poll-1', options: [] });
    const req = makeReq('user-1', { id: 'c-1', pollId: 'poll-1' }, { optionId: 'o-1' });
    const res = makeRes();
    await votePoll(req, res);
    expect(mockCreate).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('REJECTS votes on closed polls', async () => {
    mockFindUnique.mockResolvedValueOnce(community).mockResolvedValueOnce(member);
    mockFindFirst.mockResolvedValueOnce({
      id: 'poll-1', closesAt: new Date(Date.now() - 1000).toISOString(),
      options: [{ id: 'o-1' }],
    });
    const req = makeReq('user-1', { id: 'c-1', pollId: 'poll-1' }, { optionId: 'o-1' });
    const res = makeRes();
    await votePoll(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

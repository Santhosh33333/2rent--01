import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindFirst, mockCreate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    community: { findUnique: vi.fn() },
    communityMember: { findUnique: vi.fn() },
    communityPost: { create: vi.fn(), findMany: vi.fn(), findFirst: mockFindFirst, count: vi.fn(), delete: vi.fn() },
    communityComment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
    report: { findFirst: mockFindFirst, create: mockCreate },
  },
}));

import { reportPost } from '../controllers/communityPostController';

function makeReq(userId: string, body: any = {}) {
  return { params: { id: 'c-1', postId: 'p-1' }, body, user: { userId } } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'r-1' });
});

describe('community reporting', () => {
  it('creates a report for another user post', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'p-1', authorId: 'author-1', content: 'hello' })
      .mockResolvedValueOnce(null);
    const req = makeReq('user-1', { reason: 'Spam' });
    const res = makeRes();
    await reportPost(req, res);
    expect(mockCreate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('REJECTS reporting your own post', async () => {
    mockFindFirst.mockResolvedValue({ id: 'p-1', authorId: 'user-1', content: 'hello' });
    const req = makeReq('user-1', { reason: 'Spam' });
    const res = makeRes();
    await reportPost(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('REJECTS duplicate pending reports', async () => {
    mockFindFirst
      .mockResolvedValueOnce({ id: 'p-1', authorId: 'author-1', content: 'hello' })
      .mockResolvedValueOnce({ id: 'r-0' });
    const req = makeReq('user-1', { reason: 'Spam' });
    const res = makeRes();
    await reportPost(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

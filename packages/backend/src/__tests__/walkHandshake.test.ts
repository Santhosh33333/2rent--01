import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindUnique, mockUpdateMany, mockCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    walkingRequest: { findUnique: mockFindUnique, updateMany: mockUpdateMany },
    notification: { create: mockCreate },
    auditLog: { create: mockCreate },
    wallet: { findUnique: mockFindUnique },
    transaction: { create: mockCreate },
    walkingPartner: { updateMany: mockUpdateMany },
    pricingConfig: { findUnique: mockFindUnique, findFirst: mockFindUnique },
    $transaction: (fn: any) => fn({ walkingRequest: { updateMany: mockUpdateMany }, wallet: { update: mockCreate }, transaction: { create: mockCreate }, walkingPartner: { updateMany: mockUpdateMany } }),
  },
}));

import { completeWalk, confirmWalkCompletion } from '../controllers/walkingRequestController';

function makeReq(userId: string, id = 'w-1') {
  return { params: { id }, body: {}, user: { userId } } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

const base = { id: 'w-1', requesterId: 'user-1', acceptedById: 'partner-1', status: 'ACCEPTED', fare: 100, completedById: null, confirmedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 0 });
});

describe('walk completion handshake (no instant completion)', () => {
  it('walker request does not complete the walk', async () => {
    mockFindUnique.mockResolvedValue({ ...base });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const req = makeReq('partner-1');
    const res = makeRes();
    await completeWalk(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACCEPTED', completedById: null }) })
    );
  });

  it('requester cannot confirm before the walker requests', async () => {
    mockFindUnique.mockResolvedValue({ ...base });
    const req = makeReq('user-1');
    const res = makeRes();
    await confirmWalkCompletion(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('requester confirms after walker request (latched, exactly once)', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ ...base, completedById: 'partner-1' })
      .mockResolvedValueOnce({ id: 'wallet-1' });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const req = makeReq('user-1');
    const res = makeRes();
    await confirmWalkCompletion(req, res);
    const body = res.json.mock.calls[0][0];
    expect(body?.success).toBe(true);
  });
});

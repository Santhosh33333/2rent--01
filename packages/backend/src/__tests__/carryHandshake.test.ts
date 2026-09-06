import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindUnique, mockUpdate, mockUpdateMany, mockCreate, mockTx } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCreate: vi.fn(),
  mockTx: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    carryBuddyRequest: { findUnique: mockFindUnique, update: mockUpdate, updateMany: mockUpdateMany },
    notification: { create: mockCreate },
    auditLog: { create: mockCreate },
    wallet: { findUnique: mockFindUnique, create: mockCreate, update: mockCreate, upsert: mockCreate },
    transaction: { create: mockCreate, updateMany: mockCreate },
    refundLog: { create: mockCreate },
    booking: { findUnique: mockFindUnique },
    pricingConfig: { findUnique: mockFindUnique, findFirst: mockFindUnique },
    $transaction: (fn: any) => mockTx(fn),
  },
}));

import { completeRequest } from '../controllers/carryBuddyController';

function makeReq(userId: string, id = 'cb-1', body: any = {}) {
  return { params: { id }, body, user: { userId } } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

const base = { id: 'cb-1', requesterId: 'user-1', acceptedById: 'partner-1', status: 'ACCEPTED', fare: 100, partnerEarning: 90, notes: null, createdAt: new Date().toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({});
  mockUpdate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 0 });
});

describe('carry completion handshake (no instant completion)', () => {
  it('carrier can only REQUEST, never complete directly', async () => {
    mockFindUnique.mockResolvedValue({ ...base });
    mockUpdate.mockResolvedValue({ ...base });
    const req = makeReq('partner-1');
    const res = makeRes();
    await completeRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    const body = res.json.mock.calls[0][0];
    expect(body?.data?.requested).toBe(true);
  });

  it('requester cannot complete before the carrier requests', async () => {
    mockFindUnique.mockResolvedValue({ ...base });
    const req = makeReq('user-1');
    const res = makeRes();
    await completeRequest(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('requester completes after carrier request, crediting the carrier', async () => {
    const notes = JSON.stringify({ completionRequestedBy: 'partner-1', completionRequestedAt: new Date().toISOString() });
    mockFindUnique.mockResolvedValue({ ...base, notes });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockTx.mockImplementation(async (fn: any) =>
      fn({ booking: {}, carryBuddyRequest: { updateMany: mockUpdateMany, findUnique: mockFindUnique }, wallet: { findUnique: mockFindUnique, create: mockCreate, update: mockCreate }, transaction: { create: mockCreate } })
    );
    const req = makeReq('user-1');
    const res = makeRes();
    await completeRequest(req, res);
    expect(mockUpdateMany).toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body?.success).toBe(true);
  });
});

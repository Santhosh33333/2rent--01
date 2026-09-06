import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindUnique, mockCreate } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    idempotencyKey: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));

import { idempotencyMiddleware } from '../middleware/idempotency';

function makeReq(method = 'POST', headers: Record<string, string> = {}): Request {
  return { method, headers, body: {} } as unknown as Request;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('idempotencyMiddleware', () => {
  it('skips GET requests', () => {
    const req = makeReq('GET');
    const res = makeRes();
    const next = vi.fn();
    idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips POST without idempotency key', () => {
    const req = makeReq('POST');
    const res = makeRes();
    const next = vi.fn();
    idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns cached response for existing key', async () => {
    const cached = { success: true, data: { id: '123' } };
    mockFindUnique.mockResolvedValue({ key: 'k1', statusCode: 200, responseBody: cached });
    const req = makeReq('POST', { 'x-idempotency-key': 'k1' });
    const res = makeRes();
    const next = vi.fn();
    await idempotencyMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(cached);
  });

  it('calls next for new key', async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = makeReq('POST', { 'x-idempotency-key': 'new' });
    const res = makeRes();
    const next = vi.fn();
    await idempotencyMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('proceeds on DB error (fail open)', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB down'));
    const req = makeReq('POST', { 'x-idempotency-key': 'err' });
    const res = makeRes();
    const next = vi.fn();
    idempotencyMiddleware(req, res, next);
    // The middleware uses .then/.catch (not async), so wait for microtask
    await new Promise(r => setTimeout(r, 10));
    expect(next).toHaveBeenCalled();
  });
});

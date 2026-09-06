import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    booking: { findFirst: mockFindFirst },
    paymentOrder: { findFirst: mockFindFirst },
  },
}));

import { preventDuplicateBooking, preventDuplicatePayment } from '../middleware/fraudPrevention';

function makeReq(body: any = {}, userId = 'user-1') {
  return { body, userId, headers: {} } as unknown as Request;
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

describe('preventDuplicateBooking', () => {
  it('calls next if no userId', async () => {
    const req = { body: { serviceType: 'WALKING', scheduledAt: new Date().toISOString() } } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicateBooking(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows new booking (no duplicate)', async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeReq({ serviceType: 'WALKING', scheduledAt: new Date().toISOString() });
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicateBooking(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects duplicate booking', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing-1', status: 'PENDING' });
    const req = makeReq({ serviceType: 'WALKING', scheduledAt: new Date().toISOString() });
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicateBooking(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('fails open on DB error', async () => {
    mockFindFirst.mockRejectedValue(new Error('DB error'));
    const req = makeReq({ serviceType: 'WALKING', scheduledAt: new Date().toISOString() });
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicateBooking(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('preventDuplicatePayment', () => {
  it('calls next if no bookingId', async () => {
    const req = { body: {} } as unknown as Request;
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicatePayment(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows new payment', async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeReq({ bookingId: 'booking-1' });
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicatePayment(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects duplicate payment', async () => {
    mockFindFirst.mockResolvedValue({ id: 'pay-1', status: 'SUCCESS' });
    const req = makeReq({ bookingId: 'booking-1', razorpayPaymentId: 'pay_123' });
    const res = makeRes();
    const next = vi.fn();
    await preventDuplicatePayment(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

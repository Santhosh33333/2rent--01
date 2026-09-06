import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const { mockFindFirst, mockUpdateMany, mockUpdate, mockCreate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    notification: { findMany: vi.fn(), count: vi.fn() },
    device: { findFirst: mockFindFirst, updateMany: mockUpdateMany, update: mockUpdate, create: mockCreate },
  },
}));

import { registerDevice } from '../controllers/notificationController';

function makeReq(userId: string, body: any) {
  return { body, user: { userId } } as unknown as Request;
}

function makeRes() {
  const res: any = { statusCode: 200, json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() };
  return res as Response & { json: any; status: any };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 0 });
});

describe('registerDevice', () => {
  it('creates a device row for a new device type', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'd-1' });
    const req = makeReq('user-1', { deviceType: 'ANDROID', fcmToken: 'tok-123' });
    const res = makeRes();
    await registerDevice(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'user-1', fcmToken: 'tok-123' }),
    }));
  });

  it('refreshes the token on an existing row', async () => {
    mockFindFirst.mockResolvedValue({ id: 'd-1', fcmToken: 'old' });
    mockUpdate.mockResolvedValue({ id: 'd-1' });
    const req = makeReq('user-1', { deviceType: 'ANDROID', fcmToken: 'tok-new' });
    const res = makeRes();
    await registerDevice(req, res);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('detaches the token from other users first', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ id: 'd-1' });
    const req = makeReq('user-1', { deviceType: 'IOS', fcmToken: 'shared-tok' });
    const res = makeRes();
    await registerDevice(req, res);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fcmToken: 'shared-tok', userId: { not: 'user-1' } } })
    );
  });

  it('REJECTS missing token', async () => {
    const req = makeReq('user-1', { deviceType: 'ANDROID' });
    const res = makeRes();
    await registerDevice(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

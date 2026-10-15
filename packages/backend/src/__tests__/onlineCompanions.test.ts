import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock only what these two services actually touch, so the tests exercise the
// real filtering/targeting logic rather than a stub of it.
const prismaMock = vi.hoisted(() => ({
  partner: { findMany: vi.fn() },
  userBlock: { findMany: vi.fn() },
  booking: { findUnique: vi.fn(), updateMany: vi.fn() },
  dispatchRequest: { createMany: vi.fn() },
  notification: { create: vi.fn() },
  transaction: { findFirst: vi.fn() },
  wallet: { upsert: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/socketService', () => ({
  emitToUser: vi.fn(),
  getIO: () => null,
  isUserOnline: vi.fn(),
}));
vi.mock('../services/redisClient', () => ({ isUserOnlineShared: vi.fn() }));

import { findOnlineCompanions } from '../services/partnerMatching';
import { dispatchBooking } from '../services/dispatchService';
import { emitToUser, isUserOnline } from '../services/socketService';
import { isUserOnlineShared } from '../services/redisClient';

const ME = 'user-me';

function partner(id: string, userId: string, name: string, rating = 0, jobs = 0) {
  return {
    id,
    userId,
    rating,
    averageRating: rating,
    completedJobs: jobs,
    user: { fullName: name, avatarUrl: null, city: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // No Redis in tests: isUserOnlineShared returns null so the local socket
  // registry (mocked isUserOnline) is the authority, matching the free instance.
  (isUserOnlineShared as any).mockResolvedValue(null);
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.dispatchRequest.createMany.mockResolvedValue({ count: 1 });
});

describe('findOnlineCompanions', () => {
  it('returns only people who are actually online, excluding self and both block directions', async () => {
    prismaMock.partner.findMany.mockResolvedValue([
      partner('p1', 'u1', 'Online Ann', 4.5, 10),
      partner('p2', 'u2', 'Offline Bob'),
      partner('p3', 'u-blocked-by-me', 'Blocked By Me'),
      partner('p4', 'u-blocked-me', 'Blocked Me'),
      partner('p5', ME, 'Myself'),
    ]);
    prismaMock.userBlock.findMany.mockImplementation(async (args: any) => {
      if (args.where.blockerId === ME) return [{ blockedId: 'u-blocked-by-me' }];
      if (args.where.blockedId === ME) return [{ blockerId: 'u-blocked-me' }];
      return [];
    });
    (isUserOnline as any).mockImplementation((id: string) => id === 'u1');

    const online = await findOnlineCompanions(ME, 30);

    expect(online).toHaveLength(1);
    expect(online[0]).toMatchObject({ partnerId: 'p1', userId: 'u1', displayName: 'Online Ann', isOnline: true });
    // Presence is only probed for candidates that survived the block/self filter.
    const probed = (isUserOnline as any).mock.calls.map((c: any[]) => c[0]).sort();
    expect(probed).toEqual(['u1', 'u2']);
  });

  it('never exposes contact details in the payload', async () => {
    prismaMock.partner.findMany.mockResolvedValue([partner('p1', 'u1', 'Ann')]);
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    (isUserOnline as any).mockReturnValue(true);

    const [only] = await findOnlineCompanions(ME, 30);
    expect(Object.keys(only).sort()).toEqual(
      ['avatarUrl', 'city', 'completedJobs', 'displayName', 'isOnline', 'partnerId', 'rating', 'userId'].sort()
    );
  });

  it('caps the returned list at the requested limit', async () => {
    prismaMock.partner.findMany.mockResolvedValue([
      partner('p1', 'u1', 'A'),
      partner('p2', 'u2', 'B'),
      partner('p3', 'u3', 'C'),
    ]);
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    (isUserOnline as any).mockReturnValue(true);

    const online = await findOnlineCompanions(ME, 2);
    expect(online).toHaveLength(2);
  });
});

describe('dispatchBooking targeted delivery', () => {
  const booking = {
    id: 'b1',
    userId: 'buyer',
    serviceType: 'TALK',
    startLocation: 'a',
    endLocation: 'b',
    scheduledAt: null,
    status: 'PARTNER_SEARCHING',
  };

  beforeEach(() => {
    prismaMock.booking.findUnique.mockResolvedValue(booking);
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    prismaMock.partner.findMany.mockResolvedValue([
      { id: 'p1', userId: 'u1' },
      { id: 'p2', userId: 'u2' },
    ]);
  });

  it('sends only to the chosen companion when they are eligible', async () => {
    const out = await dispatchBooking('b1', { preferredPartnerId: 'p2' });

    expect(out).toEqual({ dispatched: true, preferredHonoured: true, targetCount: 1 });
    expect(emitToUser).toHaveBeenCalledTimes(1);
    expect(emitToUser).toHaveBeenCalledWith('u2', 'new_job', expect.any(Object));
  });

  it('falls back to the whole pool when the chosen companion is not eligible', async () => {
    const out = await dispatchBooking('b1', { preferredPartnerId: 'gone' });

    expect(out).toEqual({ dispatched: true, preferredHonoured: false, targetCount: 2 });
    expect(emitToUser).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch when the booking is not in a dispatchable state', async () => {
    prismaMock.booking.findUnique.mockResolvedValue({ ...booking, status: 'PAYMENT_PENDING' });

    const out = await dispatchBooking('b1', { preferredPartnerId: 'p1' });

    expect(out).toEqual({ dispatched: false, preferredHonoured: false, targetCount: 0 });
    expect(emitToUser).not.toHaveBeenCalled();
  });
});

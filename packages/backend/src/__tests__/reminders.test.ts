import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany, mockUpdateMany, mockCreate, mockFindUnique } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCreate: vi.fn(),
  mockFindUnique: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    booking: { findMany: mockFindMany, updateMany: mockUpdateMany },
    partner: { findUnique: mockFindUnique },
    notification: { create: mockCreate },
    pricingConfig: { findUnique: mockFindUnique, findFirst: mockFindUnique },
  },
}));

import { sendUpcomingReminders } from '../services/bookingEngine';

const now = new Date('2026-09-06T10:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({});
});

describe('upcoming-job reminders', () => {
  it('notifies user + partner once for jobs starting within 30 min', async () => {
    mockFindMany.mockResolvedValue([{
      id: 'b-1', userId: 'user-1', partnerId: 'p-1', serviceType: 'WALKING',
      scheduledAt: new Date('2026-09-06T10:20:00Z'), notes: null,
    }]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({ userId: 'partner-user-1' });
    const sent = await sendUpcomingReminders(now);
    expect(sent).toBe(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('skips already-reminded bookings', async () => {
    mockFindMany.mockResolvedValue([{
      id: 'b-1', userId: 'user-1', partnerId: null, serviceType: 'WALKING',
      scheduledAt: new Date('2026-09-06T10:20:00Z'),
      notes: JSON.stringify({ reminderSentAt: '2026-09-06T09:55:00Z' }),
    }]);
    const sent = await sendUpcomingReminders(now);
    expect(sent).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sends nothing when nothing is due', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await sendUpcomingReminders(now)).toBe(0);
  });
});

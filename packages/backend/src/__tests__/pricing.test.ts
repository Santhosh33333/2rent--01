import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindFirst, mockFindMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock('../config/database', () => ({
  prisma: {
    pricingConfig: { findFirst: mockFindFirst, findMany: mockFindMany },
  },
}));

import { calculatePrice } from '../services/pricingEngine';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pricingEngine.calculatePrice', () => {
  it('returns complete price breakdown', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await calculatePrice({ durationMinutes: 30, serviceAreaMultiplier: 1 });
    expect(result).toHaveProperty('baseFare');
    expect(result).toHaveProperty('platformFee');
    expect(result).toHaveProperty('finalAmount');
    expect(result).toHaveProperty('partnerEarning');
    expect(result).toHaveProperty('platformFeePercent');
    expect(result.finalAmount).toBeGreaterThanOrEqual(0);
    expect(result.partnerEarning).toBeGreaterThanOrEqual(0);
  });

  it('platform fee is 10% of subtotal', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await calculatePrice({ durationMinutes: 60, serviceAreaMultiplier: 1 });
    expect(result.platformFeePercent).toBe(10);
    const subtotal = result.baseFare + result.timeCharge + result.distanceCharge + result.nightCharge + result.peakCharge + result.festivalCharge + result.rainSurcharge + result.waitingCharge;
    expect(result.platformFee).toBeCloseTo(subtotal * 0.10, 0);
  });

  it('partner earning equals finalAmount minus platformFee', async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await calculatePrice({ durationMinutes: 30, serviceAreaMultiplier: 1 });
    expect(result.partnerEarning).toBeCloseTo(result.finalAmount - result.platformFee, 0);
  });
});

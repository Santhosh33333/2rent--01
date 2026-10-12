import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * A per-account first-period discount.
 *
 * The plan-level offer on the pricing page is the same deal for every new
 * account. This is the targeted counterpart: support can promise one named user
 * a discount without repricing the product for everyone. Two rules matter and
 * both are easy to get wrong:
 *
 *   1. It applies to the FIRST period only. An account that has ever subscribed
 *      must not keep getting it, or the grant becomes a permanent price cut.
 *   2. An expired grant silently stops applying. No cleanup job should be
 *      required for a promise that has run out.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
});

const { db } = vi.hoisted(() => ({
  db: {
    subscriptionPlan: { findMany: vi.fn() },
    pricingConfig: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    subscription: { count: vi.fn() },
  },
}));

vi.mock("../../src/config/database", () => ({ prisma: db }));
vi.mock("../../src/config/redis", () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}));

import { getActivePlans, resolveFirstPeriodPrice } from "../services/subscriptionService";
import { invalidateConfigCache } from "../services/pricingEngine";

const PLAN = {
  id: "p1",
  code: "MONTHLY",
  name: "Monthly",
  durationDays: 30,
  price: 100,
  listPrice: null as number | null,
  offerPrice: null as number | null,
  currency: "INR",
  trialDays: 1,
  isActive: true,
  displayOrder: 1,
  gatewayPlanId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateConfigCache();
  db.pricingConfig.findMany.mockResolvedValue([]);
  db.subscriptionPlan.findMany.mockResolvedValue([PLAN]);
  db.subscription.count.mockResolvedValue(0);
  db.user.findUnique.mockResolvedValue(null);
});

describe("per-account first-period offer", () => {
  it("applies the discount to the first period for a never-subscribed account", async () => {
    db.user.findUnique.mockResolvedValue({
      customOfferPercent: 25,
      customOfferNote: "goodwill",
      customOfferUntil: null,
    });

    const [plan] = await getActivePlans("u1");
    expect(plan.effectivePrice).toBe(75);
    expect(plan.listPrice).toBe(100);
    expect(plan.customOfferPercent).toBe(25);
  });

  it("ignores a grant whose expiry has passed", async () => {
    db.user.findUnique.mockResolvedValue({
      customOfferPercent: 25,
      customOfferNote: null,
      customOfferUntil: new Date(Date.now() - 60_000),
    });

    const [plan] = await getActivePlans("u1");
    expect(plan.effectivePrice).toBe(100);
    expect(plan.listPrice).toBeNull();
  });

  it("does not leak the discount to an account that has ever subscribed", async () => {
    db.user.findUnique.mockResolvedValue({
      customOfferPercent: 25,
      customOfferNote: null,
      customOfferUntil: null,
    });
    db.subscription.count.mockResolvedValue(1);

    const [plan] = await getActivePlans("u1");
    expect(plan.effectivePrice).toBe(100);

    const price = await resolveFirstPeriodPrice(PLAN, "u1");
    expect(price).toEqual({ amount: 100, listPrice: null, offerApplied: false });
  });

  it("prices the first period from the grant, struck through against full price", async () => {
    db.user.findUnique.mockResolvedValue({
      customOfferPercent: 40,
      customOfferNote: null,
      customOfferUntil: null,
    });

    const price = await resolveFirstPeriodPrice(PLAN, "u1");
    expect(price).toEqual({ amount: 60, listPrice: 100, offerApplied: true });
  });

  it("outranks the plan-level offer when both are present", async () => {
    db.subscriptionPlan.findMany.mockResolvedValue([
      { ...PLAN, offerPrice: 10, listPrice: 100 },
    ]);
    db.user.findUnique.mockResolvedValue({
      customOfferPercent: 50,
      customOfferNote: null,
      customOfferUntil: null,
    });

    const price = await resolveFirstPeriodPrice({ ...PLAN, offerPrice: 10 }, "u1");
    expect(price).toEqual({ amount: 50, listPrice: 100, offerApplied: true });
  });
});

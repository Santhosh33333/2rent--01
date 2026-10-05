import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The advertised trial and the granted trial must be one number.
 *
 * They were two. The landing pages take max(plan.trialDays) and print it as
 * "N DAYS FREE", while access is decided by User.accessUntil written from a
 * separate config value. Nothing connected them, so an admin editing the plan
 * column changed the advert and left the product alone - and the failure is
 * silent, because both sides keep working and simply disagree.
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
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../src/config/database", () => ({ prisma: db }));
vi.mock("../../src/config/redis", () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}));
vi.mock("../services/cashfreeSubscriptionGateway", () => ({
  createSubscription: vi.fn(),
  createPlan: vi.fn(),
  cancelSubscription: vi.fn(),
  changePlan: vi.fn(),
}));

import { getActivePlans } from "../services/subscriptionService";
import { getTrialSettings, TRIAL_DAYS_KEY } from "../services/trialAccessService";
import { invalidateConfigCache } from "../services/pricingEngine";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateConfigCache();
  db.pricingConfig.findMany.mockResolvedValue([]);
});

describe("getActivePlans", () => {
  const PLAN = {
    id: "p1",
    code: "MONTHLY",
    name: "Monthly",
    durationDays: 30,
    price: 499,
    currency: "INR",
    trialDays: 1,
    isActive: true,
    displayOrder: 1,
    gatewayPlanId: null,
  };

  it("reports the configured trial length, not the plan's stored column", async () => {
    // The seed sets trialDays: 1 on every plan. If that value reached the
    // landing pages, the site would advertise "1 DAY FREE" while signup granted
    // seven.
    db.pricingConfig.findMany.mockResolvedValue([{ key: TRIAL_DAYS_KEY, value: "14" }]);
    db.subscriptionPlan.findMany.mockResolvedValue([PLAN]);

    const [plan] = await getActivePlans();

    expect(plan.trialDays).toBe(14);
    expect(plan.planTrialDays).toBe(1);
  });

  it("keeps the plan's own value visible for admins", async () => {
    // Exposed rather than hidden so the admin can see the column still exists and
    // understand why it no longer drives anything.
    db.subscriptionPlan.findMany.mockResolvedValue([PLAN]);
    const [plan] = await getActivePlans();
    expect(plan.planTrialDays).toBe(PLAN.trialDays);
  });

  it("agrees with what signup would actually grant", async () => {
    // The whole point: the number on the landing page is the number a new account
    // receives. Read through both paths so a future divergence fails here.
    db.pricingConfig.findMany.mockResolvedValue([{ key: TRIAL_DAYS_KEY, value: "21" }]);
    db.subscriptionPlan.findMany.mockResolvedValue([PLAN]);

    const [plan] = await getActivePlans();
    const settings = await getTrialSettings();

    expect(plan.trialDays).toBe(settings.days);
  });

  it("still returns plans when there are none", async () => {
    db.subscriptionPlan.findMany.mockResolvedValue([]);
    expect(await getActivePlans()).toEqual([]);
  });
});
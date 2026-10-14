import { describe, it, expect, vi } from "vitest";

/**
 * The fallback call terms.
 *
 * The fallback ceiling is also the amount reserved from the caller's wallet the
 * moment a call connects, so it is a product decision, not a detail: at the old
 * value of 60 a first call withheld 60 before a word was spoken. This pins the
 * lower default so it cannot drift back up unnoticed.
 *
 * `getConfig` is mocked to return the fallback it is handed, which is exactly
 * the "no row in PricingConfig" case the constant exists for.
 */

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET ??= "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET ??= "test_refresh_secret_32chars_minimum!";
});

vi.mock("../config/database", () => ({ prisma: {} }));
vi.mock("../services/pricingEngine", () => ({ getConfig: vi.fn() }));
vi.mock("../services/trialAccessService", () => ({ LIFETIME_ACCESS_UNTIL: new Date(0) }));

import { getCallTerms } from "../services/callBillingService";
import { getConfig } from "../services/pricingEngine";

describe("call billing fallback terms", () => {
  it("reserves at most 20 minutes up front when PricingConfig has no rows", async () => {
    vi.mocked(getConfig).mockImplementation(async (_key: string, fallback: number) => fallback);

    const terms = await getCallTerms();

    expect(terms.maxBillableMinutes).toBe(20);
    expect(terms.ratePerMinute).toBe(1);
    // Billing stays off until an admin turns it on; the ceiling is inert.
    expect(terms.enabled).toBe(false);
  });
});

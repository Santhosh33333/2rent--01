import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Trial length validation and access-window decisions.
 *
 * These matter because the failure is invisible: a trial that grants nothing
 * looks exactly like a trial that works but expires sooner than the landing page
 * promises, and neither shows up as an error anywhere.
 */
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
});

const { db } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    pricingConfig: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("../../src/config/database", () => ({ prisma: db }));
vi.mock("../../src/config/redis", () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}));

import {
  normaliseTrialDays,
  getTrialSettings,
  setTrialDays,
  grantSignupTrial,
  grantTrialToAllUsers,
  setUserAccess,
  TRIAL_SOURCE,
  DEFAULT_TRIAL_DAYS,
  MAX_TRIAL_DAYS,
  TRIAL_DAYS_KEY,
} from "../services/trialAccessService";
import { invalidateConfigCache } from "../services/pricingEngine";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  // The config cache is module-level with a 60s TTL, so without this a value set
  // in one test would still be returned by the next one.
  invalidateConfigCache();
  db.pricingConfig.findMany.mockResolvedValue([]);
});

describe("normaliseTrialDays", () => {
  it("accepts a whole number of days", () => {
    expect(normaliseTrialDays(7)).toBe(7);
    expect(normaliseTrialDays(30)).toBe(30);
    expect(normaliseTrialDays(MAX_TRIAL_DAYS)).toBe(MAX_TRIAL_DAYS);
  });

  it("accepts a numeric string, because the value arrives as form input", () => {
    expect(normaliseTrialDays("14")).toBe(14);
  });

  it("refuses rather than clamping", () => {
    // A clamp is the dangerous option: an admin asking for 9999 would receive a
    // year of free access and see no error, and the trial would go out to every
    // new signup.
    expect(() => normaliseTrialDays(0)).toThrow(/INVALID/);
    expect(() => normaliseTrialDays(-5)).toThrow(/INVALID/);
    expect(() => normaliseTrialDays(1.5)).toThrow(/INVALID/);
    expect(() => normaliseTrialDays(MAX_TRIAL_DAYS + 1)).toThrow(/MAX/);
    expect(() => normaliseTrialDays("abc")).toThrow(/INVALID/);
  });
});

describe("getTrialSettings", () => {
  it("falls back to the default when nothing is configured", async () => {
    const settings = await getTrialSettings();
    expect(settings.days).toBe(DEFAULT_TRIAL_DAYS);
    expect(settings.maxDays).toBe(MAX_TRIAL_DAYS);
  });

  it("reads the configured value", async () => {
    db.pricingConfig.findMany.mockResolvedValue([{ key: TRIAL_DAYS_KEY, value: "21" }]);
    const settings = await getTrialSettings();
    expect(settings.days).toBe(21);
    expect(settings.fromConfig).toBe(true);
  });

  it("falls back rather than throwing on a corrupt stored value", async () => {
    // A hand-edited config row must not make every signup throw. A trial that
    // silently defaults is recoverable; a signup endpoint returning 500 is not.
    db.pricingConfig.findMany.mockResolvedValue([{ key: TRIAL_DAYS_KEY, value: "not-a-number" }]);
    const settings = await getTrialSettings();
    expect(settings.days).toBe(DEFAULT_TRIAL_DAYS);
  });
});

describe("setTrialDays", () => {
  it("persists the value and busts the cache", async () => {
    // Without invalidateConfigCache, getConfig keeps the old value for up to a
    // minute and an admin who just set 30 days would conclude the setting is
    // broken when a new signup still gets 7.
    db.pricingConfig.upsert.mockResolvedValue({});
    const days = await setTrialDays(30);
    expect(days).toBe(30);
    expect(db.pricingConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: TRIAL_DAYS_KEY },
        update: expect.objectContaining({ value: "30" }),
      }),
    );
  });

  it("refuses an out-of-range value before touching the database", async () => {
    await expect(setTrialDays(100_000)).rejects.toThrow(/MAX/);
    expect(db.pricingConfig.upsert).not.toHaveBeenCalled();
  });
});

describe("grantSignupTrial", () => {
  it("grants a new account its trial", async () => {
    db.pricingConfig.findMany.mockResolvedValue([{ key: TRIAL_DAYS_KEY, value: "10" }]);
    db.user.findUnique.mockResolvedValue({ accessUntil: null, role: "USER" });

    const result = await grantSignupTrial("u1");

    expect(result.granted).toBe(true);
    // Extended from now, to the configured length.
    const delta = (result.accessUntil!.getTime() - Date.now()) / DAY;
    expect(delta).toBeGreaterThan(9.9);
    expect(delta).toBeLessThan(10.1);
  });

  it("does not shorten or overwrite a window a paying customer already has", async () => {
    // The failure this prevents: a user paid for 30 days, signs in through a
    // different provider, and their paid access silently becomes a 7-day trial.
    const paid = new Date(Date.now() + 20 * DAY);
    db.user.findUnique.mockResolvedValue({ accessUntil: paid, role: "USER" });

    const result = await grantSignupTrial("u1");

    expect(result.granted).toBe(false);
    expect(result.reason).toBe("ALREADY_HAS_ACCESS");
    expect(result.accessUntil).toEqual(paid);
  });

  it("re-grants after a trial has lapsed", async () => {
    // A lapsed trial means the user came back, not that the account is finished.
    db.user.findUnique.mockResolvedValue({
      accessUntil: new Date(Date.now() - DAY),
      role: "USER",
    });

    const result = await grantSignupTrial("u1");
    expect(result.granted).toBe(true);
  });

  it("skips admins, who are never paywalled", async () => {
    db.user.findUnique.mockResolvedValue({ accessUntil: null, role: "SUPER_ADMIN" });
    const result = await grantSignupTrial("u1");
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("ADMIN_ROLE");
  });

  it("reports rather than throws when the user is missing", async () => {
    // Signup calls this, and a throw here would cost the customer their account
    // over a failed trial grant.
    db.user.findUnique.mockResolvedValue(null);
    const result = await grantSignupTrial("gone");
    expect(result.granted).toBe(false);
    expect(result.reason).toBe("USER_NOT_FOUND");
  });

  it("does not throw when the config read fails", async () => {
    db.pricingConfig.findMany.mockRejectedValue(new Error("db down"));
    db.user.findUnique.mockResolvedValue({ accessUntil: null, role: "USER" });
    // getConfig swallows its own failure and returns the default, so this still
    // grants. What matters is that it returns rather than raising.
    await expect(grantSignupTrial("u1")).resolves.toBeDefined();
  });
});

describe("grantTrialToAllUsers", () => {
  it("only extends accounts with no current access", async () => {
    // The guard that matters: a bulk promotion must not hand extra days to
    // everyone who already paid.
    db.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    db.user.updateMany.mockResolvedValue({ count: 2 });

    const result = await grantTrialToAllUsers(15, "admin1");

    expect(result).toMatchObject({ days: 15, granted: 2 });
    const call = db.user.updateMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { accessUntil: null },
      { accessUntil: { lte: expect.any(Date) } },
    ]);
    expect(call.data.accessSource).toBe(TRIAL_SOURCE);
  });

  it("excludes admins from the query", async () => {
    db.user.findMany.mockResolvedValue([]);
    await grantTrialToAllUsers(7, "admin1");
    expect(db.user.findMany.mock.calls[0][0].where.role).toEqual({
      notIn: expect.arrayContaining(["SUPER_ADMIN"]),
    });
  });

  it("audits the bulk action with the actor and the count", async () => {
    // "Who gave every account free access, and when" is asked after every
    // incident, so this has to be reconstructable.
    db.user.findMany.mockResolvedValue([{ id: "u1" }]);
    db.user.updateMany.mockResolvedValue({ count: 1 });

    await grantTrialToAllUsers(3, "admin1");

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "admin1",
        action: "TRIAL_GRANTED_ALL",
        metadata: expect.stringContaining('"granted":1'),
      }),
    });
  });

  it("validates before running any query", async () => {
    await expect(grantTrialToAllUsers(0, "admin1")).rejects.toThrow(/INVALID/);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe("setUserAccess", () => {
  it("sets a window for one named user and records why", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", accessUntil: null });
    const result = await setUserAccess("u1", 30, "admin1", "tester account");

    expect(result.accessUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "TRIAL_GRANTED_USER",
        // The reason lives in metadata because AuditLog has no reason column.
        metadata: expect.stringContaining("tester account"),
      }),
    });
  });

  it("revokes when days is null", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u1", accessUntil: new Date(Date.now() + DAY) });
    const result = await setUserAccess("u1", null, "admin1");
    expect(result.accessUntil!.getTime()).toBe(0);
  });

  it("throws for an unknown user rather than silently succeeding", async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(setUserAccess("gone", 7, "admin1")).rejects.toThrow(/USER_NOT_FOUND/);
  });
});
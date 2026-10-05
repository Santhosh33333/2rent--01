import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Discovery ranking - the part of discover() that turns saved preferences into an
 * ordering.
 *
 * Separate from datingService.test.ts on purpose. That file is about the swipe and
 * match state machine; this is about a different question (who is eligible, and in
 * what order) and has different failure modes - a bad ranking is silent, whereas a
 * bad swipe throws. Mixing them makes both harder to read.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    userPreferences: { findUnique: vi.fn(), findMany: vi.fn() },
    like: { findMany: vi.fn() },
    pass: { findMany: vi.fn() },
    userBlock: { findMany: vi.fn() },
  },
}));

// Whole-module replacement, so every import the discovery path touches has to be
// listed here. getStringConfig backs the matching weights; an empty value means
// "no admin override", which falls back to the documented defaults.
vi.mock("../services/pricingEngine", () => ({
  getConfig: vi.fn(async () => 0.5),
  getStringConfig: vi.fn(async () => ""),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { discover } from "../services/datingService";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

const CANDIDATE_BASE = {
  fullName: "Candidate",
  avatarUrl: null,
  bio: null,
  city: "Chennai",
  gender: "FEMALE",
  dateOfBirth: new Date("1998-06-01T00:00:00.000Z"),
  language: "ta",
  mobileVerified: false,
  latitude: null,
  longitude: null,
};

function candidate(over: Record<string, unknown> = {}) {
  return { id: USER_B, ...CANDIDATE_BASE, ...over };
}

function savedPrefs(over: Record<string, unknown> = {}) {
  return {
    distanceKm: 50,
    ageMin: 18,
    ageMax: 100,
    interests: [],
    languages: [],
    lifestyle: "{}",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.like.findMany.mockResolvedValue([]);
  prismaMock.pass.findMany.mockResolvedValue([]);
  prismaMock.userBlock.findMany.mockResolvedValue([]);
  prismaMock.userPreferences.findUnique.mockResolvedValue(null);
  prismaMock.userPreferences.findMany.mockResolvedValue([]);
  // No saved location by default: distance must then be unrankable, not zero.
  prismaMock.user.findUnique.mockResolvedValue({ latitude: null, longitude: null });
  prismaMock.user.findMany.mockResolvedValue([]);
});

describe("discover: saved preferences become filters", () => {
  it("applies the saved age range when no explicit filter is given", async () => {
    // The behaviour the feature exists for. DiscoverPage used to send an empty
    // filter object, so nothing was ever applied despite the UI looking filterable.
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ ageMin: 25, ageMax: 35 }));

    await discover(USER_A, {});

    const args = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { dateOfBirth: { gte: Date; lte: Date } };
    };
    // 25-35 today means: nobody born after the day they turn 25 (that is the UPPER
    // date bound), and nobody born before 1 January of the year they turned 36 (the
    // LOWER bound). Both are derived from the current year at call time, so the
    // window rolls forward by itself every January - no stored value, no migration,
    // nothing to re-deploy at New Year.
    const nowYear = new Date().getFullYear();
    expect(args.where.dateOfBirth.lte.getFullYear()).toBeLessThanOrEqual(nowYear - 25);
    expect(args.where.dateOfBirth.gte.getFullYear()).toBeLessThanOrEqual(nowYear - 36);
    // And the window must be an ordering a real person can fall inside.
    expect(args.where.dateOfBirth.gte.getTime()).toBeLessThanOrEqual(
      args.where.dateOfBirth.lte.getTime(),
    );
  });

  it("lets an explicit query filter override the saved preference", async () => {
    // A one-off "just this age band this time" must not need editing and re-saving.
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ ageMin: 25, ageMax: 35 }));

    await discover(USER_A, { minAge: 40, maxAge: 60 });

    const args = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { dateOfBirth: { gte: Date } };
    };
    expect(args.where.dateOfBirth.gte.getFullYear()).toBeLessThanOrEqual(
      new Date().getFullYear() - 61,
    );
  });

  it("does not apply a distance box when the viewer has no saved location", async () => {
    await discover(USER_A, {});
    const args = prismaMock.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // Filtering on a radius we cannot measure would silently remove everyone.
    expect(JSON.stringify(args.where)).not.toContain("latitude");
  });

  it("keeps profiles with no location eligible when the viewer has one", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ latitude: 13.08, longitude: 80.27 });
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ distanceKm: 25 }));

    await discover(USER_A, {});

    const args = prismaMock.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // The latitude:null branch is what stops "no location" meaning "invisible".
    expect(JSON.stringify(args.where)).toContain('"latitude":null');
  });

  it("applies a bounding box when both sides have a location", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ latitude: 13.08, longitude: 80.27 });
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ distanceKm: 10 }));

    await discover(USER_A, {});

    const args = prismaMock.user.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(JSON.stringify(args.where)).toContain("latitude");
  });
});

describe("discover: ranking", () => {
  it("returns a working feed for an account with no saved preferences", async () => {
    // "No preferences" must mean "no opinion", not "no results".
    prismaMock.user.findMany.mockResolvedValue([candidate()]);

    const out = await discover(USER_A, {});
    expect(out.results).toHaveLength(1);
    expect(out.results[0].matchScore).toBeGreaterThan(0);
  });

  it("orders the best-scoring candidate first, not the query order", async () => {
    prismaMock.userPreferences.findUnique.mockResolvedValue(
      savedPrefs({ interests: ["travel", "music"], languages: ["tamil"] }),
    );
    // Inserted worst-first on purpose.
    prismaMock.user.findMany.mockResolvedValue([
      candidate({ id: "no_overlap" }),
      candidate({ id: "full_overlap" }),
    ]);
    prismaMock.userPreferences.findMany.mockResolvedValue([
      { userId: "no_overlap", interests: ["books"], languages: ["english"], lifestyle: "{}" },
      { userId: "full_overlap", interests: ["travel", "music"], languages: ["tamil"], lifestyle: "{}" },
    ]);

    const out = await discover(USER_A, {});
    expect(out.results[0].id).toBe("full_overlap");
  });

  it("attaches human-readable reasons a card can render", async () => {
    prismaMock.userPreferences.findUnique.mockResolvedValue(
      savedPrefs({ interests: ["travel"], languages: ["tamil"] }),
    );
    prismaMock.user.findMany.mockResolvedValue([candidate()]);
    prismaMock.userPreferences.findMany.mockResolvedValue([
      { userId: USER_B, interests: ["travel"], languages: ["tamil"], lifestyle: "{}" },
    ]);

    const out = await discover(USER_A, {});
    const codes = out.results[0].reasons.map((r: { code: string }) => r.code);
    expect(codes).toContain("shared_interests");
    expect(codes).toContain("shared_language");
  });

  it("drops candidates outside the radius even when the bounding box admitted them", async () => {
    // The box is a square and the radius is a circle; the corners are removed here.
    prismaMock.user.findUnique.mockResolvedValue({ latitude: 13.08, longitude: 80.27 });
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ distanceKm: 5 }));
    prismaMock.user.findMany.mockResolvedValue([
      // Roughly 40 km away, inside a 5 km box's longitude span but outside its radius.
      candidate({ id: "too_far", latitude: 13.3, longitude: 80.5 }),
      candidate({ id: "close_enough", latitude: 13.09, longitude: 80.28 }),
    ]);

    const out = await discover(USER_A, {});
    expect(out.results.map((r: { id: string }) => r.id)).toEqual(["close_enough"]);
  });

  it("never returns coordinates, only an approximate band", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ latitude: 13.08, longitude: 80.27 });
    prismaMock.user.findMany.mockResolvedValue([candidate({ latitude: 13.1, longitude: 80.3 })]);

    const out = await discover(USER_A, {});
    const [first] = out.results;
    // Cast because the point of the assertion is that these keys are absent from
    // the result type. Reading them off the typed object is not possible, which is
    // the compiler already half of this test.
    const asRecord = first as unknown as Record<string, unknown>;
    expect(asRecord.latitude).toBeUndefined();
    expect(asRecord.longitude).toBeUndefined();
    expect(first.distance).toBe("1-5 km");
    // A band, never a precise figure: "3.4 km" tells a viewer more about someone's
    // movements than the decision actually needs.
    expect(first.distance).not.toMatch(/\d+\.\d/);
  });

  it("reports no distance band when neither side has a location", async () => {
    prismaMock.user.findMany.mockResolvedValue([candidate()]);
    const out = await discover(USER_A, {});
    expect(out.results[0].distance).toBeNull();
  });

  it("falls back to the single legacy language field for older profiles", async () => {
    // Most accounts have User.language set but no UserPreferences row at all.
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs({ languages: ["tamil"] }));
    prismaMock.user.findMany.mockResolvedValue([candidate({ language: "ta" })]);

    const out = await discover(USER_A, {});
    expect(out.results[0].reasons.some((r: { code: string }) => r.code === "shared_language")).toBe(
      true,
    );
  });

  it("honours the requested limit and reports the eligible total", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      candidate({ id: "a" }),
      candidate({ id: "b" }),
      candidate({ id: "c" }),
    ]);

    const out = await discover(USER_A, { limit: 2 });
    expect(out.results).toHaveLength(2);
    expect(out.count).toBe(2);
    expect(out.totalEligible).toBe(3);
  });

  it("survives a candidate whose stored lifestyle JSON is corrupt", async () => {
    prismaMock.userPreferences.findUnique.mockResolvedValue(savedPrefs());
    prismaMock.user.findMany.mockResolvedValue([candidate()]);
    prismaMock.userPreferences.findMany.mockResolvedValue([
      { userId: USER_B, interests: [], languages: [], lifestyle: "{not json" },
    ]);

    // A hand-edited row must not be able to 500 the whole feed.
    await expect(discover(USER_A, {})).resolves.toBeDefined();
  });
});
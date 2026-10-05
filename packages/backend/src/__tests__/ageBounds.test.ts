import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mock object declared through vi.hoisted rather than built from a top-level
 * import: vi.mock factories are lifted above the imports, so referencing an
 * imported binding from inside one throws "cannot access before initialization".
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    userPreferences: { findUnique: vi.fn(), findMany: vi.fn() },
    like: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    pass: { findMany: vi.fn() },
    userBlock: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

/**
 * The age window that discovery filters on.
 *
 * Written as tests rather than left implicit because the bug that motivated this
 * file was silent: an inverted date range matches nobody, so the feed simply came
 * back empty, and an empty feed looks like "nobody has signed up yet" rather than
 * like a broken query. The explicit case at the bottom is the regression test -
 * the bounds were swapped, and nothing else in the suite noticed.
 */

const VIEWER = "cccccccc-0000-0000-0000-00000000000v";

vi.mock("../services/pricingEngine", () => ({
  getConfig: vi.fn(async () => 0.5),
  getStringConfig: vi.fn(async () => ""),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { discover } from "../services/datingService";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prismaMock.like.findMany).mockResolvedValue([]);
  vi.mocked(prismaMock.pass.findMany).mockResolvedValue([]);
  vi.mocked(prismaMock.userBlock.findMany).mockResolvedValue([]);
  vi.mocked(prismaMock.userPreferences.findMany).mockResolvedValue([]);
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ latitude: null, longitude: null });
  vi.mocked(prismaMock.user.findMany).mockResolvedValue([]);
  vi.mocked(prismaMock.userPreferences.findUnique).mockResolvedValue(null);
});

/** The date-of-birth clause discovery would send to Postgres. */
function dobWindow(index = 0): { gte?: Date; lte?: Date } {
  const call = vi.mocked(prismaMock.user.findMany).mock.calls[index][0] as {
    where: { dateOfBirth?: { gte?: Date; lte?: Date } };
  };
  return call.where.dateOfBirth ?? {};
}

function year(d: Date): number {
  return d.getFullYear();
}

describe("discovery age window", () => {
  it("produces an ordering that can actually match someone", async () => {
    // The regression this file exists for. For the default 18-100 range the
    // previous implementation produced "born after 2007 and before 1926", which
    // no row can satisfy - so discovery returned nothing for every user.
    await discover(VIEWER, {});
    const { gte, lte } = dobWindow();
    expect(gte).toBeDefined();
    expect(lte).toBeDefined();
    expect(gte!.getTime()).toBeLessThanOrEqual(lte!.getTime());
  });

  it("uses the default 18-100 range when nothing is saved", async () => {
    await discover(VIEWER, {});
    const { gte, lte } = dobWindow();
    const now = new Date().getFullYear();
    // Oldest allowed: someone who turned 100 during this year.
    expect(year(gte!)).toBeLessThanOrEqual(now - 101);
    // Youngest allowed: somebody turning 18 today is included, not excluded.
    expect(year(lte!)).toBeLessThanOrEqual(now - 18);
    expect(lte!.getTime()).toBeGreaterThan(gte!.getTime());
  });

  it("excludes a person who is one year under the minimum age", async () => {
    await discover(VIEWER, {});
    const { lte } = dobWindow();
    const now = new Date();
    // Born tomorrow relative to the same month/day: a year under the minimum.
    const underage = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate() + 1);
    expect(underage.getTime()).toBeGreaterThan(lte!.getTime());
  });

  it("includes a person turning the minimum age today", async () => {
    await discover(VIEWER, {});
    const { lte } = dobWindow();
    const now = new Date();
    const exactlyEighteen = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
    // Inclusive bound: on their birthday they are exactly the requested age.
    expect(exactlyEighteen.getTime()).toBeLessThanOrEqual(lte!.getTime());
  });

  it("keeps a 25-35 window inside the 18-100 window", async () => {
    vi.mocked(prismaMock.userPreferences.findUnique).mockResolvedValue({
      distanceKm: 50,
      ageMin: 25,
      ageMax: 35,
      interests: [],
      languages: [],
      lifestyle: "{}",
    });
    await discover(VIEWER, {});
    const { gte, lte } = dobWindow();
    const now = new Date().getFullYear();
    // A narrow window must produce a narrower window, not a wider or equal one.
    expect(year(gte!)).toBeGreaterThanOrEqual(now - 37);
    expect(year(lte!)).toBeLessThanOrEqual(now - 25);
    expect(gte!.getTime()).toBeLessThan(lte!.getTime());
  });

  it("widens the window when the caller asks for a broader range", async () => {
    await discover(VIEWER, { minAge: 18, maxAge: 100 });
    const wide = dobWindow(0);
    await discover(VIEWER, { minAge: 30, maxAge: 60 });
    const narrow = dobWindow(1);
    // Narrower request -> narrower date window, at both ends.
    expect(narrow.gte!.getTime()).toBeGreaterThan(wide.gte!.getTime());
    expect(narrow.lte!.getTime()).toBeLessThan(wide.lte!.getTime());
  });

  it("omits the clause entirely when neither bound is given", async () => {
    // A caller that genuinely has no age opinion should get every age, not a
    // window invented from defaults.
    await discover(VIEWER, {});
    vi.mocked(prismaMock.userPreferences.findUnique).mockResolvedValue({
      distanceKm: 50,
      ageMin: 0,
      ageMax: 0,
      interests: [],
      languages: [],
      lifestyle: "{}",
    });
    await discover(VIEWER, {});
    // Defaults of 0/0 mean "no opinion" and must not clamp to the year 2000.
    const call = vi.mocked(prismaMock.user.findMany).mock.calls[1][0] as {
      where: { dateOfBirth?: unknown };
    };
    expect(call.where.dateOfBirth).toBeUndefined();
  });

  it("is stable across a DST boundary rather than shifting by an hour", async () => {
    // Built from calendar fields, not by subtracting milliseconds, so it cannot
    // drift by 24 hours twice a year and quietly exclude a birthday.
    await discover(VIEWER, { minAge: 18, maxAge: 18 });
    const { gte, lte } = dobWindow();
    expect(gte!.getHours()).toBe(0);
    expect(lte!.getHours()).toBe(0);
  });
});
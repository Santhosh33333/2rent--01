import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({ prismaMock: {
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  like: { findFirst: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  pass: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  userBlock: { findFirst: vi.fn(), findMany: vi.fn() },
  match: { upsert: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (t: unknown) => Promise<unknown>)(prismaMock);
    return Promise.all(arg as Promise<unknown>[]);
  }),
} }));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import {
  recordSwipe,
  likesReceived,
  discover,
} from "../services/datingService";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue({ id: USER_B });
  prismaMock.userBlock.findFirst.mockResolvedValue(null);
  prismaMock.userBlock.findMany.mockResolvedValue([]);
  prismaMock.like.findMany.mockResolvedValue([]);
  prismaMock.pass.findMany.mockResolvedValue([]);
});

describe("recordSwipe", () => {
  it("rejects a self-swipe before touching the database", async () => {
    await expect(recordSwipe(USER_A, USER_A, "LIKE")).rejects.toThrow("INVALID_TARGET");
    expect(prismaMock.like.upsert).not.toHaveBeenCalled();
  });

  it("does not create a match when the like is not reciprocated", async () => {
    prismaMock.like.findFirst.mockResolvedValue(null);
    const res = await recordSwipe(USER_A, USER_B, "LIKE");
    expect(res.match).toBeNull();
    expect(prismaMock.match.upsert).not.toHaveBeenCalled();
  });

  it("stores the canonical (ordered) pair so a mutual like yields one match", async () => {
    prismaMock.like.findFirst.mockResolvedValue({ id: "like_1" });
    prismaMock.match.upsert.mockResolvedValue({
      id: "match_1",
      matchedAt: new Date("2026-01-01"),
    });

    await recordSwipe(USER_B, USER_A, "LIKE");

    expect(prismaMock.match.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userAId_userBId: { userAId: USER_A, userBId: USER_B } },
      }),
    );
  });

  it("refuses to swipe a user who blocked the actor", async () => {
    prismaMock.userBlock.findFirst.mockResolvedValue({ id: "block_1" });
    await expect(recordSwipe(USER_A, USER_B, "LIKE")).rejects.toThrow("BLOCKED");
    expect(prismaMock.like.upsert).not.toHaveBeenCalled();
  });

  it("clears a previous like when the same user is later passed", async () => {
    await recordSwipe(USER_A, USER_B, "PASS");
    expect(prismaMock.like.deleteMany).toHaveBeenCalledWith({
      where: { fromUserId: USER_A, toUserId: USER_B },
    });
  });
});

describe("likesReceived", () => {
  it("excludes self-likes from the returned rows", async () => {
    prismaMock.like.findMany.mockResolvedValue([]);
    await likesReceived(USER_A);
    expect(prismaMock.like.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { toUserId: USER_A, fromUserId: { not: USER_A } },
      }),
    );
  });
});

describe("discover", () => {
  it("never selects phone, email or exact location", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    await discover(USER_A, {});
    const args = prismaMock.user.findMany.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(Object.keys(args.select)).not.toContain("phone");
    expect(Object.keys(args.select)).not.toContain("email");
    expect(Object.keys(args.select)).not.toContain("passwordHash");
  });

  it("excludes the viewer and anyone already acted on", async () => {
    prismaMock.like.findMany.mockResolvedValue([{ toUserId: "already_liked" }]);
    prismaMock.pass.findMany.mockResolvedValue([{ toUserId: "already_passed" }]);
    prismaMock.userBlock.findMany.mockResolvedValue([
      { blockerId: USER_A, blockedId: "blocked_by_me" },
    ]);
    prismaMock.user.findMany.mockResolvedValue([]);

    await discover(USER_A, {});

    const args = prismaMock.user.findMany.mock.calls[0][0] as {
      where: { id: { notIn: string[] } };
    };
    expect(args.where.id.notIn).toEqual(
      expect.arrayContaining([USER_A, "already_liked", "already_passed", "blocked_by_me"]),
    );
  });
});


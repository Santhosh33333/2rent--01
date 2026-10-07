import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Global social feed (posts, likes, saves, comments, reports, gifts).
 *
 * Two things here are worth pinning harder than the happy paths:
 *
 * 1. Visibility. A PRIVATE post must never leak to another user, and a
 *    FOLLOWERS post must only be readable by an ACCEPTED friend. All three
 *    resolve against the same rule in one place, so feed, single-post,
 *    and comment reads cannot drift apart.
 *
 * 2. Gifts are a money move. The sender's balance is tested inside the
 *    WHERE of the debit, so an empty wallet rolls the whole transaction
 *    back and credits nothing; a retried referenceId can never double
 *    charge. If either breaks, money is created out of thin air.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    post: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn(), update: vi.fn() },
    postComment: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    postLike: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    postSave: { create: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    postReport: { findFirst: vi.fn(), create: vi.fn() },
    gift: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    friendship: { findMany: vi.fn() },
    wallet: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    transaction: { createMany: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import * as ctrl from "../controllers/socialPostController";

const ME = "user-1-1111-1111-111111111111";
const OTHER = "user-2-2222-2222-222222222222";
const AUTHOR = "user-9-9999-9999-999999999999";

type MockRes = {
  statusCode: number;
  payload: any;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function makeRes(): { res: never; out: MockRes } {
  const out: MockRes = {
    statusCode: 0,
    payload: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.payload = b;
      return this;
    },
  };
  return { res: out as unknown as never, out };
}

function makeReq(overrides: Partial<{ body: any; params: any; query: any; user: any; file: any }> = {}) {
  return {
    body: {},
    params: {},
    query: {},
    user: { userId: ME },
    ...overrides,
  } as never;
}

function postRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    authorId: AUTHOR,
    type: "TEXT",
    content: "Hello feed",
    imageUrl: null,
    videoUrl: null,
    visibility: "PUBLIC",
    status: "ACTIVE",
    locationArea: null,
    scheduledAt: null,
    publishedAt: new Date("2026-10-06T10:00:00Z"),
    createdAt: new Date("2026-10-06T10:00:00Z"),
    updatedAt: new Date("2026-10-06T10:00:00Z"),
    author: { id: AUTHOR, fullName: "Author", avatarUrl: null },
    _count: { likes: 2, comments: 1, gifts: 3 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Feed-level defaults: nobody is anyone's friend, no existing likes/saves.
  prismaMock.friendship.findMany.mockResolvedValue([]);
  prismaMock.postLike.findMany.mockResolvedValue([]);
  prismaMock.postLike.findUnique.mockResolvedValue(null);
  prismaMock.postSave.findMany.mockResolvedValue([]);
  prismaMock.postSave.findUnique.mockResolvedValue(null);
  prismaMock.gift.groupBy.mockResolvedValue([]);
  prismaMock.gift.aggregate.mockResolvedValue({ _sum: { amount: null } });
  prismaMock.gift.count.mockResolvedValue(0);
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.transaction.createMany.mockResolvedValue({ count: 2 });
});

// ============================================================================
// CREATE POST
// ============================================================================

describe("createPost", () => {
  it("publishes a text post", async () => {
    prismaMock.post.create.mockResolvedValue(postRow());
    const { res, out } = makeRes();
    await ctrl.createPost(makeReq({ body: { content: "  Hello feed  " } }), res as never);
    expect(out.statusCode).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: ME, content: "Hello feed", type: "TEXT", visibility: "PUBLIC" }),
      })
    );
    expect(out.payload.data).toMatchObject({ content: "Hello feed", likedByMe: false, giftTotal: 0 });
  });

  it("infers PHOTO / VIDEO from the attached media", async () => {
    prismaMock.post.create.mockResolvedValue(postRow({ type: "PHOTO" }));
    const { res } = makeRes();
    await ctrl.createPost(makeReq({ body: { imageUrl: "/uploads/a.png" } }), res as never);
    expect(prismaMock.post.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "PHOTO", imageUrl: "/uploads/a.png" }) }));
  });

  it("video wins over nothing when only videoUrl is present", async () => {
    prismaMock.post.create.mockResolvedValue(postRow({ type: "VIDEO" }));
    const { res } = makeRes();
    await ctrl.createPost(makeReq({ body: { videoUrl: "/uploads/v.mp4" } }), res as never);
    expect(prismaMock.post.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "VIDEO", videoUrl: "/uploads/v.mp4" }) }));
  });

  it("rejects a post with no text and no media", async () => {
    const { res, out } = makeRes();
    await ctrl.createPost(makeReq({ body: {} }), res as never);
    expect(out.statusCode).toBe(400);
    expect(out.payload.error).toBe("VALIDATION_ERROR");
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown type and an unknown visibility", async () => {
    const { res: r1, out: o1 } = makeRes();
    await ctrl.createPost(makeReq({ body: { content: "x", type: "MEME" } }), r1 as never);
    expect(o1.statusCode).toBe(400);

    const { res: r2, out: o2 } = makeRes();
    await ctrl.createPost(makeReq({ body: { content: "x", visibility: "WHOLE_WORLD" } }), r2 as never);
    expect(o2.statusCode).toBe(400);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });
});

// ============================================================================
// FEED + SINGLE POST VISIBILITY
// ============================================================================

describe("listFeed", () => {
  it("returns ACTIVE public posts plus the reader's own, with engagement flags", async () => {
    prismaMock.post.findMany.mockResolvedValue([postRow()]);
    prismaMock.post.count.mockResolvedValue(1);
    prismaMock.postLike.findMany.mockResolvedValue([{ postId: "p1" }]);
    prismaMock.gift.groupBy.mockResolvedValue([{ postId: "p1", _sum: { amount: new Prisma.Decimal(60) } }]);

    const { res, out } = makeRes();
    await ctrl.listFeed(makeReq(), res as never);

    // The visibility WHERE must include own + PUBLIC (and FOLLOWERS via friends).
    const where = prismaMock.post.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.OR).toHaveLength(3);

    expect(out.statusCode).toBe(200);
    expect(out.payload.data.items[0]).toMatchObject({ likedByMe: true, savedByMe: false, giftTotal: 60 });
  });

  it("excludes posts whose author is blocked from nothing but keeps the feed honest on counts", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.post.count.mockResolvedValue(0);
    const { res, out } = makeRes();
    await ctrl.listFeed(makeReq(), res as never);
    expect(out.payload.data.total).toBe(0);
  });
});

describe("getPost", () => {
  it("lets an author see their own PRIVATE post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: ME, visibility: "PRIVATE" }));
    const { res, out } = makeRes();
    await ctrl.getPost(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.statusCode).toBe(200);
  });

  it("hides a PRIVATE post from everyone else", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR, visibility: "PRIVATE" }));
    const { res, out } = makeRes();
    await ctrl.getPost(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.statusCode).toBe(403);
    expect(out.payload.error).toBe("FORBIDDEN");
  });

  it("shows a FOLLOWERS post only to accepted friends", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR, visibility: "FOLLOWERS" }));
    // ME is not a friend of AUTHOR yet.
    const { res: r1, out: o1 } = makeRes();
    await ctrl.getPost(makeReq({ params: { id: "p1" } }), r1 as never);
    expect(o1.statusCode).toBe(403);

    // Now a friendship exists — accepted, other way around the test's set.
    prismaMock.friendship.findMany.mockResolvedValue([{ requesterId: AUTHOR, addresseeId: ME }]);
    const { res: r2, out: o2 } = makeRes();
    await ctrl.getPost(makeReq({ params: { id: "p1" } }), r2 as never);
    expect(o2.statusCode).toBe(200);
  });

  it("404s a REMOVED post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ status: "REMOVED" }));
    const { res, out } = makeRes();
    await ctrl.getPost(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.statusCode).toBe(404);
  });
});

describe("deletePost", () => {
  it("soft-removes as the author only", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: ME }));
    const { res, out } = makeRes();
    await ctrl.deletePost(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.statusCode).toBe(200);
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { status: "REMOVED" } });
  });

  it("refuses a non-author", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    const { res, out } = makeRes();
    await ctrl.deletePost(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.statusCode).toBe(403);
  });
});

// ============================================================================
// LIKES + SAVES
// ============================================================================

describe("toggleLike", () => {
  it("likes then unlikes", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow());
    prismaMock.postLike.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "like_1", postId: "p1", userId: ME });
    prismaMock.postLike.create.mockResolvedValue({});
    prismaMock.postLike.delete.mockResolvedValue({});
    prismaMock.postLike.count.mockResolvedValue(1);

    const { res: r1, out: o1 } = makeRes();
    await ctrl.toggleLike(makeReq({ params: { id: "p1" } }), r1 as never);
    expect(o1.payload.data).toEqual({ liked: true, likeCount: 1 });

    const { res: r2, out: o2 } = makeRes();
    await ctrl.toggleLike(makeReq({ params: { id: "p1" } }), r2 as never);
    expect(o2.payload.data.liked).toBe(false);
    expect(prismaMock.postLike.delete).toHaveBeenCalled();
  });

  it("refuses a missing post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(null);
    const { res, out } = makeRes();
    await ctrl.toggleLike(makeReq({ params: { id: "nope" } }), res as never);
    expect(out.statusCode).toBe(404);
  });

  it("records a like notification carrying the post link and event type", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.create.mockResolvedValue({});
    prismaMock.postLike.count.mockResolvedValue(1);
    const { res, out } = makeRes();
    await ctrl.toggleLike(makeReq({ params: { id: "p1" } }), res as never);
    expect(out.payload.data).toEqual({ liked: true, likeCount: 1 });
    const row = prismaMock.notification.create.mock.calls[0][0].data as any;
    expect(row.userId).toBe(AUTHOR);
    expect(row.title).toBe("New like on your post");
    // data must be JSON clients can parse — it drives deep-linking to the post.
    expect(JSON.parse(row.data)).toMatchObject({ postId: "p1", type: "POST_LIKE", actorId: ME });
  });

  it("stays silent when the author likes their own post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: ME }));
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.create.mockResolvedValue({});
    prismaMock.postLike.count.mockResolvedValue(1);
    const { res } = makeRes();
    await ctrl.toggleLike(makeReq({ params: { id: "p1" } }), res as never);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

describe("toggleSave", () => {
  it("saves then unsaves", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow());
    prismaMock.postSave.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "save_1" });
    prismaMock.postSave.create.mockResolvedValue({});
    prismaMock.postSave.delete.mockResolvedValue({});
    prismaMock.postSave.count.mockResolvedValue(1);

    const { res: r1, out: o1 } = makeRes();
    await ctrl.toggleSave(makeReq({ params: { id: "p1" } }), r1 as never);
    expect(o1.payload.data).toEqual({ saved: true, saveCount: 1 });

    const { res: r2, out: o2 } = makeRes();
    await ctrl.toggleSave(makeReq({ params: { id: "p1" } }), r2 as never);
    expect(o2.payload.data.saved).toBe(false);
  });
});

// ============================================================================
// COMMENTS
// ============================================================================

describe("createComment", () => {
  it("adds a top-level comment and notifies the author", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    prismaMock.postComment.create.mockResolvedValue({ id: "c1", postId: "p1", authorId: ME, content: "Nice!", parentId: null, author: { id: ME, fullName: "Me", avatarUrl: null } });
    const { res, out } = makeRes();
    await ctrl.createComment(makeReq({ params: { id: "p1" }, body: { content: "Nice!" } }), res as never);
    expect(out.statusCode).toBe(201);
    expect(out.payload.data.isMine).toBe(true);
    // Notification fired (async wrapper stores the call synchronously).
    expect(prismaMock.notification.create).toHaveBeenCalled();
  });

  it("rejects an empty comment", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow());
    const { res, out } = makeRes();
    await ctrl.createComment(makeReq({ params: { id: "p1" }, body: { content: "   " } }), res as never);
    expect(out.statusCode).toBe(400);
  });

  it("rejects a reply to a comment that is not on this post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow());
    prismaMock.postComment.findFirst.mockResolvedValue(null);
    const { res, out } = makeRes();
    await ctrl.createComment(makeReq({ params: { id: "p1" }, body: { content: "reply", parentId: "c999" } }), res as never);
    expect(out.statusCode).toBe(404);
    expect(out.payload.error).toBe("COMMENT_NOT_FOUND");
  });

  it("pings the parent-comment author when a reply lands", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    prismaMock.postComment.findFirst.mockResolvedValue({ id: "c1", postId: "p1", authorId: OTHER });
    prismaMock.postComment.create.mockResolvedValue({ id: "c2", postId: "p1", authorId: ME, content: "agreed", parentId: "c1", author: { id: ME, fullName: "Me", avatarUrl: null } });
    const { res, out } = makeRes();
    await ctrl.createComment(makeReq({ params: { id: "p1" }, body: { content: "agreed", parentId: "c1" } }), res as never);
    expect(out.statusCode).toBe(201);
    // Post author got the comment ping; the answered comment's author got the reply ping.
    const calls = prismaMock.notification.create.mock.calls.map((c: any) => c[0].data as any);
    expect(calls.some((d: any) => d.userId === AUTHOR && JSON.parse(d.data).type === "POST_COMMENT")).toBe(true);
    expect(calls.some((d: any) => d.userId === OTHER && JSON.parse(d.data).type === "POST_REPLY" && JSON.parse(d.data).parentCommentId === "c1")).toBe(true);
  });

  it("does not ping the post author twice when the reply answers their own comment", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    prismaMock.postComment.findFirst.mockResolvedValue({ id: "c1", postId: "p1", authorId: AUTHOR });
    prismaMock.postComment.create.mockResolvedValue({ id: "c2", postId: "p1", authorId: ME, content: "ok", parentId: "c1", author: { id: ME, fullName: "Me", avatarUrl: null } });
    const { res } = makeRes();
    await ctrl.createComment(makeReq({ params: { id: "p1" }, body: { content: "ok", parentId: "c1" } }), res as never);
    const calls = prismaMock.notification.create.mock.calls.map((c: any) => c[0].data as any);
    const hits = calls.filter((d: any) => d.userId === AUTHOR);
    expect(hits.length).toBe(1);
    expect(JSON.parse(hits[0].data).type).toBe("POST_COMMENT");
  });
});

describe("deleteComment", () => {
  it("lets the comment author soft-delete", async () => {
    prismaMock.postComment.findFirst.mockResolvedValue({ id: "c1", postId: "p1", authorId: ME });
    const { res, out } = makeRes();
    await ctrl.deleteComment(makeReq({ params: { id: "p1", commentId: "c1" } }), res as never);
    expect(out.statusCode).toBe(200);
    expect(prismaMock.postComment.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "REMOVED" } });
  });

  it("refuses a non-author", async () => {
    prismaMock.postComment.findFirst.mockResolvedValue({ id: "c1", postId: "p1", authorId: AUTHOR });
    const { res, out } = makeRes();
    await ctrl.deleteComment(makeReq({ params: { id: "p1", commentId: "c1" } }), res as never);
    expect(out.statusCode).toBe(403);
  });
});

// ============================================================================
// REPORTS
// ============================================================================

describe("reportPost", () => {
  it("creates a report and blocks duplicates while pending", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow());
    // First report: no pending dupe. Second: already pending → 409.
    prismaMock.postReport.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "rep1" });
    prismaMock.postReport.create.mockResolvedValue({ id: "rep1" });

    const { res: r1, out: o1 } = makeRes();
    await ctrl.reportPost(makeReq({ params: { id: "p1" }, body: { reason: "Spam" } }), r1 as never);
    expect(o1.statusCode).toBe(201);

    const { res: r2, out: o2 } = makeRes();
    await ctrl.reportPost(makeReq({ params: { id: "p1" }, body: { reason: "Spam" } }), r2 as never);
    expect(o2.statusCode).toBe(409);
    expect(o2.payload.error).toBe("ALREADY_REPORTED");
  });

  it("forbids reporting your own post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: ME }));
    const { res, out } = makeRes();
    await ctrl.reportPost(makeReq({ params: { id: "p1" }, body: { reason: "Spam" } }), res as never);
    expect(out.statusCode).toBe(400);
  });
});

// ============================================================================
// GIFTS
// ============================================================================

describe("sendGift", () => {
  beforeEach(() => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ id: "p1", authorId: AUTHOR }));
    prismaMock.gift.findUnique.mockResolvedValue(null);
    // $transaction forwards its callback the "tx" client — mocked as prismaMock
    // itself, so every tx.* call is observable through the same mock.
    prismaMock.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => fn(prismaMock));
  });

  function walletRow(id: string, userId: string, balance: number, heldBalance = 0) {
    return { id, userId, balance, heldBalance, promotionalBalance: 0, currency: "INR" };
  }

  it("debits the sender and credits the author in one transaction", async () => {
    prismaMock.wallet.upsert
      .mockResolvedValueOnce(walletRow("wal_s", ME, 100))
      .mockResolvedValueOnce(walletRow("wal_r", AUTHOR, 0));
    prismaMock.wallet.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.wallet.update.mockResolvedValue({});
    prismaMock.gift.create.mockResolvedValue({ id: "gift_1", postId: "p1", senderId: ME, recipientId: AUTHOR, amount: new Prisma.Decimal(50), referenceId: "ref-abc" });

    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50, referenceId: "ref-abc" } }), res as never);

    expect(out.statusCode).toBe(201);
    expect(out.payload.data).toMatchObject({ reused: false });

    // The debit guard: balance >= needed where needed = amount + held.
    const debitCall = prismaMock.wallet.updateMany.mock.calls[0];
    expect(debitCall[0].where).toEqual({ id: "wal_s", balance: { gte: new Prisma.Decimal(50) } });
    expect(debitCall[0].data).toEqual({ balance: { decrement: new Prisma.Decimal(50) } });
    expect(prismaMock.wallet.update).toHaveBeenCalledWith({ where: { id: "wal_r" }, data: { balance: { increment: new Prisma.Decimal(50) } } });

    // Two-sided ledger, one reference.
    const ledger = prismaMock.transaction.createMany.mock.calls[0][0].data;
    expect(ledger).toHaveLength(2);
    expect(ledger.map((l: any) => l.type).sort()).toEqual(["GIFT_RECEIVED", "GIFT_SENT"]);
    expect(ledger.every((l: any) => l.referenceId === "ref-abc")).toBe(true);
  });

  it("notifies the post author with a parseable gift payload", async () => {
    prismaMock.wallet.upsert
      .mockResolvedValueOnce(walletRow("wal_s", ME, 100))
      .mockResolvedValueOnce(walletRow("wal_r", AUTHOR, 0));
    prismaMock.wallet.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.wallet.update.mockResolvedValue({});
    prismaMock.gift.create.mockResolvedValue({ id: "gift_1", postId: "p1", senderId: ME, recipientId: AUTHOR, amount: new Prisma.Decimal(50), referenceId: "ref-note" });

    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50, referenceId: "ref-note" } }), res as never);
    expect(out.statusCode).toBe(201);

    const row = prismaMock.notification.create.mock.calls[0][0].data as any;
    expect(row.userId).toBe(AUTHOR);
    expect(row.title).toBe("You received a gift");
    expect(JSON.parse(row.data)).toMatchObject({ postId: "p1", type: "POST_GIFT", giftId: "gift_1", amount: 50 });
  });

  it("rolls everything back and 409s when the wallet is too empty", async () => {
    prismaMock.wallet.upsert
      .mockResolvedValueOnce(walletRow("wal_s", ME, 10))
      .mockResolvedValueOnce(walletRow("wal_r", AUTHOR, 0));
    prismaMock.wallet.updateMany.mockResolvedValue({ count: 0 }); // guard fails

    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50 } }), res as never);

    expect(out.statusCode).toBe(409);
    expect(out.payload.error).toBe("INSUFFICIENT_BALANCE");
    // Nothing may have been credited or recorded.
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.gift.create).not.toHaveBeenCalled();
  });

  it("accounts for held balance before allowing the debit", async () => {
    prismaMock.wallet.upsert.mockResolvedValueOnce(walletRow("wal_s", ME, 100, 90)); // held 90 → only 10 spendable
    prismaMock.wallet.upsert.mockResolvedValueOnce(walletRow("wal_r", AUTHOR, 0));
    prismaMock.wallet.updateMany.mockResolvedValue({ count: 0 });

    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 20 } }), res as never);
    expect(out.statusCode).toBe(409);
    // Guard demanded balance >= 110 (20 + 90 held), not just >= 20.
    const debitCall = prismaMock.wallet.updateMany.mock.calls[0];
    expect(String(debitCall[0].where.balance.gte)).toBe("110");
  });

  it("rejects out-of-range and sub-paisa amounts", async () => {
    for (const bad of [1, 999, 10.333]) {
      const { res, out } = makeRes();
      await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: bad } }), res as never);
      expect(out.statusCode).toBe(400);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    }
  });

  it("forbids gifting your own post", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: ME }));
    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50 } }), res as never);
    expect(out.statusCode).toBe(400);
    expect(out.payload.error).toBe("INVALID_ACTION");
  });

  it("reuses an existing gift for the same sender+reference instead of charging twice", async () => {
    prismaMock.gift.findUnique.mockResolvedValue({ id: "gift_1", postId: "p1", senderId: ME, recipientId: AUTHOR, amount: new Prisma.Decimal(50), referenceId: "same-ref" });
    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50, referenceId: "same-ref" } }), res as never);
    expect(out.statusCode).toBe(200);
    expect(out.payload.data.reused).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a reference already used by someone else", async () => {
    prismaMock.gift.findUnique.mockResolvedValue({ id: "gift_1", postId: "p1", senderId: OTHER, recipientId: AUTHOR, amount: new Prisma.Decimal(50), referenceId: "taken-ref" });
    const { res, out } = makeRes();
    await ctrl.sendGift(makeReq({ params: { id: "p1" }, body: { amount: 50, referenceId: "taken-ref" } }), res as never);
    expect(out.statusCode).toBe(409);
    expect(out.payload.error).toBe("REFERENCE_IN_USE");
  });
});

describe("listGifts", () => {
  it("is author-only and sums the amounts", async () => {
    prismaMock.post.findUnique.mockResolvedValue(postRow({ authorId: AUTHOR }));
    prismaMock.gift.findMany.mockResolvedValue([{ id: "g1", senderId: ME, amount: new Prisma.Decimal(50), sender: { id: ME, fullName: "Me", avatarUrl: null } }]);
    prismaMock.gift.count.mockResolvedValue(1);
    prismaMock.gift.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(50) } });

    const { res: r1, out: o1 } = makeRes();
    await ctrl.listGifts(makeReq({ params: { id: "p1" } }), r1 as never);
    expect(o1.statusCode).toBe(403);

    prismaMock.post.findUnique.mockResolvedValue(postRow({ id: "p1", authorId: ME }));
    const { res: r2, out: o2 } = makeRes();
    await ctrl.listGifts(makeReq({ params: { id: "p1" } }), r2 as never);
    expect(o2.statusCode).toBe(200);
    expect(o2.payload.data.totalAmount).toBe(50);
  });
});
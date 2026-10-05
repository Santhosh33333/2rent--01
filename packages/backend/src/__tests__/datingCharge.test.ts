/**
 * Dating request charge.
 *
 * Kept in its own file rather than appended to datingService.test.ts because it
 * mocks a different slice of prisma (wallet, transaction, the interactive
 * $transaction) and stubs pricing config. Sharing one mock across both meant
 * every discovery test inherited wallet plumbing it never used.
 *
 * What is worth protecting here is the set of failures that produce no visible
 * error: a charge that does not happen, a charge that happens twice for one
 * request, a wallet driven negative, and a request recorded without being paid.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    // findUnique serves two callers: like.findUnique decides whether a request
    // is new, and user.findUnique reads the sender's name for the notification
    // the recipient gets. Neither can be absent - a missing one is a TypeError
    // inside the transaction, which aborts the charge instead of just skipping
    // a notification.
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    like: { findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    pass: { upsert: vi.fn(), deleteMany: vi.fn() },
    userBlock: { findFirst: vi.fn() },
    match: { upsert: vi.fn() },
    wallet: { upsert: vi.fn(), update: vi.fn() },
    transaction: { create: vi.fn() },
    // The recipient's in-app notification row. recordSwipe announces a new
    // request after the transaction commits, and createNotification swallows its
    // own errors - so without this the money tests would still pass while every
    // notification silently failed, which is exactly the kind of gap that is
    // invisible until a user complains nobody told them.
    notification: { create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (t: unknown) => Promise<unknown>)(prismaMock);
      return Promise.all(arg as Promise<unknown>[]);
    }),
  },
}));

const { configMock } = vi.hoisted(() => ({ configMock: { datingRequestCharge: 0.5 as number } }));

// getConfig reaches for redis and then PricingConfig; stubbed via a variable so a
// test can price a request at something other than the default.
vi.mock("../services/pricingEngine", () => ({
  getConfig: vi.fn(async (_key: string, dflt: number) => configMock.datingRequestCharge ?? dflt),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import {
  recordSwipe,
  InsufficientDatingBalanceError,
  getDatingRequestCharge,
  DATING_REQUEST_TRANSACTION_TYPE,
} from "../services/datingService";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findFirst.mockResolvedValue({ id: B });
  prismaMock.userBlock.findFirst.mockResolvedValue(null);
  prismaMock.like.findUnique.mockResolvedValue(null);
  prismaMock.like.findFirst.mockResolvedValue(null);
  prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "100" } });
  prismaMock.wallet.update.mockResolvedValue({});
  prismaMock.transaction.create.mockResolvedValue({});
  prismaMock.user.findUnique.mockResolvedValue({ fullName: "Asha" });
  prismaMock.notification.create.mockResolvedValue({});
  configMock.datingRequestCharge = 0.5;
});

const ledgerRows = () =>
  prismaMock.transaction.create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

describe("getDatingRequestCharge", () => {
  it("defaults to 0.50 when no admin override exists", async () => {
    configMock.datingRequestCharge = 0.5;
    expect(await getDatingRequestCharge()).toBe(0.5);
  });

  it("rounds a configured rate to two decimals", async () => {
    configMock.datingRequestCharge = 0.507;
    expect(await getDatingRequestCharge()).toBe(0.51);
  });

  it("falls back to the default when config is negative or not a number", async () => {
    configMock.datingRequestCharge = -5;
    expect(await getDatingRequestCharge()).toBe(0.5);
    configMock.datingRequestCharge = Number.NaN;
    expect(await getDatingRequestCharge()).toBe(0.5);
  });
});

describe("charging a dating request", () => {
  it("debits the default 0.50 and writes a ledger row", async () => {
    await recordSwipe(A, B, "LIKE");

    expect(prismaMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { decrement: 0.5 } } }),
    );
    const rows = ledgerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe(DATING_REQUEST_TRANSACTION_TYPE);
    expect(Number(rows[0].amount)).toBe(0.5);
    expect(rows[0].status).toBe("COMPLETED");
    expect(rows[0].userId).toBe(A);
  });

  it("charges whoever sent it, not the recipient", async () => {
    await recordSwipe(B, A, "LIKE");
    expect(ledgerRows()[0].userId).toBe(B);
  });

  it("is symmetric: the same amount is charged regardless of who sends", async () => {
    await recordSwipe(A, B, "LIKE");
    const first = Number(ledgerRows()[0].amount);

    prismaMock.transaction.create.mockClear();
    await recordSwipe(B, C, "LIKE");
    expect(Number(ledgerRows()[0].amount)).toBe(first);
  });

  it("honours an admin-configured rate instead of the default", async () => {
    configMock.datingRequestCharge = 3;
    await recordSwipe(A, B, "LIKE");
    expect(prismaMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { decrement: 3 } } }),
    );
  });

  it("treats a configured zero as genuinely free, not as missing config", async () => {
    configMock.datingRequestCharge = 0;
    await recordSwipe(A, B, "LIKE");
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
    // The request itself must still go through.
    expect(prismaMock.like.upsert).toHaveBeenCalled();
  });

  it("charges for a SUPER_LIKE too", async () => {
    await recordSwipe(A, B, "SUPER_LIKE");
    expect(ledgerRows()).toHaveLength(1);
  });

  it("never charges for a PASS", async () => {
    await recordSwipe(A, B, "PASS");
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("charges a second request to a different person", async () => {
    await recordSwipe(A, B, "LIKE");
    await recordSwipe(A, C, "LIKE");
    expect(ledgerRows()).toHaveLength(2);
  });

  it("charges exactly once when the request completes a match", async () => {
    // Reciprocal like present: the match branch runs and must not debit again.
    prismaMock.like.findFirst.mockResolvedValue({ id: "reciprocal" });
    prismaMock.match.upsert.mockResolvedValue({ id: "m1", matchedAt: new Date("2026-01-01") });

    const res = await recordSwipe(A, B, "LIKE");

    expect(res.match).toEqual({ id: "m1", matchedAt: new Date("2026-01-01") });
    expect(ledgerRows()).toHaveLength(1);
  });
});

describe("not double-charging", () => {
  it("does not charge again for re-swiping the same profile", async () => {
    prismaMock.like.findUnique.mockResolvedValue({ id: "existing" });
    await recordSwipe(A, B, "LIKE");
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("still upgrades LIKE to SUPER_LIKE without charging", async () => {
    prismaMock.like.findUnique.mockResolvedValue({ id: "existing" });
    await recordSwipe(A, B, "SUPER_LIKE");
    expect(prismaMock.like.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { type: "SUPER_LIKE" } }),
    );
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("debits and records inside one transaction", async () => {
    await recordSwipe(A, B, "LIKE");
    // Two separate writes would let a user be charged for a request that was
    // never saved, or get a free request if the debit failed.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0][0]).toBeTypeOf("function");
  });
});

describe("insufficient balance", () => {
  it("blocks the request when the wallet cannot cover it", async () => {
    prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "0.2" } });

    await expect(recordSwipe(A, B, "LIKE")).rejects.toBeInstanceOf(InsufficientDatingBalanceError);
    // Nothing may be written when the money is not there: no request recorded,
    // no negative balance, no phantom ledger row.
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.like.upsert).not.toHaveBeenCalled();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("allows the request when the balance is exactly the charge", async () => {
    // Off-by-one guard: the guard is `available < charge`, so equality must pass.
    prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "0.5" } });
    await recordSwipe(A, B, "LIKE");
    expect(prismaMock.like.upsert).toHaveBeenCalled();
  });

  it("reports the shortfall so the client can ask for a top-up", async () => {
    prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "0" } });
    const err = await recordSwipe(A, B, "LIKE").catch((e) => e);

    expect(err.code).toBe("INSUFFICIENT_BALANCE");
    expect(err.required).toBe(0.5);
    expect(err.available).toBe(0);
    expect(err.message).toMatch(/top up/i);
  });

  it("gives the same clear error when the sender has no wallet row yet", async () => {
    // The wallet is upserted on demand, so a user who has never topped up gets
    // insufficient balance rather than a crash.
    prismaMock.wallet.upsert.mockResolvedValue({ id: "new", balance: { toString: () => "0" } });
    await expect(recordSwipe(A, B, "LIKE")).rejects.toThrow(/top up/i);
  });

  it("never lets a Decimal wallet balance read as zero by accident", async () => {
    // Wallet.balance is Prisma Decimal, not number. Reading it without
    // Number()/toString() yields NaN, and NaN < charge is false - so the guard
    // would pass and the request would go out free.
    prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "0" } });
    await expect(recordSwipe(A, B, "LIKE")).rejects.toThrow(/top up/i);
  });
});

describe("notifying the recipient", () => {
  const notes = () =>
    prismaMock.notification.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );

  it("tells the recipient when a request is sent", async () => {
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      ({ fullName: where.id === A ? "Asha" : "Bilal" }),
    );
    await recordSwipe(A, B, "LIKE");

    expect(notes()).toHaveLength(1);
    // The recipient is B, not the sender: telling A would be a user notifying
    // themselves about their own action.
    expect(notes()[0].userId).toBe(B);
    expect(notes()[0].title).toMatch(/like/i);
    expect(notes()[0].body).toContain("Asha");
    expect(notes()[0].isRead).toBe(false);
  });

  it("says super like when that is what was sent", async () => {
    await recordSwipe(A, B, "SUPER_LIKE");
    expect(notes()[0].title).toMatch(/super/i);
  });

  it("stays silent on a repeat swipe of the same profile", async () => {
    // The unique (from, to) index makes this a no-op upsert. Announcing it would
    // let a user tap the same profile repeatedly and flood someone's inbox.
    prismaMock.like.findUnique.mockResolvedValue({ id: "like_1" });
    await recordSwipe(A, B, "LIKE");
    expect(notes()).toHaveLength(0);
  });

  it("stays silent on a pass", async () => {
    await recordSwipe(A, B, "PASS");
    expect(notes()).toHaveLength(0);
  });

  it("tells both people when a request becomes a match", async () => {
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      ({ fullName: where.id === A ? "Asha" : "Bilal" }),
    );
    prismaMock.like.findFirst.mockResolvedValue({ id: "reciprocal" });
    prismaMock.match.upsert.mockResolvedValue({ id: "m1", matchedAt: new Date("2026-10-04") });

    const result = await recordSwipe(A, B, "LIKE");
    expect(result.match?.id).toBe("m1");

    // Both, not just the recipient - the person who swiped right has no other way
    // to learn it worked.
    expect(notes().map((n) => n.userId).sort()).toEqual([A, B].sort());
  });

  it("sends the match notice instead of a separate like notice", async () => {
    // Two notifications for one event reads as spam, and the "someone likes you"
    // message is already stale by the time it arrives alongside the match.
    prismaMock.like.findFirst.mockResolvedValue({ id: "reciprocal" });
    prismaMock.match.upsert.mockResolvedValue({ id: "m1", matchedAt: new Date("2026-10-04") });
    await recordSwipe(A, B, "LIKE");

    expect(notes()).toHaveLength(2);
    for (const n of notes()) {
      expect(n.title).toMatch(/match/i);
      expect(n.title).not.toMatch(/likes you/i);
    }
  });

  it("announces nothing at all when the charge is refused", async () => {
    prismaMock.wallet.upsert.mockResolvedValue({ id: "w1", balance: { toString: () => "0" } });
    await expect(recordSwipe(A, B, "LIKE")).rejects.toThrow(/top up/i);
    // The transaction rolled back, so there is no request to announce. A "someone
    // likes you" here would be a lie: no like row exists.
    expect(notes()).toHaveLength(0);
  });

  it("still completes the request when the notification write fails", async () => {
    // announce() is fire-and-forget by design. The money is already taken by the
    // time it runs, so a broken notification row must not turn a paid, saved
    // request into a failed call - createNotification already swallows its own
    // errors, and this pins that the caller does not start throwing as well.
    prismaMock.notification.create.mockRejectedValue(new Error("notification table down"));
    await expect(recordSwipe(A, B, "LIKE")).resolves.toMatchObject({ swipe: "LIKE" });
    expect(prismaMock.transaction.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.like.upsert).toHaveBeenCalledTimes(1);
  });

  it("does not roll back the charge when the sender has no name on record", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(recordSwipe(A, B, "LIKE")).resolves.toMatchObject({ swipe: "LIKE" });
    // Falls back to "Someone" rather than throwing on a null name.
    expect(notes()[0].body).toContain("Someone");
  });
});
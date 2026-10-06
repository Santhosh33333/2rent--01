import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Subscription collection: wallet first, manual UPI second.
 *
 * The behaviour these tests pin is the one that decides whether money moves
 * correctly, so each case asserts the wallet balance and the ledger rather than
 * just the returned source:
 *
 * - A covered balance is debited exactly once and the plan activates.
 * - A short balance debits NOTHING and opens a payment request instead. A partial
 *   debit would leave the user charged for a period they never received.
 * - heldBalance is respected, because funds held for a metered call are not
 *   spendable and a subscription must not consume them.
 * - Settling the same payment twice cannot double-activate or double-send.
 */

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET = "test_refresh_secret_32chars_minimum!";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
  process.env.ADMIN_EMAIL = "test@test.com";
  process.env.ADMIN_PASSWORD = "TestPass123!";
});

const sent = vi.hoisted(() => ({
  // Each entry is the (email, name, data) argument list the service passed to the
  // mocked sender, so a test can assert on the payload and not just the count.
  confirm: [] as any[][],
  required: [] as any[][],
}));

const db = vi.hoisted(() => ({
  wallet: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  transaction: { create: vi.fn() },
  subscription: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  subscriptionPayment: { upsert: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  topupRequest: { findFirst: vi.fn() },
  upiPayment: { findFirst: vi.fn() },
  notification: { create: vi.fn() },
}));

vi.mock("../config/database", () => ({ prisma: db }));
vi.mock("../services/emailService", () => ({
  sendSubscriptionEmail: vi.fn(async (...args: unknown[]) => {
    sent.confirm.push(args);
    return { sent: true };
  }),
  sendSubscriptionPaymentRequiredEmail: vi.fn(async (...args: unknown[]) => {
    sent.required.push(args);
    return { sent: true };
  }),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

import {
  SUBSCRIPTION_TRANSACTION_TYPE,
  collectForPeriod,
  debitWalletForPlan,
  periodFrom,
  settleSubscriptionPayment,
  sweepDueSubscriptions,
} from "../services/subscriptionBillingService";

const USER = "user-1";
const SUB = "sub-1";
const PLAN = "plan-1";

beforeEach(() => {
  vi.clearAllMocks();
  sent.confirm = [];
  sent.required = [];
  db.user.findUnique.mockResolvedValue({ email: "u@example.com", fullName: "Uma" });
  db.transaction.create.mockResolvedValue({ id: "tx-1" });
  db.subscription.updateMany.mockResolvedValue({ count: 1 });
  db.subscriptionPayment.upsert.mockResolvedValue({ id: "pay-1", status: "VERIFICATION_PENDING" });
  db.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 });
});

describe("periodFrom", () => {
  it("buys whole days and never a zero-length period", () => {
    const start = new Date("2026-10-06T00:00:00.000Z");
    const { end } = periodFrom(30, start);
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("falls back to a month rather than granting nothing", () => {
    const start = new Date("2026-10-06T00:00:00.000Z");
    const { end } = periodFrom(0, start);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

describe("debitWalletForPlan", () => {
  it("debits and writes a positive-amount ledger row with a debit-implying type", async () => {
    db.wallet.findUnique
      .mockResolvedValueOnce({ id: "w-1", balance: 500, heldBalance: 0 })
      .mockResolvedValueOnce({ balance: 400 });
    db.wallet.updateMany.mockResolvedValue({ count: 1 });

    const out = await debitWalletForPlan(USER, 100, "Pro plan", "SUB-abcd1234");

    expect(out.charged).toBe(true);
    expect(out.balance).toBe(400);
    const ledger = db.transaction.create.mock.calls[0][0].data;
    expect(ledger.type).toBe(SUBSCRIPTION_TRANSACTION_TYPE);
    // Positive: the ledger's convention is that type decides direction, and
    // anything other than CREDIT renders as a debit in the wallet.
    expect(Number(ledger.amount)).toBe(100);
  });

  it("leaves the balance alone when it is short", async () => {
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 50, heldBalance: 0 });
    db.wallet.updateMany.mockResolvedValue({ count: 0 });

    const out = await debitWalletForPlan(USER, 100, "Pro plan", "SUB-abcd1234");

    expect(out.charged).toBe(false);
    // The conditional UPDATE is still attempted - that IS the balance check, done
    // atomically. What matters is that it wrote no ledger row, so the user's
    // balance and their statement stay in agreement.
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("will not spend money held for a metered call", async () => {
    // balance 500 with 450 held leaves 50 spendable, so a 100 plan must fail
    // even though the raw balance looks sufficient.
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 500, heldBalance: 450 });
    db.wallet.updateMany.mockResolvedValue({ count: 0 });

    const out = await debitWalletForPlan(USER, 100, "Pro plan", "SUB-abcd1234");

    expect(out.charged).toBe(false);
    const where = db.wallet.updateMany.mock.calls[0]?.[0].where;
    expect(Number(where.balance.gte)).toBe(550);
  });

  it("treats a user with no wallet as uncollectable rather than erroring", async () => {
    db.wallet.findUnique.mockResolvedValue(null);
    const out = await debitWalletForPlan(USER, 100, "Pro plan", "SUB-abcd1234");
    expect(out.charged).toBe(false);
  });
});

describe("collectForPeriod", () => {
  it("activates immediately when the wallet covers the price", async () => {
    db.wallet.findUnique
      .mockResolvedValueOnce({ id: "w-1", balance: 500, heldBalance: 0 })
      .mockResolvedValueOnce({ balance: 400 });
    db.wallet.updateMany.mockResolvedValue({ count: 1 });

    const out = await collectForPeriod({
      userId: USER,
      subscriptionId: SUB,
      planId: PLAN,
      amount: 100,
      planDays: 30,
      planName: "Pro",
      kind: "activated",
    });

    expect(out.source).toBe("WALLET");
    expect(out.walletBalance).toBe(400);
    expect(db.subscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: SUB }),
        data: expect.objectContaining({ status: "ACTIVE", autoRenew: true }),
      }),
    );
    // The confirmation is the only receipt there is - there is no gateway.
    expect(sent.confirm).toHaveLength(1);
    expect(sent.confirm[0][0]).toBe("u@example.com");
  });

  it("opens a payment request and debits nothing when the wallet is short", async () => {
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 20, heldBalance: 0 });
    db.wallet.updateMany.mockResolvedValue({ count: 0 });

    const out = await collectForPeriod({
      userId: USER,
      subscriptionId: SUB,
      planId: PLAN,
      amount: 100,
      planDays: 30,
      planName: "Pro",
      kind: "activated",
    });

    expect(out.source).toBe("UPI");
    expect(out.paymentId).toBe("pay-1");
    // The whole point of the fallback: no money taken, and no activation either.
    expect(db.transaction.create).not.toHaveBeenCalled();
    const activated = db.subscription.updateMany.mock.calls.some(
      (c) => c[0].data?.status === "ACTIVE",
    );
    expect(activated).toBe(false);
    // Not confirmed, because it has not been paid for yet.
    expect(sent.confirm).toHaveLength(0);
  });

  it("reuses the one collection request for a subscription rather than stacking them", async () => {
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 0, heldBalance: 0 });
    const args = {
      userId: USER,
      subscriptionId: SUB,
      planId: PLAN,
      amount: 100,
      planDays: 30,
      planName: "Pro",
      kind: "activated" as const,
    };
    await collectForPeriod(args);
    await collectForPeriod(args);

    expect(db.subscriptionPayment.upsert).toHaveBeenCalledTimes(2);
    // Both calls target the same unique key, so there can only ever be one row:
    // an admin cannot be asked to verify two requests for one period.
    for (const call of db.subscriptionPayment.upsert.mock.calls) {
      expect(call[0].where.subscriptionId).toBe(SUB);
    }
  });

  it("anchors a renewal period to the billing date rather than to now", async () => {
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 500, heldBalance: 0 });
    db.wallet.updateMany.mockResolvedValue({ count: 1 });

    const periodStart = new Date("2026-09-06T00:00:00.000Z");
    const out = await collectForPeriod({
      userId: USER,
      subscriptionId: SUB,
      planId: PLAN,
      amount: 100,
      planDays: 30,
      planName: "Pro",
      kind: "renewed",
      periodStart,
    });

    expect(out.periodStart.toISOString()).toBe(periodStart.toISOString());
  });
});

describe("settleSubscriptionPayment", () => {
  it("activates the period and confirms by email", async () => {
    db.subscriptionPayment.findUnique.mockResolvedValue({
      id: "pay-1",
      subscriptionId: SUB,
      userId: USER,
      amount: 100,
      referenceNumber: "UTR123",
      periodStart: new Date("2026-10-06T00:00:00.000Z"),
      periodEnd: new Date("2026-11-05T00:00:00.000Z"),
      subscription: { startedAt: null, plan: { name: "Pro" } },
    });
    db.subscriptionPayment.updateMany.mockResolvedValue({ count: 1 });

    const out = await settleSubscriptionPayment({ paymentId: "pay-1", adminUserId: "admin-1" });

    expect(out).toEqual({ status: "VERIFIED", alreadySettled: false });
    expect(sent.confirm).toHaveLength(1);
    expect(sent.confirm[0][2]).toMatchObject({ method: "upi", referenceNumber: "UTR123" });
  });

  it("reports a second verification as already settled instead of re-activating", async () => {
    db.subscriptionPayment.findUnique.mockResolvedValue({
      id: "pay-1",
      subscriptionId: SUB,
      userId: USER,
      amount: 100,
      referenceNumber: null,
      periodStart: new Date(),
      periodEnd: new Date(),
      status: "VERIFIED",
      subscription: { startedAt: new Date(), plan: { name: "Pro" } },
    });
    // The guarded update matches nothing: someone got there first.
    db.subscriptionPayment.updateMany.mockResolvedValue({ count: 0 });

    const out = await settleSubscriptionPayment({ paymentId: "pay-1", adminUserId: "admin-2" });

    expect(out.alreadySettled).toBe(true);
    expect(sent.confirm).toHaveLength(0);
  });

  it("throws rather than activating a payment row that does not exist", async () => {
    db.subscriptionPayment.findUnique.mockResolvedValue(null);
    await expect(
      settleSubscriptionPayment({ paymentId: "nope", adminUserId: "admin-1" }),
    ).rejects.toThrow("SUBSCRIPTION_PAYMENT_NOT_FOUND");
  });
});

describe("sweepDueSubscriptions", () => {
  it("skips plans with auto-renew off, so opting out is never charged", async () => {
    db.subscription.findMany.mockResolvedValue([]);
    const result = await sweepDueSubscriptions();
    expect(result.scanned).toBe(0);
    // The query itself is the guarantee: only autoRenew rows are candidates.
    const where = db.subscription.findMany.mock.calls[0][0].where;
    expect(where.autoRenew).toBe(true);
  });

  it("does not raise a second request while one is awaiting verification", async () => {
    db.subscription.findMany.mockResolvedValue([
      {
        id: SUB,
        userId: USER,
        planId: PLAN,
        plan: { name: "Pro", price: 100, durationDays: 30 },
        nextBillingAt: new Date("2026-10-01T00:00:00.000Z"),
        payment: { status: "VERIFICATION_PENDING" },
      },
    ]);

    const result = await sweepDueSubscriptions(new Date("2026-10-06T00:00:00.000Z"));

    expect(result.awaitingPayment).toBe(1);
    expect(result.renewed).toBe(0);
    expect(result.pastDue).toBe(0);
    expect(db.subscriptionPayment.upsert).not.toHaveBeenCalled();
  });

  it("renews from the wallet when the balance covers it", async () => {
    db.subscription.findMany.mockResolvedValue([
      {
        id: SUB,
        userId: USER,
        planId: PLAN,
        plan: { name: "Pro", price: 100, durationDays: 30 },
        nextBillingAt: new Date("2026-10-01T00:00:00.000Z"),
        payment: null,
      },
    ]);
    db.wallet.findUnique
      .mockResolvedValueOnce({ id: "w-1", balance: 500, heldBalance: 0 })
      .mockResolvedValueOnce({ balance: 400 });
    db.wallet.updateMany.mockResolvedValue({ count: 1 });

    const result = await sweepDueSubscriptions(new Date("2026-10-06T00:00:00.000Z"));

    expect(result.renewed).toBe(1);
    expect(sent.confirm).toHaveLength(1);
    expect(sent.confirm[0][2]).toMatchObject({ kind: "renewed" });
  });

  it("holds a plan past due and asks for payment when the wallet is short", async () => {
    db.subscription.findMany.mockResolvedValue([
      {
        id: SUB,
        userId: USER,
        planId: PLAN,
        plan: { name: "Pro", price: 100, durationDays: 30 },
        nextBillingAt: new Date("2026-10-01T00:00:00.000Z"),
        payment: null,
      },
    ]);
    db.wallet.findUnique.mockResolvedValue({ id: "w-1", balance: 10, heldBalance: 0 });
    db.wallet.updateMany.mockResolvedValue({ count: 0 });

    const result = await sweepDueSubscriptions(new Date("2026-10-06T00:00:00.000Z"));

    expect(result.pastDue).toBe(1);
    expect(result.renewed).toBe(0);
    // Held, not cancelled: a short balance is not a request to leave.
    const held = db.subscription.updateMany.mock.calls.some(
      (c) => c[0].data?.status === "PAST_DUE",
    );
    expect(held).toBe(true);
    const cancelled = db.subscription.updateMany.mock.calls.some(
      (c) => c[0].data?.status === "CANCELLED",
    );
    expect(cancelled).toBe(false);
    expect(sent.required).toHaveLength(1);
  });

  it("keeps going when one subscription fails", async () => {
    const due = [
      {
        id: "bad",
        userId: USER,
        planId: PLAN,
        plan: { name: "Pro", price: 100, durationDays: 30 },
        nextBillingAt: new Date("2026-10-01T00:00:00.000Z"),
        payment: null,
      },
      {
        id: "good",
        userId: USER,
        planId: PLAN,
        plan: { name: "Pro", price: 100, durationDays: 30 },
        nextBillingAt: new Date("2026-10-01T00:00:00.000Z"),
        payment: null,
      },
    ];
    db.subscription.findMany.mockResolvedValue(due);
    db.wallet.findUnique
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ id: "w-1", balance: 500, heldBalance: 0 })
      .mockResolvedValueOnce({ balance: 400 });
    db.wallet.updateMany.mockResolvedValue({ count: 1 });

    const result = await sweepDueSubscriptions(new Date("2026-10-06T00:00:00.000Z"));

    expect(result.failed).toBe(1);
    expect(result.renewed).toBe(1);
  });
});
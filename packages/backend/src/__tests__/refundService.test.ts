import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    wallet: { findUnique: vi.fn(), update: vi.fn() },
    paymentOrder: { findFirst: vi.fn(), update: vi.fn() },
    refundLog: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    transaction: { create: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import {
  applyRefund,
  grantAccessWindow,
  hasAccess,
  revokeAccessWindow,
} from "../services/refundService";

const NOW = new Date("2026-10-11T00:00:00Z");

const ORDER = {
  id: "po_1",
  userId: "u_1",
  walletId: "w_1",
  amount: 100,
  cashfreePaymentId: "pay_1",
  cashfreeOrderId: "ord_1",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prismaMock.refundLog.findFirst.mockResolvedValue(null);
  prismaMock.refundLog.create.mockResolvedValue({ id: "rl_1" });
  prismaMock.paymentOrder.findFirst.mockResolvedValue(ORDER);
  prismaMock.wallet.findUnique.mockResolvedValue({ id: "w_1", balance: 500 });
  prismaMock.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(prismaMock));
});

describe("applyRefund", () => {
  it("refuses without a refund id because it cannot be idempotent", async () => {
    const r = await applyRefund({ gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(false);
    expect(prismaMock.refundLog.create).not.toHaveBeenCalled();
  });

  it("refuses when the order is not found", async () => {
    prismaMock.paymentOrder.findFirst.mockResolvedValue(null);
    const r = await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(false);
  });

  it("does not double-apply a redelivered refund", async () => {
    prismaMock.refundLog.findFirst.mockResolvedValue({
      id: "rl_1",
      status: "COMPLETED",
      cashfreeRefundId: "rf_1",
    });
    const r = await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(false);
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
  });

  it("debits the wallet, records the log and revokes access on a full refund", async () => {
    const r = await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(true);
    expect(prismaMock.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { balance: { decrement: 100 } } }),
    );
    expect(prismaMock.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "DEBIT", amount: 100 }),
      }),
    );
    expect(prismaMock.paymentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "REFUNDED" }) }),
    );
  });

  it("revokes premium access so a refunded user keeps nothing", async () => {
    await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    const userUpdate = prismaMock.user.update.mock.calls.find(
      (c) => (c[0] as { data?: { accessUntil?: Date } }).data?.accessUntil !== undefined,
    );
    expect(userUpdate).toBeDefined();
    const until = (userUpdate![0] as { data: { accessUntil: Date } }).data.accessUntil;
    expect(until.getTime()).toBe(0);
  });

  it("refuses when the payload amount disagrees with the stored order", async () => {
    const r = await applyRefund({
      gatewayRefundId: "rf_1",
      gatewayPaymentId: "pay_1",
      payloadAmount: 5,
    });
    expect(r.applied).toBe(false);
    expect(r.applied === false && r.reason).toMatch(/mismatch/i);
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses to drive the wallet negative and records why", async () => {
    prismaMock.wallet.findUnique.mockResolvedValue({ id: "w_1", balance: 10 });
    const r = await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(false);
    expect(r.applied === false && r.reason).toMatch(/insufficient/i);
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
  });

  it("treats a P2002 race as already-applied rather than double-debiting", async () => {
    prismaMock.refundLog.create.mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const r = await applyRefund({ gatewayRefundId: "rf_1", gatewayPaymentId: "pay_1" });
    expect(r.applied).toBe(false);
    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
  });
});

describe("access window", () => {
  it("grants 30 days from now when there is no existing window", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ accessUntil: null });
    const until = await grantAccessWindow("u_1");
    expect(until!.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("extends from the current expiry so paying early does not waste days", async () => {
    const existing = new Date("2026-12-01T00:00:00Z");
    prismaMock.user.findUnique.mockResolvedValue({ accessUntil: existing });
    const until = await grantAccessWindow("u_1");
    expect(until!.toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });

  it("restarts from now when the window already lapsed", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      accessUntil: new Date("2026-01-01T00:00:00Z"),
    });
    const until = await grantAccessWindow("u_1");
    expect(until!.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("honours a non-default day count", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ accessUntil: null });
    const until = await grantAccessWindow("u_1", 7);
    expect(until!.toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("reports access as false once the window has passed", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      accessUntil: new Date("2026-09-01T00:00:00Z"),
    });
    await expect(hasAccess("u_1")).resolves.toBe(false);
  });

  it("reports access as true while the window is open", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      accessUntil: new Date("2026-11-01T00:00:00Z"),
    });
    await expect(hasAccess("u_1")).resolves.toBe(true);
  });

  it("treats a revoked window (epoch) as no access", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ accessUntil: new Date(0) });
    await expect(hasAccess("u_1")).resolves.toBe(false);
  });

  it("revokes access immediately", async () => {
    await revokeAccessWindow("u_1");
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accessSource: "REVOKED_REFUND" }),
      }),
    );
  });
});
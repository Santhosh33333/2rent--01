import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Settling a manual-UPI top-up.
 *
 * This is the only place a wallet is credited from a bank reference, and it has
 * no existing coverage - which is how a real bug survived: the access grant lived
 * in the Cashfree settlement path, so with the gateway retired a customer could
 * pay by UPI, be credited, and still be refused by requirePaidAccess forever.
 * Money taken, nothing received, and no error anywhere.
 */
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
});

const { db } = vi.hoisted(() => ({
  db: {
    topupRequest: { updateMany: vi.fn() },
    wallet: { upsert: vi.fn() },
    transaction: { create: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/config/database", () => ({ prisma: db }));
vi.mock("../../src/config/redis", () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => undefined),
  cacheDel: vi.fn(async () => undefined),
}));

import { settleTopupRequest, AlreadySettledError } from "../services/topupSettlement";
import { ACCESS_DAYS } from "../services/refundService";

const DAY = 24 * 60 * 60 * 1000;
const USER_ID = "u_1";
const TOPUP = { id: "topup_1", userId: USER_ID, amount: 500, referenceNumber: "130500139151" };

/**
 * Runs the callback moneyTransaction hands to $transaction against a single fake
 * tx, so the assertions can see the statements the real transaction would issue.
 */
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      topupRequest: db.topupRequest,
      wallet: db.wallet,
      transaction: db.transaction,
      user: db.user,
      auditLog: db.auditLog,
    }),
  );
  db.topupRequest.updateMany.mockResolvedValue({ count: 1 });
  db.wallet.upsert.mockResolvedValue({ id: "wallet_1", userId: USER_ID, balance: 500 });
  db.user.findUnique.mockResolvedValue({ accessUntil: null });
  db.user.update.mockResolvedValue({});
});

describe("settleTopupRequest: the claim", () => {
  it("credits only the request it actually won", async () => {
    // The conditional update is what makes a double-clicked "apply", or
    // reconciliation racing an admin with the row open, harmless.
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    expect(db.topupRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TOPUP.id, status: "VERIFICATION_PENDING" },
      }),
    );
  });

  it("moves no money when another caller already settled it", async () => {
    db.topupRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(settleTopupRequest(TOPUP, "admin1", "MANUAL")).rejects.toThrow(AlreadySettledError);
    expect(db.wallet.upsert).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("refuses a non-positive amount", async () => {
    await expect(settleTopupRequest({ ...TOPUP, amount: 0 }, "admin1", "MANUAL")).rejects.toThrow(
      /non-positive/,
    );
    expect(db.wallet.upsert).not.toHaveBeenCalled();
  });
});

describe("settleTopupRequest: access is granted", () => {
  it("extends access, which is what the customer paid for", async () => {
    // The regression. Without this the wallet is credited and access is not.
    const result = await settleTopupRequest(TOPUP, "admin1", "MANUAL");

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        accessUntil: expect.any(Date),
        accessSource: "TOPUP",
      },
    });
    const until = db.user.update.mock.calls[0][0].data.accessUntil as Date;
    const days = (until.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(ACCESS_DAYS - 0.1);
    expect(days).toBeLessThan(ACCESS_DAYS + 0.1);
    expect(result).toBeUndefined();
  });

  it("grants the same access when the credit came from a bank statement", async () => {
    // The reconciliation caller must not be a second, weaker implementation.
    await settleTopupRequest(TOPUP, "admin1", "RECONCILED");
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accessSource: "TOPUP" }) }),
    );
  });

  it("adds days to a live window rather than restarting it", async () => {
    // Paying early must not cost days already paid for.
    const existing = new Date(Date.now() + 10 * DAY);
    db.user.findUnique.mockResolvedValue({ accessUntil: existing });

    await settleTopupRequest(TOPUP, "admin1", "MANUAL");

    const until = db.user.update.mock.calls[0][0].data.accessUntil as Date;
    expect(until.getTime()).toBeGreaterThan(existing.getTime() + (ACCESS_DAYS - 0.1) * DAY);
  });

  it("starts from now when the window has already lapsed", async () => {
    db.user.findUnique.mockResolvedValue({ accessUntil: new Date(Date.now() - 5 * DAY) });
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    const until = db.user.update.mock.calls[0][0].data.accessUntil as Date;
    const days = (until.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(ACCESS_DAYS - 0.1);
    expect(days).toBeLessThan(ACCESS_DAYS + 0.1);
  });

  it("reads the user through the transaction, not the shared client", async () => {
    // grantAccessWindow uses the shared prisma client. Calling it inside this
    // transaction would read a stale accessUntil through a second connection and
    // overwrite it on commit, quietly discarding paid days.
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    expect(db.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: USER_ID } }),
    );
  });

  it("records the access grant in the audit entry", async () => {
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    const metadata = JSON.parse(db.auditLog.create.mock.calls[0][0].data.metadata);
    expect(metadata.accessDaysGranted).toBe(ACCESS_DAYS);
    expect(metadata.referenceNumber).toBe("130500139151");
  });

  it("refuses to settle when the user row has gone", async () => {
    // The credit and the grant have to be atomic. Crediting a wallet for a user
    // that no longer exists leaves money in a balance nothing can spend.
    db.user.findUnique.mockResolvedValue(null);
    await expect(settleTopupRequest(TOPUP, "admin1", "MANUAL")).rejects.toThrow(/USER_NOT_FOUND/);
  });
});

describe("settleTopupRequest: ledger", () => {
  it("writes a ledger row naming the reference", async () => {
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    const data = db.transaction.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: "TOPUP",
      amount: 500,
      status: "SUCCESS",
      referenceId: `TOPUP-${TOPUP.id.slice(0, 8)}`,
    });
    expect(data.description).toContain("130500139151");
  });

  it("distinguishes a reconciled credit from a manual one", async () => {
    // Reconstructing the books months later depends on telling these apart.
    await settleTopupRequest(TOPUP, "admin1", "RECONCILED");
    expect(db.transaction.create.mock.calls[0][0].data.description).toMatch(/reconciliation/i);
  });

  it("notifies after the transaction commits", async () => {
    // Inside the transaction the notification would use a second connection to
    // read an uncommitted row, and its failure would roll back a credit that had
    // already been earned.
    await settleTopupRequest(TOPUP, "admin1", "MANUAL");
    expect(db.notification.create).toHaveBeenCalled();
    const insideTx = db.$transaction.mock.calls[0][1];
    expect(insideTx).toEqual({ maxWait: 15000, timeout: 45000 });
  });
});
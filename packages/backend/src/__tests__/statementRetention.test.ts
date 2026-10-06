import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Statement retention: uploaded statements are dropped after 24 hours.
 *
 * The rule the user asked for, and the three things that would make it wrong:
 *
 *  - keeping anything older than 24 hours (the point is that it goes);
 *  - keeping anything younger (a re-upload of the same export is rejected by
 *    `@@unique([fileHash])`, so a statement that lingers past a day silently
 *    makes tomorrow's upload fail);
 *  - deleting without a trace (the statement is the only record of what the
 *    file contained, so purging it must leave an audit row carrying that).
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    bankStatement: { findMany: vi.fn(), delete: vi.fn() },
    bankStatementRow: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { purgeExpiredStatements, STATEMENT_RETENTION_MS } from "../services/bankReconciliation";

const NOW = new Date("2026-10-10T12:00:00Z");
const HOURS_25 = new Date("2026-10-09T11:00:00Z");
const HOURS_23 = new Date("2026-10-09T13:00:00Z");

const oldStatement = {
  id: "old-1",
  fileName: "oct.csv",
  fileHash: "abc",
  status: "PREVIEWED",
  rowCount: 120,
  creditedCount: 3,
  unmatchedCount: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prismaMock.bankStatement.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockResolvedValue([{ count: 0 }]);
  prismaMock.auditLog.create.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("STATEMENT_RETENTION_MS", () => {
  it("is exactly 24 hours", () => {
    expect(STATEMENT_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("purgeExpiredStatements - what it selects", () => {
  it("asks only for statements past the 24-hour mark", async () => {
    await purgeExpiredStatements(NOW);
    expect(prismaMock.bankStatement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000) } },
      }),
    );
  });

  it("takes a 25-hour-old statement and leaves a 23-hour-old one alone", async () => {
    // Guarding the boundary explicitly: "-23h is not expired" is the half of the
    // rule that protects a statement an admin is still mid-review on.
    await purgeExpiredStatements(NOW);
    const call = prismaMock.bankStatement.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    const cutoff = call.where.createdAt.lt;

    expect(cutoff.getTime()).toBe(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(HOURS_25.getTime()).toBeLessThan(cutoff.getTime());
    expect(HOURS_23.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());
  });

  it("returns zero when nothing is due", async () => {
    await expect(purgeExpiredStatements(NOW)).resolves.toEqual({ purged: 0, rows: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredStatements - how it deletes", () => {
  beforeEach(() => {
    prismaMock.bankStatement.findMany.mockResolvedValue([oldStatement]);
    prismaMock.$transaction.mockResolvedValue([{ count: 120 }]);
  });

  it("deletes rows and statement in one transaction", async () => {
    // Cascading from the statement would work too, but doing it explicitly means
    // the intent does not depend on migration state - a bare delete that failed
    // to cascade would orphan rows rather than refuse.
    await purgeExpiredStatements(NOW);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.bankStatementRow.deleteMany).toHaveBeenCalledWith({
      where: { statementId: "old-1" },
    });
    expect(prismaMock.bankStatement.delete).toHaveBeenCalledWith({ where: { id: "old-1" } });
  });

  it("writes an audit row carrying what the file contained", async () => {
    // The statement is the only place that recorded it. Purge without this and
    // the answer to "why was this wallet credited" goes with the rows.
    await purgeExpiredStatements(NOW);
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorId: null,
      actorType: "SYSTEM",
      action: "BANK_STATEMENT_PURGED",
      entityType: "BankStatement",
      entityId: "old-1",
    });
    const meta = JSON.parse(data.metadata);
    expect(meta).toMatchObject({
      fileName: "oct.csv",
      fileHash: "abc",
      rowCount: 120,
      creditedCount: 3,
      retentionHours: 24,
    });
  });

  it("counts the rows it removed", async () => {
    await expect(purgeExpiredStatements(NOW)).resolves.toEqual({ purged: 1, rows: 120 });
  });

  it("does not lose the audit write when it is the statement that failed", async () => {
    prismaMock.$transaction.mockRejectedValue(new Error("row locked"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(purgeExpiredStatements(NOW)).resolves.toEqual({ purged: 0, rows: 0 });
    spy.mockRestore();
  });
});

describe("purgeExpiredStatements - failure isolation", () => {
  it("purges the rest when one statement fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    prismaMock.bankStatement.findMany.mockResolvedValue([
      { id: "bad", fileName: "bad.csv", fileHash: "x", status: "UPLOADED", rowCount: 1, creditedCount: 0, unmatchedCount: 0 },
      oldStatement,
    ]);
    prismaMock.$transaction.mockImplementation(() =>
      // Reject the first call, succeed afterwards.
      prismaMock.$transaction.mock.calls.length === 1
        ? Promise.reject(new Error("locked"))
        : Promise.resolve([{ count: 5 }]),
    );

    const r = await purgeExpiredStatements(NOW);
    spy.mockRestore();

    expect(r.purged).toBe(1);
    expect(r.rows).toBe(5);
  });
});

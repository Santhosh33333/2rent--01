import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The scheduler around bank reconciliation.
 *
 * Two rules are worth more than the rest of this file put together, because both
 * are ways of losing money quietly:
 *
 *  1. Expiry runs AFTER matching, not before. A statement that has just crossed
 *     24 hours must still get that tick's pass; expiring first would discard the
 *     row carrying a claim the user had only just submitted.
 *  2. One statement failing must not stop the statements queued behind it. A
 *     sweeper that dies on its first unreadable file leaves every subsequent
 *     file unwatched until somebody notices, and nothing says so.
 *
 * `../services/bankReconciliation` is mocked wholesale: these tests are about
 * orchestration order and failure isolation, not about the matcher, which has
 * its own suite.
 */

const { prismaMock, sweepStatement, purgeExpiredStatements } = vi.hoisted(() => ({
  prismaMock: { bankStatement: { findMany: vi.fn() } },
  sweepStatement: vi.fn(),
  purgeExpiredStatements: vi.fn(),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../services/bankReconciliation", () => ({
  sweepStatement,
  purgeExpiredStatements,
  STATEMENT_RETENTION_MS: 24 * 60 * 60 * 1000,
}));

import {
  runReconciliationSweep,
  startReconciliationSweeper,
  stopReconciliationSweeper,
} from "../services/reconciliationSweeper";

const outcome = (over: Record<string, unknown> = {}) => ({
  statementId: "s",
  rematched: 0,
  credited: 0,
  alreadySettled: 0,
  failed: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankStatement.findMany.mockResolvedValue([]);
  sweepStatement.mockResolvedValue(outcome());
  purgeExpiredStatements.mockResolvedValue({ purged: 0, rows: 0 });
});

describe("runReconciliationSweep - ordering", () => {
  it("matches before it expires", async () => {
    const order: string[] = [];
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "s1" }]);
    sweepStatement.mockImplementation(async () => {
      order.push("sweep");
      return outcome({ credited: 1 });
    });
    purgeExpiredStatements.mockImplementation(async () => {
      order.push("purge");
      return { purged: 1, rows: 3 };
    });

    await runReconciliationSweep();

    expect(order).toEqual(["sweep", "purge"]);
  });

  it("expires statements that are due, even when nothing was matched", async () => {
    // Expiry is not conditional on the matching pass having done work: a quiet
    // hour still has to clean up yesterday's uploads.
    prismaMock.bankStatement.findMany.mockResolvedValue([]);
    await runReconciliationSweep();
    expect(purgeExpiredStatements).toHaveBeenCalledTimes(1);
  });

  it("sweeps every statement it found, in one pass", async () => {
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const r = await runReconciliationSweep();
    expect(sweepStatement).toHaveBeenCalledTimes(3);
    expect(r.scanned).toBe(3);
  });
});

describe("runReconciliationSweep - failure isolation", () => {
  it("keeps sweeping the rest when one statement throws", async () => {
    // The practical case: one corrupt or locked file must not abandon the
    // queue, and the failure must not be swallowed into a clean-looking result.
    prismaMock.bankStatement.findMany.mockResolvedValue([
      { id: "bad" },
      { id: "good" },
      { id: "also-good" },
    ]);
    sweepStatement.mockImplementation(async ({ statementId }: { statementId: string }) => {
      if (statementId === "bad") throw new Error("unparseable");
      return outcome({ credited: 1 });
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runReconciliationSweep();
    spy.mockRestore();

    expect(sweepStatement).toHaveBeenCalledTimes(3);
    expect(r.credited).toBe(2);
  });

  it("still expires statements when matching blew up", async () => {
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "bad" }]);
    sweepStatement.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runReconciliationSweep();
    spy.mockRestore();

    expect(purgeExpiredStatements).toHaveBeenCalledTimes(1);
  });

  it("reports failures rather than returning a clean count", async () => {
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "s1" }]);
    sweepStatement.mockResolvedValue(
      outcome({ failed: [{ rowId: "r1", lineNo: 7, reason: "claim gone" }] }),
    );
    const r = await runReconciliationSweep();
    expect(r.failed).toBe(1);
  });
});

describe("reporting through the interval", () => {
  // `report()` is wired to the interval, not to `runReconciliationSweep`, so
  // these drive the real timer rather than asserting against a function the
  // sweep itself never calls.
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stopReconciliationSweeper();
    log.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("stays silent on a quiet tick", async () => {
    // This runs once a minute for the life of the process. 1440 identical log
    // lines a day is how a real signal in the same stream gets ignored.
    startReconciliationSweeper();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(log).not.toHaveBeenCalled();
  });

  it("logs when money was actually credited", async () => {
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "s1" }]);
    sweepStatement.mockResolvedValue(outcome({ credited: 4 }));

    startReconciliationSweeper();
    await vi.advanceTimersByTimeAsync(60_000);

    // Boot sweep and the first tick both report, so the count is not pinned -
    // what matters is that a credit is announced rather than swallowed.
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("4 auto-approved"))).toBe(true);
  });

  it("logs a failure even when nothing was credited", async () => {
    prismaMock.bankStatement.findMany.mockResolvedValue([{ id: "s1" }]);
    sweepStatement.mockResolvedValue(
      outcome({ failed: [{ rowId: "r1", lineNo: 7, reason: "claim gone" }] }),
    );

    startReconciliationSweeper();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes("1 failed"))).toBe(true);
  });
});

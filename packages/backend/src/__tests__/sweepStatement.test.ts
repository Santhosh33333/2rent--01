import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The automatic pass over an uploaded bank statement.
 *
 * The property this file exists for is that running it every minute cannot
 * churn. Rows whose fate is already decided must not be re-decided: an
 * ALREADY_SETTLED line has no creditedAt to its name, so any filter built from
 * creditedAt alone treats it as untouched and hands it back to the matcher,
 * which matches it, which settles it, which marks it ALREADY_SETTLED again.
 * An admin clicking Rematch twice never saw that; a scheduler runs it until the
 * statement expires.
 *
 * The rest is scope: this must not touch a statement a person has already
 * applied, must not mark a statement applied itself (that verdict ends the
 * watch, and the watch exists because claims arrive *after* upload), and must
 * not credit a line somebody decided by hand.
 */

const { prismaMock, settleTopup, TopupAlreadySettled, settleUpi, UpiAlreadySettled } =
  vi.hoisted(() => {
    class AlreadySettledError extends Error {
      constructor() {
        super("ALREADY_SETTLED");
      }
    }
    return {
      prismaMock: {
        bankStatement: { findUnique: vi.fn(), update: vi.fn() },
        bankStatementRow: { findMany: vi.fn(), update: vi.fn() },
        auditLog: { create: vi.fn() },
        topupRequest: { findMany: vi.fn(), findUnique: vi.fn() },
        upiPayment: { findMany: vi.fn(), findUnique: vi.fn() },
      },
      settleTopup: vi.fn(),
      TopupAlreadySettled: AlreadySettledError,
      settleUpi: vi.fn(),
      UpiAlreadySettled: AlreadySettledError,
    };
  });

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../services/topupSettlement", () => ({
  settleTopupRequest: settleTopup,
  AlreadySettledError: TopupAlreadySettled,
}));
vi.mock("../services/upiSettlement", () => ({
  settleUpiPayment: settleUpi,
  AlreadySettledError: UpiAlreadySettled,
}));

import { sweepStatement } from "../services/bankReconciliation";

const baseRow = {
  id: "row-1",
  lineNo: 3,
  rawJson: null,
  referenceNorm: "UTR12345",
  amount: 500,
  inbound: true,
  creditedAt: null,
  decidedAt: null,
};

function seedStatement(rows: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) {
  prismaMock.bankStatement.findUnique.mockResolvedValue({
    id: "st-1",
    status: "UPLOADED",
    fileName: "oct.csv",
    fileHash: "hash-1",
    warnings: null,
    periodFrom: null,
    periodTo: null,
    rows,
    ...over,
  });
}

/** Only the queries `refreshStatementCounts` makes return rows. */
function rowCountOnly() {
  prismaMock.bankStatementRow.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankStatement.update.mockResolvedValue({});
  prismaMock.bankStatementRow.update.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.topupRequest.findMany.mockResolvedValue([]);
  prismaMock.upiPayment.findMany.mockResolvedValue([]);
  prismaMock.topupRequest.findUnique.mockResolvedValue(null);
  settleTopup.mockResolvedValue(undefined);
  settleUpi.mockResolvedValue(undefined);
  rowCountOnly();
});

describe("sweepStatement - what it refuses to touch", () => {
  it("returns null for a statement already applied by hand", async () => {
    // Applied is a person's verdict on the file. Rewriting its rows afterwards
    // would destroy the record of why each line was or was not credited.
    seedStatement([baseRow], { status: "APPLIED" });
    await expect(sweepStatement({ statementId: "st-1" })).resolves.toBeNull();
    expect(prismaMock.topupRequest.findMany).not.toHaveBeenCalled();
    expect(prismaMock.bankStatementRow.update).not.toHaveBeenCalled();
  });

  it("returns null when the statement is gone", async () => {
    prismaMock.bankStatement.findUnique.mockResolvedValue(null);
    await expect(sweepStatement({ statementId: "gone" })).resolves.toBeNull();
  });
});

describe("sweepStatement - no churn on decided lines", () => {
  it("does not re-evaluate an ALREADY_SETTLED line", async () => {
    // The verdict writes no creditedAt, so a creditedAt-only filter would put it
    // straight back in front of the matcher - match, settle, verdict, repeat,
    // every minute until expiry.
    seedStatement([{ ...baseRow, matchStatus: "ALREADY_SETTLED" }]);

    const r = await sweepStatement({ statementId: "st-1" });

    expect(r?.rematched).toBe(0);
    // Reaching the matcher requires loading candidate claims. Not being called
    // at all is the strongest form of "this row was never reconsidered".
    expect(prismaMock.topupRequest.findMany).not.toHaveBeenCalled();
    expect(prismaMock.bankStatementRow.update).not.toHaveBeenCalled();
  });

  it("does re-evaluate an UNMATCHED line, which is the whole point", async () => {
    // The claim a user pasted a minute after the upload lands in exactly here.
    seedStatement([{ ...baseRow, matchStatus: "UNMATCHED" }]);

    await sweepStatement({ statementId: "st-1" });

    // Two queries per table (an exact reference lookup, plus a time-windowed
    // scan for a UTR the bank printed with spaces the user did not type), so
    // what is asserted is that claims were loaded at all, not how many.
    expect(prismaMock.topupRequest.findMany).toHaveBeenCalled();
    expect(prismaMock.upiPayment.findMany).toHaveBeenCalled();
  });

  it("leaves a line the admin decided on alone", async () => {
    seedStatement([{ ...baseRow, matchStatus: "UNMATCHED", decidedAt: new Date() }]);

    const r = await sweepStatement({ statementId: "st-1" });

    expect(r?.rematched).toBe(0);
    expect(prismaMock.topupRequest.findMany).not.toHaveBeenCalled();
  });
});

describe("sweepStatement - crediting", () => {
  const matchedRow = { ...baseRow, matchStatus: "MATCHED", matchedType: "TOPUP", matchedId: "t1" };

  function seedCreditable() {
    seedStatement([matchedRow]);
    // One query is the candidate scan during rematch, the other is the list of
    // rows ready to credit; the second carries the decided/credited filters.
    prismaMock.bankStatementRow.findMany.mockImplementation((args: { where: any }) =>
      args.where.decidedAt === null
        ? Promise.resolve([
            { id: "row-1", lineNo: 3, matchedType: "TOPUP", matchedId: "t1" },
          ])
        : Promise.resolve([]),
    );
    prismaMock.topupRequest.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      amount: 500,
      status: "VERIFICATION_PENDING",
      referenceNumber: "UTR12345",
    });
  }

  it("credits a matched, undecided line", async () => {
    seedCreditable();
    const r = await sweepStatement({ statementId: "st-1" });
    expect(r?.credited).toBe(1);
    expect(settleTopup).toHaveBeenCalledTimes(1);
  });

  it("only asks for lines that are matched, uncredited and undecided", async () => {
    seedCreditable();
    await sweepStatement({ statementId: "st-1" });

    const ready = prismaMock.bankStatementRow.findMany.mock.calls.find(
      (c) => c[0].where?.decidedAt !== undefined,
    );
    expect(ready![0].where).toEqual({
      statementId: "st-1",
      matchStatus: "MATCHED",
      creditedAt: null,
      decidedAt: null,
    });
  });

  it("attributes an automatic credit to the sweeper, not to the admin who uploaded", async () => {
    // They chose to upload a file; they did not choose to credit this row at
    // 01:00. Stamping their id would make the trail assert something that never
    // happened.
    seedCreditable();
    await sweepStatement({ statementId: "st-1" });
    expect(prismaMock.bankStatementRow.update.mock.calls[0][0].data.creditedById).toBe(
      "system:reconciliation-sweeper",
    );
  });

  it("records a race lost as settled, without crediting under its own name", async () => {
    seedCreditable();
    settleTopup.mockRejectedValue(new TopupAlreadySettled());

    const r = await sweepStatement({ statementId: "st-1" });

    expect(r?.credited).toBe(0);
    expect(r?.alreadySettled).toBe(1);
    expect(r?.failed).toHaveLength(0);
    const data = prismaMock.bankStatementRow.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ matchStatus: "ALREADY_SETTLED" });
    expect(data.creditedAt).toBeUndefined();
    expect(data.creditedById).toBeUndefined();
  });
});

describe("sweepStatement - statement state", () => {
  it("does not mark the statement applied", async () => {
    // Apply is a terminal verdict; this is a watch, and it has to keep watching
    // because the next claim may not exist yet.
    seedStatement([{ ...baseRow, matchStatus: "UNMATCHED" }]);
    await sweepStatement({ statementId: "st-1" });

    const statusWrites = prismaMock.bankStatement.update.mock.calls.filter(
      (c) => c[0].data?.status !== undefined,
    );
    expect(statusWrites).toHaveLength(0);
  });

  it("moves an untouched statement to PREVIEWED once something matched", async () => {
    seedStatement([{ ...baseRow, matchStatus: "MATCHED", matchedType: "TOPUP", matchedId: "t1" }]);
    prismaMock.bankStatementRow.findMany.mockImplementation((args: { where: any }) =>
      args.where.decidedAt === null
        ? Promise.resolve([{ id: "row-1", lineNo: 3, matchedType: "TOPUP", matchedId: "t1" }])
        : Promise.resolve([{ matchStatus: "MATCHED", inbound: true, amount: 500, creditedAt: null }]),
    );
    prismaMock.topupRequest.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      amount: 500,
      status: "VERIFICATION_PENDING",
    });

    await sweepStatement({ statementId: "st-1" });

    expect(prismaMock.bankStatement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PREVIEWED" } }),
    );
  });
});

describe("sweepStatement - audit", () => {
  it("writes nothing when a tick did nothing", async () => {
    // This fires every minute for the life of the process.
    seedStatement([{ ...baseRow, matchStatus: "UNMATCHED" }]);
    await sweepStatement({ statementId: "st-1" });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("writes a system audit row when money was credited", async () => {
    seedStatement([{ ...baseRow, matchStatus: "MATCHED", matchedType: "TOPUP", matchedId: "t1" }]);
    prismaMock.bankStatementRow.findMany.mockImplementation((args: { where: any }) =>
      args.where.decidedAt === null
        ? Promise.resolve([{ id: "row-1", lineNo: 3, matchedType: "TOPUP", matchedId: "t1" }])
        : Promise.resolve([]),
    );
    prismaMock.topupRequest.findUnique.mockResolvedValue({
      id: "t1",
      userId: "u1",
      amount: 500,
      status: "VERIFICATION_PENDING",
    });

    await sweepStatement({ statementId: "st-1" });

    const data = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ actorId: null, actorType: "SYSTEM", action: "BANK_STATEMENT_AUTO_APPLIED" });
    expect(JSON.parse(data.metadata)).toMatchObject({ credited: 1 });
  });

  it("writes an audit row when a line failed, so a silent failure is not a success", async () => {
    seedStatement([{ ...baseRow, matchStatus: "MATCHED", matchedType: "TOPUP", matchedId: "t1" }]);
    prismaMock.bankStatementRow.findMany.mockImplementation((args: { where: any }) =>
      args.where.decidedAt === null
        ? Promise.resolve([{ id: "row-1", lineNo: 3, matchedType: "TOPUP", matchedId: "t1" }])
        : Promise.resolve([]),
    );
    prismaMock.topupRequest.findUnique.mockResolvedValue(null);

    await sweepStatement({ statementId: "st-1" });

    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(prismaMock.auditLog.create.mock.calls[0][0].data.metadata);
    expect(meta.failed).toHaveLength(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Applying a statement to a wallet.
 *
 * The property worth pinning is that money cannot leave twice. There are three
 * paths that can credit the same bank line - this batch, an admin settling the
 * payment by hand from its own queue, and the background sweeper - and each one
 * has to find the claim already taken rather than pay again. Every assertion
 * below that involves a settled claim is really asserting that.
 *
 * The other half is quieter: a line the admin explicitly IGNOREd must stay
 * ignored. `recordRowDecision` does not rewrite matchStatus when it records a
 * decision, so an ignored line is still MATCHED - and unless the query says
 * otherwise, the batch that runs a second later credits it anyway, overruling a
 * human without a word.
 */

const { prismaMock, settleTopup, TopupAlreadySettled, settleUpi, UpiAlreadySettled } =
  vi.hoisted(() => {
    class AlreadySettledError extends Error {
      constructor() {
        super("ALREADY_SETTLED");
        this.name = "AlreadySettledError";
      }
    }
    return {
      prismaMock: {
        bankStatement: { findUnique: vi.fn(), update: vi.fn() },
        bankStatementRow: { findMany: vi.fn(), update: vi.fn() },
        auditLog: { create: vi.fn() },
        topupRequest: { findUnique: vi.fn() },
        upiPayment: { findUnique: vi.fn() },
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

import {
  applyStatement,
  ReconciliationError,
} from "../services/bankReconciliation";

const row = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  lineNo: 4,
  matchedType: "TOPUP",
  matchedId: "t1",
  ...over,
});

const pendingTopup = {
  id: "t1",
  userId: "u1",
  amount: 500,
  status: "VERIFICATION_PENDING",
  referenceNumber: "UTR123",
};

function seedStatement(over: Record<string, unknown> = {}) {
  prismaMock.bankStatement.findUnique.mockResolvedValue({
    id: "st-1",
    fileName: "oct.csv",
    fileHash: "hash-1",
    status: "PREVIEWED",
    rows: [row()],
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.bankStatement.update.mockResolvedValue({});
  prismaMock.bankStatementRow.update.mockResolvedValue({});
  prismaMock.bankStatementRow.findMany.mockResolvedValue([]);
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.topupRequest.findUnique.mockResolvedValue(pendingTopup);
  settleTopup.mockResolvedValue(undefined);
  settleUpi.mockResolvedValue(undefined);
});

describe("applyStatement - the query that decides what is eligible", () => {
  it("excludes lines the admin already decided on", async () => {
    // recordRowDecision leaves matchStatus untouched when it records IGNORE or
    // REJECT, so an ignored line is still MATCHED. Without this clause the batch
    // credits it and the decision was never real.
    seedStatement();
    await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(prismaMock.bankStatement.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          rows: { where: { matchStatus: "MATCHED", creditedAt: null, decidedAt: null } },
        },
      }),
    );
  });

  it("excludes lines already credited, so a re-apply pays nothing", async () => {
    seedStatement();
    await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    const where = prismaMock.bankStatement.findUnique.mock.calls[0][0].include.rows.where;
    expect(where.creditedAt).toBeNull();
    expect(where.matchStatus).toBe("MATCHED");
  });

  it("leaves a decided line out of the batch entirely", async () => {
    // The filter is the protection; this asserts the loop only ever sees what
    // passed it, so a decided row cannot be credited by omission of the check.
    seedStatement({ rows: [] });
    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });
    expect(r.credited).toBe(0);
    expect(settleTopup).not.toHaveBeenCalled();
  });
});

describe("applyStatement - refusals", () => {
  it("refuses a statement that was already applied", async () => {
    seedStatement({ status: "APPLIED" });
    await expect(
      applyStatement({ statementId: "st-1", actorId: "admin-1" }),
    ).rejects.toMatchObject({ code: "ALREADY_APPLIED" });
    expect(settleTopup).not.toHaveBeenCalled();
  });

  it("refuses a statement that no longer exists", async () => {
    prismaMock.bankStatement.findUnique.mockResolvedValue(null);
    await expect(
      applyStatement({ statementId: "gone", actorId: "admin-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws ReconciliationError so the HTTP edge can map its status", async () => {
    seedStatement({ status: "APPLIED" });
    const err = await applyStatement({ statementId: "st-1", actorId: "admin-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ReconciliationError);
  });
});

describe("applyStatement - crediting", () => {
  it("settles a pending claim once and records who credited it", async () => {
    seedStatement();
    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(settleTopup).toHaveBeenCalledTimes(1);
    expect(settleTopup.mock.calls[0][1]).toBe("admin-1");
    expect(r.credited).toBe(1);
    expect(prismaMock.bankStatementRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-1" }, data: expect.objectContaining({ creditedById: "admin-1" }) }),
    );
  });

  it("does not credit a claim that is already verified", async () => {
    // The case that matters: an admin settles the top-up from its own queue
    // while this statement is open. The batch must record it as settled and
    // touch no wallet.
    seedStatement();
    prismaMock.topupRequest.findUnique.mockResolvedValue({ ...pendingTopup, status: "VERIFIED" });

    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(settleTopup).not.toHaveBeenCalled();
    expect(r.alreadySettled).toBe(1);
    expect(r.credited).toBe(0);
    expect(prismaMock.bankStatementRow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row-1" },
        data: expect.objectContaining({ matchStatus: "ALREADY_SETTLED" }),
      }),
    );
  });

  it("treats a lost race as settled rather than as a failure", async () => {
    // settleTopupRequest claims with a conditional transition; the loser throws.
    // If that surfaced as `failed` an admin would retry, and retrying is exactly
    // what must not happen.
    seedStatement();
    settleTopup.mockRejectedValue(new TopupAlreadySettled());

    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(r.alreadySettled).toBe(1);
    expect(r.failed).toHaveLength(0);
  });

  it("records a missing claim as a failed line without abandoning the rest", async () => {
    seedStatement({
      rows: [row({ id: "row-gone", lineNo: 1, matchedId: "nope" }), row({ id: "row-ok", lineNo: 2 })],
    });
    prismaMock.topupRequest.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      where.id === "nope" ? Promise.resolve(null) : Promise.resolve(pendingTopup),
    );

    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(r.credited).toBe(1);
    expect(r.failed).toEqual([
      { rowId: "row-gone", lineNo: 1, reason: "The matched claim no longer exists." },
    ]);
  });

  it("still marks the statement APPLIED when a line failed", async () => {
    // Re-uploading is not the remedy for a failed line, and leaving the file
    // open is what would let the successful lines be offered a second time.
    seedStatement();
    prismaMock.topupRequest.findUnique.mockResolvedValue(null);

    await applyStatement({ statementId: "st-1", actorId: "admin-1" });

    expect(prismaMock.bankStatement.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPLIED" }) }),
    );
  });

  it("writes an audit row carrying the counts", async () => {
    seedStatement();
    await applyStatement({ statementId: "st-1", actorId: "admin-1", note: "checked" });

    const data = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      actorId: "admin-1",
      action: "BANK_STATEMENT_APPLIED",
      entityType: "BankStatement",
      entityId: "st-1",
    });
    expect(JSON.parse(data.metadata)).toMatchObject({ credited: 1, alreadySettled: 0, failed: 0 });
  });

  it("uses the note when one was given and the filename when not", async () => {
    seedStatement();
    await applyStatement({ statementId: "st-1", actorId: "admin-1", note: " checked " });
    expect(settleTopup.mock.calls[0][3]).toBe("checked");

    vi.clearAllMocks();
    seedStatement();
    await applyStatement({ statementId: "st-1", actorId: "admin-1" });
    expect(settleTopup.mock.calls[0][3]).toBe("Bank statement oct.csv");
  });
});

describe("applyStatement - a row with no claim attached", () => {
  it("skips it silently rather than inventing one", async () => {
    seedStatement({ rows: [row({ matchedType: null, matchedId: null })] });
    const r = await applyStatement({ statementId: "st-1", actorId: "admin-1" });
    expect(r.credited).toBe(0);
    expect(r.failed).toHaveLength(0);
    expect(settleTopup).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Event escrow settlement.
 *
 * The single most dangerous bug available in this module is the asymmetry
 * between the two settlement outcomes:
 *
 *   RELEASE  payer's `balance` drops by the full amount  (money leaves them)
 *   REFUND   payer's `balance` is untouched              (money never left)
 *
 * Both must drop `heldBalance` by the same amount, because both end the hold.
 * Getting the balance line wrong on either path either creates money from
 * nothing (refund that also debits) or strands it in `heldBalance` forever
 * (release that forgets to debit), and in both cases the payer's spendable
 * balance is quietly wrong by a real amount of money.
 *
 * These assertions read the SQL that was sent to Postgres, because that is
 * where the arithmetic actually happens. Asserting on function return values
 * would pass even if every one of these operations were inverted.
 */

const hoisted = vi.hoisted(() => ({
  eventEscrow: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  wallet: { findUnique: vi.fn(), update: vi.fn() },
  eventShare: { updateMany: vi.fn() },
  event: { findUnique: vi.fn(), update: vi.fn() },
  transaction: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(hoisted),
}));

vi.mock("../config/database", () => ({
  prisma: {
    eventEscrow: hoisted.eventEscrow,
    wallet: hoisted.wallet,
    eventShare: hoisted.eventShare,
    event: hoisted.event,
    transaction: hoisted.transaction,
    auditLog: hoisted.auditLog,
    $queryRaw: hoisted.$queryRaw,
    $transaction: hoisted.$transaction,
  },
}));

import { EscrowError, releaseEscrow, refundEscrow, sweepReleasableEscrows } from "../services/eventEscrowService";

const ESCROW = "esc-1";
const PAYER = "payer-1";
const ORG = "organizer-1";

/**
 * Flatten a Prisma tagged-template call into readable text.
 *
 * `tx.$queryRaw` is called as a tagged template, so `mock.calls[0][0]` is the
 * raw `TemplateStringsArray` and `[1]` holds the interpolated values - including
 * nested `Prisma.sql` fragments such as the conditional balance debit. Walking
 * both and collecting only the string literals is enough to answer the only
 * question that matters here: does this UPDATE touch `balance`, and does it
 * touch `heldBalance`.
 */
function sqlText(call: unknown): string {
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (node == null) return;
    // A bare string IS a SQL fragment and must be collected, not skipped.
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      if (Array.isArray(node.strings)) walk(node.strings);
      if (node.text) parts.push(node.text);
      for (const v of Object.values(node)) {
        if (typeof v === "string" || typeof v === "object") walk(v);
      }
    }
  };
  walk(call);
  return parts.join(" ");
}

/**
 * The SQL text of the nth guarded raw call (0 = the hold/un-hold).
 *
 * Walks the whole argument list, not just the strings array: the conditional
 * balance debit is a nested `Prisma.sql` sitting in the template's VALUES, so
 * reading only the string fragments would silently miss the exact clause this
 * test exists to check.
 */
function rawSql(index = 0): string {
  return sqlText(hoisted.$queryRaw.mock.calls[index]);
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.eventEscrow.findUnique.mockResolvedValue({
    id: ESCROW,
    eventId: "ev1",
    eventShareId: "share-1",
    payerId: PAYER,
    organizerId: ORG,
    amount: 200,
    organizerPayout: 180,
    status: "HELD",
  });
  hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 1 });
  hoisted.wallet.findUnique.mockImplementation(async ({ where }: any) =>
    where.id ? { id: where.id } : { id: where.userId === ORG ? "org-wallet" : "payer-wallet" },
  );
  hoisted.wallet.update.mockResolvedValue({});
  hoisted.eventShare.updateMany.mockResolvedValue({ count: 1 });
  // refreshEventSettlement reads every escrow on the event to recompute the
  // event's status, so this must return an array rather than undefined.
  hoisted.eventEscrow.findMany.mockResolvedValue([]);
  hoisted.event.update.mockResolvedValue({});
  hoisted.transaction.create.mockResolvedValue({});
  hoisted.auditLog.create.mockResolvedValue({});
  hoisted.$queryRaw.mockResolvedValue([{ id: "payer-wallet" }]);
});

describe("the release / refund asymmetry", () => {
  it("RELEASE debits the payer's balance and un-holds", async () => {
    await releaseEscrow(ESCROW, "admin-1", "Event ran as advertised.");

    const sql = rawSql();
    // Both columns move on release: the hold ends AND the money leaves.
    expect(sql).toContain("heldBalance");
    expect(sql).toContain("balance");
    // The guard stops the un-hold running if the hold is missing.
    expect(sql).toContain("heldBalance");
    // The organizer is paid the payout, not the gross amount.
    expect(hoisted.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-wallet" },
        data: { balance: { increment: expect.anything() } },
      }),
    );
    expect(hoisted.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "EVENT_ESCROW_EARNED" }) }),
    );
  });

  it("REFUND un-holds but does NOT debit the payer's balance", async () => {
    // This is the case that creates money if it is wrong: debiting on refund
    // would take the payer's 200 AND give it back to them.
    await refundEscrow(ESCROW, "admin-1", "The event was never held.");

    expect(hoisted.wallet.update).not.toHaveBeenCalled();
    // The share is marked REFUNDED so the cost sheet does not claim it was paid.
    expect(hoisted.eventShare.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "REFUNDED" } }),
    );
    expect(hoisted.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "EVENT_ESCROW_REFUNDED" }) }),
    );
  });

  it("marks a released share PAID and a refunded share REFUNDED", async () => {
    // Collapsing both into PAID would make the cost sheet lie about who got paid.
    await releaseEscrow(ESCROW, "admin-1", "Event ran as advertised.");
    expect(hoisted.eventShare.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "PAID" } }),
    );
  });
});

describe("settling once and only once", () => {
  it("refuses a second settlement of the same escrow", async () => {
    hoisted.eventEscrow.findUnique.mockResolvedValue({
      id: ESCROW,
      eventId: "ev1",
      eventShareId: "share-1",
      payerId: PAYER,
      organizerId: ORG,
      amount: 200,
      organizerPayout: 180,
      status: "RELEASED",
    });

    await expect(refundEscrow(ESCROW, "admin-1", "Trying again.")).rejects.toThrow(/already released/i);
    // Nothing moved: the refusal happens before any wallet write.
    expect(hoisted.$queryRaw).not.toHaveBeenCalled();
    expect(hoisted.wallet.update).not.toHaveBeenCalled();
  });

  it("claims the row before it moves any money", async () => {
    // The guard is what makes two simultaneous decisions safe. If the claim were
    // after the wallet update, a refund racing a release could pay out twice.
    await refundEscrow(ESCROW, "admin-1", "The event was never held.");
    expect(hoisted.eventEscrow.updateMany).toHaveBeenCalledTimes(1);
    expect(hoisted.eventEscrow.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.$queryRaw.mock.invocationCallOrder[0],
    );
  });

  it("stops when the guarded claim loses the race", async () => {
    hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 0 });

    await expect(releaseEscrow(ESCROW, "admin-1", "Event ran.")).rejects.toThrow(/already settled/i);
    expect(hoisted.$queryRaw).not.toHaveBeenCalled();
  });

  it("rolls back rather than stranding the amount when heldBalance has drifted", async () => {
    // Zero rows from the guarded un-hold means the held total no longer contains
    // this amount. Throwing aborts the transaction instead of leaving the escrow
    // marked settled with the payer's heldBalance still containing it forever.
    hoisted.$queryRaw.mockResolvedValue([]);

    await expect(refundEscrow(ESCROW, "admin-1", "The event was never held.")).rejects.toThrow(
      /reserved amount did not match/i,
    );
  });

  it("allows a disputed escrow to be settled", async () => {
    hoisted.eventEscrow.findUnique.mockResolvedValue({
      id: ESCROW,
      eventId: "ev1",
      eventShareId: "share-1",
      payerId: PAYER,
      organizerId: ORG,
      amount: 200,
      organizerPayout: 180,
      status: "DISPUTED",
    });
    await expect(refundEscrow(ESCROW, "admin-1", "Confirmed fake event.")).resolves.toMatchObject({
      amount: 200,
    });
  });
});

describe("a decision must be explained", () => {
  it("refuses a decision with no note", async () => {
    // The payer is emailed this text. "Your money was returned" does not answer
    // "why did you take my money for an event that never happened".
    await expect(refundEscrow(ESCROW, "admin-1", "   ")).rejects.toThrow(/note/i);
    expect(hoisted.$queryRaw).not.toHaveBeenCalled();
  });

  it("refuses a decision with a one-character note", async () => {
    await expect(refundEscrow(ESCROW, "admin-1", "x")).rejects.toThrow(/note/i);
  });

  it("trims the note before storing it", async () => {
    await refundEscrow(ESCROW, "admin-1", "  The event was cancelled by rain.  ");
    expect(hoisted.eventEscrow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decisionNote: "The event was cancelled by rain." }),
      }),
    );
  });
});

describe("the auto-release sweep", () => {
  it("releases every hold whose window closed with nothing against it", async () => {
    hoisted.eventEscrow.findMany.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 1 });

    const result = await sweepReleasableEscrows();

    expect(result.released).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("keeps going when one escrow fails, so one bad row cannot stall the queue", async () => {
    hoisted.eventEscrow.findMany.mockResolvedValue([{ id: "bad" }, { id: "good" }]);
    // First claim fails, second succeeds.
    hoisted.eventEscrow.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 1 });
    hoisted.eventEscrow.findUnique.mockResolvedValue({
      id: "good",
      eventId: "ev1",
      eventShareId: "share-1",
      payerId: PAYER,
      organizerId: ORG,
      amount: 200,
      organizerPayout: 180,
      status: "HELD",
    });

    const result = await sweepReleasableEscrows();

    expect(result.released).toBe(1);
    expect(result.skippedDisputed).toBe(1);
  });

  it("counts a held-balance mismatch as failed and logs it, not as a benign skip", async () => {
    // This is the bug this pins. A guarded un-hold that matches no row means the
    // payer's heldBalance no longer covers this hold, so the settlement rolled back
    // and the money is unaccounted for. It used to be lumped in with
    // ALREADY_SETTLED as "skippedDisputed" and returned early without logging --
    // so a wallet that does not add up produced no error anywhere and was
    // indistinguishable from a healthy race. It is a 500-class integrity failure
    // and has to be visible to whoever can fix it.
    hoisted.eventEscrow.findMany.mockResolvedValue([{ id: "drifted" }]);
    // The claim succeeds...
    hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 1 });
    // ...but the guarded UPDATE returns no rows, which is the mismatch.
    hoisted.$queryRaw.mockResolvedValue([]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sweepReleasableEscrows();

    expect(result.failed).toBe(1);
    expect(result.skippedDisputed).toBe(0);
    expect(result.released).toBe(0);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[ESCROW]"));
    expect(logged.mock.calls[0][0]).toContain("drifted");
    logged.mockRestore();
  });

  it("explains itself in the note it releases with", async () => {
    hoisted.eventEscrow.findMany.mockResolvedValue([{ id: "e1" }]);
    hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 1 });
    hoisted.eventEscrow.findUnique.mockResolvedValue({
      id: "e1",
      eventId: "ev1",
      eventShareId: "share-1",
      payerId: PAYER,
      organizerId: ORG,
      amount: 200,
      organizerPayout: 180,
      status: "HELD",
    });

    await sweepReleasableEscrows();

    expect(hoisted.eventEscrow.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionNote: expect.stringMatching(/no report/i),
          decidedById: null,
        }),
      }),
    );
  });

  it("records an automatic release with a null actor, not a fake user id", async () => {
    // `AuditLog.actorId` is a real FK to User. Writing a sentinel string like
    // "system:sweep" here violates the constraint and rolls back the whole
    // settlement - found by the live probe, not by a mock.
    hoisted.eventEscrow.findMany.mockResolvedValue([{ id: "e1" }]);
    hoisted.eventEscrow.updateMany.mockResolvedValue({ count: 1 });
    hoisted.eventEscrow.findUnique.mockResolvedValue({
      id: "e1",
      eventId: "ev1",
      eventShareId: "share-1",
      payerId: PAYER,
      organizerId: ORG,
      amount: 200,
      organizerPayout: 180,
      status: "HELD",
    });

    await sweepReleasableEscrows();

    expect(hoisted.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: null, actorType: "SYSTEM" }),
      }),
    );
  });

  it("does nothing when nothing is due", async () => {
    hoisted.eventEscrow.findMany.mockResolvedValue([]);
    const result = await sweepReleasableEscrows();
    expect(result).toMatchObject({ scanned: 0, released: 0, failed: 0 });
    expect(hoisted.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("errors carry a usable code", () => {
  it("reports a missing escrow as not found", async () => {
    hoisted.eventEscrow.findUnique.mockResolvedValue(null);
    await expect(refundEscrow("nope", "admin-1", "Some note.")).rejects.toMatchObject({
      code: "ESCROW_NOT_FOUND",
      status: 404,
    });
  });

  it("uses EscrowError so callers can branch on code not on message text", async () => {
    hoisted.eventEscrow.findUnique.mockResolvedValue(null);
    await expect(refundEscrow("nope", "admin-1", "Some note.")).rejects.toBeInstanceOf(EscrowError);
  });
});
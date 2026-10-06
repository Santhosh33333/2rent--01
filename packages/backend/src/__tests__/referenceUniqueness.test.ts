import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * One UTR, one payment - across all three tables that can hold one.
 *
 * These tests exist because there used to be four separate copies of this check
 * and they disagreed about which tables to consult and which statuses block.
 * The bug that produced was not a crash: it was a reference accepted by the
 * weakest caller and settled a second time, which shows up weeks later as a
 * wallet balance nobody can explain.
 *
 * So what is pinned down here is less "does it find a row" than "which rows are
 * allowed through, and does the answer not depend on who is asking".
 *
 * The fakes below honour the `where` clause rather than returning a fixed value.
 * A mock that ignores the filter cannot express the single most important rule
 * in this file - that REJECTED rows are excluded - because it would hand back
 * the row no matter what was asked for, and the test would pass or fail on
 * whether the mock was wired up rather than on whether the rule holds.
 */

const { prismaMock, seed } = vi.hoisted(() => {
  type Row = { id: string; status: string; referenceNumber: string };

  const prismaMock = {
    topupRequest: { findFirst: vi.fn() },
    upiPayment: { findFirst: vi.fn() },
    subscriptionPayment: { findFirst: vi.fn() },
  };

  /** Installs rows in a fake table, filtered the way the database would. */
  function seed(model: { findFirst: ReturnType<typeof vi.fn> }, rows: Row[]): void {
    model.findFirst.mockImplementation((args: { where: any }) => {
      const w = args?.where ?? {};
      const hit = rows.find(
        (r) =>
          r.referenceNumber === w.referenceNumber &&
          // `status: { notIn }` - the rule that decides REJECTED can be retried.
          (!w.status?.notIn || !w.status.notIn.includes(r.status)) &&
          // `id: { not }` - the row's own reference is not a clash against itself.
          (!w.id?.not || w.id.not !== r.id),
      );
      return Promise.resolve(hit ? { id: hit.id, status: hit.status } : null);
    });
  }

  return { prismaMock, seed };
});

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { findReferenceConflict, referenceConflictMessage } from "../services/referenceUniqueness";

const TOPUP = prismaMock.topupRequest;
const UPI = prismaMock.upiPayment;
const SUB = prismaMock.subscriptionPayment;

function allFree(): void {
  seed(TOPUP, []);
  seed(UPI, []);
  seed(SUB, []);
}

beforeEach(() => {
  vi.clearAllMocks();
  allFree();
});

describe("findReferenceConflict - a free reference", () => {
  it("reports no conflict when no table holds the reference", async () => {
    await expect(findReferenceConflict("UTR998877")).resolves.toBeNull();
  });

  it("asks all three tables, not just the caller's own", async () => {
    // The whole point of the shared guard: the booking path previously asked
    // only UpiPayment, so a settled top-up UTR was accepted straight through.
    await findReferenceConflict("UTR998877");
    expect(TOPUP.findFirst).toHaveBeenCalledTimes(1);
    expect(UPI.findFirst).toHaveBeenCalledTimes(1);
    expect(SUB.findFirst).toHaveBeenCalledTimes(1);
  });

  it("treats an empty or whitespace reference as nothing to check", async () => {
    await expect(findReferenceConflict("")).resolves.toBeNull();
    await expect(findReferenceConflict("   ")).resolves.toBeNull();
    expect(TOPUP.findFirst).not.toHaveBeenCalled();
  });

  it("trims before querying so ' UTR1 ' and 'UTR1' are the same reference", async () => {
    seed(TOPUP, [{ id: "t1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("  UTR1  ")).resolves.toMatchObject({ id: "t1" });
  });
});

describe("findReferenceConflict - what blocks", () => {
  it("blocks a reference settled on a top-up", async () => {
    seed(TOPUP, [{ id: "t1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toEqual({
      kind: "TOPUP",
      id: "t1",
      status: "VERIFIED",
    });
  });

  it("blocks a reference settled on a booking payment", async () => {
    seed(UPI, [{ id: "u1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({ kind: "UPI_PAYMENT" });
  });

  it("blocks a reference settled on a subscription payment", async () => {
    // This is the case that was missing everywhere: subscription held money
    // references that no other caller looked at.
    seed(SUB, [{ id: "s1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({
      kind: "SUBSCRIPTION_PAYMENT",
    });
  });

  it("blocks a reference still awaiting verification", async () => {
    seed(TOPUP, [{ id: "t1", status: "VERIFICATION_PENDING", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({
      status: "VERIFICATION_PENDING",
    });
  });

  it("blocks a status it has never seen, rather than letting it through", async () => {
    // The rule is "everything except REJECTED", not a list of known statuses. A
    // false "already used" costs a support ticket; a false clear costs crediting
    // the wrong wallet.
    seed(UPI, [{ id: "u1", status: "SOMETHING_NEW", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({
      status: "SOMETHING_NEW",
    });
  });

  it("excludes REJECTED so a corrected UTR can still be entered", async () => {
    // A rejection means a human said no, usually because the UTR was mistyped.
    // If rejection burned the reference permanently, one typo would make the
    // correct reference unenterable forever.
    seed(TOPUP, [{ id: "t1", status: "REJECTED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toBeNull();
  });

  it("blocks when a different table holds the same reference even if one table only rejected it", async () => {
    seed(TOPUP, [{ id: "t1", status: "REJECTED", referenceNumber: "UTR1" }]);
    seed(SUB, [{ id: "s1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({
      kind: "SUBSCRIPTION_PAYMENT",
    });
  });
});

describe("findReferenceConflict - stable reporting", () => {
  it("names the subscription conflict first when several tables collide", async () => {
    // Query resolution order is not deterministic enough to expose to a user:
    // the message has to name the same table every time.
    seed(TOPUP, [{ id: "t1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    seed(UPI, [{ id: "u1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    seed(SUB, [{ id: "s1", status: "VERIFIED", referenceNumber: "UTR1" }]);

    for (let i = 0; i < 5; i++) {
      await expect(findReferenceConflict("UTR1")).resolves.toMatchObject({
        kind: "SUBSCRIPTION_PAYMENT",
      });
    }
  });
});

describe("findReferenceConflict - excluding the row being checked", () => {
  it("does not report the row's own reference as a conflict", async () => {
    // Admin verification reads a reference that is already stored on the row it
    // is verifying. Without the exclusion every verification would refuse itself.
    seed(SUB, [{ id: "row-being-verified", status: "VERIFICATION_PENDING", referenceNumber: "UTR1" }]);
    await expect(
      findReferenceConflict("UTR1", { excludeId: "row-being-verified" }),
    ).resolves.toBeNull();
  });

  it("applies the exclusion to every table, not only its own", async () => {
    // Ids are unique across tables, so a single not-equals is correct and
    // forgetting one of the three would leave a hole exactly where a cross-table
    // clash lives.
    seed(TOPUP, [{ id: "row-1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    seed(UPI, [{ id: "row-1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    seed(SUB, [{ id: "row-1", status: "VERIFIED", referenceNumber: "UTR1" }]);

    await expect(findReferenceConflict("UTR1", { excludeId: "row-1" })).resolves.toBeNull();

    for (const model of [TOPUP, UPI, SUB]) {
      expect(model.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: { not: "row-1" } }) }),
      );
    }
  });

  it("still finds a clash in another row while excluding its own", async () => {
    // The exclusion must be narrow: it releases this row, not the reference.
    seed(SUB, [
      { id: "row-being-verified", status: "VERIFICATION_PENDING", referenceNumber: "UTR1" },
      { id: "somewhere-else", status: "VERIFIED", referenceNumber: "UTR1" },
    ]);
    await expect(
      findReferenceConflict("UTR1", { excludeId: "row-being-verified" }),
    ).resolves.toMatchObject({ id: "somewhere-else" });
  });

  it("omits the exclusion entirely when no id is given", async () => {
    await findReferenceConflict("UTR1");
    expect(TOPUP.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.not.objectContaining({ id: expect.anything() }) }),
    );
  });
});

describe("referenceConflictMessage", () => {
  it("names the table the clash is actually in", async () => {
    // Every caller used to print its own wording, and two of them named only
    // their own table - so a clash against a booking sent the user to the
    // top-up screen.
    seed(TOPUP, [{ id: "t1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    expect(referenceConflictMessage((await findReferenceConflict("UTR1"))!)).toMatch(
      /wallet top-up/,
    );

    allFree();
    seed(UPI, [{ id: "u1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    expect(referenceConflictMessage((await findReferenceConflict("UTR1"))!)).toMatch(
      /booking payment/,
    );

    allFree();
    seed(SUB, [{ id: "s1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    expect(referenceConflictMessage((await findReferenceConflict("UTR1"))!)).toMatch(
      /subscription payment/,
    );
  });

  it("says the reference can only be used once", async () => {
    seed(TOPUP, [{ id: "t1", status: "VERIFIED", referenceNumber: "UTR1" }]);
    expect(referenceConflictMessage((await findReferenceConflict("UTR1"))!)).toMatch(
      /only be used once/,
    );
  });
});

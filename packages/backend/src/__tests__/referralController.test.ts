import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Referral codes and the reward they pay out.
 *
 * The code itself is derived rather than stored - "RB-" plus the first 8
 * characters of the referrer's uuid - so almost every branch here is about
 * resolving that prefix back to exactly one person, and about the reward
 * settling once and only once. Both are worth pinning: a prefix that resolves
 * to nobody means a user shares a code that never works, and a reward that
 * settles twice is a wallet crediting itself out of thin air.
 *
 * The format regex is matched against what the card actually issues. If the
 * two ever drift apart, every code in production becomes unenterable and
 * nothing throws - which is precisely the failure this file is here to catch.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    referral: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() },
    pricingConfig: { findUnique: vi.fn() },
    wallet: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    transaction: { create: vi.fn() },
    notification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import * as ctrl from "../controllers/referralController";

/** The issuing account: the first 8 hex chars are exactly RB-A1B2C3D4. */
const ME = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const MY_CODE = "RB-A1B2C3D4";
const REFERRER = "ff001122-3344-5566-7788-99aabbccddeeff";

type MockRes = {
  statusCode: number;
  payload: any;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

/**
 * `res` is typed `never` so it satisfies the controllers' express `Response`
 * parameter without recreating the whole Response surface here (the repo's
 * other controller tests do the same with `res as never` at the call site).
 * Only `out` is ever read back, and that stays the literal the assertions
 * check against.
 */
function makeRes(): { res: never; out: MockRes } {
  const out: MockRes = {
    statusCode: 0,
    payload: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.payload = b;
      return this;
    },
  };
  return { res: out as unknown as never, out };
}

function makeReq(body: Record<string, unknown> = {}) {
  return { body, params: {}, user: { userId: ME } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.referral.count.mockResolvedValue(0);
  prismaMock.referral.findUnique.mockResolvedValue(null);
  prismaMock.referral.create.mockResolvedValue({ id: "ref_1" });
  prismaMock.referral.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.pricingConfig.findUnique.mockResolvedValue(null);
  prismaMock.wallet.findUnique.mockResolvedValue({ id: "wal_1" });
  prismaMock.wallet.create.mockResolvedValue({ id: "wal_1" });
  prismaMock.wallet.update.mockResolvedValue({});
  prismaMock.transaction.create.mockResolvedValue({});
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.$transaction.mockResolvedValue([]);
});

describe("getMyReferralProfile", () => {
  it("issues a code derived from the account id", async () => {
    const { res, out } = makeRes();
    await ctrl.getMyReferralProfile(makeReq(), res);
    expect(out.payload.success).toBe(true);
    expect(out.payload.data.code).toBe(MY_CODE);
  });

  it("reports no redeemed code for an account that has none", async () => {
    const { res, out } = makeRes();
    await ctrl.getMyReferralProfile(makeReq(), res);
    expect(out.payload.data.referredByCode).toBeNull();
  });

  it("reports the code this account redeemed", async () => {
    // Drives whether the card offers an input at all; without it the card
    // keeps offering one that can only ever answer ALREADY_REFERRED.
    prismaMock.referral.findUnique.mockResolvedValue({ code: "RB-FF001122" });
    const { res, out } = makeRes();
    await ctrl.getMyReferralProfile(makeReq(), res);
    expect(out.payload.data.referredByCode).toBe("RB-FF001122");
    expect(prismaMock.referral.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referredId: ME } }),
    );
  });

  it("counts invites and rewards separately", async () => {
    prismaMock.referral.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2);
    const { res, out } = makeRes();
    await ctrl.getMyReferralProfile(makeReq(), res);
    expect(out.payload.data.stats).toEqual({ invited: 4, completed: 2 });
  });

  it("answers 500 rather than leaking the failure", async () => {
    prismaMock.referral.count.mockRejectedValue(new Error("db down"));
    const { res, out } = makeRes();
    await ctrl.getMyReferralProfile(makeReq(), res);
    expect(out.statusCode).toBe(500);
    expect(out.payload.success).toBe(false);
  });
});

describe("applyReferralCode - what it refuses", () => {
  it("rejects anything not in the shape it issues", async () => {
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: "RB-TOOSHORT" }), res);
    expect(out.statusCode).toBe(400);
    expect(out.payload.error).toBe("INVALID_CODE");
    // No query, no row: a malformed code must not reach the database.
    expect(prismaMock.referral.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it("rejects an empty code", async () => {
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: "   " }), res);
    expect(out.payload.error).toBe("INVALID_CODE");
  });

  it("refuses a second code for the same account", async () => {
    prismaMock.referral.findUnique.mockResolvedValue({ id: "ref_0", code: "RB-FF001122" });
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);
    expect(out.statusCode).toBe(409);
    expect(out.payload.error).toBe("ALREADY_REFERRED");
    expect(prismaMock.referral.create).not.toHaveBeenCalled();
  });

  it("reports a code that matches nobody", async () => {
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: "RB-DEADBEEF" }), res);
    expect(out.statusCode).toBe(404);
    expect(out.payload.error).toBe("CODE_NOT_FOUND");
  });

  it("refuses an ambiguous prefix rather than picking one", async () => {
    // Two accounts sharing the first 8 uuid chars. Guessing here would credit
    // the wrong person's referral forever.
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);
    expect(out.statusCode).toBe(400);
    expect(out.payload.error).toBe("AMBIGUOUS_CODE");
    expect(prismaMock.referral.create).not.toHaveBeenCalled();
  });

  it("refuses your own code", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: ME }]);
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);
    expect(out.payload.error).toBe("SELF_REFERRAL");
    expect(prismaMock.referral.create).not.toHaveBeenCalled();
  });
});

describe("applyReferralCode - a code that works", () => {
  it("links the referrer and answers 201", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: REFERRER }]);
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);

    expect(out.statusCode).toBe(201);
    expect(out.payload.data.status).toBe("PENDING");
    expect(prismaMock.referral.create).toHaveBeenCalledWith({
      data: { referrerId: REFERRER, referredId: ME, code: MY_CODE },
    });
  });

  it("records who applied it", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: REFERRER }]);
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), makeRes().res);
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ actorId: ME, action: "REFERRAL_APPLY", entityId: "ref_1" });
    expect(JSON.parse(audit.metadata).referrerId).toBe(REFERRER);
  });

  it("normalises what was typed before looking it up", async () => {
    // Cards render uppercase and users paste lowercase from a message.
    prismaMock.user.findMany.mockResolvedValue([{ id: REFERRER }]);
    await ctrl.applyReferralCode(makeReq({ code: "  rb-a1b2c3d4 " }), makeRes().res);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { startsWith: "a1b2c3d4" } } }),
    );
  });

  it("answers 409 when the unique index beats the pre-check", async () => {
    // Two tabs submitting at once: the existence check sees nothing, the
    // database is what actually enforces one code per account. The referrer
    // has to resolve or the code answers CODE_NOT_FOUND first.
    prismaMock.user.findMany.mockResolvedValue([{ id: REFERRER }]);
    prismaMock.referral.create.mockRejectedValue({ code: "P2002" });
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);
    expect(out.statusCode).toBe(409);
    expect(out.payload.error).toBe("ALREADY_REFERRED");
  });

  it("does not fail an apply because the audit write failed", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: REFERRER }]);
    prismaMock.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    const { res, out } = makeRes();
    await ctrl.applyReferralCode(makeReq({ code: MY_CODE }), res);
    expect(out.payload.success).toBe(false);
    expect(out.statusCode).toBe(500);
    expect(prismaMock.referral.create).toHaveBeenCalledTimes(1);
  });
});

describe("buildReferralRewardService - settling exactly once", () => {
  function claimedReferral(over: Record<string, unknown> = {}) {
    prismaMock.referral.findUnique.mockResolvedValue({
      id: "ref_1",
      referrerId: REFERRER,
      referredId: ME,
      rewardClaimed: false,
      ...over,
    });
  }

  it("does nothing when the account was never referred", async () => {
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);
    expect(prismaMock.referral.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("does nothing when the reward was already claimed", async () => {
    claimedReferral({ rewardClaimed: true });
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("claims conditionally so a concurrent completion pays once", async () => {
    claimedReferral();
    prismaMock.referral.updateMany.mockResolvedValue({ count: 0 });
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);

    expect(prismaMock.referral.updateMany).toHaveBeenCalledWith({
      where: { id: "ref_1", rewardClaimed: false },
      data: { rewardClaimed: true },
    });
    // Lost the race: nothing read, nothing paid.
    expect(prismaMock.pricingConfig.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("pays both sides once the claim is taken", async () => {
    claimedReferral();
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    const increments = prismaMock.wallet.update.mock.calls.map(
      (c) => c[0].data.balance.increment,
    );
    expect(increments).toEqual([100, 50]);
    const transactions = prismaMock.transaction.create.mock.calls.map((c) => c[0].data);
    expect(transactions.map((t) => t.userId)).toEqual([REFERRER, ME]);
    expect(transactions.map((t) => t.type)).toEqual(["CREDIT", "CREDIT"]);
    // Each payout has its own ledger key, so a replay cannot add a second row.
    expect(transactions.map((t) => t.referenceId)).toEqual([
      "ref_1:REFERRER",
      "ref_1:REFEREE",
    ]);
  });

  it("pays nothing when both bonuses are configured as zero", async () => {
    claimedReferral();
    prismaMock.pricingConfig.findUnique.mockResolvedValue({ value: "0" });
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);

    expect(prismaMock.wallet.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    // Still claimed: a zero reward is a finished reward, not a pending one.
    expect(prismaMock.referral.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { rewardClaimed: true } }),
    );
  });

  it("never throws into the booking path that calls it", async () => {
    // settleReferralReward is fired with void after a booking completes; a
    // rejection here would surface as an unhandled rejection rather than as a
    // missing reward someone could investigate.
    claimedReferral();
    prismaMock.wallet.findUnique.mockRejectedValue(new Error("db down"));
    const settle = ctrl.buildReferralRewardService();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(settle(ME)).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("creates the missing wallet rather than dropping the reward", async () => {
    claimedReferral();
    prismaMock.wallet.findUnique.mockResolvedValue(null);
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);
    expect(prismaMock.wallet.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.wallet.update).toHaveBeenCalledTimes(2);
  });

  it("notifies both sides", async () => {
    claimedReferral();
    const settle = ctrl.buildReferralRewardService();
    await settle(ME);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    const bodies = prismaMock.notification.create.mock.calls.map((c) => c[0].data.body);
    expect(bodies[0]).toContain("100");
    expect(bodies[1]).toContain("50");
  });
});

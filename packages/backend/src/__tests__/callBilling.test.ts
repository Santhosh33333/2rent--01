/**
 * Metered call billing tests.
 *
 * These are money tests, so each one asserts a specific way a caller could be
 * charged wrongly or a reservation could leak:
 *
 *  - the hold must fail closed when funds are short, including when two calls
 *    race for the same balance
 *  - settlement must be idempotent, because end-of-call events arrive twice
 *  - the amount charged must never exceed the amount held
 *  - a client-supplied duration must be impossible to influence
 *
 * They run against the real local database (DATABASE_URL) because the whole
 * point of the guarded UPDATE is a database-level invariant that a mocked
 * client cannot exercise. Every test creates its own users and wallet and
 * cleans up after itself.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../config/database";
import {
  BillingError,
  getCallTerms,
  holdForCall,
  settleCall,
  releaseHold,
  getSpendableBalance,
  reconcileOrphanedHolds,
} from "../services/callBillingService";

const TEST_RATE = 1;
const TEST_MAX_MINUTES = 60;
const TERMS = { ratePerMinute: TEST_RATE, maxBillableMinutes: TEST_MAX_MINUTES, enabled: true };

/** Held amount for the test terms: 60 min at Rs 1 = Rs 60. */
const HOLD = 60;

let seq = 0;
function uniq(tag: string) {
  seq += 1;
  return `billing-${tag}-${Date.now()}-${seq}`;
}

async function makeUserWithBalance(tag: string, balance: number) {
  const id = uniq(tag);
  const email = `${id}@test.local`;
  // phone is the other unique column. Derive it from the same clock+seq as the
  // email so an interrupted earlier run (whose rows were never cleaned up)
  // cannot collide with this one. The old fixed-offset formula was stable
  // across runs, so one killed run made every later run fail.
  const phone = `+91${id.replace(/\D/g, "").slice(-10)}`;
  const user = await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash: "x",
      fullName: `Billing ${tag}`,
      // dateOfBirth is required by the schema; a fixed past date keeps these
      // fixtures deterministic.
      dateOfBirth: new Date("1995-01-01T00:00:00.000Z"),
      wallet: { create: { balance } },
    },
    include: { wallet: true },
  });
  return user;
}

async function makeRingingCall(callerId: string, receiverId: string) {
  return prisma.callLog.create({
    data: { callerId, receiverId, type: "VOICE", status: "RINGING" },
  });
}

/** Backdates a charge's startedAt so a call looks like it has been running. */
async function backdate(callId: string, seconds: number) {
  await prisma.callCharge.update({
    where: { callId },
    data: { startedAt: new Date(Date.now() - seconds * 1000) },
  });
}

const created: string[] = [];

afterAll(async () => {
  // CallCharge cascades from CallLog, and Wallet from User, so removing the
  // users removes everything this suite created.
  if (created.length) {
    await prisma.user.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});

describe("call billing terms", () => {
  it("reads the admin-configurable rate and falls back safely", async () => {
    const terms = await getCallTerms();
    expect(terms.ratePerMinute).toBeGreaterThanOrEqual(0);
    expect(terms.maxBillableMinutes).toBeGreaterThan(0);
    expect(terms.maxBillableMinutes).toBeLessThanOrEqual(600);
  });
});

describe("holding funds for a call", () => {
  it("reserves funds and reports them as held, not spendable", async () => {
    const caller = await makeUserWithBalance("hold-ok", 500);
    const receiver = await makeUserWithBalance("hold-ok-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    const res = await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    expect(res.heldAmount).toBe(HOLD);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(500);
    expect(bal!.held).toBe(HOLD);
    // The whole point: Rs 500 is not Rs 500 spendable while Rs 60 is reserved.
    expect(bal!.available).toBe(500 - HOLD);
  });

  it("refuses and holds nothing when the balance is short", async () => {
    const caller = await makeUserWithBalance("hold-short", 10);
    const receiver = await makeUserWithBalance("hold-short-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await expect(
      holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS })
    ).rejects.toThrow(BillingError);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.held).toBe(0);
    expect(bal!.balance).toBe(10);
    // And no charge row was left behind.
    expect(await prisma.callCharge.findUnique({ where: { callId: call.id } })).toBeNull();
  });

  it("does not let two concurrent calls both reserve the same balance", async () => {
    // Exactly one hold's worth of money. Two simultaneous calls each need Rs 60.
    const caller = await makeUserWithBalance("hold-race", HOLD);
    const receiver = await makeUserWithBalance("hold-race-recv", 0);
    created.push(caller.id, receiver.id);

    const c1 = await makeRingingCall(caller.id, receiver.id);
    const c2 = await makeRingingCall(caller.id, receiver.id);

    const results = await Promise.allSettled([
      holdForCall({ callId: c1.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS }),
      holdForCall({ callId: c2.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);

    const bal = await getSpendableBalance(caller.id);
    // Never negative, and never more than one hold outstanding.
    expect(bal!.held).toBe(HOLD);
    expect(bal!.available).toBe(0);
  });
});

describe("settling a call", () => {
  it("charges the billable minutes and returns the unused reservation", async () => {
    const caller = await makeUserWithBalance("settle-10min", 500);
    const receiver = await makeUserWithBalance("settle-10min-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    await backdate(call.id, 10 * 60 + 30); // 10m30s -> 10 billable minutes

    const r = await settleCall(call.id, "CLIENT_END");
    expect(r).not.toBeNull();
    expect(r!.billableSeconds).toBeGreaterThanOrEqual(10 * 60);
    expect(r!.charged).toBe(10);
    expect(r!.refunded).toBe(HOLD - 10);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(490); // 500 - 10 charged
    expect(bal!.held).toBe(0); // reservation fully returned
    expect(bal!.available).toBe(490);

    const ledger = await prisma.transaction.findMany({ where: { referenceId: call.id } });
    expect(ledger).toHaveLength(1);
    expect(Number(ledger[0].amount)).toBe(10);
  });

  it("is idempotent: a duplicate end event cannot double-charge", async () => {
    const caller = await makeUserWithBalance("settle-idem", 500);
    const receiver = await makeUserWithBalance("settle-idem-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    await backdate(call.id, 5 * 60);

    const first = await settleCall(call.id, "CLIENT_END");
    const second = await settleCall(call.id, "CLIENT_END"); // hangup racing disconnect
    const third = await settleCall(call.id, "PEER_END");

    expect(first!.charged).toBe(5);
    expect(second).toBeNull(); // refused, already settled
    expect(third).toBeNull();

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(495); // charged once
    expect(await prisma.transaction.count({ where: { referenceId: call.id } })).toBe(1);
  });

  it("never charges more than it held, however long the call looks", async () => {
    const caller = await makeUserWithBalance("settle-cap", 500);
    const receiver = await makeUserWithBalance("settle-cap-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    // 5 hours of call against a 60-minute ceiling.
    await backdate(call.id, 5 * 60 * 60);

    const r = await settleCall(call.id, "MAX_DURATION");
    expect(r!.charged).toBeLessThanOrEqual(HOLD);
    expect(r!.charged).toBe(HOLD);
    expect(r!.refunded).toBe(0);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(500 - HOLD);
    expect(bal!.held).toBe(0);
  });

  it("charges nothing for a call shorter than a minute and releases the hold", async () => {
    const caller = await makeUserWithBalance("settle-short", 500);
    const receiver = await makeUserWithBalance("settle-short-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    await backdate(call.id, 20); // 20 seconds

    const r = await settleCall(call.id, "CLIENT_END");
    expect(r!.charged).toBe(0);
    expect(r!.refunded).toBe(HOLD);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(500);
    expect(bal!.held).toBe(0);
    expect(await prisma.transaction.count({ where: { referenceId: call.id } })).toBe(0);
  });

  it("bills nothing for a clock that runs backwards", async () => {
    const caller = await makeUserWithBalance("settle-back", 500);
    const receiver = await makeUserWithBalance("settle-back-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    // startedAt in the future: elapsed is negative.
    await prisma.callCharge.update({
      where: { callId: call.id },
      data: { startedAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    const r = await settleCall(call.id, "CLIENT_END");
    expect(r!.charged).toBe(0);
    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(500);
    expect(bal!.available).toBeGreaterThanOrEqual(0);
  });
});

describe("releasing a hold", () => {
  it("returns the full reservation and charges nothing", async () => {
    const caller = await makeUserWithBalance("release", 500);
    const receiver = await makeUserWithBalance("release-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    await backdate(call.id, 30 * 60);

    const r = await releaseHold(call.id, "ABANDONED");
    expect(r!.refunded).toBe(HOLD);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(500);
    expect(bal!.held).toBe(0);
  });

  it("cannot release a hold that was already charged", async () => {
    const caller = await makeUserWithBalance("release-after", 500);
    const receiver = await makeUserWithBalance("release-after-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    await backdate(call.id, 5 * 60);
    await settleCall(call.id, "CLIENT_END");

    expect(await releaseHold(call.id, "ABANDONED")).toBeNull();
    const bal = await getSpendableBalance(caller.id);
    expect(bal!.balance).toBe(495); // the charge stands
  });
});

describe("reconciliation", () => {
  it("releases a reservation stranded by a crash, so money is not trapped", async () => {
    const caller = await makeUserWithBalance("orphan", 500);
    const receiver = await makeUserWithBalance("orphan-recv", 0);
    created.push(caller.id, receiver.id);

    const call = await makeRingingCall(caller.id, receiver.id);
    await holdForCall({ callId: call.id, callerId: caller.id, receiverId: receiver.id, terms: TERMS });
    // Old enough for the sweep, still HELD: the shape a deploy mid-call leaves.
    await prisma.callCharge.update({
      where: { callId: call.id },
      data: { startedAt: new Date(Date.now() - 6 * 60 * 60 * 1000) },
    });

    const released = await reconcileOrphanedHolds(120);
    expect(released).toBeGreaterThanOrEqual(1);

    const bal = await getSpendableBalance(caller.id);
    expect(bal!.held).toBe(0);
    expect(bal!.available).toBe(500);
  });
});

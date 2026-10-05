import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DEFAULT_SELF_DELETION_FROZEN_UNTIL,
  resolveFreezeUntil,
  selfDeletionGate,
  selfDeletionFrozenMessage,
} from "../services/accountDeletionPolicy";

/**
 * The account-deletion freeze.
 *
 * The property under test is that the freeze is a fixed WINDOW, not a rolling
 * one. A rolling window - `now + 3 months`, recomputed per request - would pass
 * every "is it blocked" assertion in this file and still be completely broken,
 * because it would never lift. So the tests below concentrate on the boundary
 * and on the default resolving to an absolute instant, not on a moving target.
 */

const FREEZE_UNTIL = new Date("2027-01-04T00:00:00.000Z");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveFreezeUntil", () => {
  it("defaults to an absolute date, not a rolling offset", () => {
    const resolved = resolveFreezeUntil();
    // The whole point: a concrete instant, not `new Date() + n`.
    expect(resolved.toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(resolved.getTime()).toBe(
      new Date(`${DEFAULT_SELF_DELETION_FROZEN_UNTIL}T00:00:00.000Z`).getTime(),
    );
  });

  it("returns the same instant no matter when it is called", () => {
    // If this ever changes, the freeze has become rolling and will never lift.
    expect(resolveFreezeUntil().getTime()).toBe(resolveFreezeUntil().getTime());
  });

  it("accepts an explicit override so lifting the freeze is a config change", () => {
    expect(resolveFreezeUntil("2028-06-30").toISOString()).toBe("2028-06-30T00:00:00.000Z");
  });

  it("fails CLOSED on an unparseable value", () => {
    // The dangerous direction. A typo in configuration must never be
    // interpreted as "no freeze", because that silently re-opens deletion.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveFreezeUntil("not-a-date").toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(resolveFreezeUntil("").toISOString()).toBe("2027-01-04T00:00:00.000Z");
    expect(resolveFreezeUntil(null).toISOString()).toBe("2027-01-04T00:00:00.000Z");
  });

  it("warns loudly rather than silently swallowing a bad config", () => {
    // Silent fallback is how a freeze quietly disappears from a deployment.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveFreezeUntil("31/02/2027");
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("SELF_DELETION_FROZEN_UNTIL");
  });
});

describe("selfDeletionGate", () => {
  it("blocks self-deletion today", () => {
    const gate = selfDeletionGate(new Date("2026-10-04T12:00:00.000Z"), FREEZE_UNTIL);
    expect(gate.allowed).toBe(false);
  });

  it("blocks for the whole window", () => {
    for (const at of [
      "2026-10-04T00:00:00.000Z",
      "2026-11-15T23:59:59.999Z",
      "2026-12-31T00:00:00.000Z",
      "2027-01-03T00:00:00.000Z",
    ]) {
      expect(selfDeletionGate(new Date(at), FREEZE_UNTIL).allowed).toBe(false);
    }
  });

  it("never throws, whatever it is handed", () => {
    // A throw here is swallowed by the controller's catch and reported as
    // "Failed to delete account" - which reads as a server fault but actually
    // means the lock silently did not apply. The gate has to be total.
    for (const bad of [new Date("nonsense"), new Date(NaN)]) {
      expect(() => selfDeletionGate(bad, FREEZE_UNTIL)).not.toThrow();
    }
    expect(() => selfDeletionGate(new Date(), new Date("nonsense"))).not.toThrow();
  });

  it("fails CLOSED when the clock is unusable", () => {
    // An invalid `now` means the comparison is NaN, and `NaN < x` is false -
    // which would fall through to allowed:true and unlock deletion. The lock must
    // stay shut when the gate cannot reason about time.
    expect(selfDeletionGate(new Date(NaN), FREEZE_UNTIL).allowed).toBe(false);
    expect(selfDeletionGate(new Date("nonsense"), FREEZE_UNTIL).allowed).toBe(false);
  });

  it("fails CLOSED when the freeze date itself is unusable", () => {
    expect(selfDeletionGate(new Date(), new Date(NaN)).allowed).toBe(false);
  });

  it("opens on the stated date itself, not a day later", () => {
    // Boundary. The user was told "paused until 4 January 2027", so deletion has
    // to be available ON 4 January 2027. A `<=` here would hold the lock for an
    // extra day and make the app contradict the date it just displayed.
    expect(selfDeletionGate(new Date("2027-01-04T00:00:00.000Z"), FREEZE_UNTIL).allowed).toBe(true);
  });

  it("still blocks one millisecond before the freeze ends", () => {
    expect(selfDeletionGate(new Date("2027-01-03T23:59:59.999Z"), FREEZE_UNTIL).allowed).toBe(false);
  });

  it("allows deletion once the window has passed", () => {
    expect(selfDeletionGate(new Date("2027-06-01T00:00:00.000Z"), FREEZE_UNTIL).allowed).toBe(true);
  });

  it("returns a machine-readable code and an actionable message", () => {
    const gate = selfDeletionGate(new Date("2026-10-04T12:00:00.000Z"), FREEZE_UNTIL);
    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error("expected the gate to be closed");
    expect(gate.code).toBe("SELF_DELETION_FROZEN");
    // The user has to be told what to do instead, or the screen is a dead end.
    expect(gate.message).toMatch(/administrator/i);
    expect(gate.message).toMatch(/support/i);
  });
});

describe("selfDeletionFrozenMessage", () => {
  it("names the date the user is waiting for", () => {
    // "Three months" is not something a user can hold on to. An explicit date is
    // the actionable form.
    expect(selfDeletionFrozenMessage(FREEZE_UNTIL)).toContain("4 January 2027");
  });

  it("does not leak an internal identifier", () => {
    const msg = selfDeletionFrozenMessage(FREEZE_UNTIL);
    expect(msg).not.toMatch(/SELF_DELETION_FROZEN_UNTIL/);
    expect(msg).not.toMatch(/2027-01-04T/);
  });
});

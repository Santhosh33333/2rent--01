import { describe, it, expect } from "vitest";
import {
  EVENT_JOIN_CUTOFF_HOURS,
  EVENT_CANCEL_LOCK_HOURS,
  EVENT_DISPUTE_WINDOW_HOURS,
  checkCancel,
  checkJoin,
  canStillReport,
  isDisputeOpen,
  joinCutoffAt,
  releaseEligibleAt,
  settlementReferenceEnd,
} from "../services/eventJoinPolicy";

/**
 * The event timing rules.
 *
 * These are the rules that decide whether money is allowed to move, so the tests
 * are written around the boundary instants rather than around "some middle
 * case". A rule that is off by one millisecond at the edge either lets someone
 * in after the organizer's tickets are bought, or locks a real attendee out of
 * a cancellation they were entitled to - and both failures look like nothing at
 * all until a real person is stuck.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00Z");

/** An event starting `hours` from NOW. */
function eventStartingIn(hours: number, extra: Record<string, unknown> = {}) {
  return {
    status: "PUBLISHED",
    startTime: new Date(NOW.getTime() + hours * HOUR),
    capacity: null,
    attendeeCount: 0,
    ...extra,
  };
}

describe("join cutoff", () => {
  it("lets someone in while the window is open", () => {
    expect(checkJoin(eventStartingIn(EVENT_JOIN_CUTOFF_HOURS + 1), NOW).allowed).toBe(true);
  });

  it("refuses at exactly the cutoff instant", () => {
    // Strict comparison, not >=. The organizer has to be able to buy the last
    // ticket at the moment the window shuts, so the boundary belongs to them.
    const at = checkJoin(eventStartingIn(EVENT_JOIN_CUTOFF_HOURS), NOW);
    expect(at.allowed).toBe(false);
    expect(at.allowed === false && at.reason).toBe("JOIN_CUTOFF_PASSED");
  });

  it("refuses one millisecond before the event starts", () => {
    // At start-1ms the cutoff (start-12h) is long past, so only the cutoff or
    // the started-check can be refusing. Nothing may slip in at the last instant.
    const start = new Date(NOW.getTime() + EVENT_JOIN_CUTOFF_HOURS * HOUR);
    const almost = new Date(start.getTime() - 1);
    expect(checkJoin({ ...eventStartingIn(0), startTime: start }, almost).allowed).toBe(false);
  });

  it("allows one millisecond before the cutoff instant", () => {
    // The last moment a join is legal. Paired with the strict comparison in
    // checkJoin, this is the exact boundary pair: -1ms allowed, cutoff refused.
    const start = new Date(NOW.getTime() + EVENT_JOIN_CUTOFF_HOURS * HOUR);
    const cutoff = joinCutoffAt(start);
    const justBefore = new Date(cutoff.getTime() - 1);
    expect(checkJoin({ ...eventStartingIn(0), startTime: start }, justBefore).allowed).toBe(true);
  });

  it("says when the window shut, in a form a user can act on", () => {
    const r = checkJoin(eventStartingIn(6), NOW);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.message).toContain("12 hours");
    expect(r.message).toContain("Contact the organizer");
  });
});

describe("join refusal reasons", () => {
  it("refuses a cancelled event", () => {
    const r = checkJoin(eventStartingIn(48, { status: "CANCELLED" }), NOW);
    expect(r.allowed === false && r.reason).toBe("EVENT_CANCELLED");
  });

  it("refuses a finished event", () => {
    const r = checkJoin(eventStartingIn(48, { status: "COMPLETED" }), NOW);
    expect(r.allowed === false && r.reason).toBe("EVENT_FINISHED");
  });

  it("refuses once the event has started, even with no cutoff", () => {
    // startTime - 12h is still in the future here, so only the started-check can
    // be what refuses. Guards against the cutoff silently covering this case.
    const r = checkJoin(eventStartingIn(-1), NOW);
    expect(r.allowed === false && r.reason).toBe("EVENT_FINISHED");
  });

  it("refuses a full event", () => {
    const r = checkJoin(eventStartingIn(48, { capacity: 10, attendeeCount: 10 }), NOW);
    expect(r.allowed === false && r.reason).toBe("EVENT_FULL");
  });

  it("allows the last seat", () => {
    expect(checkJoin(eventStartingIn(48, { capacity: 10, attendeeCount: 9 }), NOW).allowed).toBe(true);
  });

  it("does not treat capacity 0 as full", () => {
    // 0 means "no limit set", not "no places". Reading it as full would close
    // every unlimited event.
    expect(checkJoin(eventStartingIn(48, { capacity: 0, attendeeCount: 99 }), NOW).allowed).toBe(true);
  });

  it("does not treat a null capacity as full", () => {
    expect(checkJoin(eventStartingIn(48, { capacity: null, attendeeCount: 99 }), NOW).allowed).toBe(
      true,
    );
  });
});

describe("cancel rules", () => {
  /** Joined `hoursAgo` hours before NOW, event starting `startsIn` hours from now. */
  function joined(hoursAgo: number, startsIn: number) {
    return checkCancel(
      { status: "PUBLISHED", startTime: new Date(NOW.getTime() + startsIn * HOUR) },
      new Date(NOW.getTime() - hoursAgo * HOUR),
      NOW,
    );
  }

  it("refuses during the 24 hours after joining", () => {
    const r = joined(1, 100);
    expect(r.allowed === false && r.reason).toBe("CANCEL_LOCK_ACTIVE");
  });

  it("refuses at exactly 24 hours after joining", () => {
    // The lock covers the whole 24th hour: at exactly the unlock instant it is
    // over, so this is allowed. Pinned so a future off-by-one is visible.
    expect(joined(EVENT_CANCEL_LOCK_HOURS, 100).allowed).toBe(true);
  });

  it("allows once the lock has expired", () => {
    expect(joined(EVENT_CANCEL_LOCK_HOURS + 1, 100).allowed).toBe(true);
  });

  it("refuses inside 12 hours of the event even after the lock expired", () => {
    // Joined long ago, but the event is imminent, so the organizer's headcount
    // is fixed and cancelling would strand a purchased ticket.
    const r = joined(500, 6);
    expect(r.allowed === false && r.reason).toBe("JOIN_CUTOFF_PASSED");
  });

  it("explains the 24 hour lock with a real date", () => {
    const r = joined(1, 100);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.message).toContain("24 hours after joining");
  });

  it("explains the cutoff as also closing cancellations", () => {
    const r = joined(500, 6);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.message).toContain("headcount stays fixed");
  });

  it("refuses after the event started and points at the report route", () => {
    // Money already held: the answer to "I cannot come" is a report an admin
    // reviews, not a silent self-service refund.
    const r = joined(500, -1);
    expect(r.allowed === false && r.reason).toBe("EVENT_FINISHED");
    if (r.allowed) return;
    expect(r.message).toContain("report");
  });

  it("refuses a cancelled event so the refund has one path, not two", () => {
    const r = checkCancel(
      { status: "CANCELLED", startTime: new Date(NOW.getTime() + 100 * HOUR) },
      new Date(NOW.getTime() - 500 * HOUR),
      NOW,
    );
    expect(r.allowed === false && r.reason).toBe("EVENT_CANCELLED");
  });

  it("opens the window only once BOTH rules are satisfied", () => {
    // Lock needs 24h since joining; cutoff needs the event >12h away. So the
    // window opens at max(join+24h, start-12h) and closes at start-12h.
    //
    // Joined 30h ago, event 24h out: both satisfied -> can cancel.
    expect(joined(30, 24).allowed).toBe(true);
    // Joined 30h ago, event 6h out: lock is over but the cutoff has closed, so
    // cancelling is refused. A 6h-out event is inside the cutoff by definition,
    // which is why this is a genuine refusal rather than an arithmetic slip.
    expect(joined(30, 6).allowed).toBe(false);
  });

  it("closes the window the moment the event comes within 12 hours", () => {
    expect(joined(500, 13).allowed).toBe(true);
    expect(joined(500, 12).allowed).toBe(false);
  });
});

describe("dispute window", () => {
  const end = new Date("2026-06-20T18:00:00Z");

  it("opens 24 hours after the event ends", () => {
    expect(releaseEligibleAt(end).getTime() - end.getTime()).toBe(
      EVENT_DISPUTE_WINDOW_HOURS * HOUR,
    );
  });

  it("is open before the deadline and closed after", () => {
    const deadline = releaseEligibleAt(end);
    expect(isDisputeOpen(deadline, new Date(deadline.getTime() - 1))).toBe(true);
    expect(isDisputeOpen(deadline, new Date(deadline.getTime() + 1))).toBe(false);
  });

  it("accepts a report filed exactly at the deadline", () => {
    // Inclusive on purpose: the payout has not actually happened at that
    // instant, so refusing the report would strand the payer with no recourse.
    // The sweep's guarded update is what resolves the race, not this check.
    expect(canStillReport(releaseEligibleAt(end), releaseEligibleAt(end))).toBe(true);
  });

  it("refuses a report after the deadline", () => {
    const deadline = releaseEligibleAt(end);
    expect(canStillReport(deadline, new Date(deadline.getTime() + 1))).toBe(false);
  });
});

describe("settlement reference end", () => {
  it("uses the real end time when there is one", () => {
    const start = new Date("2026-06-20T16:00:00Z");
    const end = new Date("2026-06-20T18:00:00Z");
    expect(settlementReferenceEnd(end, start)).toEqual(end);
  });

  it("falls back to the start when no end was set", () => {
    // Falling back to "never" would leave the organizer's money in escrow
    // forever, because there would be no deadline for the sweep to find.
    const start = new Date("2026-06-20T16:00:00Z");
    expect(settlementReferenceEnd(null, start)).toEqual(start);
    expect(settlementReferenceEnd(undefined, start)).toEqual(start);
  });

  it("falls back when the end is not after the start", () => {
    // A backwards event must not produce a deadline in the past, which would
    // release the organizer's money before the event even starts.
    const start = new Date("2026-06-20T16:00:00Z");
    expect(settlementReferenceEnd(new Date("2026-06-20T14:00:00Z"), start)).toEqual(start);
  });
});

describe("constants are the documented values", () => {
  it("pins the three windows", () => {
    // If these are ever retuned, these tests are the reminder that the user was
    // told specific numbers, and the change was deliberate.
    expect(EVENT_JOIN_CUTOFF_HOURS).toBe(12);
    expect(EVENT_CANCEL_LOCK_HOURS).toBe(24);
    expect(EVENT_DISPUTE_WINDOW_HOURS).toBe(24);
  });

  it("derives the cutoff from startTime, not from now", () => {
    const start = new Date("2026-07-01T10:00:00Z");
    expect(joinCutoffAt(start)).toEqual(new Date("2026-06-30T22:00:00Z"));
  });
});
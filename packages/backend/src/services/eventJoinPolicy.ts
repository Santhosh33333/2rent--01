/**
 * Nabri event join / cancel / dispute policy.
 *
 * These are the four timing rules that decide when money may move, and they are
 * separated from the database code on purpose. Each one is a pure function of
 * (event, attendee, now), so the rules can be tested exhaustively and read in
 * one place instead of being scattered as inline `if` statements across the
 * controller - which is how the original bug became invisible.
 *
 * The four rules, and why each exists:
 *
 *  1. JOIN CUTOFF (12h before start)
 *     Once an event is inside 12 hours, the organizer has to commit: tickets
 *     bought, table booked, ride arranged. Accepting another attendee after that
 *     point hands the organizer money and cost they cannot plan for. So joining
 *     CLOSES 12 hours before the event starts, rather than running until the
 *     event begins.
 *
 *  2. CANCEL LOCK (24h after join)
 *     A user cannot cancel during the first 24 hours of their own attendance.
 *     Without this, "join then immediately cancel" is free churn that damages
 *     the organizer's committed headcount while still being listed as a
 *     registrant. The lock is deliberately on the JOIN time, not the event
 *     time, so it protects the organizer right after someone signs up.
 *
 *     Both rules apply together: cancelling is possible only in the overlap
 *     between (24h after joining) and (12h before the event). For an event
 *     created less than a day out, that overlap can legitimately be empty, and
 *     the service says so in plain words rather than a generic "not allowed".
 *
 *  3. DISPUTE WINDOW (24h after the event ends)
 *     The organizer's money stays in escrow until 24 hours after the event
 *     finishes. Inside that window an attendee can report the event as fake or
 *     as never happening, which freezes the payout for an admin to decide.
 *     After the window closes clean, the money is released automatically - no
 *     human in the loop, because the alternative is organizers waiting on a
 *     manual payout queue forever.
 *
 *  4. The escrow release deadline is fixed when the hold is created, not
 *     recomputed later, so retuning these constants for future events cannot
 *     move a deadline that a payer is already counting on.
 */

/** Hours before `startTime` at which joining closes. */
export const EVENT_JOIN_CUTOFF_HOURS = 12;

/** Hours after joining during which cancelling is locked. */
export const EVENT_CANCEL_LOCK_HOURS = 24;

/** Hours after the event ends before held money auto-releases to the organizer. */
export const EVENT_DISPUTE_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

function hoursFromNow(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

/**
 * Last moment at which a new attendee may join.
 *
 * Returns the cutoff instant itself, and the join is refused AT that instant:
 * `joinAt <= cutoff` would let someone in during the exact millisecond the
 * window closes, so the comparison is strict.
 */
export function joinCutoffAt(startTime: Date): Date {
  return new Date(startTime.getTime() - EVENT_JOIN_CUTOFF_HOURS * HOUR_MS);
}

/** First moment at which the payer's held fee may be released to the organizer. */
export function releaseEligibleAt(endTime: Date): Date {
  return hoursFromNow(endTime, EVENT_DISPUTE_WINDOW_HOURS);
}

/**
 * What the event's end time is for settlement purposes.
 *
 * `Event.endTime` is nullable - an organizer may never have set one. Falling
 * back to `startTime` is correct rather than a guess: an event with no end time
 * is treated as having finished when it began, so its dispute window opens
 * immediately instead of never opening and stranding the organizer's money.
 */
export function settlementReferenceEnd(endTime: Date | null | undefined, startTime: Date): Date {
  return endTime && endTime.getTime() > startTime.getTime() ? endTime : startTime;
}

export type JoinRefusal =
  | "EVENT_CANCELLED"
  | "EVENT_FINISHED"
  | "JOIN_CUTOFF_PASSED"
  | "EVENT_FULL";

export type CancelRefusal =
  | "NOT_REGISTERED"
  | "EVENT_CANCELLED"
  | "CANCEL_LOCK_ACTIVE"
  | "JOIN_CUTOFF_PASSED"
  | "EVENT_FINISHED";

export type Check<T> = { allowed: true } | { allowed: false; reason: T; message: string };

/** Human phrasing for a cutoff, so the UI never has to rebuild it from hours. */
export function cutoffMessage(startTime: Date): string {
  const when = joinCutoffAt(startTime);
  return (
    `Joining closes 12 hours before the event starts, at ${when.toUTCString()}. ` +
    `Contact the organizer directly if you need to come after that.`
  );
}

export function cancelLockMessage(joinedAt: Date): string {
  return (
    `You can cancel from ${hoursFromNow(joinedAt, EVENT_CANCEL_LOCK_HOURS).toUTCString()} ` +
    `(24 hours after joining). This stops join-and-immediately-drop churn for the organizer.`
  );
}

/**
 * Can `now` join this event?
 *
 * Pure. A caller that only needs a yes/no uses `.allowed`; a caller that has to
 * explain itself uses `reason` and `message` so every surface (HTTP, bot, UI)
 * gives the user the same real reason instead of a bare 403.
 */
export function checkJoin(
  event: {
    status: string;
    startTime: Date;
    capacity?: number | null;
    attendeeCount?: number | null;
  },
  now: Date,
): Check<JoinRefusal> {
  if (event.status === "CANCELLED") {
    return { allowed: false, reason: "EVENT_CANCELLED", message: "This event has been cancelled." };
  }
  if (event.status === "COMPLETED") {
    return { allowed: false, reason: "EVENT_FINISHED", message: "This event has already finished." };
  }
  if (now.getTime() >= event.startTime.getTime()) {
    return { allowed: false, reason: "EVENT_FINISHED", message: "This event has already started." };
  }
  if (now.getTime() >= joinCutoffAt(event.startTime).getTime()) {
    return { allowed: false, reason: "JOIN_CUTOFF_PASSED", message: cutoffMessage(event.startTime) };
  }
  if (
    typeof event.capacity === "number" &&
    event.capacity > 0 &&
    typeof event.attendeeCount === "number" &&
    event.attendeeCount >= event.capacity
  ) {
    return { allowed: false, reason: "EVENT_FULL", message: "This event is already full." };
  }
  return { allowed: true };
}

/**
 * Can this attendee cancel?
 *
 * `joinedAt` is `EventAttendee.createdAt`. Both the 24-hour join lock and the
 * 12-hour cutoff apply, and each gets its own message, because "you cannot
 * cancel" is not actionable while "you cannot cancel for 24 hours after
 * joining, until 6 hours before the event" is.
 */
export function checkCancel(
  event: { status: string; startTime: Date },
  joinedAt: Date,
  now: Date,
): Check<CancelRefusal> {
  if (event.status === "CANCELLED") {
    // The event is off; the money is refunded by the settlement sweep, not by a
    // per-person cancel. Refusing here stops a double path to the same refund.
    return { allowed: false, reason: "EVENT_CANCELLED", message: "This event has been cancelled." };
  }
  if (now.getTime() >= event.startTime.getTime()) {
    return {
      allowed: false,
      reason: "EVENT_FINISHED",
      message:
        "This event has already started. If you cannot attend, report it from the event page so an admin can review your money.",
    };
  }
  const unlocksAt = hoursFromNow(joinedAt, EVENT_CANCEL_LOCK_HOURS);
  if (now.getTime() < unlocksAt.getTime()) {
    return { allowed: false, reason: "CANCEL_LOCK_ACTIVE", message: cancelLockMessage(joinedAt) };
  }
  if (now.getTime() >= joinCutoffAt(event.startTime).getTime()) {
    return {
      allowed: false,
      reason: "JOIN_CUTOFF_PASSED",
      message:
        cutoffMessage(event.startTime) +
        " Cancelling is closed on the same schedule, so the organizer's headcount stays fixed.",
    };
  }
  return { allowed: true };
}

/**
 * Is the dispute window still open for this event?
 *
 * The check is against the FIXED `releaseEligibleAt` stored on the escrow row,
 * not a freshly computed deadline, so a payer is judged by the deadline that
 * was shown to them at payment time.
 */
export function isDisputeOpen(releaseEligibleAt: Date, now: Date): boolean {
  return now.getTime() < releaseEligibleAt.getTime();
}

/**
 * Can a report still be filed?
 *
 * Reports are accepted up to the same instant the money auto-releases, and
 * including that instant is deliberate: somebody who reports at the boundary
 * must not be told "too late" while the payout has not actually happened yet.
 * The sweep claims the escrow with a guarded update, so a report that wins the
 * race freezes the money and the sweep's update simply affects zero rows.
 */
export function canStillReport(releaseEligibleAt: Date, now: Date): boolean {
  return now.getTime() <= releaseEligibleAt.getTime();
}
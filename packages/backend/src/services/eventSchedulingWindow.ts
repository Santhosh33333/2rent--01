/**
 * Nabri event scheduling window.
 *
 * Rule: an event may not run past 22:00 (10:00 PM). This is enforced on both
 * create and update so the limit cannot be bypassed by editing an event after
 * it exists.
 *
 * The boundary is evaluated in UTC, matching the time-of-day filter, so the
 * meaning of "10 PM" does not drift with the server's host timezone. Events
 * carry an optional `timezone`; when it is absent the UTC rule is the contract
 * and the API documents it via EVENT_MAX_END_HOUR_UTC.
 */
export const EVENT_MAX_END_HOUR_UTC = 22;
export const EVENT_MAX_END_MINUTE_UTC = 0;

export const EVENT_LATE_END_MESSAGE =
  "Events cannot end after 10:00 PM. Please set the end time to 10:00 PM or earlier.";

export class EventWindowError extends Error {
  readonly code = "EVENT_AFTER_HOURS";

  constructor(message: string = EVENT_LATE_END_MESSAGE) {
    super(message);
    this.name = "EventWindowError";
  }
}

/** Latest permitted end instant, on the same calendar day as the start. */
export function getEventMaxEnd(startTime: Date): Date {
  const end = new Date(startTime.getTime());
  end.setUTCHours(EVENT_MAX_END_HOUR_UTC, EVENT_MAX_END_MINUTE_UTC, 0, 0);
  // A start already at/after the cutoff leaves no same-day room; the caller
  // reports the ordering error instead of silently pushing into tomorrow.
  return end;
}

export function isEventEndWithinHours(startTime: Date, endTime: Date): boolean {
  if (endTime.getTime() <= startTime.getTime()) return false; // invalid ordering
  return endTime.getTime() <= getEventMaxEnd(startTime).getTime();
}

export function assertEventWithinHours(startTime: Date, endTime: Date | null | undefined): void {
  if (!endTime) return; // no explicit end time means the event has no late run
  if (!isEventEndWithinHours(startTime, endTime)) {
    throw new EventWindowError();
  }
}

/**
 * Nabri event scheduling window.
 *
 * Rule: an event runs between 06:00 and 22:00 LOCAL time - it may not start
 * before 6 AM, may not end after 10 PM, and may not cross midnight. Enforced on
 * both create and update so the limit cannot be bypassed by editing an event
 * after it exists.
 *
 * This used to be a 22:00 UTC cap. For an India-only product that is simply the
 * wrong boundary: IST is UTC+5:30, so "22:00 UTC" let an event that starts at
 * 2 AM run until half past three in the morning, and rejected a perfectly
 * ordinary 9 PM movie showtime. The boundary is now the wall clock of the
 * event's own timezone, which is what every other part of the app displays.
 */
import {
  DEFAULT_APP_TIMEZONE,
  instantAtLocalHourOnDayOf,
  resolveTimeZone,
} from "./localTime";

/** Event day starts at 6:00 AM local. */
export const EVENT_MIN_START_HOUR = 6;
/** Event day ends at 10:00 PM local. */
export const EVENT_MAX_END_HOUR = 22;

/** Fallback when an event carries no usable timezone. */
export const DEFAULT_EVENT_TIMEZONE = DEFAULT_APP_TIMEZONE;

export const EVENT_LATE_END_MESSAGE =
  "Events have to finish by 10:00 PM. Please set the end time to 10:00 PM or earlier.";

export const EVENT_EARLY_START_MESSAGE =
  "Events cannot start before 6:00 AM. Please set a start time from 6:00 AM onwards.";

export const EVENT_LATE_START_MESSAGE =
  "Events cannot start after 10:00 PM. Please pick a start time from 6:00 AM to 10:00 PM.";

export const EVENT_SPANS_MIDNIGHT_MESSAGE =
  "An event has to start and end on the same day, between 6:00 AM and 10:00 PM.";

export class EventWindowError extends Error {
  readonly code = "EVENT_AFTER_HOURS";

  constructor(message: string = EVENT_LATE_END_MESSAGE) {
    super(message);
    this.name = "EventWindowError";
  }
}

export class EventStartWindowError extends Error {
  readonly code = "EVENT_BEFORE_HOURS";

  constructor(message: string = EVENT_EARLY_START_MESSAGE) {
    super(message);
    this.name = "EventStartWindowError";
  }
}

/** Normalises anything unusable (empty, junk, unknown zone) to the default. */
export function resolveEventTimeZone(timezone?: string | null): string {
  return resolveTimeZone(timezone);
}

/** Earliest permitted start: 6:00 AM on the start's own local day. */
export function getEventMinStart(startTime: Date, timezone?: string | null): Date {
  const zone = resolveTimeZone(timezone);
  return instantAtLocalHourOnDayOf(startTime, EVENT_MIN_START_HOUR, 0, zone);
}

/** Latest permitted end: 10:00 PM on the start's own local day. */
export function getEventMaxEnd(startTime: Date, timezone?: string | null): Date {
  const zone = resolveTimeZone(timezone);
  return instantAtLocalHourOnDayOf(startTime, EVENT_MAX_END_HOUR, 0, zone);
}

/** True when the start is at or after 6:00 AM local. */
export function isEventStartWithinHours(startTime: Date, timezone?: string | null): boolean {
  return startTime.getTime() >= getEventMinStart(startTime, timezone).getTime();
}

/**
 * True when the start itself is inside the 6 AM - 10 PM day. A start after
 * 10 PM local would otherwise be reported as "has to finish by 10 PM", which
 * reads as nonsense to the organizer who typed 11 PM.
 */
export function isEventStartWithinDay(startTime: Date, timezone?: string | null): boolean {
  if (!isEventStartWithinHours(startTime, timezone)) return false;
  return startTime.getTime() <= getEventMaxEnd(startTime, timezone).getTime();
}

/**
 * True when the event ends on the same local day as it starts and no later than
 * 10:00 PM local. Invalid ordering is rejected here too, so a caller that only
 * checks this still cannot store a backwards event.
 */
export function isEventEndWithinHours(
  startTime: Date,
  endTime: Date,
  timezone?: string | null,
): boolean {
  if (endTime.getTime() <= startTime.getTime()) return false; // invalid ordering
  return endTime.getTime() <= getEventMaxEnd(startTime, timezone).getTime();
}

/**
 * Full window check for create/update: start no earlier than 6 AM, end no later
 * than 10 PM, both on the same local day.
 */
export function isEventScheduleWithinHours(
  startTime: Date,
  endTime: Date | null | undefined,
  timezone?: string | null,
): boolean {
  if (!isEventStartWithinHours(startTime, timezone)) return false;
  if (!endTime) return true; // no explicit end time cannot run late on its own
  return isEventEndWithinHours(startTime, endTime, timezone);
}

export function assertEventWithinHours(
  startTime: Date,
  endTime: Date | null | undefined,
  timezone?: string | null,
): void {
  if (!isEventStartWithinHours(startTime, timezone)) {
    throw new EventStartWindowError();
  }
  if (!isEventStartWithinDay(startTime, timezone)) {
    throw new EventStartWindowError(EVENT_LATE_START_MESSAGE);
  }
  if (!endTime) return; // no explicit end time means the event has no late run
  if (!isEventEndWithinHours(startTime, endTime, timezone)) {
    throw new EventWindowError();
  }
}

/**
 * Sensible default end for an event created without one: two hours, but never
 * past 10 PM local. A 9 PM showtime gets a 10 PM end instead of being rejected
 * for a time the organizer did not choose.
 */
export function defaultEventEnd(
  startTime: Date,
  timezone?: string | null,
  hours = 2,
): Date {
  const candidate = new Date(startTime.getTime() + hours * 60 * 60 * 1000);
  const cap = getEventMaxEnd(startTime, timezone);
  return candidate.getTime() <= cap.getTime() ? candidate : cap;
}

/**
 * Nabri partner booking scheduling window.
 *
 * Rule: a partner job may be scheduled between 04:00 and 22:00 LOCAL time.
 * Earlier than 4 AM is rejected because no partner is awake and dispatching a
 * job at 2 AM is a support incident, not a feature; later than 10 PM is
 * rejected to match the event day boundary.
 *
 * Unlike events, a booking has no explicit end time on the wire (the job
 * carries a duration), so only the START is bounded. Evaluated in the
 * booker's timezone, defaulting to Asia/Kolkata.
 */
import {
  DEFAULT_APP_TIMEZONE,
  instantAtLocalHourOnDayOf,
  localParts,
  resolveTimeZone,
} from "./localTime";

/** Bookings can start from 4:00 AM local. */
export const BOOKING_MIN_START_HOUR = 4;
/** Bookings can start up to 10:00 PM local. */
export const BOOKING_MAX_START_HOUR = 22;

export const BOOKING_EARLY_START_MESSAGE =
  "Bookings can only be scheduled from 4:00 AM onwards. Please pick a later slot.";

export const BOOKING_LATE_START_MESSAGE =
  "Bookings can only be scheduled up to 10:00 PM. Please pick an earlier slot.";

export class BookingWindowError extends Error {
  readonly code: "BOOKING_BEFORE_HOURS" | "BOOKING_AFTER_HOURS";

  constructor(
    code: "BOOKING_BEFORE_HOURS" | "BOOKING_AFTER_HOURS",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "BookingWindowError";
  }
}

export function resolveBookingTimeZone(timezone?: string | null): string {
  return resolveTimeZone(timezone);
}

export function getBookingMinStart(
  scheduledAt: Date,
  timezone?: string | null,
): Date {
  return instantAtLocalHourOnDayOf(
    scheduledAt,
    BOOKING_MIN_START_HOUR,
    0,
    resolveTimeZone(timezone),
  );
}

export function getBookingMaxStart(
  scheduledAt: Date,
  timezone?: string | null,
): Date {
  return instantAtLocalHourOnDayOf(
    scheduledAt,
    BOOKING_MAX_START_HOUR,
    0,
    resolveTimeZone(timezone),
  );
}

/** Local hour-of-day of an instant, for cheap range checks and messages. */
export function localHourOf(instant: Date, timezone?: string | null): number {
  return localParts(instant, resolveTimeZone(timezone)).hour;
}

/**
 * True when the scheduled start falls between 4:00 AM and 10:00 PM local.
 * A start exactly at 10:00:00.000 PM is rejected: the slot is gone by then,
 * and "up to 10 PM" reads as "before 10 PM" to a user picking a clock time.
 */
export function isBookingStartWithinHours(
  scheduledAt: Date,
  timezone?: string | null,
): boolean {
  const zone = resolveTimeZone(timezone);
  const hour = localParts(scheduledAt, zone).hour;
  const minute = localParts(scheduledAt, zone).minute;
  if (hour < BOOKING_MIN_START_HOUR) return false;
  if (hour > BOOKING_MAX_START_HOUR) return false;
  if (hour === BOOKING_MAX_START_HOUR && minute > 0) return false;
  return true;
}

/**
 * Throws a coded error so the API returns 400 with a specific message rather
 * than a generic validation failure.
 */
export function assertBookingStartWithinHours(
  scheduledAt: Date,
  timezone?: string | null,
): void {
  if (isBookingStartWithinHours(scheduledAt, timezone)) return;
  const hour = localHourOf(scheduledAt, timezone);
  if (hour < BOOKING_MIN_START_HOUR) {
    throw new BookingWindowError("BOOKING_BEFORE_HOURS", BOOKING_EARLY_START_MESSAGE);
  }
  throw new BookingWindowError("BOOKING_AFTER_HOURS", BOOKING_LATE_START_MESSAGE);
}

export { DEFAULT_APP_TIMEZONE };
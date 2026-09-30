/**
 * Local-time helpers for day-window policies.
 *
 * Both the event window (6 AM - 10 PM) and the partner booking window
 * (4 AM - 10 PM) are wall-clock rules in the user's own timezone, not UTC
 * instants. Comparing UTC hours to "10 PM" is the bug these helpers exist to
 * avoid: in IST (UTC+5:30) a 22:00 UTC cap silently means half past three in
 * the morning locally.
 *
 * `instantAtLocalTime` solves for the instant whose local wall clock reads a
 * given calendar date and time, which is what "10 PM local" actually means.
 * Two passes are needed because the zone offset itself depends on the instant
 * being converted (DST edges).
 */

/** Fallback when a record carries no usable timezone. */
export const DEFAULT_APP_TIMEZONE = "Asia/Kolkata";

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Normalises anything unusable (empty, junk, unknown zone) to the default. */
export function resolveTimeZone(timezone?: string | null): string {
  const candidate = typeof timezone === "string" ? timezone.trim() : "";
  if (!candidate) return DEFAULT_APP_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_APP_TIMEZONE;
  }
}

/** Wall-clock parts of an instant in `timeZone`. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // en-US with hour12:false reports midnight as 24 in some ICU builds.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset in ms between UTC and `timeZone` at that instant. */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which the local wall clock in `timeZone` reads the given
 * calendar date and time.
 */
export function instantAtLocalTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = guess - zoneOffsetMs(new Date(guess), timeZone);
  result = guess - zoneOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** The instant for `hour:minute` on the local day that `instant` falls in. */
export function instantAtLocalHourOnDayOf(
  instant: Date,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const p = localParts(instant, timeZone);
  return instantAtLocalTime(p.year, p.month, p.day, hour, minute, timeZone);
}

/** True when both instants fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  const pa = localParts(a, timeZone);
  const pb = localParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Local calendar day key, useful for grouping and day-level messages. */
export function localDayKey(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
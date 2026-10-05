/**
 * IST day-boundary maths, with no dependencies.
 *
 * Deliberately a separate module: this is pure arithmetic and must stay
 * importable from anywhere, including a unit test with no environment loaded.
 * Keeping it out of a module that validates configuration is what allows the
 * scheduler timing to be tested without booting the whole app.
 */

const IST = "Asia/Kolkata";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds elapsed today in IST. */
function msElapsedInIstDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return ((get("hour") % 24) * 60 + get("minute")) * 60 * 1000 + get("second") * 1000;
}

/**
 * Milliseconds from now until the next 00:00 IST.
 *
 * Never returns 0: a zero delay would re-arm the scheduler as fast as the event
 * loop allows. A caller already past the boundary gets a full day.
 */
export function msUntilIstMidnight(now: Date = new Date()): number {
  const untilMidnight = DAY_MS - msElapsedInIstDay(now);
  return untilMidnight <= 0 ? DAY_MS : untilMidnight;
}

/** The current IST calendar day as `YYYY-MM-DD`. */
export function istDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

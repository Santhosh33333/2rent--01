/**
 * Reporting periods for the admin report emails.
 *
 * WHY CALENDAR PERIODS AND NOT A ROLLING WINDOW: the daily digest used to cover
 * "the last 24 hours", which sounds identical to "yesterday" and is not. A run
 * at 00:05 on the 5th under a rolling window covers 00:05 on the 4th to 00:05 on
 * the 5th - it straddles two calendar days, and the row labelled "bookings
 * created today" would quietly be yesterday's plus five minutes. Every figure in
 * a report that finance or tax uses has to be reproducible from the dates printed
 * in the header, so each period is a set of local-midnight boundaries and the
 * window is [since, until) - half-open, so a row created exactly at midnight is
 * counted once and only once.
 *
 * The boundaries are SERVER-LOCAL midnights on purpose. The report is an
 * operations artefact read by people in one timezone, so "this month" has to mean
 * their month. The digest prints the UTC offset next to every boundary so a reader
 * in another timezone can still convert it.
 *
 * `until` is always the START of the current bucket, which makes it double as the
 * "am I on the trigger day?" test the scheduler needs: the period is due exactly
 * when the clock has just passed `until`. A Wednesday midnight is not the start of
 * a week, so a weekly report cannot fire on a Wednesday.
 */

/** Every cadence the report scheduler can send. */
export const REPORT_PERIODS = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "NEXT_MONTH",
  "TAX",
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export type ReportWindow = {
  period: ReportPeriod;
  /** Identity of this bucket. Stable across restarts, unique per period. */
  key: string;
  /** Inclusive start of the completed period. */
  since: Date;
  /** Exclusive end of the completed period: the start of the current bucket. */
  until: Date;
  /** Human label for the header, e.g. "28 Sep 2026 to 04 Oct 2026". */
  label: string;
  /** The noun a row label uses: "today", "this month", ... */
  word: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight at the start of `d`'s day. */
function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * Monday 00:00 on or before `d`.
 *
 * `getDay()` is 0 for Sunday, so `(day + 6) % 7` is the number of days back to
 * Monday: Sunday maps to 6, Monday maps to 0. Getting this wrong by one day is
 * invisible in a test that only checks a Monday, which is why it is spelled out.
 */
function startOfWeek(d: Date): Date {
  const m = midnight(d);
  return addDays(m, -((m.getDay() + 6) % 7));
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfQuarter(d: Date): Date {
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}

/**
 * The completed period as of `now`, plus the current bucket's start.
 *
 * NEXT_MONTH and TAX reuse the monthly boundaries on purpose: the next-month
 * outlook is projected from the month just closed, and a monthly tax report
 * covers the month just closed. Their extra content is a different section, not a
 * different window.
 */
export function periodWindow(period: ReportPeriod, now: Date = new Date()): ReportWindow {
  let until: Date;
  let since: Date;

  switch (period) {
    case "DAILY":
      until = midnight(now);
      since = addDays(until, -1);
      break;
    case "WEEKLY":
      until = startOfWeek(now);
      since = addDays(until, -7);
      break;
    case "MONTHLY":
    case "NEXT_MONTH":
    case "TAX":
      until = startOfMonth(now);
      // Month 0 is January, so -1 rolls back into December of the prior year
      // without any special case.
      since = new Date(until.getFullYear(), until.getMonth() - 1, 1);
      break;
    case "QUARTERLY": {
      until = startOfQuarter(now);
      since = new Date(until.getFullYear(), until.getMonth() - 3, 1);
      break;
    }
    case "YEARLY":
      until = new Date(now.getFullYear(), 0, 1);
      since = new Date(now.getFullYear() - 1, 0, 1);
      break;
    default: {
      // Unreachable for a typed caller, but a bad value from config must degrade
      // to the daily window rather than throw inside the scheduler tick.
      until = midnight(now);
      since = addDays(until, -1);
      break;
    }
  }

  return {
    period,
    key: `${period}|${since.getTime()}|${until.getTime()}`,
    since,
    until,
    label: `${formatBoundary(since)} to ${formatBoundary(until)}`,
    word: periodWord(period),
  };
}

/** The noun used in row labels, so "created today" is never printed in a month. */
export function periodWord(period: ReportPeriod): string {
  switch (period) {
    case "DAILY":
      return "today";
    case "WEEKLY":
      return "this week";
    case "QUARTERLY":
      return "this quarter";
    case "YEARLY":
      return "this year";
    default:
      // MONTHLY, NEXT_MONTH and TAX all read over a calendar month.
      return "this month";
  }
}

/** "04 Oct 2026" - day and month, since a boundary is never a useful time. */
export function formatBoundary(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * "2026-10-03" from LOCAL parts.
 *
 * toISOString().slice(0, 10) is the obvious thing to reach for and it is wrong
 * here: window boundaries are local midnights, so in IST a window starting
 * 03 Oct 00:00 is "2026-10-02T18:30:00Z" and stamps a file with the 2nd. The
 * finance admin then files last month's report under the 2nd and cannot find it.
 */
export function localDateStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * A boundary with its UTC offset, for the header.
 *
 * The window is built from local midnights, so printing a bare ISO timestamp
 * would label a period that is genuinely local as if it were UTC - off by
 * 05:30 for a reader who trusts the number. The offset is the only thing that
 * makes the printed window convertible.
 */
export function formatBoundaryWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${formatBoundary(d)} ${sign}${hh}:${mm}`;
}

/**
 * Half-open filter for a timestamp column: everything from `since` up to but not
 * including `until`.
 *
 * The `lt` half is what makes a period reproducible. Without it, a monthly report
 * opened at 00:05 on the 1st also counts rows created at 00:06 that morning, and
 * the figure in the email no longer matches the dates printed above it.
 */
export function windowWhere(window: ReportWindow, field = "createdAt"): Record<string, unknown> {
  return { [field]: { gte: window.since, lt: window.until } };
}

/** Combines a period window with additional filters, e.g. windowWhere(w) + status. */
export function inWindow(window: ReportWindow, extra: Record<string, unknown> = {}, field = "createdAt") {
  return { ...windowWhere(window, field), ...extra };
}

/**
 * Is this period due right now?
 *
 * True only inside the hour after `until`, which is what stops a weekly report
 * firing on every midnight of the week. `hour` is the configured send time so
 * the schedules can be staggered and cannot collide mid-send.
 */
export function isPeriodDue(period: ReportPeriod, now: Date, hour: number): boolean {
  const window = periodWindow(period, now);
  return now.getHours() === hour && midnight(now).getTime() === window.until.getTime();
}

/** Human subject prefix, e.g. "Nabri weekly report". */
export function periodTitle(period: ReportPeriod): string {
  switch (period) {
    case "DAILY":
      return "Nabri daily digest";
    case "WEEKLY":
      return "Nabri weekly report";
    case "MONTHLY":
      return "Nabri monthly report";
    case "QUARTERLY":
      return "Nabri quarterly report";
    case "YEARLY":
      return "Nabri yearly report";
    case "NEXT_MONTH":
      return "Nabri next-month outlook";
    case "TAX":
      return "Nabri tax report";
    default:
      return "Nabri report";
  }
}

/** Number of days the window spans, for the "trailing N days" run-rate maths. */
export function windowDays(window: ReportWindow): number {
  return Math.max(1, Math.round((window.until.getTime() - window.since.getTime()) / DAY_MS));
}
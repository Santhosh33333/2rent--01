/**
 * Scheduler for the admin report emails.
 *
 * WHY A MINUTE POLL AND NOT "SLEEP UNTIL MIDNIGHT": the process restarts on
 * every deploy and Render cycles instances. A timer set for 00:00 is lost on
 * redeploy, and a long setInterval drifts. Polling once a minute and comparing
 * the current clock against each period's boundary survives both, and costs one
 * cheap comparison a minute.
 *
 * WHY ONE POLL FOR SEVEN CADENCES: every schedule here is "the hour after a
 * calendar boundary". Deriving each period's due moment from that boundary (see
 * isPeriodDue) means adding a cadence is a table entry, not a new timer, and a
 * monthly report can never drift out of step with the daily one.
 *
 * The boundaries are SERVER-LOCAL on purpose: the reports are operations
 * artefacts read by people in one timezone, so "this month" should mean their
 * month, not UTC's.
 */
import { prisma } from "../config/database";
import {
  DIGEST_ROLES,
  buildDigestSections,
  buildOutlookSections,
  buildTaxSections,
  recipientsForRole,
  sendDigestForRole,
  taxRows,
  type DigestRole,
  type DigestSection,
} from "./dailyAdminDigest";
import {
  isPeriodDue,
  periodWindow,
  periodTitle,
  type ReportPeriod,
  type ReportWindow,
} from "./reportPeriods";

const TICK_MS = 60_000;

/**
 * When each cadence fires, in local hours.
 *
 * The hours are staggered on purpose. On 1 January at 00:00 the daily, weekly,
 * monthly, quarterly and yearly reports are all due at once; the outlook waits an
 * hour so it is built after the monthly figures are out, and the tax report waits
 * two. Running seven heavy report builds in the same tick is how a background job
 * becomes the thing that times out the API.
 */
const SCHEDULES: Array<{ period: ReportPeriod; hour: number }> = [
  { period: "DAILY", hour: 0 },
  { period: "WEEKLY", hour: 0 },
  { period: "MONTHLY", hour: 0 },
  { period: "QUARTERLY", hour: 0 },
  { period: "YEARLY", hour: 0 },
  { period: "NEXT_MONTH", hour: 1 },
  { period: "TAX", hour: 2 },
];

/** Roles that get the standalone tax mail. Everyone else gets tax inside their own report. */
const DEFAULT_TAX_ROLES: DigestRole[] = ["SUPER_ADMIN", "FINANCE_ADMIN", "FINANCE"];

function taxRoles(): DigestRole[] {
  const override = (process.env.TAX_REPORT_ROLES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean) as DigestRole[];
  return override.length ? override : DEFAULT_TAX_ROLES;
}

/**
 * Periods already attempted, keyed by the period's own key.
 *
 * In-memory, and kept in step with the DigestRun table rather than replacing it.
 * It is what stops the same process retrying for the rest of the hour, and it
 * keeps working when the database cannot be reached - the durable claim below is
 * the guarantee across instances and restarts; this is the cheap local guard.
 */
const runMarkers = new Set<string>();

export function hasRun(period: ReportPeriod, window: ReportWindow): boolean {
  return runMarkers.has(`${period}|${window.key}`);
}

export function markRun(period: ReportPeriod, window: ReportWindow): void {
  runMarkers.add(`${period}|${window.key}`);
}

/** Exposed for tests: clears every marker so each case starts from a cold boot. */
export function resetRunMarkers(): void {
  runMarkers.clear();
}

/** Rows older than this can never describe a period that is due again. */
const PRUNE_AFTER_DAYS = 400;

/**
 * Claims a period for sending, durably.
 *
 * The INSERT is the claim. Two instances reaching the same midnight both try it,
 * the unique constraint on (period, windowKey) lets exactly one through, and the
 * loser is told by a constraint violation instead of by a SELECT that said "not
 * sent yet". A read-then-write guard is a race by construction: both instances
 * can read "not sent" before either writes.
 *
 * Returns true for exactly one caller per period.
 *
 * Degrades to the in-memory guard if the table is missing or the database is
 * unreachable. That is deliberate: a report scheduler that throws because a table
 * has not migrated yet stops every report silently, and a duplicate monthly email
 * is a smaller problem than no monthly email at all. The failure is logged loudly
 * because it means the cross-instance guarantee is not in force.
 */
async function claimPeriod(period: ReportPeriod, window: ReportWindow): Promise<boolean> {
  const id = `${period}|${window.key}`;
  if (runMarkers.has(id)) return false;
  // Marked before the INSERT is awaited, not after. claimPeriod is async, and the
  // next 60-second tick arrives while the database is still being asked; without
  // this the same monthly report is queued twice on 1 January.
  runMarkers.add(id);

  try {
    await prisma.digestRun.create({
      data: { period, windowKey: window.key },
    });
    await pruneOldRuns();
    return true;
  } catch (err: any) {
    // P2002 = unique violation: another instance already claimed this period.
    if (err?.code === "P2002") {
      console.log(`[REPORT] ${period} ${window.label}: already claimed by another instance - not sending again.`);
      return false;
    }
    console.error(
      `[REPORT] ${period}: durable claim unavailable (${err?.code ?? "unknown"}: ${err?.message ?? err})` +
        " - falling back to the in-process guard, so a restart may re-send this period.",
    );
    return true;
  }
}

/** Drops claim rows old enough that no period can match them again. */
async function pruneOldRuns(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000);
    await prisma.digestRun.deleteMany({ where: { claimedAt: { lt: cutoff } } });
  } catch {
    // Housekeeping only. Its absence cannot cause a duplicate report, so it is
    // not worth a log line every day.
  }
}

/** The one predicate the tick uses, exposed so it can be tested directly. */
export function isDue(period: ReportPeriod, now: Date): boolean {
  const sched = SCHEDULES.find((s) => s.period === period);
  if (!sched) return false;
  if (!isPeriodDue(period, now, sched.hour)) return false;
  return !hasRun(period, periodWindow(period, now));
}

/** Every cadence not yet sent for its current period. */
export function pendingPeriods(now = new Date()): ReportPeriod[] {
  return SCHEDULES.map((s) => s.period).filter((p) => isDue(p, now));
}

/** Exposed for tests: whether this process has already sent a period. */
export function periodIsClaimed(period: ReportPeriod, now: Date): boolean {
  return hasRun(period, periodWindow(period, now));
}

/** Which sections a cadence contains. */
export async function sectionsForPeriod(
  period: ReportPeriod,
  window: ReportWindow,
  now = new Date(),
): Promise<DigestSection[]> {
  if (period === "TAX") return buildTaxSections(window);

  const standard = await buildDigestSections(window);
  if (period === "NEXT_MONTH") return [...standard, ...(await buildOutlookSections(window, now))];

  // The longer periods carry the tax table too. Super admin receives one
  // combined mail, so "all reports end to end" has to include the tax bases in
  // that same mail rather than splitting them into a second inbox.
  if (period === "MONTHLY" || period === "QUARTERLY" || period === "YEARLY") {
    return [...standard, { title: "Tax and statutory", rows: await taxRows(window) }];
  }
  return standard;
}

/** Recipients for a cadence: tax goes only to the tax roles, everything else to all. */
async function recipientsFor(period: ReportPeriod): Promise<Map<DigestRole, string[]>> {
  const roles = period === "TAX" ? taxRoles() : [...DIGEST_ROLES];
  const out = new Map<DigestRole, string[]>();
  for (const role of roles) out.set(role, await recipientsForRole(role));
  return out;
}

/**
 * Builds and sends one cadence. Never throws: a scheduler that dies takes every
 * other background job with it.
 */
export async function runReport(period: ReportPeriod, now = new Date()): Promise<void> {
  const window = periodWindow(period, now);

  // Claimed before anything is built. The claim is what makes this once-per-period
  // across instances and restarts, and a claim that is never taken is a report
  // that is never sent - the wrong failure to risk.
  if (!(await claimPeriod(period, window))) return;

  try {
    const sections = await sectionsForPeriod(period, window, now);
    const recipients = await recipientsFor(period);

    let anyRecipient = false;
    for (const [role, addrs] of recipients) {
      if (addrs.length) anyRecipient = true;
      const res = await sendDigestForRole(role, addrs, sections, window);
      if (res.skipped) continue;
      if (res.error) console.error(`[REPORT] ${period} ${role}: ${res.sent}/${res.attempted} sent - ${res.error}`);
      else console.log(`[REPORT] ${period} ${role}: ${res.sent}/${res.attempted} sent`);
    }

    if (!anyRecipient) {
      console.log(
        `[REPORT] ${periodTitle(period)} (${window.label}): no recipients configured - built the report but sent nothing.`,
      );
    }
  } catch (err) {
    console.error(`[REPORT] ${period} run failed:`, (err as Error)?.message ?? err);
  }
}

/**
 * The daily digest. Thin wrapper over runReport so the existing daily entry
 * point and its call sites keep working.
 */
export async function runDailyDigest(now = new Date()): Promise<void> {
  await runReport("DAILY", now);
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Serialises the cadences of one tick so their report builds do not compete. */
let chain: Promise<unknown> = Promise.resolve();

export function startDigestScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    const now = new Date();
    const due = pendingPeriods(now);
    if (!due.length) return;
    // Serialised through one chain so the cadences of a single tick do not run
    // their report builds concurrently, and marked synchronously here so the next
    // tick does not queue the same period a second time while this one runs.
    for (const period of due) markRun(period, periodWindow(period, now));
    chain = chain.then(async () => {
      for (const period of due) {
        console.log(`[REPORT] ${periodTitle(period)} is due - sending`);
        await runReport(period, now);
      }
    });
  }, TICK_MS);
  timer.unref?.();
}

export function stopDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
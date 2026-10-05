/**
 * Midnight scheduler for the daily admin digest.
 *
 * WHY A MINUTE POLL AND NOT "SLEEP UNTIL MIDNIGHT": the process restarts on
 * every deploy and Render cycles instances. A timer set for 00:00 is lost on
 * redeploy, and a long setInterval drifts. Polling once a minute and comparing
 * the current hour against a per-day marker survives both, and costs one cheap
 * comparison a minute.
 *
 * The day is keyed in the SERVER's local time on purpose: the digest is an
 * operations artefact read by people in one timezone, so "today" should mean
 * their today, not UTC's.
 */
import {
  DIGEST_ROLES,
  buildDigestSections,
  recipientsForRole,
  sendDigestForRole,
  type DigestRole,
} from "./dailyAdminDigest";

const TICK_MS = 60_000;

/** Set once the digest for "today" has been attempted, so a restart cannot resend. */
let lastRunDay = "";
let timer: ReturnType<typeof setInterval> | null = null;

function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function digestHasRunToday(now = new Date()): boolean {
  return lastRunDay === localDayKey(now);
}

/** Exposed for tests: lets a run be forced for a specific date. */
export function markDigestRun(dayKey: string): void {
  lastRunDay = dayKey;
}

export function shouldRunNow(now = new Date(), hour = 0): boolean {
  return now.getHours() === hour && !digestHasRunToday(now);
}

/**
 * Builds and sends the digest. Never throws: a scheduler that dies takes every
 * other background job with it.
 */
export async function runDailyDigest(now = new Date()): Promise<void> {
  const windowEnd = now;
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Marked before sending, not after. If the process dies mid-send the day is
  // still consumed, and a partial digest is better than a duplicate one.
  markDigestRun(localDayKey(now));

  try {
    const sections = await buildDigestSections(since);
    const roles: DigestRole[] = [...DIGEST_ROLES];

    let anyRecipient = false;
    const results: Array<{
      role: DigestRole;
      attempted: number;
      sent: number;
      skipped: boolean;
      error?: string;
    }> = [];
    for (const role of roles) {
      const recipients = recipientsForRole(role);
      if (recipients.length) anyRecipient = true;
      results.push(await sendDigestForRole(role, recipients, sections, windowEnd));
    }

    if (!anyRecipient) {
      console.log(
        "[DIGEST] No DIGEST_EMAIL_<ROLE> recipients configured - built the digest but sent nothing.",
      );
      return;
    }

    for (const r of results) {
      if (r.skipped) continue;
      if (r.error) console.error(`[DIGEST] ${r.role}: ${r.sent}/${r.attempted} sent - ${r.error}`);
      else console.log(`[DIGEST] ${r.role}: ${r.sent}/${r.attempted} sent`);
    }
  } catch (err) {
    console.error("[DIGEST] run failed:", (err as Error)?.message ?? err);
  }
}

export function startDigestScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (shouldRunNow()) {
      console.log("[DIGEST] midnight reached - sending daily digest");
      void runDailyDigest();
    }
  }, TICK_MS);
  timer.unref?.();
}

export function stopDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
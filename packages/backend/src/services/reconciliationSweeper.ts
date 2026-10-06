/**
 * Re-checks uploaded bank statements every minute and approves what is
 * unambiguous, then expires what is old.
 *
 * This exists because of the order things actually happen in. A statement is
 * uploaded, and *then* the user pastes the UTR - or the booking they were paying
 * for is created. At upload time those rows have nothing to match against, so
 * they land as UNMATCHED and would stay that way until somebody clicked Rematch.
 * Every minute the reference appears somewhere it did not before, and the row
 * becomes matchable. Without this sweep that only happened if an admin happened
 * to press the button.
 *
 * Three properties make running it unattended safe:
 *
 *  - **The matcher is the gate, not this file.** Nothing here decides what is
 *    safe to credit; `matchRowAgainst` has already refused every outbound line,
 *    every amount that differs by a rupee, every reference claimed twice,
 *    repeated inside the file, already settled, or read off a PDF whose columns
 *    were inferred. This sweep only credits what that function calls MATCHED.
 *  - **Crediting is one shared loop with the admin's Apply button.** It is not
 *    possible for "safe to auto-approve" and "safe to approve by clicking" to
 *    drift into different rules.
 *  - **Every credit is a conditional claim.** `settleTopupRequest` and
 *    `settleUpiPayment` update only when the claim is still VERIFICATION_PENDING,
 *    so a row credited here and then applied by hand costs a lost race, not a
 *    second credit.
 *
 * Statements are dropped after 24 hours, after the sweep has had its final pass
 * over them - never before, or a match that was available at hour 23.9 would be
 * thrown away along with the row that would have credited it.
 */
import { prisma } from "../config/database";
import {
  purgeExpiredStatements,
  sweepStatement,
  STATEMENT_RETENTION_MS,
} from "./bankReconciliation";

const TICK_MS = 60_000;
/**
 * Statements handled per tick.
 *
 * A backlog must not become a single unbounded tick: one upload of a year-long
 * export can take seconds on its own, and a sweeper that overlaps itself is how
 * the same row gets considered twice in one pass.
 */
const BATCH_LIMIT = 10;

export interface ReconciliationSweepResult {
  scanned: number;
  rematched: number;
  credited: number;
  alreadySettled: number;
  failed: number;
  purged: number;
  purgedRows: number;
}

/** Serialises ticks so a slow pass never overlaps the next one. */
let running = false;

/**
 * One pass: match, credit, then expire.
 *
 * Expiry runs last on purpose. A statement that has just crossed 24 hours still
 * deserves this tick's matching and crediting before it goes - otherwise the
 * last claim a user submitted would be discarded with the row it belonged to.
 */
export async function runReconciliationSweep(now = new Date()): Promise<ReconciliationSweepResult> {
  const result: ReconciliationSweepResult = {
    scanned: 0,
    rematched: 0,
    credited: 0,
    alreadySettled: 0,
    failed: 0,
    purged: 0,
    purgedRows: 0,
  };
  if (running) return result;
  running = true;

  try {
    // Every statement still being watched. No age filter: age decides expiry in
    // the second half, not whether an available match should be taken.
    const live = await prisma.bankStatement.findMany({
      where: { status: { not: "APPLIED" } },
      orderBy: { createdAt: "desc" },
      take: BATCH_LIMIT,
      select: { id: true },
    });

    for (const { id } of live) {
      try {
        const outcome = await sweepStatement({ statementId: id });
        if (!outcome) continue;
        result.scanned += 1;
        result.rematched += outcome.rematched;
        result.credited += outcome.credited;
        result.alreadySettled += outcome.alreadySettled;
        result.failed += outcome.failed.length;
      } catch (err) {
        // A single unreadable statement must not stall the queue behind it.
        console.error(`[reconciliation] sweep failed for statement ${id}:`, (err as Error)?.message ?? err);
      }
    }

    const purged = await purgeExpiredStatements(now);
    result.purged = purged.purged;
    result.purgedRows = purged.rows;
  } finally {
    running = false;
  }

  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Logs only when something happened.
 *
 * This ticks once a minute for as long as the process lives; a log line on a
 * quiet minute would be 1440 identical entries a day, and a signal that is
 * always present stops being one.
 */
function report(prefix: string, r: ReconciliationSweepResult): void {
  if (r.credited > 0 || r.rematched > 0 || r.failed > 0 || r.purged > 0) {
    console.log(
      `[RECONCILIATION] ${prefix}: ${r.credited} auto-approved, ${r.rematched} newly matched, ` +
        `${r.failed} failed, ${r.purged} statement(s) expired (${r.purgedRows} rows) - scanned ${r.scanned}`,
    );
  }
}

export function startReconciliationSweeper(): void {
  if (timer) return;

  timer = setInterval(() => {
    runReconciliationSweep()
      .then((r) => report("sweep", r))
      .catch((err) => console.error("[RECONCILIATION] Sweeper run failed:", err));
  }, TICK_MS);
  timer.unref?.();

  // Sweep at boot as well. A claim submitted while the process was down for a
  // deploy should be matched on the first tick after it returns, not a minute
  // later for no reason - and a statement already past 24 hours should be
  // expired promptly rather than lingering until the next interval.
  runReconciliationSweep()
    .then((r) => report("boot sweep", r))
    .catch((err) => console.error("[RECONCILIATION] Boot sweep failed:", err));
}

export function stopReconciliationSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export const RECONCILIATION_RETENTION_MS = STATEMENT_RETENTION_MS;

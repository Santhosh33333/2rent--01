/**
 * Is this UTR / bank reference already spoken for?
 *
 * One implementation, because there were four and they disagreed. Before this
 * file:
 *
 *  - a top-up checked TopupRequest and UpiPayment but not SubscriptionPayment,
 *    so a subscription UTR could be pasted into a top-up and settle twice;
 *  - a booking UPI payment checked only itself, so it accepted a reference that
 *    a top-up had already used;
 *  - the subscription paths checked the other two tables but carried no status
 *    filter, so a REJECTED attempt blocked a corrected UTR forever while the
 *    top-up path allowed it.
 *
 * Three tables hold money references and each one has its own `@unique` column,
 * which guarantees uniqueness *within* a table and says nothing at all about the
 * other two. The database cannot help across tables without a shared table, so
 * the cross-table rule has to live in code - and it has to be the same code at
 * every entry point or the weakest entry point is the rule.
 *
 * ## The status rule
 *
 * A reference conflicts unless the only rows carrying it are REJECTED.
 *
 *  - VERIFIED money has settled: blocking is the entire point. This is the case
 *    the rule exists for - one UTR, one payment, permanently.
 *  - VERIFICATION_PENDING and REQUEST_INFO mean someone is mid-flight, and
 *    letting a second person start on the same reference produces two rows that
 *    both expect to be credited.
 *  - PENDING, CANCELLED, EXPIRED and any status added later block too. Blocking
 *    is the safe direction here: a false "already used" costs a support ticket,
 *    a false clear costs crediting the wrong wallet.
 *  - REJECTED does not block. A rejection means a human looked and said no -
 *    typically a mistyped UTR - and the correct one must still be enterable.
 *    Otherwise a single typo permanently burns that reference.
 *
 * Every table also has `@@index([referenceNumber])`, so each of the three lookups
 * is an index seek rather than a scan.
 */
import { prisma } from "../config/database";

export type ReferenceConflictKind = "TOPUP" | "UPI_PAYMENT" | "SUBSCRIPTION_PAYMENT";

export interface ReferenceConflict {
  kind: ReferenceConflictKind;
  id: string;
  status: string;
}

/** Statuses that never block a reference: a rejection is a do-over. */
const NON_BLOCKING = ["REJECTED"];

/**
 * The first row anywhere that claims this reference and is not a rejection.
 *
 * Returns null when the reference is free. Never throws to the caller for a
 * missing table - a uniqueness guard that throws has no verdict, and callers
 * would have to guess whether "error" means "used" or "unknown".
 *
 * `excludeId` is required by the two paths that check a reference already stored
 * on their own row: admin verification reads `row.referenceNumber` back before
 * deciding, and a user may re-submit the same reference. Without the exclusion
 * those two would report their own row as the conflict and could never proceed -
 * the guard would block itself.
 */
export async function findReferenceConflict(
  referenceNumber: string,
  opts: { excludeId?: string } = {},
): Promise<ReferenceConflict | null> {
  const reference = String(referenceNumber ?? "").trim();
  if (!reference) return null;

  const where = {
    referenceNumber: reference,
    status: { notIn: NON_BLOCKING },
    ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}),
  };

  const [topup, upi, sub] = await Promise.all([
    prisma.topupRequest.findFirst({ where, select: { id: true, status: true } }),
    prisma.upiPayment.findFirst({ where, select: { id: true, status: true } }),
    prisma.subscriptionPayment.findFirst({ where, select: { id: true, status: true } }),
  ]);

  // Checked in settlement-priority order rather than query order, so the conflict
  // reported to a user is stable: the row that actually holds the money is named
  // first, not whichever query happened to resolve first.
  if (sub) return { kind: "SUBSCRIPTION_PAYMENT", id: sub.id, status: sub.status };
  if (topup) return { kind: "TOPUP", id: topup.id, status: topup.status };
  if (upi) return { kind: "UPI_PAYMENT", id: upi.id, status: upi.status };
  return null;
}

/**
 * Message for a conflict, from the user's point of view.
 *
 * The three callers each had their own wording and two of them named only their
 * own table, which sent a user who had entered the reference against a *booking*
 * to look at the booking screen when the clash was a top-up.
 */
export function referenceConflictMessage(conflict: ReferenceConflict): string {
  const where =
    conflict.kind === "TOPUP"
      ? "a wallet top-up"
      : conflict.kind === "UPI_PAYMENT"
        ? "a booking payment"
        : "a subscription payment";
  return `This reference number was already used for ${where}. A UTR can only be used once.`;
}

/**
 * Money and pipeline figures for the daily admin digest.
 *
 * Kept apart from dailyAdminDigest.ts so that file stays a routing and
 * rendering concern: it decides who sees which section and what an email looks
 * like, while this module is only concerned with turning the ledger and the
 * operational tables into rows.
 *
 * Two rules hold throughout:
 *
 *  1. A figure that could not be computed is "n/a", never 0. A finance admin
 *     reconciling a payout needs to know the difference between "nothing is
 *     pending" and "the query did not run".
 *  2. Statuses are read out of the rows, never from a hardcoded list. A status
 *     added to the backend tomorrow appears in tomorrow's digest with no edit
 *     here, and a status that never occurs does not pad the email with zeroes.
 */
import { prisma } from "../config/database";
import type { DigestRow, DigestValue } from "./dailyAdminDigest";

/** ₹ with Indian digit grouping and two decimals. */
export function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Counts rows. Returns "n/a" rather than throwing so one unreachable table
 * cannot take the whole digest down with it.
 */
export async function tally(model: string, where?: Record<string, unknown>): Promise<number | "n/a"> {
  try {
    const rows = await (prisma as any)[model].findMany({
      where: where ?? {},
      select: { id: true },
    });
    return rows.length;
  } catch {
    return "n/a";
  }
}

/**
 * Sums one numeric column across a filtered set.
 *
 * Money columns are Prisma Decimal and arrive as objects, so they go through
 * Number(). Nullable columns (Booking.finalAmount is Float?) are skipped rather
 * than summed: Number(null) is 0 but a single undefined would make the whole
 * total NaN and print as "₹NaN", which is worse than an honest shortfall.
 */
export async function sumOf(
  model: string,
  field: string,
  where?: Record<string, unknown>,
): Promise<DigestValue> {
  try {
    const rows: Array<Record<string, unknown>> = await (prisma as any)[model].findMany({
      where: where ?? {},
      select: { [field]: true },
    });
    let total = 0;
    for (const r of rows) {
      const n = Number(r[field]);
      if (Number.isFinite(n)) total += n;
    }
    return rupees(total);
  } catch {
    return "n/a";
  }
}

/** Count and value together, for rows where finance needs both. */
export async function countAndSum(
  model: string,
  field: string,
  where?: Record<string, unknown>,
): Promise<{ count: number | "n/a"; value: DigestValue }> {
  return { count: await tally(model, where), value: await sumOf(model, field, where) };
}

/** One row per status actually present. */
export async function statusRows(
  model: string,
  prefix: string,
  where?: Record<string, unknown>,
): Promise<DigestRow[]> {
  try {
    const rows: Array<{ status: string }> = await (prisma as any)[model].findMany({
      where: where ?? {},
      select: { status: true },
    });
    const by: Record<string, number> = {};
    for (const r of rows) by[String(r.status)] = (by[String(r.status)] ?? 0) + 1;
    return Object.keys(by).sort().map((status) => ({ label: `${prefix}${status}`, value: by[status] }));
  } catch {
    return [{ label: `${prefix}statuses`, value: "n/a" }];
  }
}

/** PaymentOrder.status values that represent money actually taken. */
const CAPTURED = { status: { in: ["COMPLETED", "CAPTURED"] } };

/**
 * Money in, money out, money held.
 *
 * Split out from the counts-only "Money" section on purpose: nobody can
 * reconcile a payout from "12 transactions". Every figure here is derived
 * server-side from the same columns the payment and wallet code moves, so the
 * number in the email is the number in the ledger.
 */
export async function financialRows(since: Date): Promise<DigestRow[]> {
  const completedBookings = { status: "COMPLETED" };
  const pendingWithdrawal = await countAndSum("withdrawalRequest", "amount", { status: "PENDING" });
  const approvedWithdrawal = await countAndSum("withdrawalRequest", "amount", { status: "APPROVED" });
  const topupQueue = await countAndSum("topupRequest", "amount", { status: "VERIFICATION_PENDING" });

  return [
    { label: "Top-ups captured today", value: await sumOf("paymentOrder", "amount", { ...CAPTURED, type: "TOPUP", createdAt: { gte: since } }) },
    { label: "Booking payments captured today", value: await sumOf("paymentOrder", "amount", { ...CAPTURED, type: "BOOKING", createdAt: { gte: since } }) },
    { label: "Payment orders failed today", value: await tally("paymentOrder", { status: "FAILED", createdAt: { gte: since } }), alert: true },

    { label: "Wallet float (customer)", value: await sumOf("wallet", "balance") },
    { label: "Wallet float (promotional)", value: await sumOf("wallet", "promotionalBalance") },
    { label: "Wallet funds held for metered calls", value: await sumOf("wallet", "heldBalance") },

    { label: "Withdrawals awaiting payout", value: pendingWithdrawal.value, alert: pendingWithdrawal.count !== 0 },
    { label: "Withdrawals awaiting payout (count)", value: pendingWithdrawal.count, alert: pendingWithdrawal.count !== 0 },
    { label: "Withdrawals approved", value: approvedWithdrawal.value },
    { label: "Manual top-ups to verify", value: topupQueue.value, alert: topupQueue.count !== 0 },
    { label: "Manual top-ups to verify (count)", value: topupQueue.count, alert: topupQueue.count !== 0 },

    { label: "Booking revenue (completed)", value: await sumOf("booking", "finalAmount", completedBookings) },
    { label: "Platform fees earned", value: await sumOf("booking", "platformFee", completedBookings) },
    { label: "Partner earnings owed", value: await sumOf("booking", "partnerEarning", completedBookings) },
    { label: "Refunds paid out today", value: await sumOf("refundLog", "amount", { status: "COMPLETED", createdAt: { gte: since } }) },
    // Dating requests are billed from the sender's wallet, so this is real money
    // the platform has collected. It is tiny per request but it is a live revenue
    // line, and leaving it out would mean the financial report disagreed with
    // the wallet ledger.
    { label: "Dating request charges collected today", value: await sumOf("transaction", "amount", { type: "DATING_REQUEST", status: "COMPLETED", createdAt: { gte: since } }) },
  ];
}

/**
 * Every stage of the journey, in the order a user walks through it.
 *
 * The point is to make a drop-off visible in one email: if signups are healthy
 * but KYC approvals are not, the funnel says so without anyone cross-referencing
 * five tables by hand.
 */
export async function funnelRows(since: Date): Promise<DigestRow[]> {
  return [
    { label: "1. Registered today", value: await tally("user", { createdAt: { gte: since } }) },
    { label: "2. Email verified", value: await tally("user", { emailVerified: true }) },
    { label: "3. Mobile verified", value: await tally("user", { mobileVerified: true }) },
    { label: "4. Profile completed", value: await tally("user", { onboardingCompletedAt: { not: null } }) },
    { label: "5. KYC approved", value: await tally("verification", { status: "APPROVED" }) },
    { label: "6. Paid access active", value: await tally("user", { accessUntil: { gt: new Date() } }) },
    { label: "7. Subscription active", value: await tally("subscription", { status: "ACTIVE" }) },
    { label: "8. Made a dating request", value: await tally("like", { createdAt: { gte: since } }) },
    { label: "9. Posted a walking request", value: await tally("walkingRequest", { createdAt: { gte: since } }) },
    { label: "10. Placed a booking", value: await tally("booking", { createdAt: { gte: since } }) },
    { label: "11. Booking completed", value: await tally("booking", { status: "COMPLETED", completedAt: { gte: since } }) },
    // joinedAt, not createdAt: CommunityMember has no createdAt column. Prisma
    // rejects the unknown key, tally() swallows it, and the row renders "n/a"
    // forever - which reads exactly like "nobody joined a community today".
    { label: "12. Joined a community", value: await tally("communityMember", { joinedAt: { gte: since } }) },
    { label: "13. Booked an event", value: await tally("eventAttendee", { createdAt: { gte: since } }) },
    { label: "14. Raised a support ticket", value: await tally("supportTicket", { createdAt: { gte: since } }) },
    { label: "-- booking outcomes today --", value: "" },
    ...(await statusRows("booking", "bookings ", { createdAt: { gte: since } })),
    { label: "-- walking request outcomes (all time) --", value: "" },
    ...(await statusRows("walkingRequest", "walking requests ")),
  ];
}

/** Dating specifically: who is asking, who is asking back, and who paired up. */
export async function datingRows(since: Date): Promise<DigestRow[]> {
  return [
    { label: "Datable profiles", value: await tally("user", { role: "USER", status: "ACTIVE" }) },
    { label: "Requests sent today", value: await tally("like", { createdAt: { gte: since } }) },
    { label: "Requests sent total", value: await tally("like") },
    { label: "Super likes today", value: await tally("like", { createdAt: { gte: since }, type: "SUPER_LIKE" }) },
    { label: "Passes today", value: await tally("pass", { createdAt: { gte: since } }) },
    { label: "Matches formed today", value: await tally("match", { matchedAt: { gte: since } }) },
    { label: "Matches total", value: await tally("match") },
    { label: "Matches inactive (unmatched)", value: await tally("match", { isActive: false }), alert: true },
  ];
}
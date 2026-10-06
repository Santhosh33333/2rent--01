/**
 * Money and pipeline figures for the admin report emails.
 *
 * Kept apart from dailyAdminDigest.ts so that file stays a routing and
 * rendering concern: it decides who sees which section and what an email looks
 * like, while this module is only concerned with turning the ledger and the
 * operational tables into rows.
 *
 * Three rules hold throughout:
 *
 * 1. A figure that could not be computed is "n/a", never 0. A finance admin
 *    reconciling a payout needs to know the difference between "nothing is
 *    pending" and "the query did not run".
 * 2. Statuses are read out of the rows, never from a hardcoded list. A status
 *    added to the backend tomorrow appears in tomorrow's report with no edit
 *    here, and a status that never occurs does not pad the email with zeroes.
 * 3. Every period-scoped row is bounded on both sides by the report window, and
 *    every row label says which period it covers. A row labelled "today" that
 *    actually holds a month is the specific failure this module exists to avoid.
 */
import { prisma } from "../config/database";
import type { DigestRow, DigestValue } from "./dailyAdminDigest";
import { inWindow, periodWord, windowWhere, type ReportWindow } from "./reportPeriods";

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
 * Sums one numeric column, unformatted.
 *
 * Money columns are Prisma Decimal and arrive as objects, so they go through
 * Number(). Nullable columns (Booking.finalAmount is Float?) are skipped rather
 * than summed: Number(null) is 0 but a single undefined would make the whole
 * total NaN and print as "₹NaN", which is worse than an honest shortfall.
 *
 * The raw number is exposed separately from sumOf because the tax report has to do
 * arithmetic on real aggregates (taxable base less refunds). Doing that on the
 * formatted string would mean parsing "₹1,23,456.50" back into a number, which is
 * where invented digits come from.
 */
export async function sumNumber(
  model: string,
  field: string,
  where?: Record<string, unknown>,
): Promise<number | "n/a"> {
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
    return total;
  } catch {
    return "n/a";
  }
}

/** sumNumber, formatted for a row. Shares one implementation with sumNumber. */
export async function sumOf(
  model: string,
  field: string,
  where?: Record<string, unknown>,
): Promise<DigestValue> {
  const total = await sumNumber(model, field, where);
  return total === "n/a" ? "n/a" : rupees(total);
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
export async function financialRows(window: ReportWindow): Promise<DigestRow[]> {
  const word = periodWord(window.period);
  const completedBookings = { status: "COMPLETED" };
  const pendingWithdrawal = await countAndSum("withdrawalRequest", "amount", { status: "PENDING" });
  const approvedWithdrawal = await countAndSum("withdrawalRequest", "amount", { status: "APPROVED" });
  const topupQueue = await countAndSum("topupRequest", "amount", { status: "VERIFICATION_PENDING" });
  // Manual UPI is the only collection route left, so money sitting in the
  // verification queue is uncollected money. A finance admin reading a gateway
  // report would not think to look for it here, and the wallet float would read
  // higher than it should.
  const upiQueue = await countAndSum("upiPayment", "amount", { status: "VERIFICATION_PENDING" });

  return [
    { label: `Top-ups captured ${word}`, value: await sumOf("paymentOrder", "amount", { ...CAPTURED, type: "TOPUP", createdAt: windowWhere(window).createdAt }) },
    { label: `Booking payments captured ${word}`, value: await sumOf("paymentOrder", "amount", { ...CAPTURED, type: "BOOKING", createdAt: windowWhere(window).createdAt }) },
    { label: `Payment orders failed ${word}`, value: await tally("paymentOrder", inWindow(window, { status: "FAILED" })), alert: true },

    { label: "Wallet float (customer)", value: await sumOf("wallet", "balance") },
    { label: "Wallet float (promotional)", value: await sumOf("wallet", "promotionalBalance") },
    { label: "Wallet funds held for metered calls", value: await sumOf("wallet", "heldBalance") },

    { label: "Withdrawals awaiting payout", value: pendingWithdrawal.value, alert: pendingWithdrawal.count !== 0 },
    { label: "Withdrawals awaiting payout (count)", value: pendingWithdrawal.count, alert: pendingWithdrawal.count !== 0 },
    { label: "Withdrawals approved", value: approvedWithdrawal.value },
    { label: "Manual top-ups to verify", value: topupQueue.value, alert: topupQueue.count !== 0 },
    { label: "Manual top-ups to verify (count)", value: topupQueue.count, alert: topupQueue.count !== 0 },
    { label: "Manual booking UPI to verify", value: upiQueue.value, alert: upiQueue.count !== 0 },
    { label: "Manual booking UPI to verify (count)", value: upiQueue.count, alert: upiQueue.count !== 0 },

    { label: "Booking revenue (completed)", value: await sumOf("booking", "finalAmount", completedBookings) },
    { label: "Platform fees earned", value: await sumOf("booking", "platformFee", completedBookings) },
    { label: "Partner earnings owed", value: await sumOf("booking", "partnerEarning", completedBookings) },
    { label: `Refunds paid out ${word}`, value: await sumOf("refundLog", "amount", inWindow(window, { status: "COMPLETED" })) },
    // Dating requests are billed from the sender's wallet, so this is real money
    // the platform has collected. It is tiny per request but it is a live revenue
    // line, and leaving it out would mean the financial report disagreed with
    // the wallet ledger.
    { label: `Dating request charges collected ${word}`, value: await sumOf("transaction", "amount", inWindow(window, { type: "DATING_REQUEST", status: "COMPLETED" })) },
    { label: `Wallet top-ups credited ${word}`, value: await sumOf("transaction", "amount", inWindow(window, { type: "CREDIT", status: "COMPLETED" })) },
  ];
}

/** A blank-ish separator row, rendered as a heading inside its table. */
function heading(label: string): DigestRow {
  return { label, value: "" };
}

/**
 * The configured tax/withholding rates, straight out of PricingConfig.
 *
 * Read from the table rather than through bookingEngine's getServiceConfig cache
 * so the report shows what is stored, including an inactive row. A report that
 * silently substituted a hardcoded default would disagree with the fares that
 * were actually charged.
 */
async function taxRateRows(): Promise<DigestRow[]> {
  try {
    const rows: Array<{ key: string; value: string; serviceType: string | null; isActive: boolean }> =
      await (prisma as any).pricingConfig.findMany({
        where: { key: { in: ["TAX_PERCENT", "TDS_PERCENT", "GST_PERCENT"] } },
        select: { key: true, value: true, serviceType: true, isActive: true },
      });
    if (!rows.length) return [{ label: "Tax rate", value: "not configured" }];
    return rows.map((r) => {
      const pct = Number(r.value);
      const scope = r.serviceType ? ` (${r.serviceType})` : " (all services)";
      const state = r.isActive ? "" : " [inactive]";
      return { label: `${r.key}${scope}${state}`, value: Number.isFinite(pct) ? `${pct}%` : "n/a" };
    });
  } catch {
    return [{ label: "Tax rate", value: "n/a" }];
  }
}

/** The single effective TAX_PERCENT in force, or NaN when none is set. */
async function effectiveTaxPercent(): Promise<number> {
  try {
    const row: { value: string } | null = await (prisma as any).pricingConfig.findFirst({
      where: { key: "TAX_PERCENT", isActive: true },
      select: { value: true },
      orderBy: { updatedAt: "desc" },
    });
    const pct = Number(row?.value);
    return Number.isFinite(pct) ? pct : NaN;
  } catch {
    return NaN;
  }
}

/**
 * Tax and statutory position for the period.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: print a "tax collected" figure. The fare
 * engine computes a tax line (bookingEngine.ts, TAX_PERCENT) and folds it into
 * the booking total, but Booking has no `tax` column and the pricing snapshot
 * stores the RATE, not the amount. There is therefore no per-booking tax figure
 * anywhere in the database, and any single "GST collected" number would be a
 * reconstruction from rates and clamps rather than a record.
 *
 * What it does instead: report the real money bases a return is built from (gross
 * supply, refunds, net supply, platform fee, partner payouts), the rate actually
 * configured in PricingConfig, and one clearly-marked indicative line.
 */
export async function taxRows(window: ReportWindow): Promise<DigestRow[]> {
  const word = periodWord(window.period);

  const gross = await sumNumber("booking", "finalAmount", inWindow(window, { status: "COMPLETED" }));
  const refunds = await sumNumber("refundLog", "amount", inWindow(window, { status: "COMPLETED" }));
  const fee = await sumNumber("booking", "platformFee", inWindow(window, { status: "COMPLETED" }));
  const partnerPaid = await sumNumber("withdrawalRequest", "amount", inWindow(window, { status: { in: ["PAID", "COMPLETED"] } }));
  const rate = await effectiveTaxPercent();

  // Net supply is arithmetic on two figures printed directly above it, so it can
  // be re-derived by hand from this email alone.
  const net = typeof gross === "number" && typeof refunds === "number" ? gross - refunds : "n/a";
  // Refunds in a window can relate to bookings that completed in an EARLIER
  // window, so gross-minus-refunds is negative whenever a month settles more
  // refunds than it completes bookings. That is a true arithmetic result and a
  // useless taxable base, so the estimate below is withheld rather than
  // multiplied out into a negative tax figure that reads like a credit.
  const netIsNegative = typeof net === "number" && net < 0;
  const hasUsableBase = typeof net === "number" && net >= 0 && Number.isFinite(rate) && rate > 0;
  const indicative = hasUsableBase ? rupees(Math.round(net * rate) / 100) : netIsNegative
    ? "withheld - net supply is negative, see the rows above"
    : "n/a";

  return [
    heading("== taxable supply =="),
    { label: `Gross booking value, completed (${word})`, value: typeof gross === "number" ? rupees(gross) : "n/a" },
    { label: `Less refunds paid (${word})`, value: typeof refunds === "number" ? rupees(refunds) : "n/a" },
    { label: "Net taxable supply value", value: typeof net === "number" ? rupees(net) : "n/a", alert: netIsNegative },
    ...(netIsNegative
      ? [{
          label: "Why net is negative",
          value: "refunds in a window settle bookings completed in an earlier window, so this period does not reconcile on its own",
        }]
      : []),
    { label: `Platform fee on that supply (${word})`, value: typeof fee === "number" ? rupees(fee) : "n/a" },
    { label: `Partner payouts paid (${word})`, value: typeof partnerPaid === "number" ? rupees(partnerPaid) : "n/a" },
    heading("== configured rates (from PricingConfig) =="),
    ...(await taxRateRows()),
    { label: "Tax at the configured rate (INDICATIVE ESTIMATE)", value: indicative, alert: hasUsableBase },
    // The one line that stops the row above being filed as a return figure.
    { label: "Recorded per-booking tax", value: "not stored - no column exists", alert: true },
    {
      label: "TDS on partner payouts",
      // There is no withholding configuration in this system. Printing 0.00 would
      // assert that a nil deduction was made and accounted for; "not configured"
      // states the true position.
      value: "not configured - none applied or recorded",
    },
  ];
}

/**
 * Next-month outlook.
 *
 * Two clearly separated halves. The first is REAL forward-dated data already in
 * the database: bookings scheduled, requests raised, events planned. The second is
 * a run-rate projection, fenced behind an explicit "estimates, not commitments"
 * separator so nobody downstream books against it.
 */
export async function outlookRows(window: ReportWindow, now = new Date()): Promise<DigestRow[]> {
  const targetStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const targetEnd = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const days = Math.max(1, Math.round((targetEnd.getTime() - targetStart.getTime()) / 86_400_000));
  // Baseline is the completed window, so the "per day" rate uses the same days
  // that the header says, not however many days have happened to pass this month.
  const windowLength = Math.max(1, Math.round((window.until.getTime() - window.since.getTime()) / 86_400_000));
  const monthName = targetStart.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const target = { gte: targetStart, lt: targetEnd };

  const newUsersLast = await tally("user", windowWhere(window));
  const bookingsLast = await tally("booking", windowWhere(window));
  const perDay = (n: number | "n/a") => (typeof n === "number" ? n / windowLength : "n/a");
  // Resolved once each: a `typeof perDay(x) === "number" ? perDay(x) * days` guard
  // reads fine but narrows nothing, because each call is a separate expression.
  const newUsersPerDay = perDay(newUsersLast);
  const bookingsPerDay = perDay(bookingsLast);

  return [
    heading(`== already scheduled for ${monthName} ==`),
    { label: "Bookings scheduled", value: await tally("booking", { scheduledAt: target }) },
    { label: "Walking requests scheduled", value: await tally("walkingRequest", { startTime: target }) },
    { label: "Events scheduled", value: await tally("event", { startTime: target }) },
    { label: "Pending withdrawals to clear", value: await tally("withdrawalRequest", { status: "PENDING" }) },
    { label: "Pending manual top-ups to clear", value: await tally("topupRequest", { status: "VERIFICATION_PENDING" }), alert: true },
    { label: "Pending manual booking UPI to clear", value: await tally("upiPayment", { status: "VERIFICATION_PENDING" }), alert: true },
    heading("== projections - estimates, not commitments =="),
    { label: `New signups per day (from ${windowLength}d actual)`, value: newUsersPerDay },
    { label: `Bookings per day (from ${windowLength}d actual)`, value: bookingsPerDay },
    { label: `Projected signups over ${days} days`, value: typeof newUsersPerDay === "number" ? Math.round(newUsersPerDay * days) : "n/a" },
    { label: `Projected bookings over ${days} days`, value: typeof bookingsPerDay === "number" ? Math.round(bookingsPerDay * days) : "n/a" },
  ];
}

/**
 * Every stage of the journey, in the order a user walks through it.
 *
 * The point is to make a drop-off visible in one email: if signups are healthy
 * but KYC approvals are not, the funnel says so without anyone cross-referencing
 * five tables by hand.
 */
export async function funnelRows(window: ReportWindow): Promise<DigestRow[]> {
  const word = periodWord(window.period);
  return [
    { label: `1. Registered ${word}`, value: await tally("user", windowWhere(window)) },
    { label: "2. Email verified", value: await tally("user", { emailVerified: true }) },
    { label: "3. Mobile verified", value: await tally("user", { mobileVerified: true }) },
    { label: "4. Profile completed", value: await tally("user", { onboardingCompletedAt: { not: null } }) },
    { label: "5. KYC approved", value: await tally("verification", { status: "APPROVED" }) },
    { label: "6. Paid access active", value: await tally("user", { accessUntil: { gt: new Date() } }) },
    { label: "7. Subscription active", value: await tally("subscription", { status: "ACTIVE" }) },
    { label: `8. Made a dating request ${word}`, value: await tally("like", windowWhere(window)) },
    { label: `9. Posted a walking request ${word}`, value: await tally("walkingRequest", windowWhere(window)) },
    { label: `10. Placed a booking ${word}`, value: await tally("booking", windowWhere(window)) },
    // completedAt, not createdAt: a booking created last month and finished today
    // is revenue for the period it completed in, which is the basis every tax
    // regime uses.
    { label: `11. Booking completed ${word}`, value: await tally("booking", inWindow(window, { status: "COMPLETED" }, "completedAt")) },
    // joinedAt, not createdAt: CommunityMember has no createdAt column. Prisma
    // rejects the unknown key, tally() swallows it, and the row renders "n/a"
    // forever - which reads exactly like "nobody joined a community this week".
    { label: `12. Joined a community ${word}`, value: await tally("communityMember", windowWhere(window, "joinedAt")) },
    { label: `13. Booked an event ${word}`, value: await tally("eventAttendee", windowWhere(window)) },
    { label: `14. Raised a support ticket ${word}`, value: await tally("supportTicket", windowWhere(window)) },
    { label: `-- booking outcomes ${word} --`, value: "" },
    ...(await statusRows("booking", "bookings ", windowWhere(window))),
    { label: "-- walking request outcomes (all time) --", value: "" },
    ...(await statusRows("walkingRequest", "walking requests ")),
  ];
}

/** Dating specifically: who is asking, who is asking back, and who paired up. */
export async function datingRows(window: ReportWindow): Promise<DigestRow[]> {
  const word = periodWord(window.period);
  return [
    { label: "Datable profiles", value: await tally("user", { role: "USER", status: "ACTIVE" }) },
    { label: `Requests sent ${word}`, value: await tally("like", windowWhere(window)) },
    { label: "Requests sent total", value: await tally("like") },
    { label: `Super likes ${word}`, value: await tally("like", inWindow(window, { type: "SUPER_LIKE" })) },
    { label: `Passes ${word}`, value: await tally("pass", windowWhere(window)) },
    { label: `Matches formed ${word}`, value: await tally("match", windowWhere(window, "matchedAt")) },
    { label: "Matches total", value: await tally("match") },
    { label: "Matches inactive (unmatched)", value: await tally("match", { isActive: false }), alert: true },
  ];
}
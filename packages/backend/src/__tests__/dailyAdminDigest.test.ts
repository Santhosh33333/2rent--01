/**
 * Admin report emails.
 *
 * The behaviours worth protecting are the ones that would fail silently in
 * production: a role seeing another role's numbers, a failed query rendering as a
 * confident 0, a period whose figures do not match the dates in its header, the
 * scheduler sending twice for one period, and a tax report that invents a tax
 * figure the database never recorded.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  ALL_SECTION_TITLES,
  DIGEST_ROLES,
  buildDigestSections,
  buildOutlookSections,
  buildTaxSections,
  recipientsForRole,
  renderDigestHtml,
  renderDigestText,
  sectionsForRole,
  shouldAttachCsv,
  sendDigestForRole,
  type DigestSection,
  type DigestRole,
} from "../services/dailyAdminDigest";
import { buildDigestCsv, digestCsvFilename } from "../services/digestExport";
import { periodWindow, type ReportWindow } from "../services/reportPeriods";

vi.mock("../config/database", () => ({
  prisma: {
    user: { findMany: vi.fn(), findFirst: vi.fn() },
    partner: { findMany: vi.fn() },
    adminUser: { findMany: vi.fn() },
    adminLoginAttempt: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    community: { findMany: vi.fn() },
    errorLog: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    verification: { findMany: vi.fn() },
    booking: { findMany: vi.fn() },
    paymentOrder: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    withdrawalRequest: { findMany: vi.fn() },
    topupRequest: { findMany: vi.fn() },
    refundLog: { findMany: vi.fn() },
    supportTicket: { findMany: vi.fn() },
    chatRequest: { findMany: vi.fn() },
    message: { findMany: vi.fn() },
    sosAlert: { findMany: vi.fn() },
    chatReport: { findMany: vi.fn() },
    report: { findMany: vi.fn() },
    userBlock: { findMany: vi.fn() },
    blocklistEntry: { findMany: vi.fn() },
    referral: { findMany: vi.fn() },
    subscription: { findMany: vi.fn() },
    broadcastCampaign: { findMany: vi.fn() },
    contentArticle: { findMany: vi.fn() },
    walkingPartner: { findMany: vi.fn() },
    walkingRequest: { findMany: vi.fn() },
    roleApplication: { findMany: vi.fn() },
    // Added with the financial report and the end-to-end funnel. A model that is
    // queried but absent from this mock is undefined, so tally() catches the
    // TypeError and returns "n/a" - which the "no n/a when healthy" test then
    // fails on. That is deliberate: adding a section without adding its model
    // here breaks the suite instead of quietly shipping a row of n/a.
    wallet: { findMany: vi.fn() },
    like: { findMany: vi.fn() },
    pass: { findMany: vi.fn() },
    match: { findMany: vi.fn() },
    communityMember: { findMany: vi.fn() },
    eventAttendee: { findMany: vi.fn() },
    // Manual UPI is the only collection route left, so its pending money has to
    // appear in the money figures or the wallet float reads higher than it is.
    upiPayment: { findMany: vi.fn() },
    // The durable run marker. Claimed by INSERT-as-claim, so a second instance
    // losing the race gets P2002 rather than a duplicate mail. Without this in
    // the mock, claimPeriod() takes its "table missing" fallback and the tests
    // below would silently assert the in-memory behaviour instead of the real one.
    digestRun: { create: vi.fn(), deleteMany: vi.fn() },
    // The digest does not read subscriptions, but `healthy()` walks every key of
    // this mock and calls findMany on each, so the key has to be a real model
    // mock here too. Adding it to the object without that is what broke the walk.
    subscriptionPayment: { findMany: vi.fn() },
    // The tax report reads the configured rate from here rather than inventing one.
    pricingConfig: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

// Mocked so importing the digest does not pull in the real email service, whose
// env validation runs at import time and would fail the whole suite. Same
// pattern the agent tool tests use.
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: false, provider: "none", error: "not configured" }),
}));

import { prisma } from "../config/database";

/** A window over the day before 4 Oct 2026, in server-local time. */
const DAY = periodWindow("DAILY", new Date(2026, 9, 4, 0, 5));
const MONTH = periodWindow("MONTHLY", new Date(2026, 9, 4, 0, 5));

const SECTIONS: DigestSection[] = [
  { title: "Platform", rows: [{ label: "Users total", value: 11 }, { label: "Failed admin logins", value: 2, alert: true }] },
  { title: "Verification (KYC)", rows: [{ label: "Total", value: 4 }, { label: "APPROVED", value: 2 }] },
  { title: "Money", rows: [{ label: "Bookings", value: 12 }, { label: "Pending withdrawals", value: 3, alert: true }] },
  { title: "Help desk", rows: [{ label: "Tickets", value: 1 }] },
  { title: "Trust and safety", rows: [{ label: "Chat reports", value: 0, alert: true }] },
  { title: "Growth", rows: [{ label: "Referrals", value: 0 }] },
  { title: "Partner supply", rows: [{ label: "Partners", value: 1 }] },
];

const healthy = () => {
  for (const model of Object.keys(prisma as unknown as Record<string, unknown>)) {
    const m = (prisma as any)[model];
    // Not every key on this mock is a Prisma model: a couple are plain values or
    // helpers (the scheduler's run-marker store), and calling findMany on those
    // threw. Only mock a findMany that actually exists.
    if (typeof m?.findMany === "function") m.findMany.mockResolvedValue([]);
  }
  (prisma as any).pricingConfig.findFirst.mockResolvedValue(null);
};

describe("sectionsForRole", () => {
  it("gives each delegated admin role only what it acts on", () => {
    expect(sectionsForRole("FINANCE")).toEqual(["Money", "Financials"]);
    expect(sectionsForRole("FINANCE_ADMIN")).toEqual(["Money", "Financials"]);
    expect(sectionsForRole("KYC_ADMIN")).toEqual(["Verification (KYC)"]);
    expect(sectionsForRole("MODERATOR")).toEqual(["Trust and safety"]);
    expect(sectionsForRole("PARTNER_ADMIN")).toEqual(["Partner supply"]);
  });

  it("gives super admin every section, in one combined report", () => {
    // The explicit ask: one mail, every report, end to end. Not the three
    // platform-level sections it used to get.
    expect(sectionsForRole("SUPER_ADMIN")).toEqual([...ALL_SECTION_TITLES]);
    expect(sectionsForRole("SUPER_ADMIN")).toContain("Financials");
    expect(sectionsForRole("SUPER_ADMIN")).toContain("Tax and statutory");
    expect(sectionsForRole("SUPER_ADMIN")).toContain("Help desk");
  });

  it("keeps rupee figures away from roles that do not reconcile money", () => {
    // The Financials section is the one that can move a payout. A KYC or
    // moderation admin seeing a wallet float is a permissions smell even though
    // it leaks no one else's data.
    for (const role of ["KYC_ADMIN", "MODERATOR", "SUPPORT", "MARKETING_ADMIN", "PARTNER_ADMIN"]) {
      expect(sectionsForRole(role as DigestRole)).not.toContain("Financials");
      expect(sectionsForRole(role as DigestRole)).not.toContain("Tax and statutory");
    }
  });

  it("never hands a role a section outside its remit", () => {
    // Super admin is in every list on purpose: they receive the combined report,
    // so the remit check has to accept that rather than failing on the whole
    // section set. The delegated roles stay exactly as restricted as before.
    const allow: Record<string, string[]> = {
      Money: ["SUPER_ADMIN", "FINANCE", "FINANCE_ADMIN"],
      Financials: ["SUPER_ADMIN", "FINANCE", "FINANCE_ADMIN"],
      "Verification (KYC)": ["SUPER_ADMIN", "KYC_ADMIN"],
      "Help desk": ["SUPER_ADMIN", "SUPPORT", "SUPPORT_ADMIN"],
      "Trust and safety": ["SUPER_ADMIN", "MODERATOR"],
      Growth: ["SUPER_ADMIN", "MARKETING_ADMIN"],
      "Partner supply": ["SUPER_ADMIN", "PARTNER_ADMIN"],
      Platform: ["SUPER_ADMIN", "ADMIN"],
      "End-to-end funnel": ["SUPER_ADMIN", "ADMIN"],
      Dating: ["SUPER_ADMIN", "ADMIN"],
      "Tax and statutory": ["SUPER_ADMIN"],
      "Next month outlook": ["SUPER_ADMIN"],
    };
    for (const role of DIGEST_ROLES) {
      for (const title of sectionsForRole(role)) {
        expect(allow[title]).toContain(role);
      }
    }
    // Every section the combined mail can carry is covered by the allow-list, so
    // a new section cannot be added without deciding who sees it.
    expect(Object.keys(allow).sort()).toEqual([...ALL_SECTION_TITLES].sort());
  });

  it("never returns an empty digest", () => {
    for (const role of DIGEST_ROLES) {
      expect(sectionsForRole(role).length).toBeGreaterThan(0);
    }
  });
});

describe("the combined super-admin mail", () => {
  it("carries every section that was built, end to end", () => {
    const built: DigestSection[] = [
      ...SECTIONS,
      { title: "Financials", rows: [{ label: "Wallet float (customer)", value: "₹5,00,000.00" }] },
      { title: "End-to-end funnel", rows: [{ label: "1. Registered today", value: 9 }] },
      { title: "Dating", rows: [{ label: "Matches total", value: 3 }] },
      { title: "Tax and statutory", rows: [{ label: "Net taxable supply value", value: "₹4,00,000.00" }] },
    ];
    const html = renderDigestHtml("SUPER_ADMIN", built, DAY);
    for (const s of built) expect(html).toContain(s.title);
    // One mail, not five: a super admin should not need a folder to read a day.
    expect(html).toContain("Tax and statutory");
    expect(html).toContain("Wallet float (customer)");
  });

  it("still isolates the delegated roles inside their own mails", () => {
    const html = renderDigestHtml("FINANCE", SECTIONS, DAY);
    expect(html).toContain("Money");
    expect(html).not.toContain("Chat reports");
  });

  it("omits a section the period did not build rather than showing it empty", () => {
    // A daily report has no tax rows. Listing the heading with nothing under it
    // reads like a tax return that came back with no figures.
    const html = renderDigestHtml("SUPER_ADMIN", SECTIONS, DAY);
    expect(html).not.toContain("Tax and statutory");
  });
});

describe("rendering", () => {
  it("does not leak other roles' figures into the HTML", () => {
    const html = renderDigestHtml("KYC_ADMIN", SECTIONS, DAY);
    expect(html).toContain("Verification (KYC)");
    expect(html).not.toContain("Pending withdrawals");
    expect(html).not.toContain("Chat reports");
  });

  it("does not leak into the plain-text twin either", () => {
    const text = renderDigestText("FINANCE", SECTIONS, DAY);
    expect(text).toContain("MONEY");
    expect(text).not.toContain("CHAT REPORTS");
    expect(text).not.toContain("GROWTH");
  });

  it("escapes labels rather than emitting raw HTML", () => {
    const nasty: DigestSection[] = [{ title: "Platform", rows: [{ label: "<script>x</script>", value: 1 }] }];
    const html = renderDigestHtml("SUPER_ADMIN", nasty, DAY);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints n/a verbatim rather than dressing it up as zero", () => {
    const gapped: DigestSection[] = [{ title: "Platform", rows: [{ label: "Errors logged", value: "n/a" }] }];
    expect(renderDigestText("SUPER_ADMIN", gapped, DAY)).toMatch(/Errors logged\s+n\/a/);
  });

  it("flags alert rows visually", () => {
    const html = renderDigestHtml("MODERATOR", SECTIONS, DAY);
    expect(html).toContain("#b91c1c");
  });

  it("formats real numbers with Indian grouping", () => {
    const big: DigestSection[] = [{ title: "Platform", rows: [{ label: "Users", value: 1234567 }] }];
    expect(renderDigestText("SUPER_ADMIN", big, DAY)).toContain("12,34,567");
  });

  it("prints the window it is reporting on, with the offset", () => {
    const html = renderDigestHtml("SUPER_ADMIN", SECTIONS, DAY);
    expect(html).toContain(DAY.label);
    // Without the offset a reader in another timezone cannot convert the window.
    expect(html).toMatch(/[+-]\d{2}:\d{2}/);
  });

  it("renders a divider row as a heading, not as a blank measurement", () => {
    const divided: DigestSection[] = [
      { title: "Tax and statutory", rows: [{ label: "== taxable supply ==", value: "" }] },
    ];
    const html = renderDigestHtml("SUPER_ADMIN", divided, DAY);
    expect(html).toContain("== taxable supply ==");
  });
});

describe("recipientsForRole", () => {
  afterEach(() => {
    delete process.env.DIGEST_EMAIL_FINANCE;
    delete process.env.DIGEST_EMAIL_SUPER_ADMIN;
  });

  it("is empty when unset, so the run is a no-op rather than a failure", async () => {
    delete process.env.DIGEST_EMAIL_FINANCE;
    expect(await recipientsForRole("FINANCE")).toEqual([]);
  });

  it("splits, trims and de-duplicates a comma-separated list", async () => {
    process.env.DIGEST_EMAIL_FINANCE = " a@example.com , b@example.com , a@example.com ,, ";
    expect(await recipientsForRole("FINANCE")).toEqual(["a@example.com", "b@example.com"]);
  });

  it("drops entries that are not email addresses", async () => {
    process.env.DIGEST_EMAIL_FINANCE = "ok@example.com, not-an-email, missing-at.example.com";
    expect(await recipientsForRole("FINANCE")).toEqual(["ok@example.com"]);
  });

  it("takes super-admin recipients from the database, with no env var set", async () => {
    healthy();
    (prisma as any).user.findMany.mockResolvedValue([
      { email: "boss@example.com", status: "ACTIVE" },
      { email: "boss@example.com", status: "ACTIVE" },
      { email: null, status: "ACTIVE" },
    ]);
    // The whole point: the report goes out without anyone configuring anything.
    expect(await recipientsForRole("SUPER_ADMIN")).toEqual(["boss@example.com"]);
  });

  it("looks super admins up by role and active role, and skips disabled accounts", async () => {
    healthy();
    (prisma as any).user.findMany.mockResolvedValue([]);
    await recipientsForRole("SUPER_ADMIN");
    const where = (prisma as any).user.findMany.mock.calls.at(-1)[0].where;
    expect(where.OR).toEqual([{ role: "SUPER_ADMIN" }, { activeRole: "SUPER_ADMIN" }]);
    // A suspended admin must not keep receiving the combined financial view.
    expect(where.status.notIn).toContain("SUSPENDED");
  });

  it("lets an explicit env var override the database lookup", async () => {
    process.env.DIGEST_EMAIL_SUPER_ADMIN = "staging@example.com";
    healthy();
    (prisma as any).user.findMany.mockResolvedValue([{ email: "real@example.com", status: "ACTIVE" }]);
    expect(await recipientsForRole("SUPER_ADMIN")).toEqual(["staging@example.com"]);
  });

  it("falls back to the env var rather than failing when the lookup breaks", async () => {
    healthy();
    (prisma as any).user.findMany.mockRejectedValue(new Error("db down"));
    expect(await recipientsForRole("SUPER_ADMIN")).toEqual([]);
    // ...and a broken recipient lookup must never take the scheduler down.
    process.env.DIGEST_EMAIL_SUPER_ADMIN = "boss@example.com";
    expect(await recipientsForRole("SUPER_ADMIN")).toEqual(["boss@example.com"]);
    delete process.env.DIGEST_EMAIL_SUPER_ADMIN;
  });
});

describe("buildDigestSections", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("resolves every metric when the database is healthy", async () => {
    healthy();
    const sections = await buildDigestSections(DAY);
    const flat = sections.flatMap((s) => s.rows);
    expect(flat.length).toBeGreaterThan(20);
    expect(flat.filter((r) => r.value === "n/a")).toHaveLength(0);
  });

  it("reports a failed query as n/a instead of a false zero", async () => {
    healthy();
    // One model blows up; it must not poison the rest of the digest.
    (prisma as any).withdrawalRequest.findMany.mockRejectedValue(new Error("boom"));

    const sections = await buildDigestSections(DAY);
    const money = sections.find((s) => s.title === "Money")!;
    const row = money.rows.find((r) => r.label === "Pending withdrawals")!;
    expect(row.value).toBe("n/a");
    // and the section around it still has real numbers
    expect(money.rows.find((r) => r.label === "Bookings")!.value).not.toBe("n/a");
  });

  it("labels its rows with the period it is reporting on", async () => {
    healthy();
    const daily = await buildDigestSections(DAY);
    const monthly = await buildDigestSections(MONTH);
    const dailyRow = daily.find((s) => s.title === "Platform")!.rows.find((r) => r.label === "New users today");
    const monthlyRow = monthly.find((s) => s.title === "Platform")!.rows.find((r) => r.label === "New users this month");
    // A monthly report whose rows still say "today" is the labelling bug that
    // makes a finance team stop trusting the whole email.
    expect(dailyRow).toBeDefined();
    expect(monthlyRow).toBeDefined();
    expect(daily.find((s) => s.title === "Platform")!.rows.some((r) => r.label.includes("this month"))).toBe(false);
  });

  it("bounds every period-scoped query at both ends", async () => {
    healthy();
    await buildDigestSections(MONTH);
    const call = (prisma as any).user.findMany.mock.calls
      .find((c: any[]) => c[0]?.where?.createdAt?.gte === MONTH.since);
    expect(call).toBeDefined();
    // gte alone would let rows created after the report was generated leak into
    // the total, so the figure would no longer match the printed dates.
    expect(call[0].where.createdAt.lt).toEqual(MONTH.until);
  });

  it("counts completed bookings by the period they completed in", async () => {
    healthy();
    await buildDigestSections(MONTH);
    const call = (prisma as any).booking.findMany.mock.calls
      .find((c: any[]) => c[0]?.where?.completedAt?.gte);
    expect(call).toBeDefined();
    expect(call[0].where.completedAt.lt).toEqual(MONTH.until);
  });
});

describe("financial figures", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete process.env.DIGEST_EXPORT_ROLES; });

  it("adds a Financials section carrying rupee amounts, not just counts", async () => {
    healthy();
    const sections = await buildDigestSections(DAY);
    const fin = sections.find((s) => s.title === "Financials");
    expect(fin).toBeDefined();
    expect(fin!.rows.length).toBeGreaterThan(10);
    // At least one row must actually be a formatted amount.
    expect(fin!.rows.some((r) => typeof r.value === "string" && r.value.startsWith("₹"))).toBe(true);
  });

  it("sums Decimal columns into a real figure rather than NaN", async () => {
    healthy();
    // Prisma returns Decimal objects, not numbers. Summing them naively with + on
    // the object yields "[object Object]" and the row renders as garbage.
    (prisma as any).wallet.findMany.mockResolvedValue([
      { balance: { toString: () => "100.50" } },
      { balance: { toString: () => "50.25" } },
      { balance: null },
    ]);
    const sections = await buildDigestSections(DAY);
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Wallet float (customer)")!;
    expect(row.value).toBe("₹150.75");
    expect(String(row.value)).not.toContain("NaN");
  });

  it("reports an unreachable money table as n/a, not ₹0.00", async () => {
    healthy();
    (prisma as any).wallet.findMany.mockRejectedValue(new Error("db down"));
    const sections = await buildDigestSections(DAY);
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Wallet float (customer)")!;
    // "₹0.00" here would tell finance the platform holds no customer money.
    expect(row.value).toBe("n/a");
  });

  it("reports dating request charges collected as revenue", async () => {
    healthy();
    // Dating requests bill the sender's wallet, so the money is real and the
    // financial report has to agree with the wallet ledger.
    (prisma as any).transaction.findMany.mockResolvedValue([
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "7" } },
    ]);
    const sections = await buildDigestSections(DAY);
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Dating request charges collected today")!;
    expect(row).toBeDefined();
    expect(row.value).toBe("₹8.50");
  });

  it("scopes the dating revenue line to the DATING_REQUEST ledger type", async () => {
    healthy();
    await buildDigestSections(DAY);
    // Without the type filter this would also swallow wallet CREDIT top-ups and
    // booking debits, and the digest would double-count the platform's money.
    const calls = (prisma as any).transaction.findMany.mock.calls;
    const datingCall = calls.find(
      (c: any[]) => c[0]?.where?.type === "DATING_REQUEST",
    );
    expect(datingCall).toBeDefined();
    expect(datingCall![0].where.status).toBe("COMPLETED");
    expect(datingCall![0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it("counts the money waiting on manual UPI verification", async () => {
    healthy();
    // The gateway is retired. Top-ups alone would miss booking payments a user
    // sent by UPI that nobody has verified yet, and the wallet float would look
    // higher than it is.
    (prisma as any).upiPayment.findMany.mockResolvedValue([
      { amount: { toString: () => "150.00" } },
      { amount: { toString: () => "250.50" } },
    ]);
    const fin = (await buildDigestSections(DAY)).find((s) => s.title === "Financials")!;
    expect(fin.rows.find((r) => r.label === "Manual booking UPI to verify")!.value).toBe("₹400.50");
    expect(fin.rows.find((r) => r.label === "Manual booking UPI to verify (count)")!.value).toBe(2);
  });

  it("breaks pipelines down by the statuses actually present", async () => {
    healthy();
    (prisma as any).booking.findMany.mockResolvedValue([
      { status: "COMPLETED" }, { status: "COMPLETED" }, { status: "CANCELLED" },
    ]);
    const sections = await buildDigestSections(DAY);
    const funnel = sections.find((s) => s.title === "End-to-end funnel")!;
    expect(funnel.rows.find((r) => r.label === "bookings COMPLETED")!.value).toBe(2);
    expect(funnel.rows.find((r) => r.label === "bookings CANCELLED")!.value).toBe(1);
    // A status that never occurs is absent rather than padded with a zero.
    expect(funnel.rows.find((r) => r.label === "bookings REFUND_COMPLETED")).toBeUndefined();
  });

  it("reports dating request and match volume", async () => {
    healthy();
    (prisma as any).like.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }]);
    (prisma as any).match.findMany.mockResolvedValue([{ id: "m1" }]);
    const dating = (await buildDigestSections(DAY)).find((s) => s.title === "Dating")!;
    expect(dating.rows.find((r) => r.label === "Requests sent total")!.value).toBe(2);
    expect(dating.rows.find((r) => r.label === "Matches total")!.value).toBe(1);
  });
});

describe("tax report", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("derives net taxable supply from the two figures printed above it", async () => {
    healthy();
    (prisma as any).booking.findMany.mockResolvedValue([
      { finalAmount: 1000, platformFee: 100 },
      { finalAmount: 500, platformFee: 50 },
    ]);
    (prisma as any).refundLog.findMany.mockResolvedValue([{ amount: { toString: () => "200" } }]);

    const [tax] = await buildTaxSections(MONTH);
    const row = (l: string) => tax.rows.find((r) => r.label === l)!.value;
    expect(row("Gross booking value, completed (this month)")).toBe("₹1,500.00");
    expect(row("Less refunds paid (this month)")).toBe("₹200.00");
    // 1500 - 200, derivable by hand from the two rows above it.
    expect(row("Net taxable supply value")).toBe("₹1,300.00");
  });

  it("reports n/a for the whole section when the ledger cannot be read", async () => {
    healthy();
    (prisma as any).booking.findMany.mockRejectedValue(new Error("down"));
    const [tax] = await buildTaxSections(MONTH);
    // "₹0.00" would assert the platform collected nothing all month.
    expect(tax.rows.find((r) => r.label === "Net taxable supply value")!.value).toBe("n/a");
  });

  it("shows the rate actually configured in PricingConfig", async () => {
    healthy();
    (prisma as any).pricingConfig.findMany.mockResolvedValue([
      { key: "TAX_PERCENT", value: "18", serviceType: null, isActive: true },
    ]);
    (prisma as any).pricingConfig.findFirst.mockResolvedValue({ value: "18" });
    const [tax] = await buildTaxSections(MONTH);
    const row = tax.rows.find((r) => r.label === "TAX_PERCENT (all services)")!;
    expect(row.value).toBe("18%");
  });

  it("never states a collected-tax figure as if it were recorded", async () => {
    healthy();
    // Booking has no tax column and the pricing snapshot stores the rate, not the
    // amount. Printing a confident "GST collected" number here would be a
    // reconstruction, and someone would file it.
    (prisma as any).booking.findMany.mockResolvedValue([{ finalAmount: 1000, platformFee: 100 }]);
    (prisma as any).pricingConfig.findFirst.mockResolvedValue({ value: "18" });
    const [tax] = await buildTaxSections(MONTH);
    const estimate = tax.rows.find((r) => r.label.includes("INDICATIVE"))!;
    expect(estimate.value).toBe("₹180.00");
    // The line that stops it being read as a return figure.
    expect(tax.rows.find((r) => r.label === "Recorded per-booking tax")!.value).toMatch(/not stored/);
    expect(tax.rows.some((r) => /^(GST|Tax) collected$/i.test(r.label))).toBe(false);
  });

  it("withholds the estimate when refunds exceed completed bookings in the window", async () => {
    healthy();
    // A refund settled this month for a booking completed last month. The
    // arithmetic is real but the result is not a taxable base, and multiplying a
    // negative out produces a tax figure that reads like a credit.
    (prisma as any).booking.findMany.mockResolvedValue([]);
    (prisma as any).refundLog.findMany.mockResolvedValue([{ amount: { toString: () => "165" } }]);
    (prisma as any).pricingConfig.findFirst.mockResolvedValue({ value: "18" });

    const [tax] = await buildTaxSections(MONTH);
    const row = (l: string) => tax.rows.find((r) => r.label === l)!;
    expect(row("Net taxable supply value").value).toBe("₹-165.00");
    expect(row("Net taxable supply value").alert).toBe(true);
    expect(row("Why net is negative")).toBeDefined();
    const estimate = row("Tax at the configured rate (INDICATIVE ESTIMATE)").value;
    expect(String(estimate)).toMatch(/withheld/);
    expect(String(estimate)).not.toContain("-₹");
  });

  it("says TDS is not configured rather than claiming a nil deduction", async () => {
    healthy();
    const [tax] = await buildTaxSections(MONTH);
    const tds = tax.rows.find((r) => r.label === "TDS on partner payouts")!;
    expect(String(tds.value)).toMatch(/not configured/);
    // A printed ₹0.00 would assert a deduction was made and accounted for.
    expect(String(tds.value)).not.toContain("₹");
  });

  it("gives no indicative number when no rate is configured", async () => {
    healthy();
    (prisma as any).booking.findMany.mockResolvedValue([{ finalAmount: 1000 }]);
    (prisma as any).pricingConfig.findFirst.mockResolvedValue(null);
    const [tax] = await buildTaxSections(MONTH);
    expect(tax.rows.find((r) => r.label.includes("INDICATIVE"))!.value).toBe("n/a");
  });

  it("contains only the tax section", async () => {
    healthy();
    const sections = await buildTaxSections(MONTH);
    expect(sections.map((s) => s.title)).toEqual(["Tax and statutory"]);
  });
});

describe("next-month outlook", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("separates real scheduled work from projections", async () => {
    healthy();
    const sections = await buildOutlookSections(MONTH, new Date(2026, 9, 4, 0, 5));
    const labels = sections[0].rows.map((r) => r.label);
    const split = labels.findIndex((l) => l.includes("estimates, not commitments"));
    expect(split).toBeGreaterThan(-1);
    // Real commitments come first; the projection is fenced behind the heading.
    expect(labels.slice(0, split)).toContain("Bookings scheduled");
    expect(labels.slice(split + 1)).toContain("Projected bookings over 30 days");
  });

  it("projects from the closed window's own run rate, labelled as such", async () => {
    healthy();
    (prisma as any).user.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }]);
    const rows = (await buildOutlookSections(MONTH, new Date(2026, 9, 4, 0, 5)))[0].rows;
    const perDay = rows.find((r) => r.label.includes("New signups per day"))!;
    // September has 30 days, 2 signups over it.
    expect(perDay.value).toBeCloseTo(2 / 30, 5);
    expect(perDay.label).toContain("actual");
  });
});

describe("CSV export", () => {
  // Scoped to THIS describe on purpose. Declaring the cleanup next to the
  // override test in a different block left DIGEST_EXPORT_ROLES="SUPPORT" set
  // for every later test, which silently stopped FINANCE getting an attachment
  // and failed the test below for a reason that had nothing to do with it.
  afterEach(() => {
    delete process.env.DIGEST_EXPORT_ROLES;
    delete process.env.DIGEST_EMAIL_FINANCE;
    delete process.env.DIGEST_EMAIL_MODERATOR;
  });

  beforeEach(() => { vi.clearAllMocks(); });

  const withMoney: DigestSection[] = [
    { title: "Financials", rows: [{ label: "Wallet float (customer)", value: "₹1,50,000.00" }] },
    { title: "Help desk", rows: [{ label: "Tickets opened", value: 7 }] },
  ];

  it("exports only the sections that role can see", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, DAY);
    expect(csv).toContain("Wallet float (customer)");
    expect(csv).toContain("Rs 1,50,000.00");
    // Support figures must not ride along in finance's spreadsheet.
    expect(csv).not.toContain("Tickets opened");
  });

  it("stamps the period, both window bounds and the sections actually present", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, MONTH);
    expect(csv).toContain("FINANCE");
    expect(csv).toContain("Nabri monthly report");
    expect(csv).toContain(`Window start (inclusive),${MONTH.since.toISOString()}`);
    expect(csv).toContain(`Window end (exclusive),${MONTH.until.toISOString()}`);
    expect(csv).toContain("Section,Metric,Value");
    // Not the role's whole wishlist: this file has no tax rows, so it must not
    // claim a tax section.
    expect(csv).toContain("Sections,Financials");
    expect(csv).not.toContain("Tax and statutory");
  });

  it("neutralises spreadsheet formula injection", () => {
    const nasty: DigestSection[] = [
      { title: "Platform", rows: [{ label: '=HYPERLINK("http://evil","x")', value: 1 }] },
      { title: "Platform", rows: [{ label: "+cmd|calc", value: 1 }] },
    ];
    const csv = buildDigestCsv("SUPER_ADMIN", nasty, DAY);
    // A leading = or + is executed by Excel and Sheets on open.
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd|calc");
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).not.toMatch(/,\+cmd/);
  });

  it("quotes and escapes cells containing commas, quotes or newlines", () => {
    const nasty: DigestSection[] = [
      { title: "Platform", rows: [{ label: 'a,b "c"\nd', value: 1 }] },
    ];
    const csv = buildDigestCsv("SUPER_ADMIN", nasty, DAY);
    expect(csv).toContain('"a,b ""c""\nd"');
  });

  it("is pure ASCII, so no reader can mis-decode it", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, DAY);
    // The attachment is opened by something that did not write it, and the
    // charset it guesses is not ours to control. A file with no byte above 0x7E
    // reads identically under utf-8, windows-1252 and latin-1, which is the only
    // way "₹1,50,000.00" cannot reach a finance admin as "â‚¹1,50,000.00".
    const offenders = [...csv].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e);
    expect(offenders).toEqual([]);
    // ...including the first character. A BOM is itself non-ASCII and is a known
    // way for a stray character to land in the first header cell on import.
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("keeps amounts readable once folded to ASCII", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, DAY);
    // The figure has to survive the fold, not merely stop being mojibake: the
    // number and its magnitude are the whole point of the export.
    expect(csv).toContain("Rs 1,50,000.00");
    expect(csv).not.toContain("\u20b9");
    // Still a number a spreadsheet will parse, so a total column works.
    expect(/Rs\s[\d,]+\.\d{2}/.test(csv)).toBe(true);
  });

  it("folds an unmapped character instead of letting it through", () => {
    // No ASCII equivalent is known for this one. Passing it through would
    // reintroduce exactly the corruption the fold exists to prevent.
    const odd: DigestSection[] = [
      { title: "Platform", rows: [{ label: "emoji \u{1F600} label", value: 1 }] },
    ];
    const csv = buildDigestCsv("SUPER_ADMIN", odd, DAY);
    expect([...csv].every((ch) => (ch.codePointAt(0) ?? 0) <= 0x7e)).toBe(true);
    expect(csv).toContain("emoji ? label");
  });

  it("writes CRLF line endings so importers do not see one long line", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, DAY);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    // No bare LF anywhere, which would split rows in some readers.
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("names the file after the role, the period and the window", () => {
    expect(digestCsvFilename("FINANCE_ADMIN", DAY)).toBe("nabri-digest-finance_admin-daily-2026-10-03.csv");
    // Twelve reports a year are impossible to tell apart without the period in
    // the filename.
    expect(digestCsvFilename("SUPER_ADMIN", MONTH)).toBe("nabri-digest-super_admin-monthly-2026-09-01.csv");
  });

  it("declares its charset in the HTML head", () => {
    // emailTemplate.ts already does this for the OTP mail. Without it the digest
    // is the one mail in the system that leaves the encoding to the reader, and
    // a client guessing windows-1252 renders every amount as mojibake.
    const html = renderDigestHtml("FINANCE", withMoney, DAY);
    expect(html).toMatch(/<head>/i);
    expect(html).toMatch(/<meta[^>]+charset=["']?utf-8/i);
    // The declaration must come before any body text, not after it.
    expect(html.indexOf("charset")).toBeLessThan(html.indexOf("<body"));
  });

  it("attaches for the roles that reconcile money and not for the rest", () => {
    for (const r of ["SUPER_ADMIN", "ADMIN", "FINANCE", "FINANCE_ADMIN"] as DigestRole[]) {
      expect(shouldAttachCsv(r)).toBe(true);
    }
    for (const r of ["KYC_ADMIN", "MODERATOR", "SUPPORT", "MARKETING_ADMIN", "PARTNER_ADMIN"] as DigestRole[]) {
      expect(shouldAttachCsv(r)).toBe(false);
    }
  });

  it("honours an explicit override of which roles get the file", () => {
    process.env.DIGEST_EXPORT_ROLES = "SUPPORT";
    expect(shouldAttachCsv("SUPPORT")).toBe(true);
    expect(shouldAttachCsv("FINANCE")).toBe(false);
  });

  it("really passes the attachment through to the mailer", async () => {
    process.env.DIGEST_EMAIL_FINANCE = "fin@example.com";
    const { sendEmail } = await import("../services/emailService.js");
    (sendEmail as any).mockResolvedValue({ ok: true, provider: "test" });

    const sections: DigestSection[] = [
      { title: "Financials", rows: [{ label: "Wallet float (customer)", value: "₹10.00" }] },
    ];
    const res = await sendDigestForRole("FINANCE", ["fin@example.com"], sections, DAY);

    expect(res.sent).toBe(1);
    const call = (sendEmail as any).mock.calls.at(-1);
    expect(call[4]?.attachments?.[0]?.filename).toBe("nabri-digest-finance-daily-2026-10-03.csv");
    expect(call[4]?.attachments?.[0]?.content?.toString("utf8")).toContain("Wallet float (customer)");
    delete process.env.DIGEST_EMAIL_FINANCE;
  });

  it("puts the period in the subject, not just the body", async () => {
    const { sendEmail } = await import("../services/emailService.js");
    (sendEmail as any).mockResolvedValue({ ok: true, provider: "test" });
    await sendDigestForRole("SUPER_ADMIN", ["boss@example.com"], SECTIONS, MONTH);
    const subject = (sendEmail as any).mock.calls.at(-1)[2];
    expect(subject).toContain("Nabri monthly report");
    expect(subject).toContain(MONTH.label);
  });

  it("sends no attachment to a role that should not have one", async () => {
    process.env.DIGEST_EMAIL_MODERATOR = "mod@example.com";
    const { sendEmail } = await import("../services/emailService.js");
    (sendEmail as any).mockResolvedValue({ ok: true, provider: "test" });

    const sections: DigestSection[] = [
      { title: "Trust and safety", rows: [{ label: "Chat reports", value: 0 }] },
    ];
    await sendDigestForRole("MODERATOR", ["mod@example.com"], sections, DAY);

    const call = (sendEmail as any).mock.calls.at(-1);
    expect(call[4]).toBeUndefined();
    delete process.env.DIGEST_EMAIL_MODERATOR;
  });
});

describe("scheduler", () => {
  beforeEach(async () => {
    vi.resetModules();
    const m = await import("../services/digestScheduler.js");
    m.resetRunMarkers();
  });
  afterEach(() => { vi.resetModules(); });

  const load = () => import("../services/digestScheduler.js");

  it("fires the daily report only in the hour after midnight", async () => {
    const { isDue } = await load();
    expect(isDue("DAILY", new Date(2026, 9, 4, 0, 5))).toBe(true);
    expect(isDue("DAILY", new Date(2026, 9, 4, 13, 5))).toBe(false);
  });

  it("does not fire twice for the same period", async () => {
    const { isDue, runReport } = await load();
    const midnight = new Date(2026, 9, 4, 0, 1);
    expect(isDue("DAILY", midnight)).toBe(true);
    await runReport("DAILY", midnight);
    expect(isDue("DAILY", new Date(2026, 9, 4, 0, 30))).toBe(false);
    // ...but the next day is a new period and fires again.
    expect(isDue("DAILY", new Date(2026, 9, 5, 0, 1))).toBe(true);
  });

  it("fires a weekly report only on a Monday", async () => {
    const { isDue } = await load();
    // 4 Oct 2026 is a Sunday, 5 Oct a Monday.
    expect(isDue("WEEKLY", new Date(2026, 9, 5, 0, 5))).toBe(true);
    expect(isDue("WEEKLY", new Date(2026, 9, 6, 0, 5))).toBe(false);
    expect(isDue("WEEKLY", new Date(2026, 9, 7, 0, 5))).toBe(false);
  });

  it("fires monthly and quarterly only on their first day", async () => {
    const { isDue } = await load();
    expect(isDue("MONTHLY", new Date(2026, 9, 1, 0, 5))).toBe(true);
    expect(isDue("MONTHLY", new Date(2026, 9, 2, 0, 5))).toBe(false);
    // October is the first month of the Oct-Dec quarter, so the 1st is both.
    expect(isDue("QUARTERLY", new Date(2026, 9, 1, 0, 5))).toBe(true);
    expect(isDue("QUARTERLY", new Date(2026, 10, 1, 0, 5))).toBe(false);
  });

  it("fires the yearly report only on 1 January", async () => {
    const { isDue } = await load();
    expect(isDue("YEARLY", new Date(2027, 0, 1, 0, 5))).toBe(true);
    expect(isDue("YEARLY", new Date(2027, 0, 2, 0, 5))).toBe(false);
  });

  it("staggers the outlook and the tax report away from the monthly send", async () => {
    const { isDue } = await load();
    const first = new Date(2026, 9, 1, 0, 5);
    // The outlook waits an hour and the tax report two, so seven heavy report
    // builds never share one tick with the daily and monthly ones.
    expect(isDue("MONTHLY", first)).toBe(true);
    expect(isDue("NEXT_MONTH", first)).toBe(false);
    expect(isDue("TAX", first)).toBe(false);
    expect(isDue("NEXT_MONTH", new Date(2026, 9, 1, 1, 5))).toBe(true);
    expect(isDue("TAX", new Date(2026, 9, 1, 2, 5))).toBe(true);
  });

  it("lists every cadence that is due at a quarter start", async () => {
    const { pendingPeriods } = await load();
    // 1 Oct 2026: daily, monthly and quarterly all land on the same midnight.
    expect(pendingPeriods(new Date(2026, 9, 1, 0, 5)).sort()).toEqual(["DAILY", "MONTHLY", "QUARTERLY"]);
  });

  it("puts the tax table in the long-period mails but not the daily one", async () => {
    const { sectionsForPeriod } = await load();
    const now = new Date(2026, 9, 1, 0, 5);
    healthy();
    expect((await sectionsForPeriod("DAILY", periodWindow("DAILY", now), now)).map((s) => s.title))
      .not.toContain("Tax and statutory");
    expect((await sectionsForPeriod("MONTHLY", periodWindow("MONTHLY", now), now)).map((s) => s.title))
      .toContain("Tax and statutory");
    expect((await sectionsForPeriod("NEXT_MONTH", periodWindow("NEXT_MONTH", now), now)).map((s) => s.title))
      .toContain("Next month outlook");
    expect((await sectionsForPeriod("TAX", periodWindow("TAX", now), now)).map((s) => s.title))
      .toEqual(["Tax and statutory"]);
  });
});

describe("period windows", () => {
  const at = (y: number, m: number, d: number, h = 0, min = 5) => new Date(y, m, d, h, min);

  it("closes the day at local midnight, not 24 hours before now", () => {
    const w = periodWindow("DAILY", at(2026, 9, 4, 0, 5));
    expect(w.until.getHours()).toBe(0);
    expect(w.until.getDate()).toBe(4);
    expect(w.since.getDate()).toBe(3);
  });

  it("runs the week Monday to Sunday", () => {
    // Wednesday 7 Oct: the completed week is Mon 28 Sep to Sun 4 Oct.
    const w = periodWindow("WEEKLY", at(2026, 9, 7));
    expect(w.since.getDay()).toBe(1);
    expect(w.since.getDate()).toBe(28);
    expect(w.until.getDay()).toBe(1);
    expect(w.until.getDate()).toBe(5);
  });

  it("closes the month on the first and rolls back across the year", () => {
    const w = periodWindow("MONTHLY", at(2026, 0, 15));
    expect(w.until.getFullYear()).toBe(2026);
    expect(w.until.getMonth()).toBe(0);
    expect(w.since.getFullYear()).toBe(2025);
    expect(w.since.getMonth()).toBe(11);
  });

  it("closes the quarter on its first month", () => {
    const q = periodWindow("QUARTERLY", at(2026, 10, 15));
    expect(q.until.getMonth()).toBe(9);
    expect(q.since.getMonth()).toBe(6);
    // January must roll back into the previous year, not into month -2.
    const jan = periodWindow("QUARTERLY", at(2027, 1, 15));
    expect(jan.until.getFullYear()).toBe(2027);
    expect(jan.since.getFullYear()).toBe(2026);
    expect(jan.since.getMonth()).toBe(9);
  });

  it("closes the year on 1 January", () => {
    const y = periodWindow("YEARLY", at(2026, 5, 15));
    expect(y.until.getMonth()).toBe(0);
    expect(y.since.getFullYear()).toBe(2025);
  });

  it("gives every period a distinct, stable key", () => {
    const a = periodWindow("DAILY", at(2026, 9, 4));
    const b = periodWindow("DAILY", at(2026, 9, 4, 23, 59));
    expect(a.key).toBe(b.key);
    expect(a.key).not.toBe(periodWindow("DAILY", at(2026, 9, 5)).key);
  });

  it("labels each period with the word its rows use", () => {
    expect(periodWindow("DAILY", at(2026, 9, 4)).word).toBe("today");
    expect(periodWindow("WEEKLY", at(2026, 9, 4)).word).toBe("this week");
    expect(periodWindow("MONTHLY", at(2026, 9, 4)).word).toBe("this month");
    expect(periodWindow("QUARTERLY", at(2026, 9, 4)).word).toBe("this quarter");
    expect(periodWindow("YEARLY", at(2026, 9, 4)).word).toBe("this year");
  });
});
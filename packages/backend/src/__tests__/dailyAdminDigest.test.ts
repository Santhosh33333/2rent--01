/**
 * Daily admin digest.
 *
 * The behaviours worth protecting are the ones that would fail silently in
 * production: a role seeing another role's numbers, a failed query rendering as
 * a confident 0, and the scheduler sending twice for one day.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  DIGEST_ROLES,
  buildDigestSections,
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

vi.mock("../config/database", () => ({
  prisma: {
    user: { findMany: vi.fn() },
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
  },
}));

// Mocked so importing the digest does not pull in the real email service, whose
// env validation runs at import time and would fail the whole suite. Same
// pattern the agent tool tests use.
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: false, provider: "none", error: "not configured" }),
}));

import { prisma } from "../config/database";

const SECTIONS: DigestSection[] = [
  { title: "Platform", rows: [{ label: "Users total", value: 11 }, { label: "Failed admin logins", value: 2, alert: true }] },
  { title: "Verification (KYC)", rows: [{ label: "Total", value: 4 }, { label: "APPROVED", value: 2 }] },
  { title: "Money", rows: [{ label: "Bookings", value: 12 }, { label: "Pending withdrawals", value: 3, alert: true }] },
  { title: "Help desk", rows: [{ label: "Tickets", value: 1 }] },
  { title: "Trust and safety", rows: [{ label: "Chat reports", value: 0, alert: true }] },
  { title: "Growth", rows: [{ label: "Referrals", value: 0 }] },
  { title: "Partner supply", rows: [{ label: "Partners", value: 1 }] },
];

describe("sectionsForRole", () => {
  it("gives each admin role only what it acts on", () => {
    expect(sectionsForRole("FINANCE")).toEqual(["Money", "Financials"]);
    expect(sectionsForRole("FINANCE_ADMIN")).toEqual(["Money", "Financials"]);
    expect(sectionsForRole("KYC_ADMIN")).toEqual(["Verification (KYC)"]);
    expect(sectionsForRole("MODERATOR")).toEqual(["Trust and safety"]);
    expect(sectionsForRole("PARTNER_ADMIN")).toEqual(["Partner supply"]);
    expect(sectionsForRole("SUPER_ADMIN")).toEqual(["Platform", "End-to-end funnel", "Dating"]);
  });

  it("keeps rupee figures away from roles that do not reconcile money", () => {
    // The Financials section is the one that can move a payout. A KYC or
    // moderation admin seeing a wallet float is a permissions smell even though
    // it leaks no one else's data.
    for (const role of ["KYC_ADMIN", "MODERATOR", "SUPPORT", "MARKETING_ADMIN", "PARTNER_ADMIN"]) {
      expect(sectionsForRole(role as DigestRole)).not.toContain("Financials");
    }
  });

  it("never hands a role a section outside its remit", () => {
    const allow: Record<string, string[]> = {
      Money: ["FINANCE", "FINANCE_ADMIN"],
      Financials: ["FINANCE", "FINANCE_ADMIN"],
      "Verification (KYC)": ["KYC_ADMIN"],
      "Help desk": ["SUPPORT", "SUPPORT_ADMIN"],
      "Trust and safety": ["MODERATOR"],
      Growth: ["MARKETING_ADMIN"],
      "Partner supply": ["PARTNER_ADMIN"],
      Platform: ["SUPER_ADMIN", "ADMIN"],
      "End-to-end funnel": ["SUPER_ADMIN", "ADMIN"],
      Dating: ["SUPER_ADMIN", "ADMIN"],
    };
    for (const role of DIGEST_ROLES) {
      for (const title of sectionsForRole(role)) {
        expect(allow[title]).toContain(role);
      }
    }
  });

  it("never returns an empty digest", () => {
    for (const role of DIGEST_ROLES) {
      expect(sectionsForRole(role).length).toBeGreaterThan(0);
    }
  });
});

describe("rendering", () => {
  const end = new Date("2026-10-04T00:00:00.000Z");

  it("does not leak other roles' figures into the HTML", () => {
    const html = renderDigestHtml("KYC_ADMIN", SECTIONS, end);
    expect(html).toContain("Verification (KYC)");
    expect(html).not.toContain("Pending withdrawals");
    expect(html).not.toContain("Chat reports");
  });

  it("does not leak into the plain-text twin either", () => {
    const text = renderDigestText("FINANCE", SECTIONS, end);
    expect(text).toContain("MONEY");
    expect(text).not.toContain("CHAT REPORTS");
    expect(text).not.toContain("GROWTH");
  });

  it("escapes labels rather than emitting raw HTML", () => {
    const nasty: DigestSection[] = [{ title: "Platform", rows: [{ label: "<script>x</script>", value: 1 }] }];
    const html = renderDigestHtml("SUPER_ADMIN", nasty, end);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("prints n/a verbatim rather than dressing it up as zero", () => {
    const gapped: DigestSection[] = [{ title: "Platform", rows: [{ label: "Errors logged", value: "n/a" }] }];
    expect(renderDigestText("SUPER_ADMIN", gapped, end)).toMatch(/Errors logged\s+n\/a/);
  });

  it("flags alert rows visually", () => {
    const html = renderDigestHtml("MODERATOR", SECTIONS, end);
    expect(html).toContain("#b91c1c");
  });

  it("formats real numbers with Indian grouping", () => {
    const big: DigestSection[] = [{ title: "Platform", rows: [{ label: "Users", value: 1234567 }] }];
    expect(renderDigestText("SUPER_ADMIN", big, end)).toContain("12,34,567");
  });
});

describe("recipientsForRole", () => {
  afterEach(() => { delete process.env.DIGEST_EMAIL_FINANCE; });

  it("is empty when unset, so the run is a no-op rather than a failure", () => {
    delete process.env.DIGEST_EMAIL_FINANCE;
    expect(recipientsForRole("FINANCE")).toEqual([]);
  });

  it("splits and trims a comma-separated list", () => {
    process.env.DIGEST_EMAIL_FINANCE = " a@example.com , b@example.com ,, ";
    expect(recipientsForRole("FINANCE")).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("buildDigestSections", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("resolves every metric when the database is healthy", async () => {
    for (const model of Object.keys(prisma as unknown as Record<string, unknown>)) {
      (prisma as any)[model].findMany.mockResolvedValue([]);
    }
    const sections = await buildDigestSections(new Date());
    const flat = sections.flatMap((s) => s.rows);
    expect(flat.length).toBeGreaterThan(20);
    expect(flat.filter((r) => r.value === "n/a")).toHaveLength(0);
  });

  it("reports a failed query as n/a instead of a false zero", async () => {
    for (const model of Object.keys(prisma as unknown as Record<string, unknown>)) {
      (prisma as any)[model].findMany.mockResolvedValue([]);
    }
    // One model blows up; it must not poison the rest of the digest.
    (prisma as any).withdrawalRequest.findMany.mockRejectedValue(new Error("boom"));

    const sections = await buildDigestSections(new Date());
    const money = sections.find((s) => s.title === "Money")!;
    const row = money.rows.find((r) => r.label === "Pending withdrawals")!;
    expect(row.value).toBe("n/a");
    // and the section around it still has real numbers
    expect(money.rows.find((r) => r.label === "Bookings")!.value).not.toBe("n/a");
  });
});

describe("financial figures", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { delete process.env.DIGEST_EXPORT_ROLES; });

  const healthy = () => {
    for (const model of Object.keys(prisma as unknown as Record<string, unknown>)) {
      (prisma as any)[model].findMany.mockResolvedValue([]);
    }
  };

  it("adds a Financials section carrying rupee amounts, not just counts", async () => {
    healthy();
    const sections = await buildDigestSections(new Date());
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
    const sections = await buildDigestSections(new Date());
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Wallet float (customer)")!;
    expect(row.value).toBe("₹150.75");
    expect(String(row.value)).not.toContain("NaN");
  });

  it("reports an unreachable money table as n/a, not ₹0.00", async () => {
    healthy();
    (prisma as any).wallet.findMany.mockRejectedValue(new Error("db down"));
    const sections = await buildDigestSections(new Date());
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Wallet float (customer)")!;
    // "₹0.00" here would tell finance the platform holds no customer money.
    expect(row.value).toBe("n/a");
  });

  it("reports dating request charges collected as revenue", async () => {
    healthy();
    // Dating requests bill the sender's wallet, so the money is real and the
    // financial report has to agree with the wallet ledger. A per-request
    // charge is small, but a day of them is a figure finance will ask for.
    (prisma as any).transaction.findMany.mockResolvedValue([
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "0.5" } },
      { amount: { toString: () => "7" } },
    ]);
    const sections = await buildDigestSections(new Date());
    const row = sections
      .find((s) => s.title === "Financials")!
      .rows.find((r) => r.label === "Dating request charges collected today")!;
    expect(row).toBeDefined();
    expect(row.value).toBe("₹8.50");
  });

  it("scopes the dating revenue line to the DATING_REQUEST ledger type", async () => {
    healthy();
    await buildDigestSections(new Date());
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

  it("breaks pipelines down by the statuses actually present", async () => {
    healthy();
    (prisma as any).booking.findMany.mockResolvedValue([
      { status: "COMPLETED" }, { status: "COMPLETED" }, { status: "CANCELLED" },
    ]);
    const sections = await buildDigestSections(new Date());
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
    const sections = await buildDigestSections(new Date());
    const dating = sections.find((s) => s.title === "Dating")!;
    expect(dating.rows.find((r) => r.label === "Requests sent total")!.value).toBe(2);
    expect(dating.rows.find((r) => r.label === "Matches total")!.value).toBe(1);
  });
});

describe("CSV export", () => {
  const end = new Date("2026-10-04T00:00:00.000Z");

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
    const csv = buildDigestCsv("FINANCE", withMoney, end);
    expect(csv).toContain("Wallet float (customer)");
    expect(csv).toContain("Rs 1,50,000.00");
    // Support figures must not ride along in finance's spreadsheet.
    expect(csv).not.toContain("Tickets opened");
  });

  it("stamps role and window so a downloaded file identifies itself", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, end);
    expect(csv).toContain("FINANCE");
    expect(csv).toContain("2026-10-04T00:00:00.000Z");
    expect(csv).toContain("Section,Metric,Value");
  });

  it("neutralises spreadsheet formula injection", () => {
    const nasty: DigestSection[] = [
      { title: "Platform", rows: [{ label: '=HYPERLINK("http://evil","x")', value: 1 }] },
      { title: "Platform", rows: [{ label: "+cmd|calc", value: 1 }] },
    ];
    const csv = buildDigestCsv("SUPER_ADMIN", nasty, end);
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
    const csv = buildDigestCsv("SUPER_ADMIN", nasty, end);
    expect(csv).toContain('"a,b ""c""\nd"');
  });

  it("is pure ASCII, so no reader can mis-decode it", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, end);
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
    const csv = buildDigestCsv("FINANCE", withMoney, end);
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
    const csv = buildDigestCsv("SUPER_ADMIN", odd, end);
    expect([...csv].every((ch) => (ch.codePointAt(0) ?? 0) <= 0x7e)).toBe(true);
    expect(csv).toContain("emoji ? label");
  });

  it("writes CRLF line endings so importers do not see one long line", () => {
    const csv = buildDigestCsv("FINANCE", withMoney, end);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    // No bare LF anywhere, which would split rows in some readers.
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("names the file after the role and the day", () => {
    expect(digestCsvFilename("FINANCE_ADMIN", end)).toBe("nabri-digest-finance_admin-2026-10-04.csv");
  });

  it("declares its charset in the HTML head", () => {
    // emailTemplate.ts already does this for the OTP mail. Without it the digest
    // is the one mail in the system that leaves the encoding to the reader, and
    // a client guessing windows-1252 renders every amount as mojibake.
    const html = renderDigestHtml("FINANCE", withMoney, end);
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
    const res = await sendDigestForRole("FINANCE", ["fin@example.com"], sections, end);

    expect(res.sent).toBe(1);
    const call = (sendEmail as any).mock.calls.at(-1);
    expect(call[4]?.attachments?.[0]?.filename).toBe("nabri-digest-finance-2026-10-04.csv");
    expect(call[4]?.attachments?.[0]?.content?.toString("utf8")).toContain("Wallet float (customer)");
    delete process.env.DIGEST_EMAIL_FINANCE;
  });

  it("sends no attachment to a role that should not have one", async () => {
    process.env.DIGEST_EMAIL_MODERATOR = "mod@example.com";
    const { sendEmail } = await import("../services/emailService.js");
    (sendEmail as any).mockResolvedValue({ ok: true, provider: "test" });

    const sections: DigestSection[] = [
      { title: "Trust and safety", rows: [{ label: "Chat reports", value: 0 }] },
    ];
    await sendDigestForRole("MODERATOR", ["mod@example.com"], sections, end);

    const call = (sendEmail as any).mock.calls.at(-1);
    expect(call[4]).toBeUndefined();
    delete process.env.DIGEST_EMAIL_MODERATOR;
  });
});

describe("scheduler", () => {
  beforeEach(async () => {
    vi.resetModules();
    const m = await import("../services/digestScheduler.js");
    m.markDigestRun("");
  });
  afterEach(() => { vi.resetModules(); });

  it("only fires at the configured hour", async () => {
    const { shouldRunNow } = await import("../services/digestScheduler.js");
    expect(shouldRunNow(new Date(2026, 9, 4, 0, 5), 0)).toBe(true);
    expect(shouldRunNow(new Date(2026, 9, 4, 13, 5), 0)).toBe(false);
  });

  it("does not fire twice for the same day", async () => {
    const { shouldRunNow, markDigestRun: mark } = await import("../services/digestScheduler.js");
    const midnight = new Date(2026, 9, 4, 0, 1);
    expect(shouldRunNow(midnight, 0)).toBe(true);
    mark(`${midnight.getFullYear()}-${midnight.getMonth() + 1}-${midnight.getDate()}`);
    expect(shouldRunNow(new Date(2026, 9, 4, 0, 30), 0)).toBe(false);
    // ...but the next day is a new day and fires again
    expect(shouldRunNow(new Date(2026, 9, 5, 0, 1), 0)).toBe(true);
  });
});

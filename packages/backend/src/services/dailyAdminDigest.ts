/**
 * Daily admin digest — a midnight email with the numbers each admin role
 * actually acts on.
 *
 * WHY ROLE-SCOPED RATHER THAN ONE BIG EMAIL: a finance admin does not care that
 * 11 users exist, and a moderator does not care about payout totals. Sending
 * everyone everything means everyone skims past it. So each role gets its own
 * section set and its own recipient list.
 *
 * THREE THINGS THIS REFUSES TO DO:
 *
 * 1. Invent numbers. Every figure is a real aggregate. If a query fails the
 *    row renders as "n/a" rather than a confident 0, because a wrong zero in
 *    an ops email is worse than an obvious gap.
 * 2. Send twice for the same day. Guarded by `DailyDigestRun`, so a restart
 *    mid-window, or two instances racing, cannot double-send.
 * 3. Throw when email is unconfigured. `sendEmail` returns ok:false rather than
 *    throwing, and a broken provider must never take the scheduler down with it.
 */
import { prisma } from "../config/database";
import { sendEmail } from "./emailService";
import { buildDigestCsv, digestCsvFilename } from "./digestExport";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Admin roles, matching ADMIN_TIER_ROLES in middleware/auth.ts. */
export const DIGEST_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "KYC_ADMIN",
  "FINANCE",
  "FINANCE_ADMIN",
  "SUPPORT",
  "SUPPORT_ADMIN",
  "MODERATOR",
  "MARKETING_ADMIN",
  "PARTNER_ADMIN",
] as const;

export type DigestRole = (typeof DIGEST_ROLES)[number];

/** Roles whose reader cares about which slice. Each set maps to a section. */
const PLATFORM_ROLES: DigestRole[] = ["SUPER_ADMIN", "ADMIN"];
const KYC_ROLES: DigestRole[] = ["KYC_ADMIN"];
const FINANCE_ROLES: DigestRole[] = ["FINANCE", "FINANCE_ADMIN"];
const SUPPORT_ROLES: DigestRole[] = ["SUPPORT", "SUPPORT_ADMIN"];
const MODERATION_ROLES: DigestRole[] = ["MODERATOR"];
const MARKETING_ROLES: DigestRole[] = ["MARKETING_ADMIN"];
const PARTNER_ROLES: DigestRole[] = ["PARTNER_ADMIN"];

/**
 * Counts via findMany + length rather than `count()`.
 *
 * `count()`'s first positional argument is easy to get wrong: passing a filter
 * there is interpreted as `select` by some client versions, which fails in a
 * way that reads like a type error instead of a mistake in the call. This form
 * is unambiguous and the row counts here are small enough that it costs nothing.
 *
 * Re-exported from digestFigures so every count in the digest goes through one
 * implementation rather than two that can drift apart.
 */
export { tally, rupees, sumOf, countAndSum, statusRows } from "./digestFigures";
import { tally, financialRows, funnelRows, datingRows } from "./digestFigures";

/**
 * A digest value is a count, a formatted money string, or "n/a".
 *
 * The string arm exists for money. Counts must stay numeric so they can be
 * summed and compared in tests; a rupee figure is formatted for humans
 * ("₹1,23,456.50") and must not be re-formatted by the renderer, or a value
 * that is already grouped gets grouped twice.
 */
export type DigestValue = number | string;

export type DigestRow = {
  label: string;
  value: DigestValue;
  /** Highlighted red: this is the number that should prompt action today. */
  alert?: boolean;
};

export type DigestSection = {
  title: string;
  rows: DigestRow[];
};

export async function buildDigestSections(since: Date): Promise<DigestSection[]> {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * DAY_MS);

  return [
    {
      title: "Platform",
      rows: [
        { label: "Users total", value: await tally("user") },
        { label: "New users", value: await tally("user", { createdAt: { gte: since } }) },
        { label: "Partners", value: await tally("partner") },
        { label: "Admin accounts", value: await tally("adminUser") },
        { label: "Failed admin logins", value: await tally("adminLoginAttempt", { success: false }) },
        { label: "Events", value: await tally("event") },
        { label: "Events created", value: await tally("event", { createdAt: { gte: since } }) },
        { label: "Communities", value: await tally("community") },
        { label: "Errors logged", value: await tally("errorLog", { createdAt: { gte: since } }) },
        { label: "Audit entries", value: await tally("auditLog", { createdAt: { gte: since } }) },
      ],
    },
    {
      title: "Verification (KYC)",
      rows: await kycRows(since),
    },
    {
      title: "Money",
      rows: [
        { label: "Bookings", value: await tally("booking") },
        { label: "Bookings created", value: await tally("booking", { createdAt: { gte: since } }) },
        { label: "Payment orders", value: await tally("paymentOrder", { createdAt: { gte: since } }) },
        { label: "Transactions", value: await tally("transaction", { createdAt: { gte: since } }) },
        { label: "Pending withdrawals", value: await tally("withdrawalRequest", { status: "PENDING" }), alert: true },
        { label: "Pending top-ups", value: await tally("topupRequest", { status: "PENDING" }), alert: true },
        { label: "Refunds", value: await tally("refundLog", { createdAt: { gte: since } }) },
      ],
    },
    {
      title: "Financials",
      rows: await financialRows(since),
    },
    {
      title: "Help desk",
      rows: [
        { label: "Tickets", value: await tally("supportTicket") },
        { label: "Tickets opened", value: await tally("supportTicket", { createdAt: { gte: since } }) },
        { label: "Chat requests pending", value: await tally("chatRequest", { status: "PENDING" }) },
        { label: "Messages", value: await tally("message", { createdAt: { gte: since } }) },
        { label: "Active SOS alerts", value: await tally("sosAlert", { status: "ACTIVE" }), alert: true },
        { label: "SOS alerts raised", value: await tally("sosAlert", { createdAt: { gte: since } }), alert: true },
      ],
    },
    {
      title: "Trust and safety",
      rows: [
        { label: "Chat reports", value: await tally("chatReport"), alert: true },
        { label: "Reports raised", value: await tally("report", { createdAt: { gte: since } }) },
        { label: "User blocks", value: await tally("userBlock") },
        { label: "Blocklist entries", value: await tally("blocklistEntry") },
      ],
    },
    {
      title: "Growth",
      rows: [
        { label: "Referrals", value: await tally("referral") },
        { label: "Subscriptions", value: await tally("subscription") },
        { label: "Campaigns", value: await tally("broadcastCampaign") },
        { label: "Articles", value: await tally("contentArticle") },
        { label: "Events in next 7 days", value: await tally("event", { startTime: { gte: now, lte: soon } }) },
      ],
    },
    {
      title: "Partner supply",
      rows: [
        { label: "Partners", value: await tally("partner") },
        { label: "Walking partners", value: await tally("walkingPartner") },
        { label: "Open walking requests", value: await tally("walkingRequest", { status: "OPEN" }) },
        { label: "Role applications pending", value: await tally("roleApplication", { status: "PENDING" }), alert: true },
        { label: "Bookings awaiting partner", value: await tally("booking", { status: "PARTNER_SEARCHING" }), alert: true },
      ],
    },
    {
      title: "End-to-end funnel",
      rows: await funnelRows(since),
    },
    {
      title: "Dating",
      rows: await datingRows(since),
    },
  ];
}

async function kycRows(since: Date): Promise<DigestRow[]> {
  const base: DigestRow[] = [
    { label: "Suspended users", value: await tally("user", { status: "SUSPENDED" }), alert: true },
  ];
  try {
    const rows: Array<{ status: string; createdAt: Date }> = await (prisma as any).verification.findMany({
      select: { status: true, createdAt: true },
    });
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const out: DigestRow[] = [{ label: "Total", value: rows.length }];
    for (const status of Object.keys(byStatus).sort()) {
      out.push({ label: status, value: byStatus[status] });
    }
    out.push({ label: "New in period", value: rows.filter((r) => new Date(r.createdAt) >= since).length });
    return [...out, ...base];
  } catch {
    return [{ label: "Verification queue", value: "n/a" }, ...base];
  }
}

/** Which sections a role receives, in the order it receives them. */
export function sectionsForRole(role: DigestRole): string[] {
  const titles: string[] = [];
  if (PLATFORM_ROLES.includes(role)) {
    titles.push("Platform");
    // The funnel and dating volume are platform-level: they describe how the
    // whole product is moving, not one admin's queue.
    titles.push("End-to-end funnel", "Dating");
  }
  if (KYC_ROLES.includes(role)) titles.push("Verification (KYC)");
  if (FINANCE_ROLES.includes(role)) {
    titles.push("Money");
    // Counts for context, then the rupee figures they actually reconcile with.
    titles.push("Financials");
  }
  if (SUPPORT_ROLES.includes(role)) titles.push("Help desk");
  if (MODERATION_ROLES.includes(role)) titles.push("Trust and safety");
  if (MARKETING_ROLES.includes(role)) titles.push("Growth");
  if (PARTNER_ROLES.includes(role)) titles.push("Partner supply");
  // An admin with no specific remit still gets the platform view rather than
  // an empty email, which would read as "the digest broke".
  return titles.length ? titles : ["Platform"];
}

/** Recipients per role, from DIGEST_EMAIL_<ROLE>. Comma separated, optional. */
export function recipientsForRole(role: DigestRole): string[] {
  const key = `DIGEST_EMAIL_${role}`;
  return (process.env[key] ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Counts are grouped here; strings (already-formatted money, or "n/a") are
 * passed through untouched. Re-formatting a string would group a figure that is
 * already grouped and print "₹1,23,456.50" as "₹1,23,456.50" via toLocaleString
 * on a non-number, which silently yields the string again but breaks the moment
 * the value is anything else.
 */
const fmt = (v: DigestValue) => (typeof v === "number" ? v.toLocaleString("en-IN") : v);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders the HTML email. Table-based and inline-styled on purpose: email
 * clients strip <style> and ignore most modern layout, and this has to render in
 * Gmail, Outlook and the iOS mail app without a build step.
 *
 * The explicit <meta charset> is not decoration. It matches what
 * emailTemplate.ts already does for the OTP mail, and without it the digest is
 * the one mail in the system whose encoding is left to the reader: a client that
 * guesses windows-1252 renders every amount as "â‚¹4,200.00", which a finance
 * admin has to decode before they can trust the figure.
 */
export function renderDigestHtml(role: DigestRole, sections: DigestSection[], windowEnd: Date): string {
  const wanted = sectionsForRole(role);
  const shown = sections.filter((s) => wanted.includes(s.title));

  const blocks = shown
    .map((section) => {
      const rows = section.rows
        .map(
          (r) => `<tr>
            <td style="padding:6px 0;color:#475569;font-size:14px;">${esc(r.label)}</td>
            <td style="padding:6px 0;text-align:right;font-size:14px;font-weight:700;color:${r.alert ? "#b91c1c" : "#0f172a"};">${fmt(r.value)}</td>
          </tr>`,
        )
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td colspan="2" style="padding:0 0 8px;border-bottom:2px solid #e2e8f0;">
          <span style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;font-weight:700;">${esc(section.title)}</span>
        </td></tr>
        ${rows}
      </table>`;
    })
    .join("");

  const stamp = windowEnd.toISOString().slice(0, 16).replace("T", " ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Nabri daily digest</title>
</head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
    <tr><td style="padding:24px 24px 8px;">
      <div style="font-size:18px;font-weight:800;color:#0f172a;">Nabri daily digest</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">
        ${esc(stamp)} UTC &middot; role: ${esc(role)}
      </div>
    </td></tr>
    <tr><td style="padding:8px 24px 24px;">
      ${blocks || '<p style="color:#64748b;font-size:14px;">No sections apply to this role.</p>'}
      <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
        Figures cover the 24 hours to the timestamp above. &ldquo;n/a&rdquo; means that
        query could not run, which is itself worth knowing &mdash; it is never a substitute for zero.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

/** Plain-text twin, for clients that refuse the HTML part. */
export function renderDigestText(role: DigestRole, sections: DigestSection[], windowEnd: Date): string {
  const wanted = sectionsForRole(role);
  const lines: string[] = [
    "Nabri daily digest",
    `${windowEnd.toISOString().slice(0, 16).replace("T", " ")} UTC  role: ${role}`,
    "",
  ];
  for (const section of sections.filter((s) => wanted.includes(s.title))) {
    lines.push(section.title.toUpperCase());
    for (const r of section.rows) lines.push(`  ${r.label.padEnd(30, " ")} ${fmt(r.value)}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Roles that get the spreadsheet attachment.
 *
 * Anyone who reconciles money wants it; a KYC or moderation admin does not, and
 * attaching a file they will never open is how "daily report" turns into
 * "daily report nobody reads". Override with DIGEST_EXPORT_ROLES to add or drop
 * a role without a deploy.
 */
const EXPORT_ROLES: DigestRole[] = ["SUPER_ADMIN", "ADMIN", "FINANCE", "FINANCE_ADMIN"];

export function shouldAttachCsv(role: DigestRole): boolean {
  const override = (process.env.DIGEST_EXPORT_ROLES ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean) as DigestRole[];
  return override.length ? override.includes(role) : EXPORT_ROLES.includes(role);
}

/**
 * Sends one role's digest. Returns a per-role outcome so the caller can log
 * precisely what failed rather than "the digest failed".
 */
export async function sendDigestForRole(
  role: DigestRole,
  recipients: string[],
  sections: DigestSection[],
  windowEnd: Date,
): Promise<{ role: DigestRole; attempted: number; sent: number; skipped: boolean; error?: string }> {
  if (recipients.length === 0) {
    return { role, attempted: 0, sent: 0, skipped: true, error: "no recipients configured" };
  }
  const html = renderDigestHtml(role, sections, windowEnd);
  const text = renderDigestText(role, sections, windowEnd);
  const subject = `Nabri daily digest - ${role} - ${windowEnd.toISOString().slice(0, 10)}`;

  let opts: { attachments?: Array<{ filename: string; content: Buffer }> } | undefined;
  if (shouldAttachCsv(role)) {
    opts = {
      attachments: [
        {
          filename: digestCsvFilename(role, windowEnd),
          content: Buffer.from(buildDigestCsv(role, sections, windowEnd), "utf8"),
        },
      ],
    };
  }

  let sent = 0;
  let lastError: string | undefined;
  for (const to of recipients) {
    const res = await sendEmail(to, subject, html, text, opts);
    if (res.ok) sent++;
    else lastError = res.error ?? "send failed";
  }
  return { role, attempted: recipients.length, sent, skipped: false, error: lastError };
}
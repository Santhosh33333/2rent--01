import { Response } from "express";
import * as XLSX from "xlsx";
import { prisma } from "../config/database";
import { sendSuccess, sendError, sendPaginated } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { sendEmail, sendBetaTesterConfirmationEmail } from "../services/emailService";

/**
 * Landing-page enquiry forms: beta tester, app feedback, investor/supporter.
 *
 * Each page still posts normally to formsubmit.co, so the founder's mailbox
 * keeps receiving every reply exactly as it always did. The browser mirrors the
 * same answers here as well, and that second copy is the whole point: a mailbox
 * cannot be sorted or exported, so "put every reply in one Excel sheet, one row
 * each" needs rows to read from.
 *
 * The public write is deliberately forgiving. A failed insert must never break
 * a visitor's submission, because the email half of that submission does not
 * depend on this service - so capture swallows its own errors and reports
 * success either way.
 */

const MAX_FIELDS = 60;
const MAX_VALUE_LENGTH = 4000;
const MAX_NAME_LENGTH = 160;
const MAX_SUBJECT_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
/** Export bounds: the sheet is a report, not a database dump. */
const EXPORT_LIMIT = 5000;

/** The beta-tester form's `Form` value. Matched case-insensitively. */
const BETA_TESTER_FORM = "beta tester";

/**
 * Filter for beta-tester rows. The landing page posts "Beta tester" while the
 * constant is lower-case, so every query must match case-insensitively - an
 * exact `form: "beta tester"` silently matched zero rows, which is why the
 * tester list/CSV always came back empty.
 */
const BETA_FORM_FILTER = { form: { equals: BETA_TESTER_FORM, mode: "insensitive" as const } };

type Row = {
  id: string;
  form: string;
  subject: string;
  name: string | null;
  email: string;
  fields: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  /** Set once the beta invitation has been emailed; null otherwise. */
  invitedAt: Date | null;
};

/** One value to a bounded string. Arrays are joined so a multi-select survives. */
function text(value: unknown, max: number): string {
  if (value === null || value === undefined) return "";
  const raw = Array.isArray(value)
    ? value.map((entry) => String(entry)).join(", ")
    : String(value);
  return raw.replace(/\u0000/g, "").trim().slice(0, max);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function asFields(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const fields: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const value_ = text(entry, MAX_VALUE_LENGTH);
    if (value_) fields[key.slice(0, 80)] = value_;
  }
  return fields;
}

/**
 * Deliver the beta invitation to one address at most once.
 *
 * Returns "skipped" when the address already received it, so a caller can tell
 * "nothing to do" apart from a real delivery failure. The address - not the
 * submission row - is the unit: the same person can apply twice and must only
 * be mailed once.
 */
async function inviteBetaTester(email: string, name: string | null): Promise<"sent" | "skipped" | "failed"> {
  const alreadyInvited = await prisma.formSubmission.count({
    where: { ...BETA_FORM_FILTER, email, invitedAt: { not: null } },
  });
  if (alreadyInvited > 0) return "skipped";

  const result = await sendBetaTesterConfirmationEmail(email, name || email);
  if (!result.ok) return "failed";

  await prisma.formSubmission.updateMany({
    where: { ...BETA_FORM_FILTER, email, invitedAt: null },
    data: { invitedAt: new Date() },
  });
  return "sent";
}

/**
 * POST /api/forms - public mirror of a landing-page form submission.
 *
 * The request body is the flat name/value map the HTML form itself posts, so
 * the page needs no adapter: whatever fields the form has, they land as-is.
 */
export async function capture(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const body = asRecord(req.body);

    // Honeypot. A bot fills the invisible field; a person never does. Answer
    // 200 either way - a 4xx teaches the bot to try something else, while a
    // quiet drop teaches it nothing and costs the visitor nothing.
    if (text(body._honey, 200) !== "") {
      sendSuccess(res, { stored: false }, undefined, 202);
      return;
    }

    const email = text(body.email ?? body.Email, MAX_EMAIL_LENGTH).toLowerCase();
    if (!isEmail(email)) {
      sendError(res, "A valid email is required.", 400, "EMAIL_REQUIRED");
      return;
    }

    const form = text(body.Form ?? body.form, 80) || "Unknown form";
    const subject = text(body._subject ?? body.subject, MAX_SUBJECT_LENGTH) || `Nabri - ${form}`;

    const fields: Record<string, string> = {};
    let kept = 0;
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith("_")) continue; // _subject/_captcha/_template/_honey are transport, not answers
      if (key === "email" || key === "Email" || key === "Form" || key === "form") continue;
      if (kept >= MAX_FIELDS) break;
      const value_ = text(value, MAX_VALUE_LENGTH);
      if (!value_) continue;
      fields[key.slice(0, 80)] = value_;
      kept += 1;
    }

    const created = await prisma.formSubmission.create({
      data: {
        form,
        subject,
        name: text(body.Name ?? body.name, MAX_NAME_LENGTH) || null,
        email,
        fields,
        ip: typeof req.ip === "string" ? req.ip.slice(0, 64) : null,
        userAgent: text(req.headers["user-agent"], 300) || null,
      },
      select: { id: true },
    });

    sendSuccess(res, { stored: true, id: created.id }, "Reply recorded.", 201);

    // Beta-tester applications get an instant confirmation carrying the Google
    // Play opt-in link. Fired after the response and never awaited: the
    // visitor's submission must not wait on mail latency, and a mail failure
    // must never turn a good capture into an error.
    if (form.trim().toLowerCase() === BETA_TESTER_FORM.toLowerCase()) {
      const applicantName = text(body.Name ?? body.name, MAX_NAME_LENGTH) || email;
      void inviteBetaTester(email, applicantName).catch((err) =>
        console.error("[forms] beta confirmation email threw:", err)
      );
    }
  } catch (error) {
    // Never fail the visitor: the form has already emailed the founder by the
    // time this runs, and a down mirror is not their problem.
    console.error("[forms] could not store submission:", error);
    sendSuccess(res, { stored: false }, undefined, 202);
  }
}

/** Newest-first page of replies, optionally filtered to one form. */
export async function list(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const form = text(req.query.form, 80);
    const where = form ? { form } : {};

    const [total, items] = await Promise.all([
      prisma.formSubmission.count({ where }),
      prisma.formSubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    sendPaginated<Row>(res, items as unknown as Row[], { page, limit, total });
  } catch (error) {
    console.error("[forms] list failed:", error);
    sendError(res, "Could not load replies.", 500, "FORM_LIST_FAILED");
  }
}

/** Reply counts per form - the numbers shown at the top of the admin screen. */
export async function stats(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [byForm, total] = await Promise.all([
      prisma.formSubmission.groupBy({ by: ["form"], _count: { _all: true } }),
      prisma.formSubmission.count(),
    ]);
    sendSuccess(res, {
      total,
      byForm: byForm
        .map((entry) => ({ form: entry.form, count: entry._count._all }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (error) {
    console.error("[forms] stats failed:", error);
    sendError(res, "Could not load reply counts.", 500, "FORM_STATS_FAILED");
  }
}

/**
 * The beta-tester sign-ups as a de-duplicated, newest-first list.
 *
 * This is the "test user list": every applicant, once. The Play closed-test
 * tester list itself can only be edited in Play Console (there is no API for
 * it), so this is the authoritative source the founder imports/pastes from.
 */
async function collectTesters(): Promise<Array<{ email: string; name: string | null; addedAt: string }>> {
  const rows = await prisma.formSubmission.findMany({
    where: BETA_FORM_FILTER,
    select: { email: true, name: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const seen = new Map<string, { email: string; name: string | null; addedAt: string }>();
  for (const row of rows) {
    const email = row.email.toLowerCase();
    if (!seen.has(email)) {
      seen.set(email, { email, name: row.name, addedAt: row.createdAt.toISOString() });
    }
  }
  return Array.from(seen.values());
}

/** GET /api/admin/forms/testers - the beta list as JSON, plus a count. */
export async function testers(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const list = await collectTesters();
    sendSuccess(res, { count: list.length, testers: list }, "Beta testers.");
  } catch (error) {
    console.error("[forms] testers failed:", error);
    sendError(res, "Could not load testers.", 500, "FORM_TESTERS_FAILED");
  }
}

/** RFC-4180-safe CSV cell. */
function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** GET /api/admin/forms/testers.csv - the tester emails as one CSV file. */
export async function testersCsv(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const list = await collectTesters();
    const body = list
      .map((t) => [csvCell(t.email), csvCell(t.name ?? ""), csvCell(t.addedAt)].join(","))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=nabri-beta-testers-${new Date().toISOString().slice(0, 10)}.csv`
    );
    res.setHeader("X-Row-Count", String(list.length));
    res.send(`Email,Name,Added\n${body}\n`);
  } catch (error) {
    console.error("[forms] testers csv failed:", error);
    sendError(res, "Could not export testers.", 500, "FORM_TESTERS_FAILED");
  }
}

/**
 * POST /api/admin/forms/beta-invites - backfill the beta invitation email.
 *
 * Every unique beta applicant who has not yet been invited receives the same
 * email a fresh application gets. This must run from the production server: the
 * email provider authorises by source IP, so a local run is rejected. Safe to
 * press twice - already-invited addresses are skipped.
 */
export async function sendBetaInvites(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const testers = (await collectTesters()).filter((tester) => isEmail(tester.email));
    const invited = new Set(
      (
        await prisma.formSubmission.findMany({
          where: { ...BETA_FORM_FILTER, invitedAt: { not: null } },
          select: { email: true },
          distinct: ["email"],
        })
      ).map((row) => row.email.toLowerCase())
    );
    const pending = testers.filter((tester) => !invited.has(tester.email.toLowerCase()));

    let sent = 0;
    let failed = 0;
    const CHUNK = 8;
    for (let i = 0; i < pending.length; i += CHUNK) {
      const results = await Promise.all(
        pending.slice(i, i + CHUNK).map((tester) => inviteBetaTester(tester.email, tester.name))
      );
      for (const result of results) {
        if (result === "sent") sent += 1;
        else if (result === "failed") failed += 1;
      }
    }

    if (sent === 0 && failed > 0) {
      sendError(res, "No beta invites could be delivered. Check the email provider configuration.", 502, "EMAIL_DELIVERY_FAILED");
      return;
    }

    sendSuccess(
      res,
      { total: testers.length, alreadyInvited: testers.length - pending.length, sent, failed },
      `Beta invites sent to ${sent} of ${pending.length} pending testers.`
    );
  } catch (error) {
    console.error("[forms] beta invite backfill failed:", error);
    sendError(res, "Could not send beta invites.", 500, "FORM_TESTERS_FAILED");
  }
}

async function recentRows(): Promise<Row[]> {
  const rows = await prisma.formSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
  });
  return rows as unknown as Row[];
}

/**
 * One sheet, one row per reply. Column order is fixed columns first (so the
 * sheet always opens with Received/Form/Name/Email), then every answer key the
 * exported replies contain - the union, because the three forms ask different
 * questions and json_to_sheet would otherwise take its columns from row one.
 */
function buildWorkbook(rows: Row[]): Buffer {
  const fixed = ["Received", "Form", "Name", "Email", "Subject"];
  const answers = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(asFields(row.fields))) answers.add(key);
  }
  const header = [...fixed, ...Array.from(answers).sort()];

  const data = rows.map((row) => ({
    // "2026-10-07 14:03" rather than an ISO timestamp: a date Excel parses as
    // a date, in a format that reads the same in every locale.
    Received: row.createdAt.toISOString().slice(0, 16).replace("T", " "),
    Form: row.form,
    Name: row.name ?? "",
    Email: row.email,
    Subject: row.subject,
    ...asFields(row.fields),
  }));

  const sheet = XLSX.utils.json_to_sheet(data, { header });
  sheet["!cols"] = header.map((column) => ({
    wch: Math.min(60, Math.max(12, column.length + 4)),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Replies");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function xlsxFilename(): string {
  return `nabri-form-replies-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

/** GET /api/admin/forms/export - download every reply as one Excel file. */
export async function exportXlsx(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const rows = await recentRows();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${xlsxFilename()}`);
    res.setHeader("X-Row-Count", String(rows.length));
    res.send(buildWorkbook(rows));
  } catch (error) {
    console.error("[forms] export failed:", error);
    sendError(res, "Could not build the spreadsheet.", 500, "FORM_EXPORT_FAILED");
  }
}

/**
 * POST /api/admin/forms/email - mail the same sheet to the founder.
 *
 * Defaults to the address of the admin who asked, because that is the address
 * they are reading anyway; `to` may point it at the founder mailbox instead.
 */
export async function emailXlsx(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const requested = text(asRecord(req.body).to, MAX_EMAIL_LENGTH).toLowerCase();
    const to = requested || req.user?.email;
    if (!to || !isEmail(to)) {
      sendError(res, "No recipient address.", 400, "RECIPIENT_REQUIRED");
      return;
    }

    const rows = await recentRows();
    const buffer = buildWorkbook(rows);
    const byForm = new Map<string, number>();
    for (const row of rows) byForm.set(row.form, (byForm.get(row.form) ?? 0) + 1);
    const breakdown = Array.from(byForm.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([form, count]) => `<li><strong>${escapeHtml(form)}</strong>: ${count}</li>`)
      .join("");

    const html = [
      "<p>Every reply from the Nabri website forms, one row per reply.</p>",
      `<p><strong>${rows.length}</strong> reply(ies) included${rows.length >= EXPORT_LIMIT ? ` (the most recent ${EXPORT_LIMIT})` : ""}:</p>`,
      `<ul>${breakdown}</ul>`,
      "<p>The same submissions still arrive in the founder mailbox by email.</p>",
    ].join("");

    const result = await sendEmail(
      to,
      `Nabri form replies - ${rows.length} total`,
      html,
      `Nabri form replies: ${rows.length} rows attached as ${xlsxFilename()}.`,
      { attachments: [{ filename: xlsxFilename(), content: buffer }] },
    );

    if (!result.ok) {
      sendError(res, "The email could not be sent.", 502, "EMAIL_FAILED");
      return;
    }
    sendSuccess(res, { to, rows: rows.length, filename: xlsxFilename() }, "Sheet emailed.");
  } catch (error) {
    console.error("[forms] email failed:", error);
    sendError(res, "Could not email the spreadsheet.", 500, "FORM_EMAIL_FAILED");
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

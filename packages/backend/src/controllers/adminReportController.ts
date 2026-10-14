/**
 * HTTP edge for the admin report emails.
 *
 * Kept apart from `adminController.ts` for the same reason the reconciliation
 * surface is: this is not a CRUD endpoint over a table, it is the manual override
 * for a background job, and the one question it answers - "why did my report not
 * arrive?" - deserves to be readable on its own.
 *
 * The scheduled mail is sent by the process itself (see services/digestScheduler).
 * When it does not arrive there is nothing to inspect: no row says "attempted", no
 * error surfaces in the UI, and the only observable is the missing email. So this
 * endpoint runs the exact same build-and-send path synchronously and returns what
 * the mailer said, per recipient, which turns the silent absence into a concrete
 * result the operator can act on.
 */
import { Response } from "express";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";
import { runReportNow } from "../services/digestScheduler";
import { REPORT_PERIODS, type ReportPeriod } from "../services/reportPeriods";

const PERIODS = new Set<string>(REPORT_PERIODS);

/**
 * POST /api/admin/reports/digest/run
 *
 * Body: { period?: ReportPeriod } - defaults to DAILY, the one that is expected
 * to arrive every day and therefore the one whose silence is a bug report.
 *
 * Super-admin only (see the route): this sends real mail to real staff, so it is
 * not a viewer-tier action.
 */
export async function runDigestNow(req: AuthedRequest, res: Response): Promise<Response> {
  const requested = (req.body?.period ?? "DAILY") as string;
  if (!PERIODS.has(requested)) {
    return sendError(
      res,
      `Unknown report period "${requested}".`,
      400,
      "INVALID_PERIOD",
      undefined,
      { allowed: [...PERIODS] },
    );
  }

  try {
    const summary = await runReportNow(requested as ReportPeriod);
    const sent = summary.recipients.reduce((n, r) => n + r.sent, 0);
    const configured = summary.recipients.filter((r) => !r.skipped).length;
    const message =
      configured === 0
        ? "The report was built but there are no recipients configured for it - check DIGEST_EMAIL_*."
        : sent === 0
          ? "The report was built but the mail provider sent nothing - see recipients for the error."
          : `Sent ${sent} message(s).`;
    return sendSuccess(res, summary, message);
  } catch (err) {
    // Surfaced rather than swallowed: if building or sending a report throws, that
    // is exactly the fault the caller is here to find, and a generic "failed" would
    // hide it.
    console.error("[admin-report] manual digest run failed:", err);
    return sendError(
      res,
      err instanceof Error ? err.message : "The report could not be built or sent. Check the server log.",
      500,
      "REPORT_RUN_FAILED",
    );
  }
}

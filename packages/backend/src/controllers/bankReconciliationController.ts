/**
 * HTTP edge for bank statement reconciliation.
 *
 * Kept out of `adminController.ts` because this is the one admin surface whose
 * failure is not a bad request: a statement upload either credits wallets or it
 * does not, and the validation that protects it deserves to be readable on its
 * own rather than buried between KYC rejection and wallet top-ups.
 *
 * Two rules this file enforces at the boundary, because a service that trusts
 * its caller about money is a service that eventually credits the wrong person:
 *
 *  - the uploaded bytes never leave this process. A bank statement lists every
 *    transaction the business did, which is more than anyone on staff needs;
 *    only the parsed rows are kept, and they are the whole audit trail.
 *  - a decision on an unmatched line requires a comment, enforced by the
 *    service and re-checked here so the error a client sees names the reason.
 */
import { Response } from "express";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";
import {
  uploadStatement,
  listStatements,
  getStatementDetail,
  listUnresolvedRows,
  applyStatement,
  rematchStatement,
  recordRowDecision,
  ReconciliationError,
} from "../services/bankReconciliation";

/** Map a service rejection onto the envelope the admin UI already understands. */
function fail(res: Response, err: unknown): void {
  if (err instanceof ReconciliationError) {
    sendError(res, err.message, err.status, err.code);
    return;
  }
  // Not swallowed. A statement that failed for an unrecognised reason is exactly
  // the case where a generic "try again" would hide a real bug, and this is a
  // money path.
  console.error("[bank-reconciliation] unhandled:", err);
  sendError(
    res,
    "Something went wrong reading that statement. Nothing was credited - check the server log and try again.",
    500,
    "RECONCILIATION_FAILED",
  );
}

/**
 * POST /api/admin/bank-statements
 *
 * Multipart, field name "statement". Returns the full preview so the admin can
 * read every line before any of them is applied.
 */
export async function upload(req: AuthedRequest, res: Response): Promise<void> {
  const file = req.file;
  if (!file) {
    sendError(res, "Attach the statement file.", 400, "NO_FILE");
    return;
  }
  try {
    const result = await uploadStatement({
      // The stored name keeps the original for the admin's benefit, minus any
      // path a browser may have prefixed to it.
      fileName: (file.originalname || "statement.csv").split(/[\\/]/).pop() || "statement.csv",
      buffer: file.buffer,
      actorId: req.user!.userId,
    });
    sendSuccess(
      res,
      result,
      `${result.rowCount} lines read. ${result.matchedCount} match a payment waiting for it, ${result.unmatchedCount} do not. Nothing has been credited yet.`,
      201,
    );
  } catch (err) {
    fail(res, err);
  }
}

export async function list(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await listStatements({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    sendSuccess(res, result);
  } catch (err) {
    fail(res, err);
  }
}

export async function detail(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await getStatementDetail(req.params.id!);
    if (!result) {
      sendError(res, "That statement no longer exists.", 404, "NOT_FOUND");
      return;
    }
    sendSuccess(res, result);
  } catch (err) {
    fail(res, err);
  }
}

/**
 * The work list: every line across every statement still waiting on a person.
 * Separate from `list` because this is what an admin opens daily.
 */
export async function unresolved(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await listUnresolvedRows({
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    sendSuccess(res, result);
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/admin/bank-statements/:id/apply - credits every matched line. */
export async function apply(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await applyStatement({
      statementId: req.params.id!,
      actorId: req.user!.userId,
      note: typeof req.body?.note === "string" ? req.body.note : undefined,
    });
    const parts = [`${result.credited} wallet${result.credited === 1 ? "" : "s"} credited.`];
    if (result.alreadySettled) parts.push(`${result.alreadySettled} were already paid.`);
    if (result.failed.length) {
      parts.push(`${result.failed.length} could not be credited and are still waiting for you.`);
    }
    sendSuccess(res, result, parts.join(" "));
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/admin/bank-statements/:id/rematch - retry after late claims. */
export async function rematch(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await rematchStatement({
      statementId: req.params.id!,
      actorId: req.user!.userId,
    });
    sendSuccess(
      res,
      result,
      result.newlyMatched
        ? `${result.newlyMatched} more line${result.newlyMatched === 1 ? "" : "s"} now match. Nothing has been credited yet.`
        : "No new lines matched. Anything still unmatched needs a decision from you.",
    );
  } catch (err) {
    fail(res, err);
  }
}

/**
 * POST /api/admin/bank-statements/rows/:rowId/decision
 *
 * The manual path. CREDIT settles immediately - the admin has named the claim
 * and written the comment, so there is nothing left to batch up.
 */
export async function decide(req: AuthedRequest, res: Response): Promise<void> {
  const { decision, comment, matchedType, matchedId, amountMismatchAccepted } = req.body ?? {};
  try {
    const result = await recordRowDecision({
      rowId: req.params.rowId!,
      decision,
      comment,
      matchedType: matchedType === "TOPUP" || matchedType === "UPI_PAYMENT" ? matchedType : undefined,
      matchedId: typeof matchedId === "string" ? matchedId : undefined,
      amountMismatchAccepted: amountMismatchAccepted === true,
      actorId: req.user!.userId,
    });
    sendSuccess(
      res,
      result,
      result.credited ? "Credited and recorded with your note." : "Recorded with your note.",
    );
  } catch (err) {
    fail(res, err);
  }
}
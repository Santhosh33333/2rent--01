/**
 * Bank statement reconciliation: turn a bank export into wallet credits, without
 * inventing a rupee.
 *
 * The design rule that governs this whole file is that the matcher may only ever
 * do the one thing it can do safely - recognise a payment some user already told
 * us about, by the reference they gave us, for exactly the amount they claimed.
 * Anything short of that is not settled here; it is parked with a reason and,
 * when a person looks at it, a comment they had to type.
 *
 * Three properties the rest of this file exists to hold:
 *
 *  1. Money moves only through `settleTopupRequest` / `settleUpiPayment`. Both
 *     claim their row with a conditional status transition, so running this while
 *     an admin has the same payment open is safe and a double-applied statement
 *     credits nothing twice.
 *  2. A reference with no claim behind it, or a claim for a different amount, is
 *     never credited. Crediting an unmatched line is how a stranger's transfer
 *     ends up funding somebody's wallet.
 *  3. Anything an admin settles by hand carries their comment, in the row, for
 *     as long as the row exists. An unexplained approval in a money flow is
 *     indistinguishable from a mistake three months later.
 *
 * Parsing lives in `bankStatementParser`, and the file-format handling in
 * `bankStatementIngest`. Neither is reimplemented here: header mapping, amount
 * parsing and date interpretation are the only places those rules exist, and a
 * second copy is a second set of bugs.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { parseBankStatement, normaliseReference } from "./bankStatementParser";
import { ingestStatement, type StatementFormat } from "./bankStatementIngest";
import { settleTopupRequest, AlreadySettledError as TopupAlreadySettledError } from "./topupSettlement";
import {
  settleUpiPayment,
  AlreadySettledError as UpiAlreadySettledError,
} from "./upiSettlement";

/** Verdict the matcher reaches on its own. Mirrors the schema's documented set. */
export type RowMatchStatus =
  | "MATCHED"
  | "UNMATCHED"
  | "AMOUNT_MISMATCH"
  | "ALREADY_SETTLED"
  | "DUPLICATE_IN_FILE"
  | "NO_REFERENCE"
  | "UNPARSEABLE_AMOUNT"
  | "OUTBOUND"
  | "ZERO_AMOUNT";

/** What an admin concluded about a line. */
export type RowDecision = "CREDIT" | "REJECT" | "IGNORE";

/**
 * How far either side of the statement period to look for a matching claim.
 *
 * A user pays, then opens the app to submit the reference; that gap is hours,
 * not weeks. 90 days is generous enough that a claim always falls inside the
 * window even if the admin uploads an old export late, while keeping the scan
 * bounded - an unbounded "load every pending claim" turns one large export into
 * a full-table read on a live database.
 */
const CLAIM_WINDOW_DAYS = 90;

/**
 * Hard ceiling on claims pulled into memory for matching.
 *
 * If a window really does exceed this, the upload still proceeds - refusing to
 * reconcile a legitimate statement is worse than a slow one - but the rows that
 * found nothing are marked with a reason saying the search was truncated, so
 * "UNMATCHED" is never quietly a lie.
 */
const MAX_CLAIMS_SCANNED = 20_000;

export class ReconciliationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

// -----------------------------------------------------------------------------
// Claim indexing
// -----------------------------------------------------------------------------

interface IndexedClaim {
  kind: "TOPUP" | "UPI_PAYMENT";
  id: string;
  userId: string;
  amount: number;
  status: string;
  referenceNorm: string;
  referenceRaw: string;
}

/**
 * Pull every claim whose reference the file might mention.
 *
 * Two queries, unioned, because neither alone is sufficient:
 *
 *  - an exact `IN` lookup on the file's own reference strings, which is precise
 *    and covers the common case where the user pasted the UTR exactly as the
 *    bank printed it;
 *  - a time-windowed scan, because a user may have typed the UTR without the
 *    spaces the bank inserted ("UTR12345" stored vs "UTR 12345" printed), and
 *    no SQL equality can see through that. Matching then happens on the
 *    normalised form in JS.
 *
 * The window scan is what could be truncated, so it is capped and reports it.
 */
async function loadCandidateClaims(
  refs: string[],
  periodFrom: Date | null,
  periodTo: Date | null,
): Promise<{ claims: IndexedClaim[]; truncated: boolean }> {
  // With no usable dates at all there is no window to search, so fall back to
  // the whole table (still capped). A statement whose dates all failed to parse
  // is unusual, and silently skipping the scan would make every row UNMATCHED.
  const hasWindow = Boolean(periodFrom || periodTo);
  const from = periodFrom ?? new Date(1970, 0, 1);
  const to = periodTo ?? new Date(new Date().getFullYear() + 1, 0, 1);
  const windowFilter = {
    createdAt: {
      ...(hasWindow ? { gte: new Date(from.getTime() - CLAIM_WINDOW_DAYS * 86_400_000) } : {}),
      ...(hasWindow ? { lte: new Date(to.getTime() + CLAIM_WINDOW_DAYS * 86_400_000) } : {}),
    },
  };

  const wantPending = { status: { in: ["VERIFICATION_PENDING", "VERIFIED"] } };

  const [topups, upis] = await Promise.all([
    prisma.topupRequest.findMany({
      where: { ...windowFilter, ...wantPending },
      select: { id: true, userId: true, amount: true, status: true, referenceNumber: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CLAIMS_SCANNED,
    }),
    prisma.upiPayment.findMany({
      where: { ...windowFilter, ...wantPending },
      select: { id: true, userId: true, amount: true, status: true, referenceNumber: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: MAX_CLAIMS_SCANNED,
    }),
  ]);

  // The exact-string pass. The file's reference is already normalised, so this
  // mainly rescues claims stored with the normalisation applied one step
  // further (upper-cased with spaces stripped) that the window would have
  // missed if it were also truncated.
  const refSet = new Set(refs);
  const exact = refSet.size
    ? await Promise.all([
        prisma.topupRequest.findMany({
          where: { referenceNumber: { in: [...refSet] } },
          select: { id: true, userId: true, amount: true, status: true, referenceNumber: true },
        }),
        prisma.upiPayment.findMany({
          where: { referenceNumber: { in: [...refSet] } },
          select: { id: true, userId: true, amount: true, status: true, referenceNumber: true },
        }),
      ])
    : [[], []];

  const byId = new Map<string, IndexedClaim>();
  for (const t of [...topups, ...exact[0]]) {
    byId.set(`TOPUP:${t.id}`, {
      kind: "TOPUP",
      id: t.id,
      userId: t.userId,
      amount: Number(t.amount),
      status: t.status,
      referenceNorm: normaliseReference(t.referenceNumber),
      referenceRaw: t.referenceNumber,
    });
  }
  for (const u of [...upis, ...exact[1]]) {
    if (!u.referenceNumber) continue; // UpiPayment.referenceNumber is nullable
    byId.set(`UPI_PAYMENT:${u.id}`, {
      kind: "UPI_PAYMENT",
      id: u.id,
      userId: u.userId,
      amount: Number(u.amount),
      status: u.status,
      referenceNorm: normaliseReference(u.referenceNumber),
      referenceRaw: u.referenceNumber,
    });
  }

  return { claims: [...byId.values()], truncated: topups.length >= MAX_CLAIMS_SCANNED || upis.length >= MAX_CLAIMS_SCANNED };
}

/**
 * Resolve one file line against the claims index.
 *
 * Split out from the upload loop because the rules are the whole safety
 * argument and want to be unit-testable on their own.
 */
export interface MatchOutcome {
  status: RowMatchStatus;
  reason: string;
  claim?: IndexedClaim;
  /** Present when the claim exists but the money does not agree. */
  claimedAmount?: number;
}

export function matchRowAgainst(
  row: { referenceNorm: string; amount: number | null; inbound: boolean; matchStatus: string },
  byRef: Map<string, IndexedClaim[]>,
  opts: { duplicate: boolean; truncated: boolean; reconstructed?: boolean },
): MatchOutcome {
  // Parser-level verdicts pass straight through. These lines are not merely
  // unmatched, they are unreadable or pointing the wrong way, and calling them
  // "no matching top-up" would send an admin hunting for a claim that cannot
  // exist.
  if (row.matchStatus === "NO_REFERENCE") {
    return { status: "NO_REFERENCE", reason: "This line has no transaction reference." };
  }
  if (row.matchStatus === "UNPARSEABLE_AMOUNT") {
    return { status: "UNPARSEABLE_AMOUNT", reason: "The amount on this line could not be read as a number." };
  }
  if (!row.inbound) {
    // Payouts, fees and the bank's own charges. Crediting these mints money out
    // of the expense list, so they are never eligible.
    return { status: "OUTBOUND", reason: "Money leaving the account - never credited." };
  }
  if (row.amount === null) {
    return { status: "UNPARSEABLE_AMOUNT", reason: "The amount on this line could not be read as a number." };
  }
  if (row.amount === 0) {
    return { status: "ZERO_AMOUNT", reason: "Nothing to credit on this line." };
  }
  if (opts.duplicate) {
    return {
      status: "DUPLICATE_IN_FILE",
      reason: "This reference appears on more than one line in this file.",
    };
  }

  // A reconstructed table is not a read of the file, it is a guess at one. The
  // text layer of a PDF has no columns - only glyph positions - so the column
  // assignment, and therefore the amount attributed to the reference, is
  // inferred. That inference can be wrong in exactly the way that costs money:
  // two adjacent numbers and the credit lands on the wrong line.
  //
  // The warning is already attached to the statement, but a warning nobody is
  // forced to read is not a control. So a reconstructed file can still be
  // decided, and it can still be credited, but only by a person who has looked
  // at the actual PDF and typed why.
  if (opts.reconstructed) {
    const claims = byRef.get(row.referenceNorm) ?? [];
    const claim = claims.find((c) => c.status === "VERIFICATION_PENDING") ?? claims[0];
    return {
      status: "UNMATCHED",
      reason:
        "This is a PDF, so the columns had to be guessed from the layout. Nothing is credited automatically from a PDF - check the line against the statement and decide by hand.",
      ...(claim ? { claim, claimedAmount: claim.amount } : {}),
    };
  }

  const claims = byRef.get(row.referenceNorm) ?? [];
  if (claims.length === 0) {
    return {
      status: "UNMATCHED",
      reason: opts.truncated
        ? "No matching top-up or booking payment was found. The search window was truncated, so a claim may exist outside it."
        : "No top-up or booking payment has claimed this reference.",
    };
  }

  // One UTR is one payment. If two claims in our database both cite it, the
  // database is wrong somewhere and guessing which would credit the wrong
  // person, so this goes to a human.
  const kinds = new Set(claims.map((c) => c.kind));
  if (kinds.size > 1) {
    return {
      status: "UNMATCHED",
      reason: `This reference is claimed by both a top-up and a booking payment. A human has to say which one it paid.`,
    };
  }

  const claim = claims[0];

  // Amounts must agree exactly. A top-up of 500 arriving as 499.50 is not our
  // bug to forgive: rounding differences are what a real matching fraud looks
  // like, and a rupee of drift has to be a person's decision, not ours.
  if (claim.amount !== row.amount) {
    return {
      status: "AMOUNT_MISMATCH",
      reason: `The bank line is ${row.amount.toFixed(2)} but the claim is for ${claim.amount.toFixed(2)}.`,
      claim,
      claimedAmount: claim.amount,
    };
  }

  if (claim.status === "VERIFIED") {
    return {
      status: "ALREADY_SETTLED",
      reason: "This payment was already verified and credited.",
      claim,
    };
  }

  return {
    status: "MATCHED",
    reason: `Matches the ${claim.kind === "TOPUP" ? "top-up" : "booking payment"} of ${row.amount.toFixed(2)}.`,
    claim,
  };
}

// -----------------------------------------------------------------------------
// Upload
// -----------------------------------------------------------------------------

export interface UploadSummary {
  statementId: string;
  fileName: string;
  fileHash: string;
  format: StatementFormat;
  status: string;
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  skippedAmount: number;
  periodFrom: string | null;
  periodTo: string | null;
  columnMap: unknown;
  warnings: unknown[];
  /** Only from `rematchStatement`: how many previously unmatched lines now match. */
  newlyMatched?: number;
  rows: Array<{
    id: string;
    lineNo: number;
    rawReference: string;
    rawAmount: string | null;
    amount: number | null;
    txnDate: string | null;
    inbound: boolean;
    matchStatus: string;
    matchReason: string | null;
    matchedType: string | null;
    matchedId: string | null;
    matchedUserId: string | null;
  }>;
}

/**
 * Ingest, parse, match and store a statement. Moves no money.
 *
 * The whole thing is stored even when nothing matched, because the rows are the
 * evidence an admin needs to decide, and because a statement whose claims were
 * submitted late should be re-matchable without a re-upload. `rematchStatement`
 * is that retry.
 */
export async function uploadStatement(params: {
  fileName: string;
  buffer: Buffer;
  actorId: string;
}): Promise<UploadSummary> {
  const { fileName, buffer, actorId } = params;

  const ingest = await ingestStatement(buffer);

  // `parseBankStatement` throws a plain Error carrying the one sentence that
  // actually explains what is wrong with the admin's file - "No header row
  // could be found", "No amount column was found". Letting that reach the HTTP
  // edge uncaught turns a fixable data problem into an opaque 500 that tells
  // the admin to go read a server log, which is the opposite of useful.
  let parsed: ReturnType<typeof parseBankStatement>;
  try {
    parsed = parseBankStatement(ingest.text);
  } catch (err) {
    throw new ReconciliationError(
      "UNREADABLE_STATEMENT",
      `Could not read that ${ingest.format === "CSV" ? "file" : ingest.format} as a transaction statement. ${
        (err as Error)?.message ?? "The parser rejected it."
      }`.trim(),
      422,
    );
  }

  if (parsed.rows.length === 0) {
    throw new ReconciliationError(
      "NO_ROWS_PARSED",
      "No transaction lines were found in that file. Check it is a transaction export rather than an account summary.",
      422,
    );
  }
  // Without a reference column nothing can ever match, and without an amount
  // column nothing can be credited. Say which one is missing instead of showing
  // an admin 300 rows that all failed for the same unstated reason.
  if (parsed.columnMap.reference === undefined && !parsed.columnMap.credit && !parsed.columnMap.amount) {
    throw new ReconciliationError(
      "NO_COLUMNS_DETECTED",
      "No transaction reference or amount column was found. Bank exports rename these columns often; a CSV with headings like UTR / Credit / Date works today.",
      422,
    );
  }

  // Duplicate references inside one file. A bank export that repeats a UTR is
  // either a broken export or an attempt to get one payment credited twice, and
  // neither is something the matcher should resolve by picking the first.
  const seen = new Map<string, number>();
  for (const r of parsed.rows) {
    if (!r.referenceNorm) continue;
    seen.set(r.referenceNorm, (seen.get(r.referenceNorm) ?? 0) + 1);
  }

  const candidates = parsed.rows
    .filter((r) => r.matchStatus === "PENDING" && r.inbound && r.referenceNorm)
    .map((r) => r.referenceNorm);
  const uniqueRefs = [...new Set(candidates)];

  const { claims, truncated } = await loadCandidateClaims(uniqueRefs, parsed.periodFrom, parsed.periodTo);

  const byRef = new Map<string, IndexedClaim[]>();
  for (const c of claims) {
    const list = byRef.get(c.referenceNorm) ?? [];
    list.push(c);
    byRef.set(c.referenceNorm, list);
  }

  let matched = 0;
  let unmatched = 0;
  let skipped = 0;

  // A file whose columns had to be inferred cannot auto-credit anything. See
  // `matchRowAgainst` for why this is a hard stop rather than a warning.
  const reconstructed = ingest.warnings.some((w) => w.kind === "PDF_TABLE_RECONSTRUCTED");

  const persisted = parsed.rows.map((row) => {
    const outcome = matchRowAgainst(row, byRef, { duplicate: (seen.get(row.referenceNorm) ?? 0) > 1, truncated, reconstructed });

    if (outcome.status === "MATCHED") matched += 1;
    else unmatched += 1;
    // "Skipped" is money in the file that reconciliation declined to act on,
    // for any reason. Counting it is what lets an admin confirm the file adds up
    // rather than trusting a green "applied" tick.
    if (outcome.status !== "MATCHED" && row.inbound && row.amount && row.amount > 0) {
      skipped += row.amount;
    }

    return {
      lineNo: row.lineNo,
      rawReference: row.rawReference,
      rawAmount: row.rawAmount || null,
      referenceNorm: row.referenceNorm,
      rawDate: row.rawDate || null,
      amount: row.amount,
      txnDate: row.txnDate,
      inbound: row.inbound,
      matchStatus: outcome.status,
      matchReason: outcome.reason,
      matchedType: outcome.claim?.kind ?? null,
      matchedId: outcome.claim?.id ?? null,
      matchedAmount: outcome.claim ? new Prisma.Decimal(outcome.claim.amount) : null,
      matchedUserId: outcome.claim?.userId ?? null,
      rawJson: JSON.stringify(row.raw),
    };
  });

  const existing = await prisma.bankStatement.findUnique({
    where: { fileHash: ingest.fileHash },
    select: { id: true },
  });
  if (existing) {
    throw new ReconciliationError(
      "DUPLICATE_FILE",
      "This exact file has already been uploaded. Re-uploading it would not match anything new.",
      409,
    );
  }

  const statement = await prisma.bankStatement.create({
    data: {
      fileName,
      byteSize: buffer.byteLength,
      fileHash: ingest.fileHash,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      rowCount: persisted.length,
      matchedCount: matched,
      unmatchedCount: unmatched,
      skippedAmount: new Prisma.Decimal(skipped),
      status: "PREVIEWED",
      columnMap: JSON.stringify(parsed.columnMap),
      warnings: JSON.stringify([...ingest.warnings, ...parsed.warnings]),
      uploadedById: actorId,
      rows: { create: persisted },
    },
    include: { rows: { orderBy: { lineNo: "asc" } } },
  });

  return {
    statementId: statement.id,
    fileName: statement.fileName,
    fileHash: statement.fileHash,
    format: ingest.format,
    status: statement.status,
    rowCount: statement.rowCount,
    matchedCount: statement.matchedCount,
    unmatchedCount: statement.unmatchedCount,
    skippedAmount: Number(statement.skippedAmount),
    periodFrom: statement.periodFrom?.toISOString() ?? null,
    periodTo: statement.periodTo?.toISOString() ?? null,
    columnMap: parsed.columnMap,
    warnings: [...ingest.warnings, ...parsed.warnings],
    rows: statement.rows.map((r) => ({
      id: r.id,
      lineNo: r.lineNo,
      rawReference: r.rawReference,
      rawAmount: r.rawAmount,
      amount: r.amount === null ? null : Number(r.amount),
      txnDate: r.txnDate?.toISOString() ?? null,
      inbound: r.inbound,
      matchStatus: r.matchStatus,
      matchReason: r.matchReason,
      matchedType: r.matchedType,
      matchedId: r.matchedId,
      matchedUserId: r.matchedUserId,
    })),
  };
}

// -----------------------------------------------------------------------------
// Reading
// -----------------------------------------------------------------------------

export async function listStatements(opts: { limit?: number; cursor?: string } = {}) {
  const take = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const rows = await prisma.bankStatement.findMany({
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      byteSize: true,
      fileHash: true,
      periodFrom: true,
      periodTo: true,
      rowCount: true,
      matchedCount: true,
      creditedCount: true,
      unmatchedCount: true,
      skippedAmount: true,
      status: true,
      createdAt: true,
      appliedAt: true,
      uploadedBy: { select: { id: true, fullName: true, email: true } },
    },
  });
  const page = rows.slice(0, take);
  return {
    items: page.map((s) => ({
      ...s,
      skippedAmount: Number(s.skippedAmount),
      createdAt: s.createdAt.toISOString(),
      periodFrom: s.periodFrom?.toISOString() ?? null,
      periodTo: s.periodTo?.toISOString() ?? null,
      appliedAt: s.appliedAt?.toISOString() ?? null,
    })),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}

export async function getStatementDetail(id: string) {
  const statement = await prisma.bankStatement.findUnique({
    where: { id },
    include: {
      rows: { orderBy: { lineNo: "asc" } },
      uploadedBy: { select: { id: true, fullName: true, email: true } },
      appliedBy: { select: { id: true, fullName: true, email: true } },
    },
  });
  if (!statement) return null;

  const parsedMap = safeJson(statement.columnMap, {});
  const warnings = safeJson<Array<{ kind: string; detail: string }>>(statement.warnings, []);

  return {
    id: statement.id,
    fileName: statement.fileName,
    byteSize: statement.byteSize,
    fileHash: statement.fileHash,
    periodFrom: statement.periodFrom?.toISOString() ?? null,
    periodTo: statement.periodTo?.toISOString() ?? null,
    rowCount: statement.rowCount,
    matchedCount: statement.matchedCount,
    creditedCount: statement.creditedCount,
    unmatchedCount: statement.unmatchedCount,
    skippedAmount: Number(statement.skippedAmount),
    status: statement.status,
    columnMap: parsedMap,
    warnings,
    createdAt: statement.createdAt.toISOString(),
    appliedAt: statement.appliedAt?.toISOString() ?? null,
    uploadedBy: statement.uploadedBy,
    appliedBy: statement.appliedBy,
    rows: statement.rows.map((r) => ({
      id: r.id,
      lineNo: r.lineNo,
      rawReference: r.rawReference,
      rawAmount: r.rawAmount,
      referenceNorm: r.referenceNorm,
      amount: r.amount === null ? null : Number(r.amount),
      txnDate: r.txnDate?.toISOString() ?? null,
      inbound: r.inbound,
      matchStatus: r.matchStatus,
      matchReason: r.matchReason,
      matchedType: r.matchedType,
      matchedId: r.matchedId,
      matchedUserId: r.matchedUserId,
      matchedAmount: r.matchedAmount === null ? null : Number(r.matchedAmount),
      creditedAt: r.creditedAt?.toISOString() ?? null,
      adminComment: r.adminComment,
      decidedStatus: r.decidedStatus,
      decidedAt: r.decidedAt?.toISOString() ?? null,
    })),
  };
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// -----------------------------------------------------------------------------
// The unmatched queue
// -----------------------------------------------------------------------------

/**
 * Every stored line still waiting on a person: not matched, not credited, and
 * never decided. Across all statements, because an admin working the queue wants
 * the work list, not one file's slice of it.
 */
export async function listUnresolvedRows(opts: { limit?: number; cursor?: string } = {}) {
  const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = {
    creditedAt: null,
    decidedAt: null,
    // MATCHED lines are not the queue - they are waiting for "apply", which is a
    // different, machine-driven action. Anything else is waiting for a human.
    NOT: { matchStatus: "MATCHED" },
  };
  const rows = await prisma.bankStatementRow.findMany({
    where,
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    orderBy: [{ statement: { createdAt: "desc" } }, { lineNo: "asc" }],
    include: {
      statement: { select: { id: true, fileName: true, createdAt: true, status: true } },
    },
  });
  const page = rows.slice(0, take);
  return {
    items: page.map((r) => ({
      id: r.id,
      statementId: r.statementId,
      fileName: r.statement.fileName,
      lineNo: r.lineNo,
      rawReference: r.rawReference,
      rawAmount: r.rawAmount,
      amount: r.amount === null ? null : Number(r.amount),
      txnDate: r.txnDate?.toISOString() ?? null,
      inbound: r.inbound,
      matchStatus: r.matchStatus,
      matchReason: r.matchReason,
      matchedType: r.matchedType,
      matchedId: r.matchedId,
      matchedUserId: r.matchedUserId,
    })),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}

/**
 * Record an admin's verdict on one line, crediting it when they say CREDIT.
 *
 * The comment is mandatory and that is the entire point. Every other field on
 * this function can be reconstructed from the file and the database six months
 * later; "why did a person credit this line that no claim matched" cannot, and
 * it is the question that matters when money has gone wrong.
 */
export async function recordRowDecision(params: {
  rowId: string;
  decision: RowDecision;
  comment: string;
  actorId: string;
  /** Set when the admin linked the line to a claim the matcher did not find. */
  matchedType?: "TOPUP" | "UPI_PAYMENT";
  matchedId?: string;
  /**
   * Required when the line's amount and the claim's amount differ. Reconciling
   * a genuine rounding difference is legitimate; doing it silently is not.
   */
  amountMismatchAccepted?: boolean;
}): Promise<{ rowId: string; credited: boolean; decidedStatus: string }> {
  const { rowId, decision, comment, actorId } = params;

  const commentText = String(comment ?? "").trim();
  if (commentText.length < 5) {
    throw new ReconciliationError(
      "COMMENT_REQUIRED",
      "Write what you checked. A short note on why this line was credited or ignored is what makes it defensible later.",
      400,
    );
  }
  if (!["CREDIT", "REJECT", "IGNORE"].includes(decision)) {
    throw new ReconciliationError("BAD_DECISION", "Decision must be CREDIT, REJECT or IGNORE.", 400);
  }

  const row = await prisma.bankStatementRow.findUnique({ where: { id: rowId } });
  if (!row) throw new ReconciliationError("NOT_FOUND", "That statement line no longer exists.", 404);
  if (row.creditedAt) {
    throw new ReconciliationError(
      "ALREADY_CREDITED",
      "This line already credited a wallet. Reversing a credit is a separate, deliberate action.",
      409,
    );
  }
  if (row.decidedAt) {
    throw new ReconciliationError(
      "ALREADY_DECIDED",
      `This line was already marked ${row.decidedStatus}. Remove the decision before recording a different one.`,
      409,
    );
  }

  if (decision !== "CREDIT") {
    await prisma.bankStatementRow.update({
      where: { id: rowId },
      data: {
        adminComment: commentText,
        decidedStatus: decision,
        decidedById: actorId,
        decidedAt: new Date(),
      },
    });
    await writeAudit(actorId, "BANK_ROW_IGNORED", "BankStatementRow", rowId, {
      matchStatus: row.matchStatus,
      reference: row.rawReference,
      amount: row.amount === null ? null : Number(row.amount),
      decision,
      comment: commentText,
    });
    return { rowId, credited: false, decidedStatus: decision };
  }

  // CREDIT. A human approval still has to name a claim - crediting a line
  // without one is not a judgement call, it is a payment to nobody.
  const kind = params.matchedType ?? (row.matchedType as "TOPUP" | "UPI_PAYMENT" | null);
  const claimId = params.matchedId ?? row.matchedId;
  if (!kind || !claimId) {
    throw new ReconciliationError(
      "CLAIM_REQUIRED",
      "Choose the top-up or booking payment this line paid before crediting it.",
      400,
    );
  }

  const claim =
    kind === "TOPUP"
      ? await prisma.topupRequest.findUnique({ where: { id: claimId } })
      : await prisma.upiPayment.findUnique({ where: { id: claimId } });
  if (!claim) throw new ReconciliationError("CLAIM_NOT_FOUND", "That claim no longer exists.", 404);
  if (claim.status !== "VERIFICATION_PENDING") {
    throw new ReconciliationError(
      "CLAIM_NOT_PENDING",
      `That claim is already ${claim.status}. There is nothing left to credit.`,
      409,
    );
  }
  if (row.amount === null) {
    throw new ReconciliationError(
      "AMOUNT_UNREADABLE",
      "The amount on this line could not be read, so it cannot be checked against the claim.",
      400,
    );
  }

  const claimAmount = Number(claim.amount);
  if (claimAmount !== Number(row.amount) && !params.amountMismatchAccepted) {
    throw new ReconciliationError(
      "AMOUNT_MISMATCH_CONFIRMATION_REQUIRED",
      `The line is ${Number(row.amount).toFixed(2)} but the claim is ${claimAmount.toFixed(2)}. Confirm you accept the difference before crediting.`,
      409,
    );
  }
  if (claimAmount !== Number(row.amount)) {
    // Recorded on the row itself, not just the audit log, so the line still
    // explains itself when read without the log.
    await prisma.bankStatementRow.update({
      where: { id: rowId },
      data: { adminComment: `${commentText} (accepted a ${(Number(row.amount) - claimAmount).toFixed(2)} difference against the claim)` },
    });
  }

  await creditClaim({
    kind,
    claimId,
    userId: claim.userId,
    amount: claimAmount,
    referenceNumber: kind === "TOPUP" ? (claim as { referenceNumber: string }).referenceNumber : undefined,
    actorId,
    note: `Bank statement reconciliation: ${commentText}`,
  });

  await prisma.bankStatementRow.update({
    where: { id: rowId },
    data: {
      matchedType: kind,
      matchedId: claimId,
      matchedUserId: claim.userId,
      matchStatus: "MATCHED",
      matchReason: `Matched by hand: ${commentText}`,
      adminComment: commentText,
      decidedStatus: "CREDITED",
      decidedById: actorId,
      decidedAt: new Date(),
      creditedAt: new Date(),
      creditedById: actorId,
    },
  });

  await refreshStatementCounts(row.statementId);

  return { rowId, credited: true, decidedStatus: "CREDITED" };
}

/**
 * One credit path for both services, so "reconciliation credited a wallet" is
 * the same code whether the line was matched by machine or by a person.
 */
async function creditClaim(args: {
  kind: "TOPUP" | "UPI_PAYMENT";
  claimId: string;
  userId: string;
  amount: number;
  referenceNumber?: string;
  actorId: string;
  note: string;
}): Promise<void> {
  try {
    if (args.kind === "TOPUP") {
      await settleTopupRequest(
        {
          id: args.claimId,
          userId: args.userId,
          amount: args.amount,
          referenceNumber: args.referenceNumber ?? "",
        },
        args.actorId,
        "RECONCILED",
        args.note,
      );
    } else {
      await settleUpiPayment(
        { id: args.claimId, userId: args.userId, amount: args.amount },
        args.actorId,
        "RECONCILED",
        args.note,
      );
    }
  } catch (err) {
    if (err instanceof TopupAlreadySettledError || err instanceof UpiAlreadySettledError) {
      // Someone verified it in the browser while this file sat in the queue.
      // Not an error: the money is where it should be, exactly once.
      return;
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Apply
// -----------------------------------------------------------------------------

export interface ApplyResult {
  statementId: string;
  credited: number;
  alreadySettled: number;
  failed: Array<{ rowId: string; lineNo: number; reason: string }>;
  creditedCount: number;
  unmatchedCount: number;
  skippedAmount: number;
}

/**
 * Credit every line the matcher approved. One transaction per line, not one for
 * the file.
 *
 * That is deliberate. Each credit is a conditional claim on its own payment, so
 * the only thing a batch transaction would add is the ability to lose a hundred
 * good credits because the hundred-and-first line had a dead foreign key. A
 * partial apply with a per-line reason is recoverable; an all-or-nothing apply
 * over money is a support ticket.
 */
export async function applyStatement(params: {
  statementId: string;
  actorId: string;
  note?: string;
}): Promise<ApplyResult> {
  const { statementId, actorId } = params;

  const statement = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { rows: { where: { matchStatus: "MATCHED", creditedAt: null } } },
  });
  if (!statement) throw new ReconciliationError("NOT_FOUND", "That statement no longer exists.", 404);
  if (statement.status === "APPLIED") {
    throw new ReconciliationError(
      "ALREADY_APPLIED",
      "This statement has already been applied. Its rows are settled; nothing further to credit.",
      409,
    );
  }

  const failed: ApplyResult["failed"] = [];
  let credited = 0;
  let alreadySettled = 0;

  for (const row of statement.rows) {
    if (!row.matchedType || !row.matchedId) continue;

    const claim =
      row.matchedType === "TOPUP"
        ? await prisma.topupRequest.findUnique({ where: { id: row.matchedId } })
        : await prisma.upiPayment.findUnique({ where: { id: row.matchedId } });

    if (!claim) {
      failed.push({ rowId: row.id, lineNo: row.lineNo, reason: "The matched claim no longer exists." });
      continue;
    }
    if (claim.status !== "VERIFICATION_PENDING") {
      // Verified by hand since the file was uploaded. Record the fact so the
      // line leaves the pending set instead of being offered again.
      alreadySettled += 1;
      await prisma.bankStatementRow.update({
        where: { id: row.id },
        data: { matchStatus: "ALREADY_SETTLED", matchReason: `Already ${claim.status} before this statement was applied.` },
      });
      continue;
    }

    try {
      await creditClaim({
        kind: row.matchedType as "TOPUP" | "UPI_PAYMENT",
        claimId: row.matchedId,
        userId: claim.userId,
        amount: Number(claim.amount),
        referenceNumber:
          row.matchedType === "TOPUP" ? (claim as { referenceNumber?: string }).referenceNumber : undefined,
        actorId,
        note: params.note?.trim() || `Bank statement ${statement.fileName}`,
      });
      await prisma.bankStatementRow.update({
        where: { id: row.id },
        data: { creditedAt: new Date(), creditedById: actorId },
      });
      credited += 1;
    } catch (err) {
      // One bad line must not abandon the rest, and it must not be silent.
      failed.push({
        rowId: row.id,
        lineNo: row.lineNo,
        reason: err instanceof Error ? err.message.slice(0, 300) : "Unknown error.",
      });
    }
  }

  await writeAudit(actorId, "BANK_STATEMENT_APPLIED", "BankStatement", statement.id, {
    fileName: statement.fileName,
    fileHash: statement.fileHash,
    credited,
    alreadySettled,
    failed: failed.length,
  });

  const counts = await refreshStatementCounts(statementId);
  // Applied even when some lines failed: re-uploading is not the remedy for a
  // line that failed, and marking the whole file APPLIED is what stops the
  // successful lines from being offered for crediting a second time.
  await prisma.bankStatement.update({
    where: { id: statementId },
    data: { status: "APPLIED", appliedAt: new Date(), appliedById: actorId },
  });

  return {
    statementId,
    credited,
    alreadySettled,
    failed,
    creditedCount: counts.creditedCount,
    unmatchedCount: counts.unmatchedCount,
    skippedAmount: counts.skippedAmount,
  };
}

/**
 * Recompute a statement's headline numbers from its rows.
 *
 * Derived rather than incremented, because the increments would have to survive
 * every path that credits a row (apply, hand decision, a retry after a partial
 * failure) and there are three. Recomputing from the rows cannot drift.
 */
async function refreshStatementCounts(statementId: string) {
  const rows = await prisma.bankStatementRow.findMany({
    where: { statementId },
    select: { matchStatus: true, inbound: true, amount: true, creditedAt: true },
  });

  let matched = 0;
  let unmatched = 0;
  let credited = 0;
  let skipped = 0;

  for (const r of rows) {
    if (r.matchStatus === "MATCHED") matched += 1;
    else unmatched += 1;
    if (r.creditedAt) credited += 1;
    if (r.matchStatus !== "MATCHED" && r.inbound && r.amount && Number(r.amount) > 0) {
      skipped += Number(r.amount);
    }
  }

  await prisma.bankStatement.update({
    where: { id: statementId },
    data: {
      matchedCount: matched,
      unmatchedCount: unmatched,
      creditedCount: credited,
      skippedAmount: new Prisma.Decimal(skipped),
    },
  });

  return { matchedCount: matched, unmatchedCount: unmatched, creditedCount: credited, skippedAmount: skipped };
}

/**
 * Re-run matching over a stored statement, for claims submitted after upload.
 *
 * Only meaningful before apply. Afterwards the statement's own rows are the
 * record of what was decided, and rewriting them would overwrite the reason a
 * credit was or was not made.
 */
export async function rematchStatement(params: {
  statementId: string;
  actorId: string;
}): Promise<UploadSummary> {
  const { statementId } = params;
  const statement = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { rows: { orderBy: { lineNo: "asc" } } },
  });
  if (!statement) throw new ReconciliationError("NOT_FOUND", "That statement no longer exists.", 404);
  if (statement.status === "APPLIED") {
    throw new ReconciliationError(
      "ALREADY_APPLIED",
      "This statement was already applied, so its lines will not be re-matched.",
      409,
    );
  }

  const rawJsonByLine = new Map<number, string>();
  for (const r of statement.rows) {
    if (r.rawJson) rawJsonByLine.set(r.lineNo, r.rawJson);
  }

  // The candidate references come from the stored rows, not the file: the bytes
  // are gone by design (a statement is not kept), and the stored rows are what
  // the admin was shown.
  const pending = statement.rows.filter(
    (r) => r.matchStatus !== "MATCHED" && !r.creditedAt && !r.decidedAt && r.inbound && r.referenceNorm,
  );
  const { claims, truncated } = await loadCandidateClaims(
    [...new Set(pending.map((r) => r.referenceNorm))],
    statement.periodFrom,
    statement.periodTo,
  );
  const byRef = new Map<string, IndexedClaim[]>();
  for (const c of claims) {
    const list = byRef.get(c.referenceNorm) ?? [];
    list.push(c);
    byRef.set(c.referenceNorm, list);
  }

  const seen = new Map<string, number>();
  for (const r of pending) {
    seen.set(r.referenceNorm, (seen.get(r.referenceNorm) ?? 0) + 1);
  }

  // `statement.warnings` is stored as a JSON array, so it reads back as one. It
  // is the only surviving record that the original file was a reconstructed PDF,
  // which is why the rule has to be re-applied here rather than at upload.
  const storedWarnings = safeJson<Array<{ kind: string }>>(statement.warnings, []);
  const reconstructed = storedWarnings.some((w) => w.kind === "PDF_TABLE_RECONSTRUCTED");

  let newlyMatched = 0;
  for (const r of pending) {
    const outcome = matchRowAgainst(
      { referenceNorm: r.referenceNorm, amount: r.amount === null ? null : Number(r.amount), inbound: r.inbound, matchStatus: "PENDING" },
      byRef,
      { duplicate: (seen.get(r.referenceNorm) ?? 0) > 1, truncated, reconstructed },
    );
    if (outcome.status !== "MATCHED") continue;
    await prisma.bankStatementRow.update({
      where: { id: r.id },
      data: {
        matchStatus: outcome.status,
        matchReason: outcome.reason,
        matchedType: outcome.claim!.kind,
        matchedId: outcome.claim!.id,
        matchedAmount: new Prisma.Decimal(outcome.claim!.amount),
        matchedUserId: outcome.claim!.userId,
        rawJson: rawJsonByLine.get(r.lineNo) ?? r.rawJson,
      },
    });
    newlyMatched += 1;
  }

  const counts = await refreshStatementCounts(statementId);
  if (counts.matchedCount > 0 && statement.status === "UPLOADED") {
    await prisma.bankStatement.update({ where: { id: statementId }, data: { status: "PREVIEWED" } });
  }

  const detail = await getStatementDetail(statementId);
  return {
    statementId,
    fileName: statement.fileName,
    fileHash: statement.fileHash,
    format: "CSV" as StatementFormat,
    status: counts.matchedCount > 0 || statement.status !== "UPLOADED" ? "PREVIEWED" : "UPLOADED",
    rowCount: counts.matchedCount + counts.unmatchedCount,
    matchedCount: counts.matchedCount,
    unmatchedCount: counts.unmatchedCount,
    skippedAmount: counts.skippedAmount,
    periodFrom: statement.periodFrom?.toISOString() ?? null,
    periodTo: statement.periodTo?.toISOString() ?? null,
    columnMap: safeJson(statement.columnMap, {}),
    warnings: [],
    rows: detail?.rows ?? [],
    newlyMatched,
  };
}

async function writeAudit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        actorType: "ADMIN",
        action,
        entityType,
        entityId,
        metadata: JSON.stringify(metadata),
      },
    });
  } catch (err) {
    // An audit row that fails must not undo a credit that already happened, but
    // it must be loud - a silent audit gap in a money flow is its own incident.
    console.error("[bank-reconciliation] audit write failed:", err);
  }
}
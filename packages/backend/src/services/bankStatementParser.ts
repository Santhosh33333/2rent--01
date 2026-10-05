/**
 * Bank statement parsing for manual-UPI reconciliation.
 *
 * No database access here on purpose. Everything in this file is a pure function
 * from file bytes to parsed rows, which is what makes the risky part - guessing
 * what a bank's column headings mean, and reading its numbers - testable without
 * a fixture database.
 *
 * The input is whatever the merchant's bank hands them, which is to say: CSV,
 * with a column layout that differs per bank and sometimes per export, often
 * wrapped in a few lines of account-summary preamble before the real header.
 *
 * Two decisions shape everything below.
 *
 * 1. Nothing here decides whether to pay anyone. A parse produces a candidate
 *    reference and amount and then stops. Matching and crediting are separate
 *    steps in bankReconciliation.ts, because a parser that can also move money
 *    cannot be tested against the interesting cases.
 *
 * 2. Unrecognised input is flagged, never coerced. A UTR is opaque: if the
 *    parser cannot find a column that plausibly holds one, guessing at column 1
 *    would produce a file that looks parsed, reconciles against nothing, and
 *    reports "0 matched" as if the statement were simply empty. Failing loudly
 *    with the detected mapping is the useful outcome.
 */
import { parse } from "csv-parse/sync";

/** What a column is for. One header maps to at most one role. */
export type ColumnRole = "reference" | "amount" | "debit" | "credit" | "direction" | "date" | "balance" | "narration";

export interface ColumnMap {
  reference?: number;
  amount?: number;
  debit?: number;
  credit?: number;
  direction?: number;
  date?: number;
  balance?: number;
  narration?: number;
}

export interface ParsedRow {
  /** 1-based line in the file, header included, so it lines up with a text editor. */
  lineNo: number;
  rawReference: string;
  referenceNorm: string;
  /**
   * Further references this same line legitimately answers to.
   *
   * A UPI credit on a Slice or Axis export puts the customer's UTR (the NPCI
   * RRN) inside the narration, as "UPI-Credit-130500139151-...", while the
   * reference column holds the bank's own internal booking number
   * ("2026100148790401"). The user is told to type the UTR their UPI app shows,
   * so only the narration value can ever match a claim. Without this, those files
   * parse and then reconcile to nothing.
   *
   * Deliberately additional keys, never replacements: the reference column is
   * still tried first, so a bank that does print the UTR there is unaffected.
   */
  altReferences: string[];
  rawAmount: string;
  rawDate: string;
  /** Null when the cell could not be read as a number. Never zero as a stand-in. */
  amount: number | null;
  txnDate: Date | null;
  /**
   * Whether this line is money arriving. Debits, fees and payouts are false, and
   * the reconciler never credits them - doing so would mint money out of the
   * bank's own expense list.
   */
  inbound: boolean;
  matchStatus: RowStatus;
  matchReason: string;
  raw: Record<string, string>;
}

export type RowStatus =
  | "PENDING"
  | "NO_REFERENCE"
  | "UNPARSEABLE_AMOUNT"
  | "OUTBOUND"
  | "ZERO_AMOUNT";

export interface ParseWarning {
  kind: string;
  detail: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  columnMap: ColumnMap;
  headerLineNo: number;
  headers: string[];
  warnings: ParseWarning[];
  periodFrom: Date | null;
  periodTo: Date | null;
}

/**
 * Clean a column heading before it is matched against the role patterns.
 *
 * Banks punctuate their headings, and the punctuation lands exactly where the
 * patterns were anchored. Slice prints "REF NO." and Axis prints "Ref No." -
 * both with a trailing full stop - and `^ref\s*(no|number)?$` could not match
 * either, so the only column holding a reference was invisible and the file was
 * rejected for having "no UTR column" while the reference sat right there in the
 * preview. Trimming the punctuation is what makes those exports readable.
 *
 * Only leading/trailing marks are removed. Punctuation *inside* a heading is
 * meaningful ("a/c no." is not "a/c"), and rewriting it would let an unrelated
 * column claim a role it does not have.
 */
function normaliseHeading(value: string): string {
  return String(value ?? "")
    .replace(/^[\s._#:;,\-/\\]+/, "")
    .replace(/[\s._#:;,\-/\\]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Header synonyms, longest and most specific first.
 *
 * Order matters within each role: "transaction reference" must be tested before
 * "reference", or every column whose heading merely contains the word would
 * claim the reference slot.
 */
const ROLE_PATTERNS: Array<{ role: ColumnRole; re: RegExp }> = [
  // Reference. UTR first: it is the term an Indian bank's UPI credit line uses.
  //
  // The `^ref…$` alternative now tolerates separators between the words and a
  // trailing mark, because "REF NO." (Slice) and "Ref No." (Axis) are how the
  // two most common merchant-bank exports spell it. It stays anchored at both
  // ends so "Cheque No." and "Customer Ref" cannot be mistaken for it.
  { role: "reference", re: /\b(utr|rrn)\b|utr\s*[._-]?\s*(no|number|ref)|bank\s*ref(erence)?|txn\s*ref|transaction\s*ref(erence)?|upi\s*ref|payment\s*ref|customer\s*ref|^ref(erence)?[\s._#:,\-/]*(no|number)?[\s._#:,\-/]*$|transaction\s*id|^txn\s*id$|rrn\s*no/i },
  // Direction. Before amount, because "debit/credit" headings contain neither a
  // bare amount word but do contain "credit", which the credit role wants.
  { role: "direction", re: /\b(dr\s*\/?\s*cr|cr\s*\/?\s*dr|txn\s*type|transaction\s*type|debit\s*\/?\s*credit|type)\s*$/i },
  { role: "debit", re: /debit|withdrawal|paid\s*out|money\s*out|^dr\b/i },
  { role: "credit", re: /credit|deposit|paid\s*in|money\s*in|^cr\b/i },
  { role: "amount", re: /transaction\s*amount|^amount$|^amt$|\bvalue\b|txn\s*amt/i },
  { role: "balance", re: /balance/i },
  { role: "date", re: /date|time|posting|value\s*date/i },
  { role: "narration", re: /narration|description|particulars|remarks|details|payer|payee/i },
];

/**
 * A heading only counts as a header if it is text rather than data. Bank exports
 * put a summary block above the table, so "row 1" is not necessarily row 1 of
 * the data.
 */
function looksLikeHeader(cells: string[]): boolean {
  const filled = cells.filter((c) => c.trim().length > 0);
  if (filled.length < 3) return false;
  // A real header row has no cell that is purely a number.
  const numeric = filled.filter((c) => parseAmount(c) !== null).length;
  if (numeric > 0) return false;
  return true;
}

function detectMapping(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  headers.forEach((header, index) => {
    const text = normaliseHeading(header);
    if (!text) return;
    for (const { role, re } of ROLE_PATTERNS) {
      if (map[role] !== undefined) continue;
      if (re.test(text)) {
        map[role] = index;
        return;
      }
    }
  });
  return map;
}

/**
 * Normalise a UTR for comparison.
 *
 * Banks are inconsistent about how they render the same reference: some
 * lowercase it, some wrap it, some break it across the cell, and some print it
 * with a trailing full stop. Whitespace collapse plus case folding makes those
 * compare equal.
 *
 * Deliberately does NOT strip punctuation. A UTR is defined by its bank and may
 * legitimately contain "-", and "_" or "." inside it. Removing characters would
 * merge two genuinely different references - and this key is what decides who
 * gets credited, so a looser key is a larger blast radius than a missed match.
 * A missed match surfaces as an UNMATCHED row for a human; a wrong merge pays
 * the wrong person.
 */
export function normaliseReference(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * Pull UPI transaction ids out of a narration line.
 *
 * On a UPI credit, the number a customer's app shows them is the NPCI RRN, and
 * that is what they type into the top-up form. Banks print it inside the
 * narration, never in a column of its own:
 *
 *   Slice:  UPI-Credit-130500139151-KATHIRVEL S-HDFC0001284-kathir3459-5@okhdfcbank
 *   Axis:   UPI/CR/512345678901/SALARY CREDIT/...
 *
 * The "reference" column of those same exports holds the bank's own internal
 * booking number, which the user has never seen and cannot type. Matching on it
 * alone parses the file perfectly and then credits nobody.
 *
 * The CR/DR marker is required rather than optional, deliberately. Without it,
 * prose like "UPI transfer to 9876543210" would contribute a phone number as a
 * candidate reference; with it, only a line the bank explicitly labelled as a
 * UPI credit or debit can contribute one.
 */
const UPI_NARRATION_ID = /UPI[\s\-_/.]+(?:CREDIT|CR|DEBIT|DR)[\s\-_/.]+(\d{9,20})/gi;

export function extractUpiReferences(narration: string | null | undefined): string[] {
  if (!narration) return [];
  const text = String(narration);
  const out: string[] = [];
  // The pattern is global, so lastIndex must be reset per call or a second row
  // would resume the previous row's scan position and miss matches.
  UPI_NARRATION_ID.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = UPI_NARRATION_ID.exec(text)) !== null) {
    const norm = normaliseReference(m[1]);
    if (norm && !out.includes(norm)) out.push(norm);
    if (m.index === UPI_NARRATION_ID.lastIndex) {
      UPI_NARRATION_ID.lastIndex += 1;
    }
  }
  return out;
}

/**
 * Read a money cell.
 *
 * Handles the shapes Indian bank exports actually use: thousands separators in
 * either grouping, a currency symbol or code, a leading minus, accounting-style
 * parentheses for negatives, and a trailing DR/CR marker.
 *
 * Returns null - never 0 - when the cell holds no number. Zero is a real
 * balance and must stay distinguishable from "could not read this", because a
 * row that failed to parse must not look like a row for a zero-rupee payment.
 */
export function parseAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text) return null;

  let negative = false;

  // Accounting parentheses: (1,234.50) is a negative.
  const paren = /^\((.*)\)$/.exec(text);
  if (paren) {
    negative = true;
    text = paren[1].trim();
  }

  // Leading minus. Both the ASCII hyphen and U+2212 MINUS SIGN, which some
  // exports use and which a plain "-" test silently misses.
  if (/^[-−]/.test(text)) {
    negative = true;
    text = text.slice(1).trim();
  }

  // Currency symbol or ISO code at either end.
  text = text.replace(/^[\s₹$€£¥]+/, "").replace(/[\s₹$€£¥]+$/, "");

  // Trailing direction marker. DR means money out. It is also the only signal
  // that a single signed amount column is negative, so it feeds `negative`
  // rather than being discarded.
  const dr = /\bDR\b\s*$/i.exec(text);
  const cr = /\bCR\b\s*$/i.exec(text);
  if (dr) {
    negative = true;
    text = text.slice(0, dr.index).trim();
  } else if (cr) {
    text = text.slice(0, cr.index).trim();
  }

  text = text.replace(/^inr\s*/i, "").replace(/\s*inr$/i, "").trim();

  // Only digits, separators and a decimal point may survive. If anything else is
  // left the cell is prose ("Balance as on date") and must not become a number.
  if (!/^[\d,.\s]+$/.test(text)) return null;

  // Decide which separator is the decimal point, because both grouping styles
  // are in the wild and they disagree about what a comma means.
  //
  // The awkward case is a lone separator. "12,34,567" is twelve lakh - Indian
  // grouping - while "1.234,56" has the comma as its decimal point. What
  // separates them is the digit count after the final separator: exactly three
  // is a thousands group, and three digits can never be a rupee fraction.
  // Anything else is a decimal point.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const lastSep = Math.max(lastComma, lastDot);

  let integerPart: string;
  let fractionPart: string;

  if (lastSep === -1) {
    integerPart = text;
    fractionPart = "";
  } else if (lastComma !== -1 && lastDot !== -1) {
    // Both present: whichever comes last is the decimal point. Handles
    // "1,234.56" and "1.234,56" without needing to know the locale.
    if (lastDot > lastComma) {
      integerPart = text.slice(0, lastDot);
      fractionPart = text.slice(lastDot + 1);
    } else {
      integerPart = text.slice(0, lastComma);
      fractionPart = text.slice(lastComma + 1);
    }
  } else if (text.slice(lastSep + 1).replace(/\s/g, "").length === 3) {
    integerPart = text;
    fractionPart = "";
  } else {
    integerPart = text.slice(0, lastSep);
    fractionPart = text.slice(lastSep + 1);
  }

  integerPart = integerPart.replace(/[\s,.]/g, "");
  fractionPart = fractionPart.replace(/[\s,.]/g, "");

  // More than two decimal places is not a rupee amount. It is far more likely a
  // mis-grouped figure or an identifier pasted into the amount column, and
  // silently truncating would credit a figure nobody agreed to.
  if (fractionPart.length > 2) return null;

  const normalised = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
  if (!/^\d+(\.\d+)?$/.test(normalised)) return null;
  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Best-effort date read.
 *
 * Deliberately ambiguous-tolerant and deliberately not trusted. Banks export
 * 04/10/2026 for both 4 October and April 10 depending on the bank, and no
 * amount of cleverness here resolves that from the value alone. So the returned
 * date is used for display and for one sanity check (money cannot arrive before
 * the request that claims it), never to identify a row - matching is by UTR and
 * amount alone.
 *
 * `dayFirst` selects the reading for slash/dash numeric dates. It defaults to
 * true because this is an Indian merchant's account.
 */
export function parseTxnDate(value: string | null | undefined, dayFirst = true): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  // Numeric dates, with an optional trailing time. The three groups are read as
  // a/b/c and only interpreted once it is known which end is the year.
  const numeric = /^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const c = Number(numeric[3]);
    const hh = numeric[4] === undefined ? 0 : Number(numeric[4]);
    const mm = numeric[5] === undefined ? 0 : Number(numeric[5]);
    const ss = numeric[6] === undefined ? 0 : Number(numeric[6]);
    if (hh > 23 || mm > 59 || ss > 59) return null;

    let day: number;
    let month: number;
    let year: number;

    if (numeric[1].length === 4) {
      // yyyy-mm-dd. Unambiguous, and the only form where the year leads.
      year = a;
      month = b;
      day = c;
    } else if (numeric[3].length === 4) {
      // Year at the end: dd/mm/yyyy or mm/dd/yyyy depending on dayFirst.
      year = c;
      if (dayFirst) {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }
    } else {
      // Two-digit year at the end. Indian exports are overwhelmingly dd/mm/yy.
      year = c < 70 ? 2000 + c : 1900 + c;
      if (dayFirst) {
        day = a;
        month = b;
      } else {
        month = a;
        day = b;
      }
    }

    if (!(month >= 1 && month <= 12)) return null;
    if (!(day >= 1 && day <= 31)) return null;
    const d = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
    // Rejects 31/02 and friends, which Date.UTC would roll forward silently -
    // a February payment would appear as the 2nd or 3rd of March.
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      return null;
    }
    return d;
  }

  // "04 Oct 2026" / "4 October 2026, 13:45"
  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[A-Za-z]*[\s-]+(\d{4})/.exec(text);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const d = new Date(Date.UTC(Number(named[3]), month, Number(named[1])));
      if (d.getUTCMonth() === month && d.getUTCDate() === Number(named[1])) return d;
    }
  }

  // Excel serial date: days since 1899-12-30. Exports that lose their date
  // formatting come through as a bare number in the date column.
  if (/^\d{5}$/.test(text)) {
    const serial = Number(text);
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    if (d.getUTCFullYear() >= 1990 && d.getUTCFullYear() <= 2100) return d;
  }

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Whether a cell holds anything at all.
 *
 * Needed because "the credit cell is empty" and "the credit cell says 0.00" are
 * different facts. Testing the parsed number for zero conflates them, which made
 * a genuine 0.00 line look like an empty row and fall through to a column that
 * does not exist - reported as an unreadable amount rather than a zero payment.
 */
function cellFilled(cells: string[], index: number | undefined): boolean {
  if (index === undefined) return false;
  const value = cells[index];
  if (value === undefined || value === null) return false;
  return String(value).trim().length > 0;
}

/**
 * Decide whether a row is money in.
 *
 * Three shapes, in order of reliability:
 *  - a separate credit column with something in it -> inbound
 *  - a separate debit column with something in it  -> outbound
 *  - a single amount column: signed negatives are outbound; otherwise inbound.
 *
 * The last case is the weak one and the reason the reconciler still requires an
 * exact amount match before crediting anything. A statement with only a signed
 * amount column and a "Balance" heading is read as inbound-by-default, which is
 * the right bias for a current-account credit-heavy export and the wrong one for
 * an unusual layout - hence the warning this emits.
 */
function resolveInbound(
  cells: string[],
  map: ColumnMap,
): { inbound: boolean; weak: boolean } {
  // Credit wins over debit. A row with money in both columns is malformed, and
  // treating it as inbound is the safer of the two readings: the reconciler
  // still needs an exact amount match before any of it reaches a wallet.
  if (cellFilled(cells, map.credit)) return { inbound: true, weak: false };
  if (cellFilled(cells, map.debit)) return { inbound: false, weak: false };

  if (map.direction !== undefined) {
    const dir = String(cells[map.direction] ?? "").trim().toLowerCase();
    if (dir) {
      if (/^(dr|debit|payout|out|withdrawal)/.test(dir)) return { inbound: false, weak: false };
      if (/^(cr|credit|in|deposit)/.test(dir)) return { inbound: true, weak: false };
    }
  }

  const amount = map.amount !== undefined ? parseAmount(cells[map.amount]) : null;
  if (amount !== null && amount < 0) return { inbound: false, weak: false };

  return { inbound: true, weak: true };
}

export interface ParseOptions {
  /** How to read 04/10/2026. Defaults to day-first, matching Indian banks. */
  dayFirst?: boolean;
  /** Hard cap on data lines, so a mis-selected header cannot import a million rows. */
  maxRows?: number;
}

/**
 * Parse a statement file into candidate credit lines.
 *
 * A malformed file throws with the reason, because there is nothing useful to
 * reconcile. Individual bad rows do not: they come back flagged, so one
 * unparseable amount in three hundred lines does not cost the admin the other
 * two hundred and ninety-nine.
 */
export function parseBankStatement(text: string, opts: ParseOptions = {}): ParseResult {
  const dayFirst = opts.dayFirst !== false;
  const maxRows = opts.maxRows ?? 5000;
  const warnings: ParseWarning[] = [];

  // Strip a UTF-8 BOM. Excel writes one on every export, and it would otherwise
  // become part of the first header cell and break that column's detection.
  const clean = text.replace(/^\uFEFF/, "");

  let matrix: string[][];
  try {
    matrix = parse(clean, {
      skip_empty_lines: true,
      relax_column_count: true,
      relax_quotes: true,
      trim: false,
      bom: true,
    }) as string[][];
  } catch (err: any) {
    throw new Error(`This file is not readable as CSV: ${String(err?.message ?? err).slice(0, 200)}`);
  }

  if (!matrix.length) {
    throw new Error("This file is empty.");
  }

  // Find the header row.
  //
  // Not simply "the first row that is text". Axis and Slice both open their
  // exports with an account-summary block - account holder, email, IFSC,
  // account number - and those rows look exactly like headings: several words,
  // no numbers. Committing to the first such row meant a perfectly good
  // transaction table further down the sheet was never read, and the file was
  // rejected for having "no UTR column" while naming the email address as one
  // of its columns.
  //
  // So each plausible row is scored by what it actually maps, and the first one
  // that identifies a transaction AND an amount wins. A row that cannot do both
  // is describing a summary block, not the table.
  const scanLimit = Math.min(matrix.length, 25);
  let headerIndex = -1;
  let headers: string[] = [];
  let map: ColumnMap = {};
  // Kept only so a failure can still name the columns it did see.
  let fallbackHeaders: string[] = [];
  let fallbackScore = -1;

  for (let i = 0; i < scanLimit; i += 1) {
    if (!looksLikeHeader(matrix[i])) continue;
    const candidateHeaders = matrix[i].map((c) => String(c ?? "").trim());
    const candidateMap = detectMapping(candidateHeaders);
    const score = Object.keys(candidateMap).length;
    if (score > fallbackScore) {
      fallbackScore = score;
      fallbackHeaders = candidateHeaders;
    }
    const identifies = candidateMap.reference !== undefined;
    const values =
      candidateMap.amount !== undefined ||
      candidateMap.credit !== undefined ||
      candidateMap.debit !== undefined;
    if (identifies && values) {
      headerIndex = i;
      headers = candidateHeaders;
      map = candidateMap;
      break;
    }
  }

  if (headerIndex === -1) {
    if (fallbackScore <= 0) {
      throw new Error(
        "No header row could be found. The first row must name the columns, including the UTR/reference and the amount.",
      );
    }
    // Something looked like a header but did not name the columns the matcher
    // needs. Say which ones it named, so it is obvious that the transaction
    // table further down was not the problem.
    const seen = fallbackHeaders.filter(Boolean).join(", ");
    const tail = fallbackHeaders.some((h) => h)
      ? `Columns in the closest header-like row: ${seen}. `
      : "";

    // Which half of the mapping actually failed, so the message names the column
    // the admin has to change.
    //
    // These two cases were previously collapsed into one message that always
    // blamed the amount column. A Slice export has DEBIT and CREDIT recognised
    // perfectly and only its "REF NO." heading unrecognised, and it was told to
    // "add a 'Credit', 'Debit' or 'Amount' column" - columns it already had. The
    // admin adds them, the file fails identically, and the real cause is never
    // surfaced.
    const fallbackMap = detectMapping(fallbackHeaders);
    const hasAmountRole =
      fallbackMap.amount !== undefined ||
      fallbackMap.credit !== undefined ||
      fallbackMap.debit !== undefined;
    const refishHeading = fallbackHeaders.find((h) => {
      const clean = normaliseHeading(h);
      return clean.length > 0 && /\b(utr|rrn|ref|reference)\b/i.test(clean);
    });

    if (refishHeading && !hasAmountRole) {
      throw new Error(
        `${tail}No amount column was found next to the reference column. Add a 'Credit', 'Debit' or 'Amount' column.`,
      );
    }
    if (refishHeading) {
      throw new Error(
        `${tail}Found a reference column ("${refishHeading}") and an amount column, but that heading was not ` +
          "recognised as the reference. Rename it to 'UTR No' or 'Reference No' and upload again.",
      );
    }
    throw new Error(
      `${tail}No UTR or reference column was found. Rename the column to something like 'UTR No' or 'Reference' and upload again.`,
    );
  }

  if (headerIndex > 0) {
    warnings.push({
      kind: "HEADER_NOT_FIRST",
      detail: `Skipped ${headerIndex} line(s) above the header row. Check that the columns were detected correctly.`,
    });
  }

  // The scan above only accepts a row whose mapping both identifies a
  // transaction and names an amount, so a reference column is guaranteed here -
  // but the narrowing does not survive the loop, so it is restated. In a money
  // path an impossible branch should fail loudly rather than index with
  // `undefined`.
  const referenceColumn = map.reference;
  if (referenceColumn === undefined) {
    throw new Error(
      `No UTR or reference column was found. Columns in this file: ${headers.filter(Boolean).join(", ")}. ` +
        "Rename the column to something like 'UTR No' or 'Reference' and upload again.",
    );
  }

  // Where the amount lives, whether or not there is a separate credit/debit pair.
  // Presence of the cell decides, not its value - see cellFilled. The explicit
  // `!== undefined` checks are load-bearing for the type as well as for clarity:
  // cellFilled's own check is what makes the index safe at runtime.
  const effectiveAmount = (cells: string[]): number | null => {
    if (map.credit !== undefined && cellFilled(cells, map.credit)) {
      return parseAmount(cells[map.credit]);
    }
    if (map.debit !== undefined && cellFilled(cells, map.debit)) {
      return parseAmount(cells[map.debit]);
    }
    if (map.amount !== undefined && cellFilled(cells, map.amount)) {
      return parseAmount(cells[map.amount]);
    }
    return null;
  };

  const rows: ParsedRow[] = [];
  const dataStart = headerIndex + 1;
  const end = Math.min(matrix.length, dataStart + maxRows);

  if (matrix.length - dataStart > maxRows) {
    warnings.push({
      kind: "TRUNCATED",
      detail: `Only the first ${maxRows} data rows were read; the file has ${matrix.length - dataStart}.`,
    });
  }

  for (let i = dataStart; i < end; i++) {
    const cells = matrix[i];
    const lineNo = i + 1;

    const narration = map.narration !== undefined ? String(cells[map.narration] ?? "") : "";
    const altReferences = extractUpiReferences(narration);

    const rawReference = String(cells[referenceColumn] ?? "").trim();
    // A row whose reference column is blank but whose narration carries a UPI id
    // still names a payment the customer can claim, so promote that id instead of
    // reporting the line as having no reference at all.
    const referenceNorm = rawReference ? normaliseReference(rawReference) : altReferences[0] ?? "";
    const rawAmount = String(
      (map.credit !== undefined && cells[map.credit]) ||
      (map.debit !== undefined && cells[map.debit]) ||
      (map.amount !== undefined ? cells[map.amount] : "") ||
      "",
    ).trim();
    const rawDate = map.date !== undefined ? String(cells[map.date] ?? "").trim() : "";

    // A wholly blank line is not a row; skip before flagging it, or every
    // trailing newline in the file becomes an UNMATCHED line for the admin.
    if (!rawReference && !rawAmount && !rawDate) continue;

    const amount = effectiveAmount(cells);
    const txnDate = parseTxnDate(rawDate, dayFirst);
    const { inbound, weak } = resolveInbound(cells, map);

    // A line with neither a reference nor a readable amount cannot match a claim
    // and can never be credited, so there is nothing an admin could decide about
    // it. On a PDF whose narration wraps across lines these are the continuation
    // fragments, and they were being reported as "this line has no transaction
    // reference" - filling the preview with warnings no one can act on while the
    // two real payments scroll off the page.
    if (!referenceNorm && amount === null) continue;

    let matchStatus: RowStatus = "PENDING";
    let matchReason = "";

    if (!referenceNorm) {
      matchStatus = "NO_REFERENCE";
      matchReason = "This line has no UTR or reference, so it cannot be matched to a request.";
    } else if (amount === null) {
      matchStatus = "UNPARSEABLE_AMOUNT";
      matchReason = rawAmount
        ? `Could not read "${rawAmount}" as an amount.`
        : "This line has no amount.";
    } else if (amount === 0) {
      matchStatus = "ZERO_AMOUNT";
      matchReason = "The amount is zero.";
    } else if (!inbound) {
      matchStatus = "OUTBOUND";
      matchReason = "Money leaving the account, so it is not a payment in.";
    }

    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) raw[h] = String(cells[idx] ?? "");
    });

    rows.push({
      lineNo,
      rawReference,
      referenceNorm,
      altReferences,
      rawAmount,
      rawDate,
      amount,
      txnDate,
      inbound,
      matchStatus,
      matchReason,
      raw,
    });

    if (weak && matchStatus === "PENDING") {
      warnings.push({
        kind: "DIRECTION_INFERRED",
        detail: `Line ${lineNo}: no credit/debit column, so this was treated as money in. Check it.`,
      });
    }
  }

  if (!rows.length) {
    warnings.push({ kind: "NO_ROWS", detail: "The file has a header but no data rows below it." });
  }

  const dates = rows.map((r) => r.txnDate).filter((d): d is Date => d !== null);
  const periodFrom = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const periodTo = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

  return { rows, columnMap: map, headerLineNo: headerIndex + 1, headers, warnings, periodFrom, periodTo };
}

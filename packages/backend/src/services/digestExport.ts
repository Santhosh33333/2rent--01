/**
 * CSV export of a role's digest.
 *
 * The email body is for reading; this is for the finance admin who needs to open
 * a spreadsheet, reconcile a payout, or paste two days side by side. It carries
 * exactly the rows that role can see in the email and nothing more, so the
 * attachment cannot become a way to leak another role's figures.
 */
import type { DigestSection, DigestRole } from "./dailyAdminDigest";
import { sectionsForRole } from "./dailyAdminDigest";
import { localDateStamp, periodTitle, type ReportWindow } from "./reportPeriods";

/**
 * Fold the digest's few non-ASCII characters down to ASCII.
 *
 * A BOM is NOT enough for an email attachment, which is how this file is always
 * delivered. The BOM is a hint Excel honours when it opens a CSV from disk, but
 * here the MIME charset is chosen by the mail provider and then by whatever
 * opens the attachment - a webmail preview, Google Sheets, LibreOffice, or
 * Excel itself after a round trip. Any of those guessing windows-1252 turns
 * "\u20b90.50" into "\u00e2\u0082\u00b90.50": unreadable for a human, and worse, it
 * looks like a different number to whoever is reconciling a payout.
 *
 * Writing the file as plain ASCII removes the ambiguity completely, because a
 * byte string that is identical under every encoding needs no charset to be
 * agreed on. Rs is ordinary notation in Indian finance, so the figures stay
 * legible, and "Rs 4,200.00" still parses as a number for a spreadsheet.
 *
 * Anything with no known ASCII equivalent becomes "?" rather than being passed
 * through: an unmapped character is the one case where a guess could reintroduce
 * the exact corruption this is here to remove.
 */
const ASCII_FOLD: Array<[RegExp, string]> = [
  [/\u20b9/g, "Rs "],           // rupee sign
  [/\u2014|\u2013/g, "-"],      // em dash, en dash
  [/\u2018|\u2019|\u201a|\u201b/g, "'"], // curly single quotes
  [/\u201c|\u201d|\u201e|\u201f/g, '"'], // curly double quotes
  [/\u2026/g, "..."],           // ellipsis
  [/\u00a0/g, " "],             // no-break space
  [/\u2022/g, "-"],             // bullet
  [/\u2192/g, "->"],            // right arrow
  [/\u00d7|\u2715|\u2716|\u2717/g, "x"], // multiplication / ballot x
];

function toAscii(value: string): string {
  let v = value;
  for (const [re, to] of ASCII_FOLD) v = v.replace(re, to);
  // Only the high bytes go. The range deliberately starts at \x00 rather than
  // \x20: a newline, tab or carriage return inside a cell is structure that
  // csvCell quotes and escapes, so replacing it would corrupt the row layout -
  // a label of 'a,b "c"\nd' would come out as one line of 'a,b "c"?d'.
  //
  // The u flag is load-bearing. Without it this operates on UTF-16 code units,
  // so an astral character (any emoji) is two lone surrogates and gets replaced
  // by two question marks - "emoji ?? label" instead of "emoji ? label".
  return v.replace(/[^\x00-\x7E]/gu, "?");
}

/**
 * RFC 4180 quoting.
 *
 * Only quote when necessary rather than always: a naive "quote everything"
 * exporter is safe but produces a file where every cell has quotes, which some
 * spreadsheet importers then display literally. The leading-apostrophe guard
 * matters because a value beginning =, +, - or @ is executed as a formula by
 * Excel and Sheets. No digest label is attacker-controlled today, but a label is
 * a string in a database row the day someone adds an admin-editable section
 * title, and the exporter should not be the thing that turns that into code
 * execution on a finance machine.
 */
function csvCell(value: string): string {
  let v = toAscii(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function buildDigestCsv(
  role: DigestRole,
  sections: DigestSection[],
  window: ReportWindow,
): string {
  const wanted = sectionsForRole(role);
  const shown = sections.filter((s) => wanted.includes(s.title));

  const lines: string[] = [];
  lines.push(["Report", periodTitle(window.period)].map(csvCell).join(","));
  lines.push(["Role", role].map(csvCell).join(","));
  // Both boundaries, in full ISO, so a downloaded file is reconcilable against
  // the ledger without anyone having to remember what "this month" meant.
  lines.push(["Window start (inclusive)", window.since.toISOString()].map(csvCell).join(","));
  lines.push(["Window end (exclusive)", window.until.toISOString()].map(csvCell).join(","));
  // Only the sections actually present, not the role's whole wishlist: the daily
  // mail has no tax rows, so listing "Tax and statutory" in its header would
  // suggest the file contains a return that it does not.
  lines.push(["Sections", shown.map((s) => s.title).join(" | ") || "none"].map(csvCell).join(","));
  lines.push("");
  lines.push(["Section", "Metric", "Value"].map(csvCell).join(","));

  for (const section of shown) {
    for (const row of section.rows) {
      lines.push([section.title, row.label, String(row.value)].map(csvCell).join(","));
    }
  }

  // CRLF, and every cell already folded to ASCII by csvCell above. CRLF because
  // RFC 4180 specifies it and bare-LF files come back as one long line in some
  // spreadsheet importers. No BOM: with the content ASCII there is no encoding
  // left to declare, and a BOM is itself a known source of a stray character
  // showing up in the first header cell when a file is imported rather than
  // opened.
  return lines.join("\r\n") + "\r\n";
}

/**
 * Names the file after the role, the period and the window it covers.
 *
 * The period label is folded to ASCII and squeezed, so a monthly file is
 * `nabri-digest-super_admin-monthly-2026-09.csv` rather than something with
 * spaces or a rupee sign in it that a finance admin has to rename before it can
 * be attached to a return.
 */
export function digestCsvFilename(role: DigestRole, window: ReportWindow): string {
  const period = window.period.toLowerCase();
  return `nabri-digest-${role.toLowerCase()}-${period}-${localDateStamp(window.since)}.csv`;
}
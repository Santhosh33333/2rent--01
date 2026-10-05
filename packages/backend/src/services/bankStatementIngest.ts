/**
 * Getting a bank statement out of whatever file the merchant's bank actually
 * hands them, and into the ONE parser that already understands the rules.
 *
 * ## Why everything becomes CSV text
 *
 * `bankStatementParser` already encodes the parts that must never be guessed:
 * which column is the UTR, what counts as a negative amount, which of two
 * ambiguous dates is the day, when a row is safe to act on. A second reader for
 * `.xlsx` and a third for `.pdf` would each need those rules re-implemented, and
 * they would drift - the classic failure being "Excel says 12 rows, the same
 * statement as CSV says 13".
 *
 * So both formats are reduced to a cell grid and serialised back to CSV, and the
 * existing parser does all the deciding. The format readers below are therefore
 * only responsible for "what are the cells", which is the part that genuinely
 * differs per format.
 *
 * ## Honesty about PDF
 *
 * A PDF has no table. It has glyphs at coordinates. Recovering columns means
 * guessing where the gaps are, and a wrong guess silently merges two columns and
 * shifts every amount. Every reconstructed row therefore carries a warning, and
 * the reconciler never credits a row it could not read confidently - it lands in
 * the unmatched queue for a human. A slightly inconvenient PDF is much cheaper
 * than crediting the wrong person.
 */
import { createHash } from "crypto";
import type { ParseWarning } from "./bankStatementParser";

export type StatementFormat = "CSV" | "XLSX" | "PDF" | "UNKNOWN";

export interface IngestResult {
  /** CSV text, handed to `parseBankStatement`. */
  text: string;
  format: StatementFormat;
  warnings: ParseWarning[];
  /** sha256 of the ORIGINAL bytes, which is what the unique index stores. */
  fileHash: string;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Decide what the file really is.
 *
 * Magic bytes, never the client-supplied name or MIME type: both are chosen by
 * whoever uploaded, and a statement is the one upload where being wrong moves
 * money. `.csv` containing a PDF body is a rename away, and sniffing is the only
 * thing that notices.
 *
 * XLSX and XLSM are ZIP containers, so they share the `PK` signature and are told
 * apart from a generic ZIP by the reader failing, not by guessing here.
 */
export function sniffFormat(buffer: Buffer): StatementFormat {
  if (buffer.length >= 4) {
    if (buffer.subarray(0, 4).toString("latin1") === "%PDF") return "PDF";
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "XLSX"; // PK.. zip
    // Legacy BIFF .xls: the OLE2 compound-file signature D0 CF 11 E0.
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) {
      return "XLSX";
    }
  }
  return "CSV";
}

/**
 * Quote one CSV cell.
 *
 * A statement has narrations full of commas, and an unquoted comma there shifts
 * every column to its right - which is exactly how a UTR ends up in the amount
 * column and an amount gets matched against the wrong request.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula when
  // the file is opened again. Prefixing an apostrophe keeps the value intact for
  // a human looking at the source.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/** A cell grid -> RFC4180 CSV. Rows are padded so every line has equal width. */
export function gridToCsv(grid: unknown[][]): string {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";
  return grid
    .map((row) => {
      const cells = new Array(width);
      for (let i = 0; i < width; i += 1) cells[i] = csvCell(row[i]);
      return cells.join(",");
    })
    .join("\n");
}

/**
 * Normalise a value read out of a spreadsheet cell into parser-shaped text.
 *
 * `raw: false` in the reader gives us formatted strings, but Excel still hands
 * back `Date` objects for date-formatted cells and `number` for the rest, so the
 * conversion is explicit. Dates are rendered here rather than left as ISO,
 * because the parser's own `parseTxnDate` is the authority on ambiguous
 * day/month ordering and must see the same shape a CSV export would produce.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // dd/mm/yyyy: the shape Indian bank exports use, and the parser's default.
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    // Avoid 1e-7 style output and trailing ".0" noise for whole rupees.
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }
  return String(value);
}

async function readXlsx(buffer: Buffer, warnings: ParseWarning[]): Promise<string> {
  // Required lazily: pdfjs is large and only bank PDFs need it, so a deployment
  // that never sees one should not pay to load it on every upload.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    warnings.push({ kind: "EMPTY_WORKBOOK", detail: "The workbook has no sheets." });
    return "";
  }
  if (wb.SheetNames.length > 1) {
    warnings.push({
      kind: "MULTIPLE_SHEETS",
      detail: `The workbook has ${wb.SheetNames.length} sheets; only "${sheetName}" was read.`,
    });
  }
  const sheet = wb.Sheets[sheetName];
  // header:1 -> array of arrays, i.e. the cell grid the parser expects.
  // raw:false -> formatted text rather than underlying serials.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return gridToCsv(rows.map((row) => (Array.isArray(row) ? row.map(cellText) : row)));
}

/**
 * How much horizontal space counts as a column break, in ems of the line's own
 * text.
 *
 * An absolute threshold is wrong here. The same bank statement arrives at 8pt
 * from one export and 12pt from another, and a gap that is a column break in
 * the second is invisible in the first. Sizing the threshold to the text means
 * "wider than about three word spaces" at any font size: a single space inside
 * a narration is 0.25em and never splits, while the 3-space alignment banks
 * actually use is ~0.8em and always does.
 *
 * Deliberately biased towards too wide. Merging two columns shifts every amount
 * to the right of them, which is the dangerous direction; splitting one column
 * only makes a line land in the unmatched queue, where a human sees it. PDF
 * rows can never auto-credit, so the worst case here is a nuisance.
 */
const PDF_COLUMN_GAP_EM = 0.75;
/** Floor in user-space units, so text set absurdly small stays sane. */
const PDF_COLUMN_GAP_MIN = 2;
/** Rows whose baselines differ by less than this are the same printed line. */
const PDF_ROW_TOLERANCE = 3;

interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Glyph height, which is the font size for ordinary text. 0 for fillers. */
  height: number;
  hasEOL: boolean;
}

/**
 * How wide a piece of text is, when pdf.js could not measure it.
 *
 * Only used for PDFs whose embedded font has no usable metrics, which report
 * `width: 0`. Without a width there is no way to know where a cell ends, and
 * every column runs together. Helvetica and Times average roughly half an em
 * per character, which is close enough for a gap test - the alternative is
 * treating the whole page as one column.
 */
function estimateAdvance(text: string, item: PdfItem): number {
  const size = item.height > 0 ? item.height : 8;
  return text.length * size * 0.5;
}

async function readPdf(buffer: Buffer, warnings: ParseWarning[]): Promise<string> {
  // The legacy build is the Node-compatible entry point; the browser build
  // reaches for DOM globals this process does not have.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // No worker: pdf.js otherwise spawns one, and a statement upload is a rare
    // admin action that does not justify the process-level machinery.
    disableWorker: true,
    useSystemFonts: false,
  }).promise;

  const items: PdfItem[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      if (typeof raw.str !== "string" || raw.str.length === 0) continue;
      // transform = [a, b, c, d, e, f]; e is x and f is y in user space.
      const x = raw.transform[4] as number;
      const y = raw.transform[5] as number;
      items.push({
        str: raw.str,
        x,
        y,
        width: raw.width || 0,
        height: raw.height || 0,
        hasEOL: !!raw.hasEOL,
      });
    }
    page.cleanup();
  }
  await doc.destroy();

  if (items.length === 0) {
    warnings.push({
      kind: "NO_TEXT_LAYER",
      detail:
        "This PDF has no selectable text - it is a scan or an image. Upload a CSV or Excel export so the lines can be read.",
    });
    return "";
  }

  // Group glyphs into printed lines by baseline. Pages restart at the top, so a
  // line is only ever formed within one page's worth of coordinates.
  const lines: PdfItem[][] = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  let current: PdfItem[] = [];
  let currentY: number | null = null;

  for (const item of sorted) {
    if (currentY === null || Math.abs(item.y - currentY) <= PDF_ROW_TOLERANCE) {
      current.push(item);
      if (currentY === null) currentY = item.y;
    } else {
      lines.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length) lines.push(current);

  const grid: string[][] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);

    // Flatten the line into positioned pieces first, then decide where the
    // column breaks are. Doing it in two passes is what makes the two ways a
    // PDF can express a gap both work; see below.
    const pieces: Array<{ text: string; start: number; end: number }> = [];
    for (const item of line) {
      // pdf.js emits a synthetic whitespace run to carry the horizontal gap
      // between two glyph clusters, and gives that run the FULL width of the
      // gap. Treating it as content swallows the gap it represents: the next
      // cell then starts exactly where this filler ends, so the distance from
      // the previous cell is ~0 and no break is ever detected. Every row comes
      // back as one cell, the header row has one cell, and the parser rejects
      // the file for having no header. Skipping fillers is the fix.
      if (item.str.trim() === "") continue;

      const runWidth = item.width > 0 ? item.width : estimateAdvance(item.str, item);

      // A bank that writes a whole printed line as one string has no separate
      // glyph clusters to measure, so the gap lives inside the string: "Date
      // UTR Narration Amount". Two or more spaces is the alignment signal; a
      // single space is just a word gap inside a narration, so only runs of 2+
      // are treated as column breaks.
      const parts = item.str.split(/[ \t]{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length <= 1) {
        pieces.push({ text: item.str.trim(), start: item.x, end: item.x + runWidth });
        continue;
      }

      // Sub-cells inside one run have no x of their own, so lay them out
      // across the run in proportion to their character counts. The internal
      // spacing IS the column layout; character counts are the only available
      // proxy for where each part sits inside it.
      const totalChars = parts.reduce((n, p) => n + p.length, 0) || 1;
      let cursor = item.x;
      for (const part of parts) {
        const w = (part.length / totalChars) * runWidth;
        pieces.push({ text: part, start: cursor, end: cursor + w });
        cursor += w;
      }
    }

    const cells: string[] = [];
    let buffer = "";
    let previousEnd: number | null = null;
    // Sized to this line's own text, so the same rule works at any font size.
    const tallest = line.reduce((h, i) => (i.height > h ? i.height : h), 0);
    const gap = Math.max(PDF_COLUMN_GAP_MIN, tallest * PDF_COLUMN_GAP_EM);
    for (const piece of pieces) {
      if (previousEnd !== null && piece.start - previousEnd > gap) {
        cells.push(buffer.trim());
        buffer = "";
      }
      buffer += piece.text;
      previousEnd = piece.end;
    }
    cells.push(buffer.trim());
    grid.push(cells);
  }

  // A PDF whose columns could not be recovered must not look trustworthy. The
  // reconciler keys off `warnings` to keep these rows out of auto-crediting.
  warnings.push({
    kind: "PDF_TABLE_RECONSTRUCTED",
    detail:
      `Columns in this PDF were reconstructed from glyph positions (${grid.length} line(s)). ` +
      "Check the preview before applying, and expect to comment on anything unmatched.",
  });

  return gridToCsv(grid);
}

/**
 * Entry point: file bytes in, parser-ready CSV text out.
 *
 * Never throws for a recognised-but-unreadable file. A bank export is not clean
 * input, and a single odd sheet should not cost the admin the whole upload -
 * `warnings` is how the problem reaches them instead.
 */
export async function ingestStatement(
  buffer: Buffer,
): Promise<IngestResult> {
  const warnings: ParseWarning[] = [];
  const format = sniffFormat(buffer);
  const fileHash = sha256(buffer);

  let text = "";
  if (format === "XLSX") {
    try {
      text = await readXlsx(buffer, warnings);
    } catch (err) {
      warnings.push({
        kind: "XLSX_UNREADABLE",
        detail: `Could not read this workbook: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
      });
    }
  } else if (format === "PDF") {
    try {
      text = await readPdf(buffer, warnings);
    } catch (err) {
      warnings.push({
        kind: "PDF_UNREADABLE",
        detail: `Could not read this PDF: ${String((err as Error)?.message ?? err).slice(0, 200)}`,
      });
    }
  } else {
    text = buffer.toString("utf8");
    // Banks in this market export UTF-8, but a Windows-generated file is often
    // UTF-16, which decodes as CJK-looking garbage and would match nothing.
    if (/^﻿/.test(text) || text.includes("\0")) {
      const asUtf16 = buffer.toString("utf16le").replace(/^﻿/, "");
      if (asUtf16.split("\n").length >= text.split("\n").length) {
        warnings.push({
          kind: "ENCODING_GUESSED",
          detail: "This file looked like UTF-16; it was read as UTF-16.",
        });
        text = asUtf16;
      }
    }
  }

  return { text, format, warnings, fileHash };
}
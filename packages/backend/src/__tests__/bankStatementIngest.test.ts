import { describe, it, expect } from "vitest";
import { ingestStatement, sniffFormat, gridToCsv } from "../services/bankStatementIngest";
import { parseBankStatement } from "../services/bankStatementParser";

/**
 * The PDF reader had no tests at all, and that is precisely why it shipped
 * broken: every statement came back as a single column, the parser rejected it
 * for "no header row", and the admin got a 500. The failure was invisible to a
 * suite that only ever fed the parser CSV.
 *
 * So these tests build actual PDFs - byte for byte, with a real xref table - in
 * the three shapes banks emit, and assert on the columns that come out.
 */

type Cell = { x: number; y: number; text: string };

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** One Tj per cell, positioned with Tm. What most report generators emit. */
function cellsContent(cells: Cell[], size: number): string {
  return cells
    .map((c) => `BT /F1 ${size} Tf 1 0 0 1 ${c.x} ${c.y} Tm (${esc(c.text)}) Tj ET`)
    .join("\n");
}

/** The whole printed line as one string with aligned gaps. */
function rowTextContent(rows: string[][], size: number, gap: string): string {
  return rows
    .map((cells, i) => `BT /F1 ${size} Tf 1 0 0 1 40 ${550 - i * 15} Tm (${esc(cells.join(gap))}) Tj ET`)
    .join("\n");
}

function buildPdf(content: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const COLS = [40, 110, 250, 450, 520];
const HEADER = ["Date", "UTR", "Narration", "Amount", "Balance"];
const ROWS: string[][] = [
  ["04/10/2026", "UIPROBE-UPI-0001", "UPI CR Nabri Wallet", "750.00", "9250.00"],
  ["04/10/2026", "UIPROBE-UNKNOWN-9", "NEFT IN from someone", "250.00", "9500.00"],
  ["03/10/2026", "UIPROBE-UPI-0002", "UPI CR Nabri Wallet", "125.50", "9625.50"],
];

function cellsPdf(size = 8): Buffer {
  const cells: Cell[] = [];
  let y = 550;
  HEADER.forEach((h, i) => cells.push({ x: COLS[i], y, text: h }));
  for (const row of ROWS) {
    y -= 15;
    row.forEach((text, i) => cells.push({ x: COLS[i], y, text }));
  }
  return buildPdf(cellsContent(cells, size));
}

async function parsedFor(buffer: Buffer) {
  const ingest = await ingestStatement(buffer);
  return { ingest, parsed: parseBankStatement(ingest.text) };
}

describe("sniffFormat", () => {
  it("trusts magic bytes over the file name", () => {
    expect(sniffFormat(buildPdf(""))).toBe("PDF");
    expect(sniffFormat(Buffer.from("Date,Amount\n04/10/2026,750\n"))).toBe("CSV");
    expect(sniffFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe("XLSX");
  });
});

describe("PDF with one glyph run per cell", () => {
  it("recovers the columns instead of collapsing the page into one", async () => {
    const { ingest, parsed } = await parsedFor(cellsPdf());

    expect(ingest.format).toBe("PDF");
    expect(parsed.columnMap).toMatchObject({
      date: 0,
      reference: 1,
      narration: 2,
      amount: 3,
      balance: 4,
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((r) => r.referenceNorm)).toEqual([
      "UIPROBE-UPI-0001",
      "UIPROBE-UNKNOWN-9",
      "UIPROBE-UPI-0002",
    ]);
    expect(parsed.rows.map((r) => r.amount)).toEqual([750, 250, 125.5]);
  });

  it("marks the table as reconstructed, which is what blocks auto-crediting", async () => {
    const { ingest } = await parsedFor(cellsPdf());
    expect(ingest.warnings.map((w) => w.kind)).toContain("PDF_TABLE_RECONSTRUCTED");
  });

  // The threshold is in ems precisely so this holds. With a fixed 10pt gap, the
  // 8pt version below sits at 6pt and every column runs together again.
  it("recovers the same columns at a larger font size", async () => {
    const { parsed } = await parsedFor(cellsPdf(12));
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.columnMap.amount).toBe(3);
  });
});

describe("PDF with one glyph run per printed line", () => {
  it("splits a whole-line string on its aligned gaps", async () => {
    const pdf = buildPdf(rowTextContent([HEADER, ...ROWS], 8, "   "));
    const { parsed } = await parsedFor(pdf);

    expect(parsed.columnMap).toMatchObject({ reference: 1, amount: 3 });
    expect(parsed.rows.map((r) => r.amount)).toEqual([750, 250, 125.5]);
  });

  it("does not split a narration on its single word spaces", async () => {
    const pdf = buildPdf(
      rowTextContent(
        [
          HEADER,
          ["04/10/2026", "UIPROBE-UPI-0003", "PAID BY CARD TOPUP AT MALL", "99.00", "100.00"],
        ],
        8,
        "   ",
      ),
    );
    const { ingest } = await ingestStatement(pdf).then((r) => ({ ingest: r }));
    const dataLines = ingest.text.split("\n")[1].split(",");

    // A single space inside a narration must never be read as a column break.
    expect(dataLines[2]).toBe("PAID BY CARD TOPUP AT MALL");
  });
});

describe("PDF with no text layer", () => {
  it("says so instead of pretending the file was empty of transactions", async () => {
    const pdf = buildPdf("1 0 0 RG 4 w 40 40 700 500 re S");
    const ingest = await ingestStatement(pdf);

    expect(ingest.warnings.map((w) => w.kind)).toContain("NO_TEXT_LAYER");
    expect(ingest.text).toBe("");
  });

  it("surfaces the reason through the parser rather than inventing rows", async () => {
    const pdf = buildPdf("1 0 0 RG 4 w 40 40 700 500 re S");
    const { text } = await ingestStatement(pdf);
    expect(() => parseBankStatement(text)).toThrow(/empty/i);
  });
});

describe("gridToCsv", () => {
  it("quotes a narration containing a comma so columns do not shift", () => {
    // An unquoted comma here would push every amount one column right, which is
    // how a UTR ends up compared against the wrong request.
    expect(gridToCsv([["Date", "Narration", "Amount"], ["04/10/2026", "CR, from A", "750"]])).toBe(
      'Date,Narration,Amount\n04/10/2026,"CR, from A",750',
    );
  });

  it("pads short rows so every line has the same width", () => {
    expect(gridToCsv([["a", "b"], ["c"]])).toBe("a,b\nc,");
  });

  it("neutralises a leading = so a spreadsheet treats the cell as text", () => {
    expect(gridToCsv([["=SUM(A1:A9)"]])).toBe("'=SUM(A1:A9)");
  });
});
import { describe, it, expect } from "vitest";
import {
  parseBankStatement,
  parseAmount,
  parseTxnDate,
  normaliseReference,
  extractUpiReferences,
} from "../services/bankStatementParser";

/**
 * These tests exist because the failure mode is silent. A parser that picks the
 * wrong column produces a file that imports cleanly, reconciles against nothing,
 * and reports "0 of 300 matched" - which looks exactly like a quiet week.
 */

describe("parseAmount", () => {
  it("reads a plain number", () => {
    expect(parseAmount("500")).toBe(500);
    expect(parseAmount("500.50")).toBe(500.5);
  });

  it("strips thousands separators in both groupings", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("1,23,456.78")).toBe(123456.78);
    expect(parseAmount("12,34,567")).toBe(1234567);
  });

  it("treats the last separator as the decimal point", () => {
    // European grouping: the comma is decimal because it has exactly two digits
    // after it. Reading this as 1234.50 would be a thousandfold error.
    expect(parseAmount("1.234,56")).toBe(1234.56);
  });

  it("strips a currency symbol or code", () => {
    expect(parseAmount("₹500")).toBe(500);
    expect(parseAmount("₹ 1,234.50")).toBe(1234.5);
    expect(parseAmount("INR 500")).toBe(500);
    expect(parseAmount("500 INR")).toBe(500);
  });

  it("reads negatives in all three notations", () => {
    expect(parseAmount("-250")).toBe(-250);
    expect(parseAmount("(250.00)")).toBe(-250);
    expect(parseAmount("−250")).toBe(-250);
  });

  it("uses a trailing DR as the negative signal", () => {
    expect(parseAmount("500.00 DR")).toBe(-500);
    expect(parseAmount("500.00 CR")).toBe(500);
  });

  it("returns null for prose rather than guessing zero", () => {
    // A balance cell or a note must never become 0.00, which is a real amount.
    expect(parseAmount("Balance as on date")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount("N/A")).toBeNull();
  });

  it("rejects a decimal point with an implausible number of places", () => {
    // 1.2345 is far more likely to be a grouping artefact or an id than a price.
    expect(parseAmount("1.2345")).toBeNull();
  });

  it("keeps zero distinguishable from unreadable", () => {
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("0.00")).toBe(0);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("normaliseReference", () => {
  it("folds case and strips whitespace so the same UTR compares equal", () => {
    expect(normaliseReference("  utr 123abc ")).toBe("UTR123ABC");
    expect(normaliseReference("UTR\t123\nABC")).toBe("UTR123ABC");
  });

  it("keeps punctuation, because two different UTRs may differ only by it", () => {
    // Merging these would credit one person's payment to another's request.
    expect(normaliseReference("UTR-123")).not.toBe(normaliseReference("UTR123"));
    expect(normaliseReference("UTR_1")).not.toBe(normaliseReference("UTR.1"));
  });

  it("treats an absent reference as empty", () => {
    expect(normaliseReference(null)).toBe("");
    expect(normaliseReference(undefined)).toBe("");
  });
});

describe("parseTxnDate", () => {
  it("reads an unambiguous ISO date", () => {
    expect(parseTxnDate("2026-10-04")?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("reads day-first by default, as Indian banks export", () => {
    // 04/10/2026 is 4 October here, not April 10th.
    const d = parseTxnDate("04/10/2026");
    expect(d?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("can be told to read month-first", () => {
    const d = parseTxnDate("04/10/2026", false);
    expect(d?.toISOString()).toBe("2026-04-10T00:00:00.000Z");
  });

  it("reads a two-digit year in this century", () => {
    expect(parseTxnDate("04/10/26")?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("keeps the time when one is present", () => {
    expect(parseTxnDate("04/10/2026 13:45:22")?.toISOString()).toBe("2026-10-04T13:45:22.000Z");
  });

  it("reads a month name", () => {
    expect(parseTxnDate("04 Oct 2026")?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("rejects a date that does not exist instead of rolling it forward", () => {
    // Date.UTC(2026, 1, 31) is 3 March. Silently shifting a payment by a month
    // would break the "arrived after the request" check it feeds.
    expect(parseTxnDate("31/02/2026")).toBeNull();
    expect(parseTxnDate("31/04/2026")).toBeNull();
  });

  it("rejects an impossible month or day", () => {
    expect(parseTxnDate("13/13/2026")).toBeNull();
    expect(parseTxnDate("00/10/2026")).toBeNull();
    expect(parseTxnDate("04/10/2026 25:00:00")).toBeNull();
  });

  it("reads an Excel serial date", () => {
    // 45995 days after the 1899-12-30 epoch is 2025-12-04.
    expect(parseTxnDate("45995")?.toISOString().slice(0, 10)).toBe("2025-12-04");
  });

  it("returns null for junk", () => {
    expect(parseTxnDate("")).toBeNull();
    expect(parseTxnDate(null)).toBeNull();
    expect(parseTxnDate("not a date")).toBeNull();
  });
});

const HEADER = "Date,UTR No,Description,Credit,Debit,Balance";

describe("parseBankStatement", () => {
  it("matches the common layout and keeps the raw text", () => {
    const csv = [
      HEADER,
      "04/10/2026,UTR123456,Payment from user,500.00,,12000.00",
      "05/10/2026,UTR777888,Payment from user,250.50,,12250.50",
    ].join("\n");

    const out = parseBankStatement(csv);
    expect(out.warnings).toEqual([]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].referenceNorm).toBe("UTR123456");
    expect(out.rows[0].amount).toBe(500);
    expect(out.rows[0].inbound).toBe(true);
    expect(out.rows[0].matchStatus).toBe("PENDING");
    expect(out.rows[0].lineNo).toBe(2);
    expect(out.rows[1].amount).toBe(250.5);
  });

  it("detects UTR no matter which synonym the bank uses", () => {
    for (const heading of [
      "Date,UTR No,Credit,Debit",
      "Date,UTR Number,Credit,Debit",
      "Date,Transaction Reference,Credit,Debit",
      "Date,Bank Ref,Credit,Debit",
      "Date,RRN,Credit,Debit",
      "Date,Reference,Credit,Debit",
      "Date,UPI Ref,Credit,Debit",
    ]) {
      const out = parseBankStatement(`${heading}\n04/10/2026,UTR999,500,`);
      expect(out.columnMap.reference, heading).toBe(1);
    }
  });

  it("picks the transaction reference over a narration that merely says reference", () => {
    // "Particulars" and "Remarks" columns sit next to the real UTR column, and a
    // narration mentioning a reference must not steal the match slot.
    const csv = [
      "Date,Particulars,Remarks,Reference No,Amount",
      "04/10/2026,UPI payment,ref no pending,UTR555,500",
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.columnMap.reference).toBe(3);
    expect(out.rows[0].referenceNorm).toBe("UTR555");
    expect(out.rows[0].amount).toBe(500);
  });

  it("skips an account-summary preamble and says so", () => {
    const csv = [
      "Account Holder Name,Example Pvt Ltd",
      "Account Number,XXXX1234",
      "Statement Period,01/09/2026 to 04/10/2026",
      HEADER,
      "04/10/2026,UTR123,Payment,500.00,,",
    ].join("\n");

    const out = parseBankStatement(csv);
    expect(out.headerLineNo).toBe(4);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].referenceNorm).toBe("UTR123");
    expect(out.warnings.some((w) => w.kind === "HEADER_NOT_FIRST")).toBe(true);
  });

  it("reads a UTF-8 BOM without corrupting the first heading", () => {
    const csv = "\uFEFF" + HEADER + "\n04/10/2026,UTR123,Payment,500.00,,";
    const out = parseBankStatement(csv);
    expect(out.columnMap.reference).toBe(1);
    expect(out.rows[0].referenceNorm).toBe("UTR123");
  });

  it("marks debits outbound and never offers them for crediting", () => {
    const csv = [
      HEADER,
      "04/10/2026,UTR111,Payment in,500.00,,1000.00",
      "04/10/2026,UTR222,Payout,,300.00,700.00",
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].inbound).toBe(true);
    expect(out.rows[0].matchStatus).toBe("PENDING");
    expect(out.rows[1].inbound).toBe(false);
    expect(out.rows[1].matchStatus).toBe("OUTBOUND");
  });

  it("flags a line with no UTR instead of matching it on amount alone", () => {
    const csv = [HEADER, "04/10/2026,,Payment,500.00,,"].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].matchStatus).toBe("NO_REFERENCE");
    expect(out.rows[0].matchReason).toMatch(/no UTR or reference/i);
  });

  it("flags an unreadable amount and keeps zero distinct", () => {
    const csv = [HEADER, "04/10/2026,UTR1,Payment,pending,,"].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].matchStatus).toBe("UNPARSEABLE_AMOUNT");

    const zero = parseBankStatement([HEADER, "04/10/2026,UTR2,Payment,0.00,,"].join("\n"));
    expect(zero.rows[0].matchStatus).toBe("ZERO_AMOUNT");
  });

  it("warns rather than silently guessing when direction comes from the sign", () => {
    const csv = [
      "Date,UTR No,Amount,Balance",
      "04/10/2026,UTR123,500.00,1000.00",
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].inbound).toBe(true);
    expect(out.warnings.some((w) => w.kind === "DIRECTION_INFERRED")).toBe(true);
  });

  it("reads a Dr/Cr direction column", () => {
    const csv = [
      "Date,UTR No,Dr/Cr,Amount",
      "04/10/2026,UTR111,Cr,500.00",
      "04/10/2026,UTR222,Dr,300.00",
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].inbound).toBe(true);
    expect(out.rows[0].amount).toBe(500);
    expect(out.rows[1].inbound).toBe(false);
  });

  it("handles quoted fields containing commas", () => {
    const csv = [
      HEADER,
      '"04/10/2026","UTR123","Payment, credit from Asha, Chennai","500.00","","1000.00"',
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].amount).toBe(500);
    expect(out.rows[0].referenceNorm).toBe("UTR123");
  });

  it("handles CRLF line endings", () => {
    const csv = [HEADER, "04/10/2026,UTR123,Payment,500.00,,"].join("\r\n");
    const out = parseBankStatement(csv);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].referenceNorm).toBe("UTR123");
  });

  it("ignores blank lines rather than reporting them as unmatched", () => {
    const csv = [HEADER, "04/10/2026,UTR123,Payment,500.00,,", "", "05/10/2026,UTR124,Payment,100.00,,"].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows).toHaveLength(2);
  });

  it("refuses a file with no UTR column rather than guessing a position", () => {
    const csv = ["Date,Description,Amount", "04/10/2026,Something,500"].join("\n");
    expect(() => parseBankStatement(csv)).toThrow(/UTR or reference column/i);
  });

  it("refuses a file with no amount column", () => {
    const csv = ["Date,UTR No,Description", "04/10/2026,UTR123,Something"].join("\n");
    expect(() => parseBankStatement(csv)).toThrow(/amount column/i);
  });

  it("refuses an empty file", () => {
    expect(() => parseBankStatement("")).toThrow(/empty/i);
  });

  it("reports the statement period from the dates it read", () => {
    const csv = [
      HEADER,
      "05/10/2026,UTR2,Payment,100.00,,",
      "03/10/2026,UTR1,Payment,200.00,,",
    ].join("\n");
    const out = parseBankStatement(csv);
    expect(out.periodFrom?.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(out.periodTo?.toISOString().slice(0, 10)).toBe("2026-10-05");
  });

  it("truncates rather than importing an unbounded number of rows", () => {
    const lines = [HEADER];
    for (let i = 0; i < 50; i++) lines.push(`04/10/2026,UTR${i},Payment,10.00,,`);
    const out = parseBankStatement(lines.join("\n"), { maxRows: 10 });
    expect(out.rows).toHaveLength(10);
    expect(out.warnings.some((w) => w.kind === "TRUNCATED")).toBe(true);
  });

  it("keeps the original row so a mismatch can be explained later", () => {
    const csv = [HEADER, "04/10/2026,UTR123,Payment from Asha,500.00,,"].join("\n");
    const out = parseBankStatement(csv);
    expect(out.rows[0].raw["Description"]).toBe("Payment from Asha");
  });
});

describe("header detection under a bank account-summary block", () => {
  // Axis and Slice both open their statement exports with an account-summary
  // block - holder name, email, IFSC, account number - before the transaction
  // table. Those preamble rows read exactly like headings: several words, no
  // numbers. An earlier version of this parser committed to the first such row
  // and then rejected the file for having no UTR column "in a file" whose
  // columns were, in its own words, "Email, santhoshkrishna958@gmail.com, IFSC,
  // NESF0000333" - while a complete, valid transaction table sat six rows below.
  const PREAMBLE = [
    "Slice, Axis Bank,,,",
    "Account Holder,SANTHOSH KRISHNA,,",
    "Email,santhoshkrishna958@gmail.com,IFSC,NESF0000333",
    "Account Number,9230301234567890,Period,01/10/2026 - 04/10/2026",
    ",,,",
  ];
  const TABLE = [
    "Date,Description,Reference Number,Debit,Credit,Balance",
    "01/10/2026,UPI/CR/AXIS/Asha,412233445566,,750.00,9250.00",
    "02/10/2026,NEFT/OUT/AXIS/Rent,412233445567,120.00,,9130.00",
    "03/10/2026,UPI/CR/AXIS/Rohan,412233445568,,125.50,9255.50",
  ];

  it("finds the transaction table below the summary block", () => {
    const out = parseBankStatement([...PREAMBLE, ...TABLE].join("\n"));

    expect(out.columnMap).toMatchObject({
      date: 0,
      narration: 1,
      reference: 2,
      debit: 3,
      credit: 4,
      balance: 5,
    });
    expect(out.rows).toHaveLength(3);
    expect(out.rows.map((r) => r.referenceNorm)).toEqual([
      "412233445566",
      "412233445567",
      "412233445568",
    ]);
  });

  it("tells the admin that rows above the header were skipped", () => {
    const out = parseBankStatement([...PREAMBLE, ...TABLE].join("\n"));
    expect(out.warnings.some((w) => w.kind === "HEADER_NOT_FIRST")).toBe(true);
  });

  // The reason this matters for money: a summary block has no debit/credit
  // columns, so reading direction off the wrong table silently inverts it.
  it("still tells a debit from a credit", () => {
    const out = parseBankStatement([...PREAMBLE, ...TABLE].join("\n"));
    expect(out.rows.map((r) => [r.amount, r.inbound])).toEqual([
      [750, true],
      [120, false],
      [125.5, true],
    ]);
    expect(out.rows[1].matchStatus).toBe("OUTBOUND");
  });

  it("says so plainly when the file is only a summary", () => {
    expect(() => parseBankStatement(PREAMBLE.join("\n"))).toThrow(/No header row could be found/i);
  });

  it("names the columns it did see when the table has a reference but no money column", () => {
    const csv = [
      "Email,santhoshkrishna958@gmail.com,IFSC,NESF0000333",
      "Date,Description,Reference Number",
      "01/10/2026,UPI,412233445566",
    ].join("\n");
    // "Validation failed" style genericity would tell the admin nothing about
    // which of their columns is the problem.
    expect(() => parseBankStatement(csv)).toThrow(/Date, Description, Reference Number/);
    expect(() => parseBankStatement(csv)).toThrow(/no amount column/i);
  });
});

/**
 * Regression cover for the two defects that made a Slice statement reconcile to
 * nobody while looking perfectly valid.
 *
 * Both were found against a real export from Slice Small Finance Bank
 * (IFSC NESF0000333), and both are the kind of failure this file already exists
 * to catch: the file imports, the preview renders, and the result is silence.
 */
describe("punctuated reference headings (Slice / Axis)", () => {
  // Real column headers from the Slice export.
  const SLICE_HEADER = "DATE,DETAILS,REF NO.,TRANSACTION TYPE,DEBIT,CREDIT,BALANCE";
  const SLICE_ROWS = [
    "01 Oct '26,UPI-Credit-130500139151-KATHIRVEL S-HDFC0001284-kathir3459-5@okhdfcbank,2026100148790401,CREDIT,,2880,2882.79",
    "01 Oct '26,UPI-Debit-627377943583-SANTHOSH KUMAR U-UTIB0003492-sk128383828282@slc-self transfer,2026100152042401,DEBIT,2882,,0.79",
  ];

  const withPreamble = [
    "Customer ID,380004016598,,Account,SAVINGS,,",
    "Email,santhoshkrishna958@gmail.com,,IFSC,NESF0000333,,",
    SLICE_HEADER,
    ...SLICE_ROWS,
  ].join("\n");

  it("recognises 'REF NO.' as the reference column", () => {
    // The heading is punctuated, and the pattern was anchored at the end of the
    // string, so a trailing full stop hid the only reference column in the file
    // and the upload was rejected outright.
    const parsed = parseBankStatement(withPreamble);
    expect(parsed.columnMap.reference).toBe(2);
    expect(parsed.headers).toContain("REF NO.");
  });

  it("still separates debit and credit with the punctuated heading present", () => {
    const parsed = parseBankStatement(withPreamble);
    // Found by reference rather than line number: the preamble length is a fixture
    // detail, and the point of the assertion is direction, not position.
    const credit = parsed.rows.find((r) => r.rawReference === "2026100148790401")!;
    const debit = parsed.rows.find((r) => r.rawReference === "2026100152042401")!;
    expect(credit.amount).toBe(2880);
    expect(credit.inbound).toBe(true);
    expect(debit.inbound).toBe(false);
  });

  it("recognises the other spellings these banks use", () => {
    const forms = ["Ref No.", "REF NO.", "Reference No.", "Ref No", "Reference Number"];
    for (const heading of forms) {
      const csv = [`Date,Details,${heading},Credit`, `01/10/2026,UPI,412233445566,500`].join("\n");
      const parsed = parseBankStatement(csv);
      expect(parsed.columnMap.reference, `heading: ${heading}`).toBe(2);
    }
  });

  it("does not let a cheque number claim the reference slot", () => {
    // Axis exports carry both. Crediting against a cheque number would match the
    // wrong payment, so "Cheque No." must not be taken as the reference.
    const csv = ["Date,Cheque No.,Reference No.,Credit", "01/10/2026,000123,412233445566,500"].join("\n");
    const parsed = parseBankStatement(csv);
    expect(parsed.columnMap.reference).toBe(2);
    expect(parsed.rows[0].referenceNorm).toBe("412233445566");
  });

  it("blames the reference column, not the amount column, when only it is wrong", () => {
    // The previous message always said "add a Credit, Debit or Amount column",
    // for a file that already had both. Following that advice changed nothing and
    // hid the real cause.
    const csv = [
      "Account ID,123456789",
      "Date,Payee Details,Ref No (System),CREDIT",
      "01/10/2026,UPI,412233445566,500",
    ].join("\n");
    // "Ref No (System)" is what banks print when they append their own internal
    // label, and it is ref-ish without being one of the accepted spellings.
    expect(() => parseBankStatement(csv)).toThrow(/reference/i);
  });
});

describe("UPI transaction id inside the narration", () => {
  it("extracts the RRN from a Slice-style narration", () => {
    expect(
      extractUpiReferences("UPI-Credit-130500139151-KATHIRVEL S-HDFC0001284-kathir3459-5@okhdfcbank")
    ).toEqual(["130500139151"]);
  });

  it("extracts the RRN from an Axis-style narration", () => {
    expect(extractUpiReferences("UPI/CR/512345678901/SALARY CREDIT/XYZ")).toEqual(["512345678901"]);
    expect(extractUpiReferences("UPI/DR/512345678901/SELF TRANSFER")).toEqual(["512345678901"]);
  });

  it("adds it as an extra key without discarding the reference column", () => {
    // The reference column holds Slice's internal booking number, which the
    // customer has never seen. Keeping only that value parses the file perfectly
    // and credits nobody, because no claim is filed under it.
    const csv = [
      "DATE,DETAILS,REF NO.,TRANSACTION TYPE,DEBIT,CREDIT,BALANCE",
      "01 Oct '26,UPI-Credit-130500139151-KATHIRVEL S-HDFC0001284-kathir3459-5@okhdfcbank,2026100148790401,CREDIT,,2880,2882.79",
    ].join("\n");
    const row = parseBankStatement(csv).rows[0];
    expect(row.referenceNorm).toBe("2026100148790401");
    expect(row.altReferences).toEqual(["130500139151"]);
  });

  it("does not invent a reference from prose that lacks a CR/DR marker", () => {
    // "UPI transfer to 9876543210" contains digits but is not a transaction id.
    // Allowing it through would put a phone number into the candidate set.
    expect(extractUpiReferences("UPI transfer to 9876543210")).toEqual([]);
    expect(extractUpiReferences("NEFT IMFS12345678 to branch")).toEqual([]);
    expect(extractUpiReferences("")).toEqual([]);
    expect(extractUpiReferences(null)).toEqual([]);
  });

  it("finds every UPI line in a file, not just the first", () => {
    // The pattern is global; a shared lastIndex would make the second row resume
    // the first row's scan and silently miss its id.
    const ids = ["111111111111", "222222222222", "333333333333"].map((id) =>
      extractUpiReferences(`UPI-Credit-${id}-SOMEONE`)
    );
    expect(ids).toEqual([["111111111111"], ["222222222222"], ["333333333333"]]);
  });

  it("promotes the narration id when the reference column is empty", () => {
    const csv = [
      "DATE,DETAILS,REF NO.,DEBIT,CREDIT",
      "01 Oct '26,UPI-Credit-130500139151-SOMEONE,,,2880",
    ].join("\n");
    const row = parseBankStatement(csv).rows[0];
    expect(row.matchStatus).not.toBe("NO_REFERENCE");
    expect(row.referenceNorm).toBe("130500139151");
  });

  it("drops wrapped fragments that carry neither a reference nor an amount", () => {
    // A PDF whose narration wraps leaves continuation lines that hold neither.
    // They can never match a claim, and reporting each as NO_REFERENCE buried the
    // two real payments under noise no admin could act on.
    const csv = [
      "DATE,DETAILS,REF NO.,AMOUNT",
      "01 Oct '26,UPI-Credit-130500139151-SANTHOSH KUMAR U-UTIB0003492,2026100148790401,\"₹2,880\"",
      "001284-kathir3459-5@okhdfcbank,,,",
      "01 Oct '26,UPI-Debit-627377943583-SELF,2026100152042401,\"₹2,882\"",
    ].join("\n");
    const rows = parseBankStatement(csv).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.matchStatus !== "NO_REFERENCE")).toBe(true);
  });
});
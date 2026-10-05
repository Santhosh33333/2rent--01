import { describe, it, expect } from "vitest";
import { matchRowAgainst } from "../services/bankReconciliation";
import { sniffFormat, gridToCsv } from "../services/bankStatementIngest";
import { parseBankStatement } from "../services/bankStatementParser";

/**
 * These tests exist because the failure is silent and expensive.
 *
 * A matcher that is too generous does not throw - it credits a wallet. The
 * wrong person gets money, the ledger row looks legitimate, and the only trace
 * is that one statement reported more matches than expected. Every rule below
 * is therefore a refusal, and the refusals are what is being pinned down.
 */

interface ClaimLike {
  kind: "TOPUP" | "UPI_PAYMENT";
  id: string;
  userId: string;
  amount: number;
  status: string;
  referenceNorm: string;
  referenceRaw: string;
}

function claim(over: Partial<ClaimLike> = {}): ClaimLike {
  return {
    kind: "TOPUP",
    id: "claim-1",
    userId: "user-1",
    amount: 500,
    status: "VERIFICATION_PENDING",
    referenceNorm: "UTR12345",
    referenceRaw: "UTR12345",
    ...over,
  };
}

function index(...claims: ClaimLike[]): Map<string, ClaimLike[]> {
  const m = new Map<string, ClaimLike[]>();
  for (const c of claims) {
    const list = m.get(c.referenceNorm) ?? [];
    list.push(c);
    m.set(c.referenceNorm, list);
  }
  return m;
}

const goodRow = { referenceNorm: "UTR12345", amount: 500, inbound: true, matchStatus: "PENDING" };
const clean = { duplicate: false, truncated: false };

describe("matchRowAgainst - what it credits", () => {
  it("matches a pending top-up on reference and exact amount", () => {
    const out = matchRowAgainst(goodRow, index(claim()), clean);
    expect(out.status).toBe("MATCHED");
    expect(out.claim?.id).toBe("claim-1");
  });

  it("matches a pending booking payment the same way", () => {
    const out = matchRowAgainst(goodRow, index(claim({ kind: "UPI_PAYMENT" })), clean);
    expect(out.status).toBe("MATCHED");
    expect(out.claim?.kind).toBe("UPI_PAYMENT");
  });

  it("matches on the normalised reference, so bank spacing does not matter", () => {
    // The user typed "UTR12345"; the bank printed "UTR 12345". Both normalise
    // to the same key, so this is the same payment.
    const out = matchRowAgainst(goodRow, index(claim({ referenceNorm: "UTR12345", referenceRaw: "UTR 12345" })), clean);
    expect(out.status).toBe("MATCHED");
  });
});

describe("matchRowAgainst - what it refuses", () => {
  it("refuses when no claim cites the reference", () => {
    const out = matchRowAgainst(goodRow, index(claim({ referenceNorm: "OTHER" })), clean);
    expect(out.status).toBe("UNMATCHED");
    expect(out.claim).toBeUndefined();
  });

  it("refuses a claim for a different amount, even by one rupee", () => {
    const out = matchRowAgainst({ ...goodRow, amount: 499.5 }, index(claim()), clean);
    expect(out.status).toBe("AMOUNT_MISMATCH");
    expect(out.claimedAmount).toBe(500);
  });

  it("refuses when the reference is claimed by both a top-up and a booking", () => {
    // One UTR is one payment. Two claims citing it means our database is wrong,
    // and guessing which would credit the wrong person's wallet.
    const out = matchRowAgainst(
      goodRow,
      index(claim(), claim({ kind: "UPI_PAYMENT", id: "claim-2" })),
      clean,
    );
    expect(out.status).toBe("UNMATCHED");
    expect(out.reason).toMatch(/top-up and a booking/i);
    expect(out.claim).toBeUndefined();
  });

  it("refuses a reference that appears twice in the same file", () => {
    const out = matchRowAgainst(goodRow, index(claim()), { ...clean, duplicate: true });
    expect(out.status).toBe("DUPLICATE_IN_FILE");
    expect(out.claim).toBeUndefined();
  });

  it("never credits an outbound line, even one that matches a claim exactly", () => {
    // A payout the business made can carry any reference it likes. Crediting it
    // mints money out of the bank's own expense list.
    const out = matchRowAgainst({ ...goodRow, inbound: false }, index(claim()), clean);
    expect(out.status).toBe("OUTBOUND");
    expect(out.claim).toBeUndefined();
  });

  it("does not offer an already-verified claim as a fresh credit", () => {
    const out = matchRowAgainst(goodRow, index(claim({ status: "VERIFIED" })), clean);
    expect(out.status).toBe("ALREADY_SETTLED");
  });

  it("passes through unreadable and empty lines rather than calling them unmatched", () => {
    // Calling these "no matching top-up" would send an admin hunting for a claim
    // that cannot exist.
    expect(matchRowAgainst({ ...goodRow, matchStatus: "NO_REFERENCE" }, index(claim()), clean).status).toBe(
      "NO_REFERENCE",
    );
    expect(
      matchRowAgainst({ ...goodRow, amount: null, matchStatus: "UNPARSEABLE_AMOUNT" }, index(claim()), clean).status,
    ).toBe("UNPARSEABLE_AMOUNT");
    expect(matchRowAgainst({ ...goodRow, amount: 0 }, index(claim()), clean).status).toBe("ZERO_AMOUNT");
  });

  it("cannot match a reference it was never given", () => {
    const out = matchRowAgainst({ ...goodRow, referenceNorm: "" }, index(claim()), clean);
    expect(out.status).toBe("UNMATCHED");
  });
});

describe("matchRowAgainst - truncated search", () => {
  it("says so when the claim window was cut short, so UNMATCHED is not a lie", () => {
    const out = matchRowAgainst(goodRow, index(), { duplicate: false, truncated: true });
    expect(out.status).toBe("UNMATCHED");
    expect(out.reason).toMatch(/truncated/i);
  });

  it("still credits what it did find when the window was truncated", () => {
    // A cap must degrade the guarantee, not the useful work.
    const out = matchRowAgainst(goodRow, index(claim()), { duplicate: false, truncated: true });
    expect(out.status).toBe("MATCHED");
  });
});

describe("matchRowAgainst - reconstructed PDFs", () => {
  it("never auto-credits a line from a PDF whose columns were inferred", () => {
    const out = matchRowAgainst(goodRow, index(claim()), { ...clean, reconstructed: true });
    expect(out.status).toBe("UNMATCHED");
    expect(out.claim).toBeDefined(); // surfaced, so a human can credit it by hand
    expect(out.reason).toMatch(/PDF/i);
  });

  it("blocks the PDF case even when the reference and amount agree perfectly", () => {
    // This is the exact shape of the dangerous case: nothing looks wrong, which
    // is precisely why it has to be blocked structurally.
    expect(matchRowAgainst(goodRow, index(claim()), { ...clean, reconstructed: true }).status).not.toBe("MATCHED");
  });
});

describe("sniffFormat", () => {
  it("decides from magic bytes, not the filename", () => {
    expect(sniffFormat(Buffer.from("Date,UTR,Credit\r\n01/10/2024,U1,500\r\n"))).toBe("CSV");
    // A ZIP container: xlsx and xls are both zip-based, but xlsx has these entries.
    expect(sniffFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))).not.toBe("PDF");
    expect(sniffFormat(Buffer.from("%PDF-1.7\n1 0 obj"))).toBe("PDF");
  });

  it("does not trust a .pdf name on CSV content", () => {
    // The rename attack: sniffFormat is the only thing standing between a text
    // file and a code path that guesses column positions.
    expect(sniffFormat(Buffer.from("a,b,c\n1,2,3\n"))).toBe("CSV");
  });
});

describe("gridToCsv - the XLSX path feeds the existing parser", () => {
  it("quotes cells containing the delimiter so a comma in a narration stays one cell", () => {
    const csv = gridToCsv([["UTR", "Narration"], ["U1", "IMPS, paid"]]);
    expect(csv).toContain('"IMPS, paid"');
  });

  it("quotes and escapes embedded quotes", () => {
    const csv = gridToCsv([["UTR", "Note"], ["U1", 'said "ok"']]);
    // If this round-tripped wrongly the row would split into extra cells and the
    // reference column would be read from the wrong place.
    expect(csv).toContain('"said ""ok"""');
  });

  it("survives a full round trip through the parser with columns still aligned", () => {
    const csv = gridToCsv([
      ["Date", "UTR", "Credit", "Narration"],
      ["01/10/2024", "UTR90001", "750.50", "IMPS, salary credit"],
      ["02/10/2024", "UTR90002", "250", "IMPS, refund"],
    ]);
    const result = parseBankStatement(csv);
    expect(result.columnMap.reference).toBeDefined();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.referenceNorm).toBe("UTR90001");
    expect(result.rows[0]!.amount).toBe(750.5);
    expect(result.rows[1]!.referenceNorm).toBe("UTR90002");
    expect(result.rows[1]!.amount).toBe(250);
  });
});

describe("the whole path, end to end through the parser", () => {
  const csv = [
    "Date,Description,UTR,Debit,Credit,Balance",
    "01/10/2024,IMPS credit,UTR12345,,500.00,1500.00",
    "02/10/2024,UPI to vendor,UTR99999,250.00,,1250.00",
    "03/10/2024,IMPS credit,UTR77777,,500.00,1750.00",
    "04/10/2024,NEFT in,UTR55555,,500.00,2250.00",
    "05/10/2024,IMPS credit,UTR44444,,oops,2250.00",
  ].join("\n");

  it("separates the one creditable line from every line it must not credit", () => {
    const result = parseBankStatement(csv);
    const byRef = index(claim()); // 500 pending, claims UTR12345
    let credited = 0;

    for (const row of result.rows) {
      const out = matchRowAgainst(row, byRef, {
        duplicate: false,
        truncated: false,
        reconstructed: false,
      });
      if (out.status === "MATCHED") credited += 1;
      // Every refusal carries a reason. An unexplained row is unfixable.
      expect(out.reason.length).toBeGreaterThan(10);
    }

    expect(credited).toBe(1);
  });

  it("never credits the outbound line or the duplicated-amount line", () => {
    const result = parseBankStatement(csv);
    const byRef = index(
      claim({ referenceNorm: "UTR99999", referenceRaw: "UTR99999" }),
      claim({ referenceNorm: "UTR44444", referenceRaw: "UTR44444" }),
    );
    const statuses = result.rows.map(
      (r) => matchRowAgainst(r, byRef, { duplicate: false, truncated: false }).status,
    );
    // UTR99999 is a payout of 250 that a pending claim also names: outbound wins.
    expect(statuses).toContain("OUTBOUND");
    // UTR44444 is a credit of 500 whose amount cell is unreadable.
    expect(statuses).toContain("UNPARSEABLE_AMOUNT");
  });

  it("does not credit the same line twice when the file repeats its reference", () => {
    const dupCsv = [
      "Date,UTR,Credit",
      "01/10/2024,UTR12345,500",
      "01/10/2024,UTR12345,500",
    ].join("\n");
    const result = parseBankStatement(dupCsv);
    const seen = new Map<string, number>();
    for (const r of result.rows) seen.set(r.referenceNorm, (seen.get(r.referenceNorm) ?? 0) + 1);
    const statuses = result.rows.map((r) =>
      matchRowAgainst(r, index(claim()), {
        duplicate: (seen.get(r.referenceNorm) ?? 0) > 1,
        truncated: false,
      }).status,
    );
    expect(statuses.every((s) => s !== "MATCHED")).toBe(true);
  });
});
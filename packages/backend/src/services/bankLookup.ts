// Payout-destination lookups: IFSC -> bank name, UPI ID -> account holder name.
// Purely offline/deterministic (no third-party call required) so the withdrawal
// form can auto-fill instantly; Razorpay VPA validation is used as a bonus when
// real credentials are configured.
import { env } from "../config/env";

// IFSC = 4-char bank code + '0' + branch code. The first four characters are
// assigned by the RBI to the bank, so a prefix table resolves the bank name.
const IFSC_BANK_PREFIXES: Record<string, string> = {
  SBIN: "State Bank of India",
  SBIN0: "State Bank of India",
  HDFC: "HDFC Bank",
  HDFC0: "HDFC Bank",
  ICIC: "ICICI Bank",
  ICIC0: "ICICI Bank",
  UTIB: "Axis Bank",
  UTIB0: "Axis Bank",
  PUNB: "Punjab National Bank",
  PUNB0: "Punjab National Bank",
  BARB: "Bank of Baroda",
  BARB0: "Bank of Baroda",
  CNRB: "Canara Bank",
  CNRB0: "Canara Bank",
  PNB: "Punjab National Bank",
  PNB0: "Punjab National Bank",
  SBINB: "State Bank of India",
  UBIN: "Union Bank of India",
  UBIN0: "Union Bank of India",
  IDIB: "Indian Bank",
  IDIB0: "Indian Bank",
  KKBK: "Kotak Mahindra Bank",
  KKBK0: "Kotak Mahindra Bank",
  YESB: "Yes Bank",
  YESB0: "Yes Bank",
  INDB: "IndusInd Bank",
  INDB0: "IndusInd Bank",
  HDFCB: "HDFC Bank",
  IDFC: "IDFC FIRST Bank",
  IDFC0: "IDFC FIRST Bank",
  TMB: "Tamilnad Mercantile Bank",
  TMB0: "Tamilnad Mercantile Bank",
  SBINB0: "State Bank of India",
  CITI: "Citibank",
  HSBC: "HSBC",
  HSBC0: "HSBC",
  SCBL: "Standard Chartered",
  SCBL0: "Standard Chartered",
  PAGO: "Paytm Payments Bank",
  PAGO0: "Paytm Payments Bank",
  AIRT: "Airtel Payments Bank",
  AIRT0: "Airtel Payments Bank",
  FINC: "Fino Payments Bank",
  FINC0: "Fino Payments Bank",
  JIOB: "Jio Financial Services",
  JIOB0: "Jio Financial Services",
  PSIB: "Prathama UP Gramin Bank",
  RRB0: "Regional Rural Bank",
  DEUT0: "Deutsche Bank",
  BOFA0: "Bank of America",
  UTIB1: "Axis Bank",
  ORBC: "Bank of Baroda",
  RATN: "RBL Bank",
  RATN0: "RBL Bank",
  DLUB: "Dublin",
  ESAB: "ESAF Small Finance Bank",
  ESAB0: "ESAF Small Finance Bank",
  UTGA: "Utkarsh Small Finance Bank",
  KJES: "Karnataka Bank",
  KKBK1: "Kotak Mahindra Bank",
  APMC: "APMC Bank",
  CLGB: "Clerx Bank",
  KACE: "Karnataka Central Co-operative Bank",
  WRBK: "Writers Bank",
};

// UPI handles map to the PSP/bank that operates them. Used both to label the
// bank and to tell the user which app to approve the request in.
const UPI_SUFFIX_BANK: Record<string, string> = {
  okhdfcbank: "HDFC Bank",
  hdfcbank: "HDFC Bank",
  hdfc: "HDFC Bank",
  oksbi: "State Bank of India",
  sbi: "State Bank of India",
  sbinet: "State Bank of India",
  okicici: "ICICI Bank",
  icici: "ICICI Bank",
  okaxis: "Axis Bank",
  axisbank: "Axis Bank",
  axis: "Axis Bank",
  okkotak: "Kotak Mahindra Bank",
  kotak: "Kotak Mahindra Bank",
  okyes: "Yes Bank",
  yesbank: "Yes Bank",
  okindus: "IndusInd Bank",
  indusind: "IndusInd Bank",
  okidfc: "IDFC FIRST Bank",
  idfcfirst: "IDFC FIRST Bank",
  okicic: "ICICI Bank",
  okcnrb: "Canara Bank",
  cnrb: "Canara Bank",
  okpnb: "Punjab National Bank",
  pnb: "Punjab National Bank",
  okbaroda: "Bank of Baroda",
  okubo: "Union Bank of India",
  union: "Union Bank of India",
  okynab: "Yes Bank",
  ybl: "PhonePe",
  paytm: "Paytm",
  paytmmp: "Paytm Payments Bank",
  okaxisbank: "Axis Bank",
  oksbiin: "State Bank of India",
  okicici2: "ICICI Bank",
  airetel: "Airtel Payments Bank",
  amazonpay: "Amazon Pay",
  apay: "Amazon Pay",
  cred: "CRED",
  freecharge: "Freecharge",
  okwalnut: "Walnut",
  rupay: "RuPay",
  upto: "Google Pay (UPI)",
};

function titleCase(token: string): string {
  return token
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/[0-9]+/g, "").toLowerCase())
    .join(" ");
}

export function isValidIfsc(ifsc: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase());
}

/** Bank name for an IFSC code, or null when the prefix is unknown. */
export function bankNameFromIfsc(ifsc: string): string | null {
  const code = ifsc.trim().toUpperCase();
  if (!isValidIfsc(code)) return null;
  if (IFSC_BANK_PREFIXES[code.slice(0, 4)]) return IFSC_BANK_PREFIXES[code.slice(0, 4)];
  if (IFSC_BANK_PREFIXES[code.slice(0, 5)]) return IFSC_BANK_PREFIXES[code.slice(0, 5)];
  return null;
}

export interface UpiLookup {
  valid: boolean;
  handle: string;
  bank: string | null;
  /** Best-effort name derived from the handle (john.doe -> "John Doe"). */
  suggestedName: string | null;
  /** True when the name came from a gateway VPA check rather than the handle. */
  verified: boolean;
  reason?: string;
}

export function parseUpiId(upiId: string): { handle: string; bank: string | null; suggestedName: string | null } {
  const raw = upiId.trim().toLowerCase();
  const [handle, suffix] = raw.split("@");
  if (!handle || !suffix || !/^[\w.\-]+$/.test(handle) || !/^[a-z0-9]{2,}$/.test(suffix)) {
    return { handle: "", bank: null, suggestedName: null };
  }
  const bank = UPI_SUFFIX_BANK[suffix] || null;
  // Strip common numeric noise (e.g. "rahul12345" -> "Rahul").
  const nameToken = handle.split(/[._\-\s]+/).filter((t) => t.length > 0 && !/^\d+$/.test(t))[0] || null;
  return { handle, bank, suggestedName: nameToken ? titleCase(nameToken) : null };
}

// Optional: Razorpay can validate the VPA and return the true payee name at the
// bank. Silently skipped when credentials are placeholders or the call fails.
async function verifiedVpaName(upiId: string): Promise<string | null> {
  const keyId = env.RAZORPAY_KEY_ID || "";
  const keySecret = env.RAZORPAY_KEY_SECRET || "";
  if (!keyId || !keySecret || keyId.includes("placeholder") || keySecret.includes("placeholder")) return null;
  try {
    // Imported lazily so the module loads even when Razorpay isn't installed.
    const { default: Razorpay } = (await import("razorpay")) as unknown as {
      default: new (opts: { key_id: string; key_secret: string }) => any;
    };
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const res = await rzp.customers.validateVpa(upiId.trim().toLowerCase());
    const name = res?.customer?.vpa?.name || res?.name || null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

export async function lookupUpi(upiId: string): Promise<UpiLookup> {
  const parsed = parseUpiId(upiId);
  if (!parsed.handle) {
    return { valid: false, handle: "", bank: null, suggestedName: null, verified: false, reason: "INVALID_FORMAT" };
  }
  const verified = await verifiedVpaName(upiId);
  return {
    valid: true,
    handle: parsed.handle,
    bank: parsed.bank,
    suggestedName: verified || parsed.suggestedName,
    verified: !!verified,
  };
}

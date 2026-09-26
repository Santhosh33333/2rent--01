/**
 * Dynamic UPI QR payloads.
 *
 * The payee VPA is fixed (it is a bank account), so what actually rotates is
 * the QR itself: every hour a new transaction reference (`tr`) is generated, so
 * a screenshot of an old QR can never be matched to a later payment. That is
 * the same reconciliation trick dynamic-QR PSPs use, without needing a gateway.
 *
 * The reference embeds the hour bucket, e.g. NB1A2B3C4260912PM, and is rebuilt
 * automatically once the current hour rolls over.
 */

/** Indian mobile number in the forms customers actually type. */
const PHONE_DIGITS = /^(?:0|91)?([6-9]\d{9})$/;

/** VPA shape: local part @ bank/app handle. */
const VPA_SHAPE = /^[\w.\-]{2,64}@[a-zA-Z][a-zA-Z0-9.\-]{1,49}$/;

/** UPI caps the transaction reference at 40 characters in practice. */
const MAX_REFERENCE_LENGTH = 40;

/** Exposed for tests and for clamping elsewhere. */
export const safeReferenceLength = MAX_REFERENCE_LENGTH;

export type HourBucket = string;

export interface UpiQrPayload {
  /** Full intent URI - this is what the QR encodes. */
  upiUri: string;
  /** Transaction reference for this hour, also shown to the customer. */
  reference: string;
  /** Which hour this QR belongs to, e.g. 2026092614. */
  bucket: HourBucket;
  /** When this QR stops matching, i.e. the next hour boundary (UTC-aligned). */
  expiresAt: string;
  expiresInSeconds: number;
  /** True once the current hour has elapsed and a new QR is required. */
  expired: boolean;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/** The hour bucket a timestamp belongs to, in UTC. */
export function hourBucket(at: Date = new Date()): HourBucket {
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `${pad(at.getUTCHours())}`
  );
}

/** The next UTC hour boundary, i.e. when the current QR expires. */
export function nextHourBoundary(at: Date = new Date()): Date {
  const next = new Date(at.getTime());
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * Per-hour transaction reference.
 *
 * Short, deterministic and unique per booking per hour, so the admin can match
 * a bank statement line to a booking without ambiguity.
 */
export function buildReference(scope: string, at: Date = new Date()): string {
  const cleaned = scope.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "NABRI";
  return `N${cleaned}${hourBucket(at)}`.slice(0, MAX_REFERENCE_LENGTH);
}

/** Strip a VPA down to the bare handle, rejecting anything malformed. */
export function isVpa(value: unknown): boolean {
  return typeof value === "string" && VPA_SHAPE.test(value.trim());
}

/** True when the input is a usable Indian mobile number; returns the 10 digits. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).replace(/[\s\-()+]/g, "");
  const match = PHONE_DIGITS.exec(raw);
  return match ? match[1] : null;
}

/**
 * Classify what the customer typed.
 *
 * A phone number cannot be turned into a VPA or resolved to a name: no public
 * UPI service maps a mobile number to an account holder, so the caller has to
 * be told that a UPI ID is required instead.
 */
export function classifyUpiInput(
  value: unknown
): { kind: "VPA"; value: string } | { kind: "PHONE"; value: string } | { kind: "INVALID"; value: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { kind: "INVALID", value: raw };
  if (isVpa(raw)) return { kind: "VPA", value: raw.toLowerCase() };
  const phone = normalizePhone(raw);
  if (phone) return { kind: "PHONE", value: phone };
  return { kind: "INVALID", value: raw };
}

/** UPI intent URI. `tr` is what makes each hour's QR unique. */
export function buildUpiUri(options: {
  payeeVpa: string;
  payeeName?: string | null;
  amount?: number | null;
  note?: string | null;
  reference: string;
}): string {
  const params = new URLSearchParams();
  params.set("pa", options.payeeVpa.trim());
  if (options.payeeName) params.set("pn", options.payeeName.trim().slice(0, 50));
  if (typeof options.amount === "number" && Number.isFinite(options.amount) && options.amount > 0) {
    params.set("am", options.amount.toFixed(2));
  }
  params.set("cu", "INR");
  if (options.note) params.set("tn", options.note.trim().slice(0, 50));
  params.set("tr", options.reference);
  // URLSearchParams encodes spaces as "+", which some UPI apps mis-parse.
  return `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
}

export interface BuildQrOptions {
  payeeVpa: string;
  payeeName?: string | null;
  amount?: number | null;
  note?: string | null;
  /** Booking id, wallet scope, etc. - identifies whose QR this is. */
  scope: string;
  at?: Date;
}

/** Build the QR payload that is valid for the current hour. */
export function buildHourlyQr(options: BuildQrOptions): UpiQrPayload {
  const at = options.at ?? new Date();
  const reference = buildReference(options.scope, at);
  const boundary = nextHourBoundary(at);
  return {
    upiUri: buildUpiUri({
      payeeVpa: options.payeeVpa,
      payeeName: options.payeeName,
      amount: options.amount,
      note: options.note,
      reference,
    }),
    reference,
    bucket: hourBucket(at),
    expiresAt: boundary.toISOString(),
    expiresInSeconds: Math.max(0, Math.floor((boundary.getTime() - at.getTime()) / 1000)),
    expired: false,
  };
}

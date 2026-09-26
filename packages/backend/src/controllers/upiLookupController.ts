import { Response } from "express"
import { prisma } from "../config/database"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import { lookupUpi } from "../services/bankLookup"
import { classifyUpiInput } from "../services/upiQr"

const LOOKUP_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

type NameSource = "gateway" | "handle" | "configured" | "none";

interface CachedLookup {
  expiresAt: number;
  value: {
    name: string | null;
    nameSource: NameSource;
    verified: boolean;
    exists: boolean | null;
    bank: string | null;
  };
}

/**
 * Short-lived cache.
 *
 * Confirming a VPA costs a gateway call, and customers retype the same UPI ID
 * repeatedly while filling the form, so identical lookups inside a minute are
 * answered from memory.
 */
const lookupCache = new Map<string, CachedLookup>();

function cacheGet(key: string): CachedLookup["value"] | null {
  const hit = lookupCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    lookupCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key: string, value: CachedLookup["value"]): void {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest entry rather than growing without bound.
    const oldest = lookupCache.keys().next();
    if (!oldest.done) lookupCache.delete(oldest.value);
  }
  lookupCache.set(key, { value, expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS });
}

/**
 * Resolve a UPI ID (or a phone number) to an account holder name.
 *
 * What can be resolved depends entirely on the provider:
 * - With live gateway credentials the VPA is checked at the bank, so the name is
 *   authoritative and we can also say whether the VPA exists at all.
 * - Without them only the handle is parsed, so the name is a guess and
 *   existence is reported as unknown rather than guessed either way.
 *
 * A phone number can never be resolved: no UPI service maps a mobile number to
 * an account holder, so the customer is asked for the UPI ID instead.
 */
export async function lookupUpiPayee(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const raw = String(req.body?.query ?? req.query?.query ?? "").trim();
    if (!raw) {
      sendError(res, "Enter a UPI ID or a 10-digit phone number.", 400, "VALIDATION_ERROR");
      return;
    }

    const classified = classifyUpiInput(raw);

    if (classified.kind === "INVALID") {
      sendError(
        res,
        "That does not look like a UPI ID or phone number. UPI IDs look like name@bank.",
        400,
        "INVALID_UPI_INPUT"
      );
      return;
    }

    if (classified.kind === "PHONE") {
      sendSuccess(
        res,
        {
          input: raw,
          kind: "PHONE",
          valid: true,
          phone: classified.value,
          upiId: null,
          name: null,
          nameSource: "none" as NameSource,
          verified: false,
          exists: null,
          bank: null,
          message:
            "A phone number cannot be matched to a UPI account. Ask for the UPI ID (name@bank) or scan their QR code.",
        },
        "Phone number recognised, but a UPI ID is required to confirm the payee."
      );
      return;
    }

    const vpa = classified.value;
    const cached = cacheGet(vpa);
    if (cached) {
      sendSuccess(
        res,
        { input: raw, kind: "VPA", valid: true, upiId: vpa, ...cached, cached: true },
        cached.name ? `Payee name: ${cached.name}` : "UPI ID format accepted."
      );
      return;
    }

    // The platform's own VPA is known-good without asking any gateway.
    const configured = await prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } });
    if (configured?.value && configured.value.trim().toLowerCase() === vpa) {
      const accountName = await prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } });
      const value = {
        name: accountName?.value ?? configured.value.split("@")[0],
        nameSource: "configured" as NameSource,
        verified: true,
        exists: true,
        bank: vpa.split("@")[1] ?? null,
      };
      cacheSet(vpa, value);
      sendSuccess(
        res,
        { input: raw, kind: "VPA", valid: true, upiId: vpa, ...value, cached: false },
        `This is the official Nabri UPI ID (${value.name}).`
      );
      return;
    }

    const result = await lookupUpi(vpa);
    const value = {
      name: result.suggestedName,
      nameSource: (result.verified ? "gateway" : result.suggestedName ? "handle" : "none") as NameSource,
      // Only a gateway check can prove a VPA exists; a parsed handle cannot.
      verified: result.verified,
      exists: result.verified ? true : null,
      bank: result.bank,
    };
    cacheSet(vpa, value);

    const message = result.verified
      ? `Verified at the bank: ${value.name}.`
      : value.name
        ? `Format looks valid. Name guessed as "${value.name}" - not confirmed with the bank.`
        : "Format looks valid, but the account holder name could not be determined.";

    sendSuccess(
      res,
      { input: raw, kind: "VPA", valid: true, upiId: vpa, ...value, cached: false },
      message
    );
  } catch (err) {
    console.error("lookupUpiPayee error:", err);
    sendError(res, "Failed to look up that UPI ID.", 500, "INTERNAL_ERROR");
  }
}

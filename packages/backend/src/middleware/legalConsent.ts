// ============================================================================
// Consent gates.
//
// requireLegalConsent("BOOKING") blocks the request server-side until the
// caller has accepted the current version of every document that gate requires.
//
// The client shows a checkbox, but that is a convenience, not the control. The
// decision is made here from the database so a client that skips the checkbox,
// replays an old bundle or is modified cannot get past it.
// ============================================================================
import { Response, NextFunction } from "express";
import { AuthedRequest } from "./authTypes";
import { getConsentStatus, ConsentGate } from "../services/legalConsentService";
import { getReConsentState } from "../services/legalReConsentService";

export class LegalConsentError extends Error {
  readonly status = 403;
  readonly code = "LEGAL_CONSENT_REQUIRED";
  readonly gate: string;
  readonly missing: string[];
  readonly required: unknown;

  constructor(gate: string, missing: string[], required: unknown) {
    super("You must accept the current terms before continuing.");
    this.name = "LegalConsentError";
    this.gate = gate;
    this.missing = missing;
    this.required = required;
  }
}

export function requireLegalConsent(gate: ConsentGate) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user!.userId;
    const status = await getConsentStatus(userId, gate);
    if (status.satisfied) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: {
        code: "LEGAL_CONSENT_REQUIRED",
        message: "You must accept the current terms before continuing.",
        gate,
        missing: status.missing,
        required: status.required,
      },
    });
  };
}

/**
 * Gate the SIGNUP documents with a grace period, for accounts that predate
 * consent enforcement.
 *
 * The difference from requireLegalConsent is the clock. A brand-new account
 * never had terms to accept, so there is nothing to forgive. An account created
 * under the old product is given a window first: it is told, the window starts
 * running, and only a lapsed window turns the owed signature into a refusal.
 * That distinction is the whole point - refusing someone for a deadline they
 * were never shown is indefensible.
 */
export function requireReConsent() {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const state = await getReConsentState(req.user!.userId);
    if (!state.required || !state.blocking) {
      next();
      return;
    }
    res.status(403).json({
      success: false,
      error: {
        code: "LEGAL_RECONSENT_REQUIRED",
        message: "Please review and accept the current terms to continue using this feature.",
        missing: state.missing,
        notifiedAt: state.notifiedAt,
        graceEndsAt: state.graceEndsAt,
      },
    });
  };
}

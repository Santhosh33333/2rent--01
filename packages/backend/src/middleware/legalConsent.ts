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

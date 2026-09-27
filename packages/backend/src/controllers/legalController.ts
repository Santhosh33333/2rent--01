import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { getCurrentDocuments, getConsentStatus, recordConsent, ConsentGate } from "../services/legalConsentService";
import { CONSENT_REQUIREMENTS } from "../legal/documents";

const VALID_GATES: ConsentGate[] = ["SIGNUP", "PARTNER_ONBOARDING", "BOOKING", "RE_CONSENT"];

/** Public document text so the acceptance screen can render real content. */
export async function listLegalDocuments(req: AuthedRequest, res: Response): Promise<void> {
  const docs = await getCurrentDocuments();
  sendSuccess(res, { documents: docs, requirements: CONSENT_REQUIREMENTS });
}

/** Full text for one document, for the pre-signature review step. */
export async function getLegalDocument(req: AuthedRequest, res: Response): Promise<void> {
  const doc = await prisma.legalDocument.findFirst({
    where: { kind: req.params.kind, isCurrent: true },
    select: { id: true, kind: true, version: true, title: true, summary: true, contentHtml: true, effectiveFrom: true },
  });
  if (!doc) {
    sendError(res, "Document not found.", 404, "NOT_FOUND");
    return;
  }
  sendSuccess(res, { document: doc });
}

/** What this user still needs to accept, per gate. */
export async function getMyConsentStatus(req: AuthedRequest, res: Response): Promise<void> {
  const gate = (req.query.gate as string) || "SIGNUP";
  if (!VALID_GATES.includes(gate as ConsentGate)) {
    sendError(res, "Invalid gate.", 400, "VALIDATION_ERROR");
    return;
  }
  const status = await getConsentStatus(req.user!.userId, gate as ConsentGate);
  sendSuccess(res, status);
}

/**
 * Record a signature. The IP and user agent come from the request, never the
 * body, so they cannot be forged by the client.
 */
export async function acceptLegalDocument(req: AuthedRequest, res: Response): Promise<void> {
  const { kind, signatureType, signatureValue, consentType } = req.body || {};
  if (!kind || !CONSENT_REQUIREMENTS[consentType as string]) {
    sendError(res, "kind and a valid consentType are required.", 400, "VALIDATION_ERROR");
    return;
  }
  const type = signatureType === "DRAWN" ? "DRAWN" : "TYPED_NAME";
  const value = String(signatureValue || "").trim();
  if (type === "TYPED_NAME" && value.length < 2) {
    sendError(res, "Type your full name to sign.", 400, "VALIDATION_ERROR");
    return;
  }
  if (type === "DRAWN" && value.length < 20) {
    sendError(res, "A drawn signature is required.", 400, "VALIDATION_ERROR");
    return;
  }
  if (value.length > 200000) {
    sendError(res, "Signature payload too large.", 400, "VALIDATION_ERROR");
    return;
  }

  const result = await recordConsent({
    userId: req.user!.userId,
    kind: String(kind),
    signatureType: type,
    signatureValue: value,
    consentType: consentType as ConsentGate,
    ipAddress: req.ip || null,
    userAgent: req.get("user-agent") || null,
  });

  if (!result.ok) {
    sendError(res, "Document not found.", 404, "NOT_FOUND");
    return;
  }
  const status = await getConsentStatus(req.user!.userId, consentType as ConsentGate);
  sendSuccess(res, { acceptanceId: result.acceptanceId, ...status }, "Terms accepted.");
}

/** The person's own signed record — their evidence of what they agreed to. */
export async function getMyAcceptances(req: AuthedRequest, res: Response): Promise<void> {
  const rows = await prisma.legalAcceptance.findMany({
    where: { userId: req.user!.userId },
    orderBy: { acceptedAt: "desc" },
    select: {
      id: true,
      kind: true,
      version: true,
      title: true,
      consentType: true,
      signatureType: true,
      contentSha256: true,
      acceptedAt: true,
      withdrawnAt: true,
    },
  });
  sendSuccess(res, { acceptances: rows });
}

// ============================================================================
// Legal document publishing + consent capture.
//
// ensureLegalDocumentsSeeded()  — idempotent publish of version 1. Safe to call
//       on every boot: it only inserts when a kind has no current row, so it
//       never clobbers wording a lawyer has since revised in the database.
//
// getConsentStatus(userId, gate) — which required documents are still missing.
//       Drives both the API response and the requireLegalConsent middleware, so
//       the client can never disagree with the server about what is outstanding.
//
// recordConsent(...) — the binding write. Snapshots the document id, version,
//       title, a SHA-256 of the exact HTML, the signature, the IP, the user
//       agent and the timestamp, then mails the user a copy and BCCs admin.
// ============================================================================
import crypto from "crypto";
import { prisma } from "../config/database";
import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { sendEmail } from "./emailService";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";
import { buildAgreementPdf } from "./agreementPdf";
import { LEGAL_DOCUMENTS, CONSENT_REQUIREMENTS, LegalDocKind } from "../legal/documents";

export type ConsentGate = "SIGNUP" | "PARTNER_ONBOARDING" | "BOOKING" | "RE_CONSENT";

const GATE_TITLES: Record<string, string> = {
  SIGNUP: "Account creation",
  PARTNER_ONBOARDING: "Partner onboarding",
  BOOKING: "Booking",
  RE_CONSENT: "Updated terms",
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function adminConsentBcc(): string[] {
  const raw = (env.AGREEMENT_ARCHIVE_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const primary = env.ADMIN_EMAIL || "santhoshkrishna958@gmail.com";
  return Array.from(new Set([...raw, primary]));
}

/** Publish version 1 of any document that has no current row. */
export async function ensureLegalDocumentsSeeded(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const doc of LEGAL_DOCUMENTS) {
    const existing = await prisma.legalDocument.findFirst({
      where: { kind: doc.kind, isCurrent: true },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.legalDocument.create({
      data: {
        kind: doc.kind,
        version: 1,
        title: doc.title,
        summary: doc.summary,
        contentHtml: doc.contentHtml,
        plainText: doc.plainText,
        isCurrent: true,
      },
    });
    inserted += 1;
  }
  return { inserted };
}

export async function getCurrentDocuments(): Promise<
  Array<{ id: string; kind: string; version: number; title: string; summary: string | null; contentHtml: string }>
> {
  return prisma.legalDocument.findMany({
    where: { isCurrent: true },
    orderBy: { kind: "asc" },
    select: { id: true, kind: true, version: true, title: true, summary: true, contentHtml: true },
  });
}

export interface ConsentStatus {
  gate: string;
  satisfied: boolean;
  required: Array<{ kind: string; title: string; version: number; accepted: boolean; acceptedAt: string | null }>;
  missing: string[];
  reConsentRequired: string[];
}

/**
 * `missing` blocks the gate. `reConsentRequired` is reported separately: the
 * person did sign this kind, but an older version, so a material change needs a
 * fresh acceptance before it binds them.
 */
export async function getConsentStatus(userId: string, gate: ConsentGate): Promise<ConsentStatus> {
  const kinds = CONSENT_REQUIREMENTS[gate] || [];
  const docs = await prisma.legalDocument.findMany({
    where: { isCurrent: true, kind: { in: kinds } },
    select: { id: true, kind: true, version: true, title: true },
  });
  const acceptances = await prisma.legalAcceptance.findMany({
    where: { userId, kind: { in: kinds }, withdrawnAt: null },
    orderBy: { acceptedAt: "desc" },
    select: { kind: true, version: true, acceptedAt: true },
  });

  const acceptedMap = new Map<string, (typeof acceptances)[number]>();
  for (const a of acceptances) {
    if (!acceptedMap.has(a.kind)) acceptedMap.set(a.kind, a);
  }

  const required = kinds.map((kind) => {
    const doc = docs.find((d) => d.kind === kind);
    const acc = acceptedMap.get(kind);
    const accepted = Boolean(doc && acc && acc.version === doc.version);
    return {
      kind,
      title: doc?.title || kind,
      version: doc?.version || 0,
      accepted,
      acceptedAt: accepted && acc ? acc.acceptedAt.toISOString() : null,
    };
  });

  return {
    gate,
    satisfied: required.every((r) => r.accepted),
    required,
    missing: required.filter((r) => !r.accepted).map((r) => r.kind),
    reConsentRequired: required
      .filter((r) => !r.accepted && acceptances.some((a) => a.kind === r.kind))
      .map((r) => r.kind),
  };
}

export interface RecordConsentInput {
  userId: string;
  kind: string;
  signatureType: "TYPED_NAME" | "DRAWN";
  signatureValue: string;
  consentType: ConsentGate;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Client to run the reads/writes on. Defaults to the shared prisma instance.
   * Signup passes its transaction client so the acceptance and the account are
   * created atomically: an account must never exist without the terms it was
   * created under.
   */
  db?: Prisma.TransactionClient;
}

export interface RecordConsentResult {
  ok: boolean;
  error?: "DOCUMENT_NOT_FOUND" | "ALREADY_ACCEPTED";
  acceptanceId?: string;
}

/** Sealed, append-only acceptance of one document at its current version. */
export async function recordConsent(input: RecordConsentInput): Promise<RecordConsentResult> {
  const db = input.db ?? prisma;
  const doc = await db.legalDocument.findFirst({
    where: { kind: input.kind, isCurrent: true },
    select: { id: true, kind: true, version: true, title: true, contentHtml: true, plainText: true },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };

  const already = await db.legalAcceptance.findFirst({
    where: { userId: input.userId, documentId: doc.id, withdrawnAt: null },
    select: { id: true },
  });
  if (already) return { ok: true, acceptanceId: already.id };

  const acceptance = await db.legalAcceptance.create({
    data: {
      userId: input.userId,
      documentId: doc.id,
      kind: doc.kind,
      version: doc.version,
      title: doc.title,
      consentType: input.consentType,
      signatureType: input.signatureType,
      signatureValue: input.signatureValue,
      contentSha256: sha256(doc.contentHtml),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  await (input.db ?? prisma).auditLog
    .create({
      data: {
        actorId: input.userId,
        actorType: "USER",
        action: "LEGAL_CONSENT_ACCEPTED",
        entityType: "LegalAcceptance",
        entityId: acceptance.id,
        metadata: JSON.stringify({
          kind: doc.kind,
          version: doc.version,
          consentType: input.consentType,
          signatureType: input.signatureType,
          contentSha256: sha256(doc.contentHtml).slice(0, 16),
        }),
      },
    })
    .catch((err) => console.error("[LEGAL] audit log failed:", err));

  void sendConsentReceipt(acceptance.id, input.userId, doc.title, doc.version, GATE_TITLES[input.consentType] || input.consentType, doc.plainText).catch((err) =>
    console.error("[LEGAL] consent receipt email failed:", err)
  );

  return { ok: true, acceptanceId: acceptance.id };
}

/** Email the signed copy to the user and blind-copy the admin archive. */
async function sendConsentReceipt(
  acceptanceId: string,
  userId: string,
  title: string,
  version: number,
  gateTitle: string,
  plainText: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, fullName: true },
  });
  if (!user?.email) return;

  const pdf = await buildAgreementPdf(title, plainText);
  const when = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(user.fullName || "there")},</p>
<p style="margin:0 0 14px">Your acceptance of <strong>${escHtml(title)}</strong> (version ${version}) has been recorded.</p>
<p style="margin:0 0 14px">Accepted for: ${escHtml(gateTitle)}<br/>Recorded: ${escHtml(when)}<br/>Reference: <strong>${escHtml(acceptanceId.toUpperCase().slice(0, 12))}</strong></p>
<p style="margin:0 0 14px">A PDF of the exact document you signed is attached. Keep it for your records.</p>`;

  const result = await sendEmail(
    user.email,
    `Signed copy · ${title} (v${version})`,
    renderEmail({
      title: "Your signed copy",
      kicker: gateTitle,
      bodyHtml,
      ctaText: "View my agreements",
      ctaUrl: `${WEB_ORIGIN}/agreements`,
      note: "This email and the attached PDF are your record of the terms in force when you accepted them.",
    }),
    `Your acceptance of ${title} (version ${version}) has been recorded. Reference ${acceptanceId.toUpperCase().slice(0, 12)}.`,
    {
      bcc: adminConsentBcc(),
      attachments: [{ filename: `Nabri-${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-v${version}.pdf`, content: pdf }],
    }
  );
  if (!result.ok) {
    console.error("[LEGAL] consent receipt not delivered:", result.error);
  }
}

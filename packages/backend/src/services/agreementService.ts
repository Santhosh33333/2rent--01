// ============================================================================
// Post-KYC Agreement lifecycle.
//
//  createAndSendAgreements(userId)  — called right after a KYC approval.
//       1. Creates a USER agreement (and a PARTNER agreement when the member
//          has a partner profile) with the template HTML snapshotted verbatim.
//       2. Emails each agreement to the member with a branded HTML body, a PDF
//          attachment and an accept CTA pointing at the in-app page.
//       3. Blind-copies (BCC) every agreement to the archive list
//          (AGREEMENT_ARCHIVE_EMAILS, default = primary super admin) so the
//          owner always has a copy — "sent to super admin also".
//
//  acceptAgreement(userId, agreementId) — records the legally binding
//        acceptance (acceptedAt) and fires the confirmation email.
//
// Fire-and-forget by design: email hiccups must never fail the KYC approval.
// ============================================================================
import { prisma } from "../config/database";
import { env } from "../config/env";
import crypto from "crypto";
import { sendEmail } from "./emailService";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";
import { renderAgreementHtml, agreementPlainText, AgreementKind, buildAgreementTemplate } from "./agreementTemplates";
import { buildAgreementPdf } from "./agreementPdf";

export function agreementArchiveBcc(): string[] {
  const raw = (env.AGREEMENT_ARCHIVE_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const primary = env.ADMIN_EMAIL || "santhoshkrishna958@gmail.com";
  const list = raw.length ? raw : [primary];
  return Array.from(new Set([...list, primary]));
}

async function sendAgreementMail(
  user: { email: string; fullName: string },
  agreement: { id: string; kind: AgreementKind; title: string; contentHtml: string }
): Promise<boolean> {
  const kind: AgreementKind = agreement.kind === "PARTNER" ? "PARTNER" : "USER";
  const tpl = buildAgreementTemplate(kind);
  const acceptUrl = `${WEB_ORIGIN}/agreements/${agreement.id}`;
  const pdf = await buildAgreementPdf(agreement.title, agreementPlainText(kind, user.fullName || user.email, agreement.id));
  const result = await sendEmail(
    user.email,
    `Please review & accept · ${agreement.title}`,
    renderEmail({
      title: agreement.title,
      kicker: tpl.kicker,
      bodyHtml: agreement.contentHtml,
      ctaText: "Review & accept",
      ctaUrl: acceptUrl,
      note: "The PDF of this agreement is attached to this email. You must accept it in-app to fully activate your Nabri account.",
    }),
    agreementPlainText(kind, user.fullName || user.email, agreement.id),
    {
      bcc: agreementArchiveBcc(),
      attachments: [{ filename: `Nabri-Agreement-${agreement.id.slice(0, 8)}.pdf`, content: pdf }],
    }
  );
  return result.ok;
}

/**
 * Create + send agreements after a successful KYC approval. Never throws —
 * failures are logged and the admin request proceeds.
 */
export async function createAndSendAgreements(userId: string): Promise<{ created: number }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true },
    });
    if (!user?.email) return { created: 0 };

    const kinds: AgreementKind[] = ["USER"];
    const partner = await prisma.partner.findUnique({ where: { userId }, select: { id: true } }).catch(() => null);
    if (partner) kinds.push("PARTNER");

    let created = 0;
    for (const kind of kinds) {
      const tpl = buildAgreementTemplate(kind);
      const agreementId = crypto.randomUUID();
      const agreement = await prisma.agreement.create({
        data: {
          id: agreementId,
          userId,
          kind,
          title: tpl.title,
          contentHtml: renderAgreementHtml(kind, user.fullName || user.email, agreementId),
        },
      });
      created += 1;
      const ok = await sendAgreementMail(user, { id: agreement.id, kind, title: agreement.title, contentHtml: agreement.contentHtml });
      await prisma.agreement.update({
        where: { id: agreement.id },
        data: { status: ok ? "SENT" : "PENDING", ...(ok ? { sentAt: new Date() } : {}) },
      });
      await prisma.auditLog.create({
        data: {
          actorId: userId,
          actorType: "ADMIN",
          action: "AGREEMENT_ISSUED",
          entityType: "Agreement",
          entityId: agreement.id,
          metadata: JSON.stringify({ kind, delivered: ok }),
        },
      });
    }
    return { created };
  } catch (err) {
    console.error("[AGREEMENT] createAndSendAgreements failed:", err);
    return { created: 0 };
  }
}

/** Record a member's acceptance + send the confirmation email. */
export async function acceptAgreement(userId: string, agreementId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const agreement = await prisma.agreement.findUnique({ where: { id: agreementId } });
    if (!agreement || agreement.userId !== userId) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (agreement.status === "ACCEPTED") {
      return { ok: true };
    }
    await prisma.agreement.update({
      where: { id: agreementId },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, fullName: true } });

    if (user?.email) {
      const kind: AgreementKind = agreement.kind === "PARTNER" ? "PARTNER" : "USER";
      const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(user.fullName || "there")},</p>
<p style="margin:0 0 14px">Thank you — your acceptance of <strong>${escHtml(agreement.title)}</strong> has been recorded${agreement.acceptedAt ? ` on ${escHtml(new Date(agreement.acceptedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }))}` : ""}.</p>
<p style="margin:0 0 14px">Reference <strong>${escHtml(agreement.id.toUpperCase().slice(0, 8))}</strong>. This record is part of your verified, safe account.</p>`;
      void sendEmail(
        user.email,
        `Agreement accepted · ${agreement.title}`,
        renderEmail({
          title: "Agreement accepted",
          kicker: kind === "PARTNER" ? "Partner agreement" : "Member agreement",
          bodyHtml,
          ctaText: "View my agreements",
          ctaUrl: `${WEB_ORIGIN}/agreements`,
          note: "A copy of every agreement is kept on file with Nabri for your future reference.",
        }),
        `Your acceptance of ${agreement.title} has been recorded. Reference ${agreement.id.toUpperCase().slice(0, 8)}.`
      ).catch((err) => console.error("[EMAIL] Agreement accepted email failed:", err));
    }
    void prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "ADMIN",
        action: "AGREEMENT_ACCEPTED",
        entityType: "Agreement",
        entityId: agreementId,
        metadata: JSON.stringify({ kind: agreement.kind }),
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[AGREEMENT] acceptAgreement failed:", err);
    return { ok: false, error: "INTERNAL_ERROR" };
  }
}
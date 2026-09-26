// ============================================================================
// Post-KYC agreements issued to verified members and partners.
//
// Each template produces a self-contained, lightly-styled HTML snapshot that is
// stored verbatim on the Agreement row the moment it is issued (so later edits
// to these templates never rewrite someone's accepted terms), plus a plain-text
// version used for the PDF attachment and email text fallback.
// ============================================================================

export type AgreementKind = "USER" | "PARTNER";

export interface AgreementTemplate {
  kind: AgreementKind;
  title: string;
  kicker: string;
  contentHtml: string;
  plainText: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function section(num: string, title: string, body: string): string {
  return `<h3 style="margin:18px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;color:#1C1917">${num}. ${title}</h3><p style="margin:0 0 12px">${body}</p>`;
}

const USER_SECTIONS: Array<[string, string, string]> = [
  ["1", "Purpose", "This agreement keeps every member safe, accountable and honest. By using Nabri — bookings, walks, carry requests, communities, events and messaging — you agree to the standards below."],
  ["2", "Verified identity", "You confirm that the identity documents you submitted during KYC belong to you. Sharing an account, impersonating another person, or providing false documents is a breach of this agreement and results in immediate suspension and reporting to authorities where required."],
  ["3", "Community conduct", "Be respectful. Harassment, hate speech, unsolicited advances, threats, fraud, or conduct that endangers another member is prohibited. If you see something unsafe, use the in-app report or SOS features — your identity stays private."],
  ["4", "Payments & wallet", "Wallet balances belong to your verified account only. You may withdraw via the approved bank/UPI channel. Chargebacks or reversal attempts after a completed service are treated as fraud and will be escalated."],
  ["5", "Privacy & data", "Your personal data is used to operate and secure the platform as described in our privacy policy. We never sell your data. Location sharing is shown to the people you explicitly interact with — never publicly."],
  ["6", "Prohibited activity", "You may not: solicit private deals outside Nabri to bypass safety and payments, collect another member's contact information for outside commerce, publish defamatory content, or use the platform for illegal activity. Money laundering safeguards apply to all wallet transactions."],
  ["7", "Acceptance", "Accepting this agreement (in-app or via the emailed copy) is a binding acknowledgement of these terms. Nabri reserves the right to update the community agreement by notifying you of a new version in advance."],
];

const PARTNER_SECTIONS: Array<[string, string, string]> = [
  ["1", "Role & status", "You are an independent service partner on Nabri, not an employee. You set your availability and accept the jobs you choose. This agreement does not create employment, agency or partnership rights."],
  ["2", "Background verification", "Your KYC documents, selfie and references were checked before approval. You must keep your documents valid and immediately inform us of any identity or eligibility change. Misrepresentation is grounds for instant removal."],
  ["3", "Service & safety standards", "Deliver services professionally, arrive within your accepted window, and keep the client's belongings, space and person safe. Alcohol/drugs are prohibited while on a job. Maintain the Nabri dress/identity badge and carry your verified profile."],
  ["4", "Earnings & payouts", "Your earnings accrue per completed job as shown in your dashboard. Payouts land in your linked bank/UPI wallet after approval. Withdrawal fraud or collusion with clients to bypass the platform will block your balance and account."],
  ["5", "Conduct", "No harassment, discrimination, solicitation outside the platform, or unsolicited contact after a job. Ratings matter — repeated low-rated interactions reduce your job priority."],
  ["6", "Liability", "You are responsible for negligence during service. Nabri provides identity-verification and safety records for each job. Report workplace safety issues immediately; SOS and insurance guidance live in your partner resources."],
  ["7", "Acceptance", "Accepting this agreement (in-app or via the emailed copy) is a binding acknowledgement of these partner terms. Updated versions will be notified to you in advance."],
];

function buildSections(kind: AgreementKind): { title: string; kicker: string; rows: Array<[string, string, string]> } {
  if (kind === "PARTNER") return { title: "Nabri Partner Service & Safety Agreement", kicker: "Partner verification", rows: PARTNER_SECTIONS };
  return { title: "Nabri User Safety & Community Agreement", kicker: "Identity verification", rows: USER_SECTIONS };
}

export function buildAgreementTemplate(kind: AgreementKind): { title: string; kicker: string } {
  const { title, kicker } = buildSections(kind);
  return { title, kicker };
}

/** Filled + storage-ready HTML snapshot (header table + every section). */
export function renderAgreementHtml(kind: AgreementKind, name: string, agreementId: string): string {
  const { rows } = buildSections(kind);
  const date = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
  const meta = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:12px;overflow:hidden;margin:0 0 18px;background:#FBF7EF"><tr><td style="padding:10px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">${kind === "PARTNER" ? "NABRI · PARTNER AGREEMENT" : "NABRI · MEMBER AGREEMENT"}</td></tr><tr><td style="padding:2px 14px 12px;font-size:11px;color:#6B6558">Reference ${agreementId.toUpperCase().slice(0, 8)} · Issued ${esc(date)} · Accepted by ${esc(name)}</td></tr></table>`;
  const body = `<p style="margin:0 0 14px">Dear <strong>${esc(name)}</strong>,</p><p style="margin:0 0 12px">Thank you for completing your Nabri verification. The following agreement is the safe-harbour contract between you and Nabri. Please read it and accept it to unlock the community.</p>${rows.map((r) => section(r[0], r[1], r[2])).join("")}`;
  return `${meta}${body}<p style="margin:16px 0 0;font-size:11px;color:#9A9184">Nabri keeps an electronic record of your acceptance. This document is legally binding in India.</p>`;
}

/** Plain-text version used for the PDF attachment + email text fallback. */
export function agreementPlainText(kind: AgreementKind, name: string, agreementId: string): string {
  const { title, rows } = buildSections(kind);
  return [
    title.toUpperCase(),
    "=".repeat(Math.min(60, title.length + 4)),
    "",
    `Reference ${agreementId.toUpperCase().slice(0, 8)}`,
    `Issued ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`,
    "",
    `Dear ${name},`,
    "",
    ...rows.flatMap((r) => [`${r[0]}. ${r[1]}`, r[2], ""]),
    "Nabri keeps an electronic record of your acceptance. This document is legally binding in India.",
  ].join("\n");
}
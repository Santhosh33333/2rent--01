// ============================================================================
// Nabri legal documents.
//
// Each document is stored as an immutable, versioned row (LegalDocument). This
// module is the source used to seed the initial version; the database is the
// source of truth afterwards so a lawyer can revise wording and admins can
// re-publish without a redeploy.
//
// IMPORTANT: this is a product-ready DRAFT, not legal advice. Liability,
// refunds, the partner relationship, dispute resolution, age requirements, KYC
// and data-retention terms must be reviewed by an Indian lawyer before launch.
//
// [JURISDICTION] is intentionally loud so a missing detail is obvious in review
// rather than shipping as a blank in a binding document. The entity, support
// and grievance contacts are resolved values, not placeholders.
// ============================================================================

export type LegalDocKind =
  | "USER_AGREEMENT"
  | "PARTNER_AGREEMENT"
  | "PRIVACY_POLICY"
  | "COMMUNITY_GUIDELINES"
  | "BOOKING_POLICY";

export interface LegalDocSeed {
  kind: LegalDocKind;
  title: string;
  summary: string;
  contentHtml: string;
  plainText: string;
}

// Per product decision: the legal entity is the app name itself, and there is no
// separate registered address or grievance mailbox. Two addresses are published:
// the support desk handles all queries, complaints and privacy requests, and the
// founder mailbox is the direct contact. Jurisdiction still needs counsel.
const P = {
  entity: "Nabri",
  support: "nabri.support@gmail.com",
  founder: "founder_nabri@zohomail.in",
  jurisdiction: "[JURISDICTION - TO BE CONFIRMED BY COUNSEL]",
} as const;

const DISCLAIMER = `<p style="margin:18px 0 0;padding:12px 14px;background:#FFF7ED;border-left:3px solid #EA580C;font-size:12px;color:#7C2D12"><strong>Draft for legal review.</strong> This document is a product-ready draft and not legal advice. It must be reviewed and finalised by an Indian lawyer, and the bracketed placeholders completed, before it is treated as binding.</p>`;

function sections(rows: Array<[string, string, string | string[]]>): string {
  return rows
    .map(([num, title, body]) => {
      const html = Array.isArray(body) ? `<ul>${body.map((li) => `<li>${li}</li>`).join("")}</ul>` : `<p>${body}</p>`;
      return `<h3>${num}. ${title}</h3>${html}`;
    })
    .join("");
}

function bullets(items: string[]): string {
  return items.map((i) => `<li>${i}</li>`).join("");
}

function toPlainText(title: string, rows: Array<[string, string, string | string[]]>): string {
  const lines: string[] = [title.toUpperCase(), "=".repeat(Math.min(72, title.length)), ""];
  for (const [num, t, body] of rows) {
    lines.push(`${num}. ${t}`);
    if (Array.isArray(body)) body.forEach((li) => lines.push(`  - ${li}`));
    else lines.push(body);
    lines.push("");
  }
  lines.push("Draft for legal review. Must be finalised by an Indian lawyer before being binding.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 1. User Agreement
// ---------------------------------------------------------------------------
const USER_ROWS: Array<[string, string, string | string[]]> = [
  ["1", "About Nabri", "Nabri is a technology platform that may provide social connections, friendship, communities, events, sports and activities, travel activities, movie and entertainment discovery, messaging, partner and service discovery, bookings, location-based features, payments, notifications and safety tools. Some services are provided by independent Partners rather than by Nabri itself."],
  ["2", "Eligibility", "You must provide accurate information and meet the minimum age requirement applicable to the service and to law. You must not create an account using another person's identity. You are responsible for the security of your account."],
  ["3", "Account security", ["Protect your OTP, PIN and password.", "Do not share login credentials.", "Report unauthorised access immediately.", "Keep your contact information reasonably current.", "Nabri may require additional verification for sensitive actions."]],
  ["4", "Profile and photos", "You are responsible for content you upload to your profile. You must not upload another person's private photos without permission, impersonation content, stolen content, illegal content, abusive content, sexually exploitative content, harmful content, or content that violates another person's privacy. Nabri may remove content that violates applicable law or platform rules."],
  ["5", "Real-world connections", "Nabri helps users discover and communicate with other people. Nabri does not guarantee that another user is genuine, that a user will attend an event, that a person will respond, that a relationship will develop, that an event will be safe, or that another user will behave appropriately. Users should exercise appropriate caution when meeting people offline."],
  ["6", "Safety", `Never share your OTP, PIN, passwords, banking credentials, card PIN or confidential financial information with anyone, including anyone claiming to represent Nabri. Use Nabri's report and block features when necessary. For emergencies, contact the appropriate emergency services rather than relying solely on Nabri.`],
  ["7", "Location", "Location may be used for nearby discovery, events, sports, partner matching, active bookings, navigation and safety features. Nabri should use only the location information reasonably necessary for the relevant feature. Your exact location must not be publicly displayed by default."],
  ["8", "Booking", "When you create a booking you agree to the displayed service, date, time, location, pricing, applicable fees and cancellation rules. Cancellation is governed by the Booking, Cancellation, Refund and Payment Policy. The backend server time is authoritative for all cutoffs."],
  ["9", "Partner services", "Partners may be independent service providers. Nabri may facilitate discovery, booking, communication, payment, notifications and service tracking. Unless expressly stated otherwise, Nabri does not represent that every Partner is an employee or agent of Nabri."],
  ["10", "Payments", "Payment must be processed through supported payment methods. A payment is considered successful only after the applicable payment system or provider confirms it. Screenshots, manually entered transaction IDs or frontend messages do not by themselves establish payment completion."],
  ["11", "Refunds", "Refund eligibility depends on booking status, cancellation timing, payment status, the applicable refund policy and applicable law. A refund is not considered completed until the payment system confirms it."],
  ["12", "Events and communities", "Users must follow the event rules and the Community & Safety Guidelines. Organizers are responsible for the information they provide about their events. Nabri may remove or cancel events that violate law, safety rules or platform policies."],
  ["13", "Messaging", "You must not use Nabri messaging to harass, threaten, scam, spam, impersonate, distribute malware, violate privacy or distribute illegal content. You may report or block other users."],
  ["14", "Prohibited conduct", bullets([
    "Impersonate another person.",
    "Operate fraudulent accounts or scam users.",
    "Manipulate bookings or the payment system.",
    "Exploit promotions.",
    "Bypass security controls.",
    "Scrape private information.",
    "Attack or unlawfully reverse engineer Nabri systems.",
    "Upload malicious code.",
    "Abuse OTP systems.",
    "Create fake reviews or manipulate ratings.",
    "Harass other users.",
  ])],
  ["15", "Account suspension", "Nabri may restrict, suspend or terminate an account where there is a serious rule violation, fraud, abuse, a security risk, unlawful activity, repeated harmful conduct or payment abuse. Where appropriate, users should receive an explanation and an available review or appeal mechanism."],
  ["16", "User content", "You retain applicable rights in content you upload. You grant Nabri the permissions reasonably necessary to host, process, display and distribute that content as required to operate the service. Nabri should not use your private content for unrelated purposes without an appropriate legal basis or consent."],
  ["17", "Privacy", `Nabri's processing of personal data is described separately in the Privacy Policy, including the data collected, purpose, sharing, retention, security, user rights, consent and withdrawal mechanisms, and grievance contact information. Contact ${P.support} for any privacy question or request.`],
  ["18", "AI features", "Nabri may use AI for features such as recommendations, matching, translations, support, moderation assistance and event suggestions. AI output must not be treated as guaranteed fact. AI must not be permitted to bypass authentication, payment verification, KYC, privacy controls, admin permissions or safety controls."],
  ["19", "Platform availability", "Nabri will attempt to keep the service available but does not guarantee uninterrupted operation. Temporary interruption may occur due to maintenance, infrastructure failure, network problems, third-party provider failures, security incidents or events outside reasonable control."],
  ["20", "Changes", "Nabri may update this Agreement as the service evolves. Material changes should be communicated through appropriate channels, and where the change is material you may be required to re-accept the new version."],
  ["21", "Governing law", `This Agreement should specify the applicable law and dispute-resolution mechanism after legal review. Proposed jurisdiction: ${P.jurisdiction}.`],
  ["22", "Contact", `Nabri Support: ${P.support}<br/>Grievances and privacy requests: ${P.support}<br/>Founder contact: ${P.founder}<br/>Entity: ${P.entity}`],
];

// ---------------------------------------------------------------------------
// 2. Partner Agreement
// ---------------------------------------------------------------------------
const PARTNER_ROWS: Array<[string, string, string | string[]]> = [
  ["1", "Partner status", "A Partner is an individual or service provider approved to offer eligible services through Nabri. Partner approval does not automatically create an employment relationship. The exact legal relationship should be reviewed and defined by counsel based on the actual business model."],
  ["2", "Partner information", "A Partner must provide accurate identity information, profile information, service information, service area, availability, payout information and any required KYC documents."],
  ["3", "KYC", "A Partner may be required to complete verification before accessing certain services. KYC information must be securely stored, access controlled, used only for appropriate purposes and protected from public exposure."],
  ["4", "Partner responsibilities", bullets([
    "Accept only jobs you can perform.",
    "Arrive appropriately for accepted bookings.",
    "Communicate respectfully.",
    "Follow safety rules and applicable law.",
    "Protect customer information.",
    "Never misuse customer location.",
    "Never request unnecessary sensitive information.",
    "Accurately complete the service.",
  ])],
  ["5", "One active job", "A Partner may have only the number of active jobs permitted by Nabri's rules. For the current Nabri model this is ONE ACTIVE JOB PER PARTNER, and the backend must enforce this."],
  ["6", "Booking acceptance", "Once accepted, the Partner must follow the Nabri booking state machine and must not manually bypass protected states."],
  ["7", "Navigation and location", "A Partner may receive the location information necessary for an active booking. A Partner must not copy customer addresses unnecessarily, publicly disclose customer locations, retain customer location for unrelated purposes, or track customers outside authorised service periods."],
  ["8", "Start OTP", "The Partner must obtain the customer's start OTP where required. A Partner must never guess the OTP, bypass OTP, request another person's OTP, or mark a job started without successful verification."],
  ["9", "Completion OTP", "The Partner must follow the completion process. A Partner cannot independently mark a protected job completed where customer confirmation or OTP is required."],
  ["10", "Pricing", "A Partner must not secretly charge amounts outside the applicable Nabri pricing process. Final pricing must follow the booking's applicable pricing rules."],
  ["11", "Payments", "A Partner must not manipulate payment status, submit fake payment evidence, request unauthorised payment, or falsely claim payment."],
  ["12", "Earnings", "Partner earnings are created only after the applicable booking and payment conditions are satisfied. A Partner should receive a transaction record showing the booking, gross amount, platform fee, applicable deductions and net earnings."],
  ["13", "Withdrawal", "Withdrawals are subject to available balance, verification, applicable limits, payment processing and fraud and security checks."],
  ["14", "Cancellation", "Partner cancellation is governed by the same applicable booking cancellation rules. For the current Nabri rule, a booking scheduled for 6:00 PM must be cancelled before 5:00 PM. The server determines the cutoff."],
  ["15", "Customer privacy", "A Partner must keep customer information confidential, including phone number, address, location, messages, photos, booking details, emergency information and payment information."],
  ["16", "Safety", "A Partner must not threaten, harass, unlawfully discriminate, misuse customer information, pressure customers for personal relationships, use customer information for unrelated marketing, or engage in fraudulent activity."],
  ["17", "Account suspension", "Nabri may temporarily restrict Partner access during investigation of safety complaints, fraud, repeated cancellations, payment abuse, identity issues, serious customer complaints or security incidents. Where appropriate, an appeal or review mechanism should be provided."],
  ["18", "Insurance and licences", "Where a particular service legally requires a licence, registration, insurance, permit or professional qualification, the Partner must maintain the required documentation. Nabri should define service-specific requirements before launch."],
  ["19", "Taxes", "A Partner is responsible for applicable taxes and statutory obligations arising from their income, subject to applicable law and Nabri's role."],
  ["20", "Independent relationship", "This Agreement must clearly describe the intended relationship between Nabri and Partners. Generic wording must not be used here without legal review, because the actual operational model can affect the legal classification."],
  ["21", "Confidentiality", "A Partner must not disclose Nabri confidential information, customer information, internal systems or security information."],
  ["22", "Termination", "Nabri or the Partner may terminate the relationship subject to applicable law and outstanding obligations. Active bookings, payments, refunds, complaints and records must be handled before final closure."],
];

// ---------------------------------------------------------------------------
// 3. Privacy Policy
// ---------------------------------------------------------------------------
const PRIVACY_ROWS: Array<[string, string, string | string[]]> = [
  ["1", "Scope", "This Privacy Policy explains how Nabri collects, uses, shares, retains and protects personal data relating to users and partners. It applies to the Nabri app, website and services."],
  ["2", "Data we collect", bullets([
    "Account data such as name, email, phone number, date of birth, gender and profile content.",
    "Verification data such as identity documents, selfie images and address proof, collected for KYC and handled as sensitive personal data.",
    "Location data, including location shared during an active booking or safety event.",
    "Transaction data such as bookings, payments, wallet and withdrawal records.",
    "Communications such as messages, reports, support tickets and SOS alerts.",
    "Technical data such as device identifiers, IP address, logs and crash information.",
  ])],
  ["3", "Purpose and lawful basis", "Personal data is used to operate the service: to provide bookings and payments, to verify identity and prevent fraud, to provide safety features such as SOS and location sharing during an active job, to communicate with you, to comply with legal obligations, and to improve the service. Consent is required where applicable, and you may withdraw consent at any time."],
  ["4", "Sharing", "We do not sell your personal data. We may share data with service providers who host the platform, deliver payments, send messages, or provide KYC verification, strictly to operate the service. We share the minimum necessary with a Partner for the duration of an active booking, such as your name, pickup location and contact number. We may share data where required by law, a court order, or to protect the safety of users."],
  ["5", "Retention", "Personal data is retained only for as long as needed for the purposes described, including legal, tax, dispute and safety record-keeping obligations. Where data is no longer required it is deleted or anonymised."],
  ["6", "Security", "Reasonable technical and organisational safeguards are used, including encryption in transit, access control, audit logging and restricted KYC storage. No system is completely secure, and users should also protect their own credentials."],
  ["7", "Your rights", `Subject to applicable law you may request access to your personal data, correction of inaccurate data, deletion, restriction or portability, and you may withdraw consent. Requests should be sent to ${P.support} and will be handled within the period required by law.`],
  ["8", "Automated decision-making", "Nabri may use automated systems for matching, recommendations, fraud detection and moderation assistance. Significant decisions affecting you are subject to human review, and you may contact us to contest an automated outcome."],
  ["9", "Grievance", `Grievances relating to this policy, including any request to access, correct or delete your personal data, may be sent to ${P.support} and will be acknowledged and resolved within the period required by applicable law. Entity: ${P.entity}.`],
  ["10", "Children", "Nabri is not intended for use by persons below the applicable minimum age, and we do not knowingly collect data from them."],
  ["11", "Changes", "This policy may be updated as the service or law changes. Material changes will be communicated, and where required you will be asked to re-accept the updated version."],
];

// ---------------------------------------------------------------------------
// 4. Community & Safety Guidelines
// ---------------------------------------------------------------------------
const COMMUNITY_ROWS: Array<[string, string, string | string[]]> = [
  ["1", "Be respectful", "Treat every member with respect. Harassment, hate speech, threats, bullying, sexual harassment, and discriminatory or demeaning conduct are not permitted."],
  ["2", "No impersonation or deception", "Do not impersonate another person, organisation or business. Do not use another person's photos, identity or documents without permission."],
  ["3", "No fraud or scams", "Do not solicit money for outside deals, request advance payments, fake job offers, or otherwise deceive members. Financial deception results in suspension and may be reported to authorities."],
  ["4", "Content you post", "You are responsible for content you upload, including events, community posts, photos and reviews. Do not post illegal, abusive, sexually exploitative, defamatory, hateful or infringing content, or content that violates another person's privacy."],
  ["5", "Events and meetups", "Organizers are responsible for the accuracy of event information and for safety at their event. Events must not run past 10:00 PM, and a booking scheduled for 6:00 PM cannot be cancelled normally at or after 5:00 PM, as the server time determines the cutoff. Nabri may remove or cancel events that violate law, safety rules or platform policy."],
  ["6", "Privacy of others", "Do not share another person's private information, contact details or location without their consent, and do not use the platform to track or harass anyone."],
  ["7", "Reporting and blocking", "Use the in-app report and block features when something is unsafe. Reports are handled confidentially and the reporter's identity is protected from the reported member."],
  ["8", "Safety features", "The SOS feature is for genuine emergencies and should be used responsibly. In an emergency, contact the appropriate emergency services rather than relying solely on Nabri."],
  ["9", "Consequences", "Nabri may remove content, restrict features, or suspend or terminate accounts that breach these guidelines, proportionately to the severity and repetition of the breach."],
  ["10", "Acceptance", "By using Nabri you accept these Community & Safety Guidelines. They are incorporated into the User Agreement and, for partners, into the Partner Agreement."],
];

// ---------------------------------------------------------------------------
// 5. Booking, Cancellation, Refund & Payment Policy
// ---------------------------------------------------------------------------
const BOOKING_ROWS: Array<[string, string, string | string[]]> = [
  ["1", "Booking", "A booking is a request for a service at a stated time and location. A booking is confirmed only when its status shows it has been accepted and payment has been confirmed by the payment provider."],
  ["2", "Scheduling", "Bookings and events are subject to platform operating hours. An event may not run past 10:00 PM. Scheduled times are interpreted in the timezone shown on the booking or event."],
  ["3", "Cancellation cutoff", "For a booking scheduled at 6:00 PM, cancellation is permitted only before 5:00 PM. At or after 5:00 PM, normal cancellation is not available. More generally, normal cancellation closes one hour before the scheduled start time. The backend server time is authoritative, not the device clock. Special emergency or support handling may apply where permitted."],
  ["4", "Cancelling", "A confirmed booking may be cancelled by the user or the assigned partner, subject to the cutoff above. The cancellation window and the resulting refund are shown before the user confirms."],
  ["5", "No-show", "If a user does not attend, or a partner does not arrive within the accepted window, the booking may be marked a no-show and may affect ratings and future access."],
  ["6", "Payment confirmation", "Payment must be processed through supported payment methods. A payment is successful only when the payment system or provider confirms it. A screenshot, a manually entered transaction ID or a message in the app is not proof of payment."],
  ["7", "Refunds", "Refund eligibility depends on booking status, cancellation timing, payment status, the applicable refund policy and applicable law. A refund is not considered completed until the payment system confirms it. Where a service has already been delivered, a refund may be refused."],
  ["8", "Platform and partner amounts", "Where a booking is fulfilled by a partner, the amounts payable to the partner and any applicable platform fee are shown in the partner's transaction record. A partner may not charge outside the applicable pricing process."],
  ["9", "Disputes", "If something is wrong with a booking, raise it through in-app support promptly. Disputes are reviewed against the booking record, including status history, payment confirmation, OTP verification and chat."],
  ["10", "Acceptance", "By creating a booking you accept this Booking, Cancellation, Refund and Payment Policy."],
];

function doc(
  kind: LegalDocKind,
  title: string,
  summary: string,
  rows: Array<[string, string, string | string[]]>
): LegalDocSeed {
  const contentHtml = `<p style="margin:0 0 16px">${summary}</p>${sections(rows)}<p style="margin:18px 0 0;font-size:12px;color:#57534E">Nabri &middot; Support: ${P.support} &middot; Founder contact: ${P.founder}</p>${DISCLAIMER}`;
  return { kind, title, summary, contentHtml, plainText: toPlainText(title, rows) };
}

export const LEGAL_DOCUMENTS: LegalDocSeed[] = [
  doc("USER_AGREEMENT", "Nabri User Agreement", "The terms that apply to every person using Nabri.", USER_ROWS),
  doc("PARTNER_AGREEMENT", "Nabri Partner Agreement", "The terms that apply to independent service partners on Nabri.", PARTNER_ROWS),
  doc("PRIVACY_POLICY", "Nabri Privacy Policy", "How Nabri collects, uses, shares, retains and protects personal data.", PRIVACY_ROWS),
  doc("COMMUNITY_GUIDELINES", "Nabri Community & Safety Guidelines", "The conduct and safety rules every member must follow.", COMMUNITY_ROWS),
  doc("BOOKING_POLICY", "Nabri Booking, Cancellation, Refund & Payment Policy", "How bookings, cancellations, refunds and payments work, including the 5:00 PM and 10:00 PM rules.", BOOKING_ROWS),
];

/** Which documents must be accepted at a given gate. */
export const CONSENT_REQUIREMENTS: Record<string, LegalDocKind[]> = {
  SIGNUP: ["USER_AGREEMENT", "PRIVACY_POLICY", "COMMUNITY_GUIDELINES"],
  PARTNER_ONBOARDING: ["PARTNER_AGREEMENT", "USER_AGREEMENT", "PRIVACY_POLICY", "COMMUNITY_GUIDELINES"],
  BOOKING: ["BOOKING_POLICY"],
  // Re-consent asks for the same core terms as signup. The route validator has
  // always advertised RE_CONSENT as a valid consentType, but this map had no
  // such key, so the controller rejected every re-consent with a 400 and nobody
  // could ever clear an updated-terms notice.
  RE_CONSENT: ["USER_AGREEMENT", "PRIVACY_POLICY", "COMMUNITY_GUIDELINES"],
};

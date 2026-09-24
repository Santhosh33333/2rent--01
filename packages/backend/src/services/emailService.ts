import { createTransport } from "nodemailer";
import { env } from "../config/env";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";

export type EmailProviderName = "none" | "smtp" | "brevo" | "resend";

export function emailProvider(): EmailProviderName {
  const p = (env.EMAIL_PROVIDER || "none").toLowerCase();
  // Brevo Transactional Email API: api-key auth, IP-independent (SMTP relay is
  // bound to sender IP and breaks on cloud hosts with 525 Unauthorized IP).
  if (p === "brevo" && env.BREVO_API_KEY) return "brevo";
  if (p === "smtp" && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return "smtp";
  if (p === "resend" && env.RESEND_API_KEY) return "resend";
  // Explicit provider request without credentials, or unknown name, degrades
  // honestly to "none" — never pretend to send.
  return "none";
}

export function emailStatus(): {
  provider: EmailProviderName;
  configured: boolean;
  requiredEnv: string[];
  from: string;
} {
  const provider = emailProvider();
  if (provider === "brevo" || provider === "smtp" || provider === "resend") {
    return { provider, configured: true, requiredEnv: [], from: env.EMAIL_FROM };
  }
  const want = (env.EMAIL_PROVIDER || "none").toLowerCase();
  const required =
    want === "resend"
      ? ["RESEND_API_KEY", "EMAIL_FROM"]
      : want === "brevo"
        ? ["BREVO_API_KEY", "EMAIL_FROM"]
        : ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"];
  return { provider: "none", configured: false, requiredEnv: required, from: env.EMAIL_FROM };
}

/** Parse "Name <email>" from EMAIL_FROM with safe fallbacks. */
function parseFrom(): { name: string; email: string } {
  const m = /^([^<]*)<([^>]+)>/.exec(env.EMAIL_FROM || "");
  if (m) return { name: m[1].trim() || "Nabri", email: m[2].trim() };
  return { name: "Nabri", email: (env.EMAIL_FROM || "noreply@nabri.app").trim() };
}

let transporter: ReturnType<typeof createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

async function sendViaBrevo(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; messageId?: string; error?: string; detail?: string }> {
  try {
    const { name, email } = parseFrom();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "api-key": env.BREVO_API_KEY || "",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name, email },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = `${res.status} ${Array.isArray(data?.message) ? data.message.join(" | ") : data?.message || ""}`.trim();
        console.error("[EMAIL] Brevo API error:", JSON.stringify({ status: res.status, message: data?.message, code: data?.code, error: data?.error }));
        return { ok: false, error: "EMAIL_DELIVERY_FAILED", detail };
      }
      return { ok: true, messageId: data?.messageId };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    return { ok: false, error: "EMAIL_DELIVERY_FAILED", detail: err?.name === "AbortError" ? "timed out" : (err?.message || "request failed") };
  }
}

async function sendViaResend(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; messageId?: string; error?: string; detail?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${data?.message || "rejected"}` };
      return { ok: true, messageId: data?.id };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || "Resend request failed" };
  }
}

export interface EmailResult {
  ok: boolean;
  provider: EmailProviderName;
  messageId?: string;
  error?: string;
  /** Extra delivery detail (SMTP code/response) for diagnostics/logs. */
  detail?: string;
}

function wrapHtml(title: string, body: string): string {
  return renderEmail({ title, bodyHtml: body });
}

/**
 * Send one transactional email. Returns ok:false (never throws) when no
 * provider is configured or delivery fails — callers MUST check `ok`
 * before telling the user anything was sent.
 */
export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<EmailResult> {
  const provider = emailProvider();
  const plain = text || html.replace(/<[^>]*>/g, "");
  if (provider === "none") {
    if (!env.isProduction) console.log(`[EMAIL] (dev, unconfigured) To: ${to} | Subject: ${subject}`);
    else console.warn("[EMAIL] not configured — email not delivered (suppressed from logs for PII safety).");
    return { ok: false, provider, error: "EMAIL_NOT_CONFIGURED" };
  }
  if (provider === "brevo") {
    const r = await sendViaBrevo(to, subject, html, plain);
    if (!r.ok) console.error("[EMAIL] Brevo API failed:", r.error);
    return { ok: r.ok, provider, messageId: r.messageId, error: r.error, detail: r.detail };
  }
  if (provider === "resend") {
    const r = await sendViaResend(to, subject, html, plain);
    if (!r.ok) console.error("[EMAIL] Resend failed:", r.error);
    return { ok: r.ok, provider, messageId: r.messageId, error: r.error, detail: r.detail };
  }
  const tx = getTransporter();
  if (!tx) return { ok: false, provider: "none", error: "EMAIL_NOT_CONFIGURED" };
  try {
    const info: any = await tx.sendMail({ from: env.EMAIL_FROM, to, subject, html, text: plain });
    return { ok: true, provider, messageId: info?.messageId };
  } catch (err: any) {
    // Nodemailer surfaces rejection codes/responses that a bare message hides.
    const detail =
      err?.response !== undefined && typeof err.response === "string"
        ? err.response
        : err?.responseCode
          ? `${err.responseCode} ${String(err?.response || "")}`.trim()
          : err?.code
            ? String(err.code)
            : err?.message || "unknown";
    console.error("[EMAIL] SMTP failed:", detail);
    return { ok: false, provider, error: "EMAIL_DELIVERY_FAILED", detail };
  }
}

export async function sendOTPEmail(
  email: string,
  otp: string,
  purpose = "verification",
  organization = "Nabri",
  subjectOverride?: string
): Promise<EmailResult> {
  const subject = subjectOverride || `Your ${organization} ${purpose} code`;
  const bodyHtml = `<div style="background:#FBF7EF;border:1px solid #EFE4D4;border-radius:16px;padding:22px 16px;text-align:center;margin:8px 0 18px"><div style="font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:900;letter-spacing:10px;color:#1C1917;padding-left:10px;margin:0">${escHtml(otp)}</div></div><p style="margin:0 0 12px;font-size:14px;color:#6B6558">Use this code to complete the <strong style="color:#1C1917">${escHtml(purpose)}</strong> step for your ${escHtml(organization)} account. It expires in ${env.OTP_EXPIRY_MINUTES} minutes.</p><p style="margin:0;font-size:12px;color:#9A9184">If you didn't request this code, you can safely ignore this email.</p>`;
  return sendEmail(
    email,
    subject,
    renderEmail({
      title: subject,
      bodyHtml,
      note: `This code expires in ${env.OTP_EXPIRY_MINUTES} minutes. Never share it with anyone, including ${organization} support.`,
    }),
    `Your ${purpose} code is ${otp}. Expires in ${env.OTP_EXPIRY_MINUTES} minutes.`
  );
}

export async function sendWelcomeEmail(email: string, name: string): Promise<EmailResult> {
  const displayName = name && name !== email ? name : "there";
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const supportEmail = escHtml(env.SUPPORT_EMAIL);
  const features: Array<[string, string, string]> = [
    ["🤝", "Connect", "with people and communities"],
    ["🚶", "Find or join", "activities near you"],
    ["✈️", "Discover travel", "opportunities"],
    ["🎬", "Explore plans and", "experiences"],
    ["📅", "Create and join", "events"],
    ["💬", "Chat and connect", "with others"],
    ["🔐", "Keep your profile", "and interactions secure"],
  ];
  const featureRows = features
    .map(
      ([emoji, head, desc]) =>
        `<tr><td style="vertical-align:top;padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:34px;vertical-align:top"><div style="width:28px;height:28px;border-radius:9px;background:#FBF7EF;border:1px solid #EFE4D4;text-align:center;line-height:26px;font-size:14px">${emoji}</div></td><td style="padding:2px 0 0 10px;font-size:13.5px;line-height:1.5;color:#4B453D"><strong style="color:#1C1917">${escHtml(head)}</strong> ${escHtml(desc)}</td></tr></table></td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 12px">Hi <strong style="color:#1C1917">${escHtml(firstName)}</strong>,</p>
<p style="margin:0 0 14px"><span style="font-size:18px">🎉</span> <strong class="nabri-anim" style="color:#1C1917">Welcome to Nabri!</strong></p>
<p class="nabri-anim" style="margin:0 0 14px">We&rsquo;re happy to have you with us. Nabri is built to help you connect, discover, travel, join activities, and create meaningful experiences with people around you. Your account has been successfully created.</p>
<p style="margin:0 0 14px;font-weight:800;color:#1C1917">🚀 What you can do with Nabri</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${featureRows}</table>
<table class="nabri-anim" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBF7EF;border:1px solid #EFE4D4;border-radius:14px;margin:0 0 18px;padding:0"><tr><td style="padding:14px 16px;font-size:12px;color:#6B6558;font-weight:800;letter-spacing:1px">YOUR ACCOUNT</td></tr>
<tr><td style="padding:0 16px 8px;font-size:13px;color:#6B6558">Name<strong style="display:block;color:#1C1917">${escHtml(displayName)}</strong></td></tr>
<tr><td style="padding:0 16px 8px;font-size:13px;color:#6B6558">Email<strong style="display:block;color:#1C1917">${escHtml(email)}</strong></td></tr>
<tr><td style="padding:0 16px 14px;font-size:13px;color:#6B6558">Account<strong style="display:block;color:#1C1917"><span class="nabri-badge" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22A06B;margin-right:6px"></span>Successfully verified ✅</strong></td></tr></table>
<p class="nabri-anim" style="margin:0 0 14px">Start exploring Nabri and discover what&rsquo;s happening around you.</p>
<p style="margin:0 0 18px;font-style:italic;color:#4B453D">Welcome to Nabri — Connect. Discover. Experience.</p>
<p style="margin:0 0 6px">Regards,<br/><strong style="color:#1C1917">Team Nabri</strong><br/><a href="mailto:${supportEmail}" style="color:#D83D27;text-decoration:none">${supportEmail}</a></p>`;
  return sendEmail(
    email,
    `Welcome to Nabri, ${firstName}! 🎉`,
    renderEmail({
      title: `Welcome to Nabri! 🎉`,
      bodyHtml,
      ctaText: "Start exploring",
      ctaUrl: WEB_ORIGIN,
      note: `If you didn't create this account, please contact our support team: ${env.SUPPORT_EMAIL}`,
      headHtml: `@keyframes nabriFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } @keyframes nabriBadgeGlow { 0% { box-shadow: 0 0 0 0 rgba(34,160,107,0.4); } 70% { box-shadow: 0 0 0 8px rgba(34,160,107,0); } 100% { box-shadow: 0 0 0 0 rgba(34,160,107,0); } } @media screen { .nabri-anim { animation: nabriFadeIn 0.8s ease-out both; } .nabri-badge { animation: nabriBadgeGlow 1.6s ease-out infinite; } }`,
    }),
    `Hi ${firstName}, welcome to Nabri! Your account is ready. Connect, discover and experience what's around you. Support: ${env.SUPPORT_EMAIL}`
  );
}

const INTRO_LINES: Array<[string, string]> = [
  ["1. Make your profile", "Add your name, photo and contact details so helpers and partners can reach you easily."],
  ["2. Get verified", "Complete the quick KYC check to unlock bookings and trusted-partner services."],
  ["3. Book anything nearby", "Homes, ride help, services, events — reserve what you need with a clean invoice every time."],
  ["4. Ask for help anytime", "Need assistance in a pinch? Request quick help from verified people and partners around you."],
];

/** Introduction email sent shortly after signup — walks the user through Nabri. */
export async function sendIntroductionEmail(email: string, name: string): Promise<EmailResult> {
  const displayName = name && name !== email ? name : "there";
  const linesHtml = INTRO_LINES.map(
    ([head, desc]) =>
      `<tr><td style="vertical-align:top;padding:0 0 16px"><div style="font-size:15px;font-weight:800;color:#1C1917;margin:0 0 2px">${escHtml(head)}</div><div style="font-size:13px;color:#6B6558;line-height:1.5;margin:0">${escHtml(desc)}</div></td></tr>`
  ).join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi <strong style="color:#1C1917">${escHtml(displayName)}</strong>,</p><p style="margin:0 0 14px">Thanks for joining Nabri! Here's how to get the most out of it:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px">${linesHtml}</table><p style="margin:0">Start by completing your profile — it takes under a minute and unlocks everything.</p>`;
  return sendEmail(
    email,
    "Getting started with Nabri",
    renderEmail({
      title: "Welcome — let's get you started",
      bodyHtml,
      ctaText: "Open Nabri",
      ctaUrl: WEB_ORIGIN,
      note: "You're receiving this because you recently created a Nabri account.",
    }),
    `Hi ${displayName}, thanks for joining Nabri! Complete your profile and verify your account to unlock bookings and services.`
  );
}

export async function sendPasswordResetEmail(email: string, otp: string): Promise<EmailResult> {
  return sendOTPEmail(email, otp, "password reset");
}

export async function sendSecurityAlertEmail(email: string, subject: string, body: string): Promise<EmailResult> {
  return sendEmail(email, `[Security] ${subject}`, wrapHtml(subject, `<p>${body}</p>`), `${subject}: ${body}`);
}

export async function sendBookingEmail(email: string, subject: string, body: string): Promise<EmailResult> {
  return sendEmail(email, subject, wrapHtml(subject, `<p>${body}</p>`), `${subject}: ${body}`);
}

/** KYC decision email — sent to the applicant when an admin reviews their documents. */
export async function sendKycEmail(email: string, name: string, approved: boolean, rejectionReason?: string): Promise<EmailResult> {
  const subject = approved ? "KYC verification approved" : "KYC verification needs attention";
  const bodyHtml = approved
    ? `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Good news — your identity check was <strong>approved</strong>. You now have full access to bookings, events and partner services.</p><p style="margin:0">Keep your documents up to date in case we ever need to re-verify you.</p>`
    : `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Unfortunately your identity check was <strong>not approved</strong>${rejectionReason ? `: ${escHtml(rejectionReason)}` : "."}</p><p style="margin:0">Please correct the details and resubmit your documents.</p>`;
  return sendEmail(
    email,
    subject,
    renderEmail({
      title: approved ? "You're verified!" : "KYC update",
      bodyHtml,
      ctaText: "Check my profile",
      ctaUrl: `${WEB_ORIGIN}/profile`,
      note: "Need help? Reply to this email and we'll get back to you.",
    }),
    approved
      ? `Hi ${name}, your KYC was approved. You now have full access to Nabri.`
      : `Hi ${name}, your KYC was not approved${rejectionReason ? `: ${rejectionReason}` : "."} Please resubmit.`
  );
}

export interface BookingInvoiceEmailData {
  bookingId: string;
  serviceType: string;
  scheduledAt: Date;
  startLocation: string;
  endLocation: string;
  amount: number;
  paymentReference?: string;
  paymentMethod?: string;
}

/** Booking confirmation with payment invoice summary. */
export async function sendBookingInvoiceEmail(email: string, name: string, invoice: BookingInvoiceEmailData): Promise<EmailResult> {
  const amountStr = `₹${invoice.amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const invoiceNo = invoice.bookingId.slice(0, 8).toUpperCase();
  const scheduled = new Date(invoice.scheduledAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const rows: Array<[string, string]> = [
    ["Service", invoice.serviceType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())],
    ["Scheduled for", scheduled],
    ["Pickup", invoice.startLocation],
    ["Drop-off", invoice.endLocation],
    ["Payment method", invoice.paymentMethod || "UPI / Online"],
    ["Amount paid", amountStr],
  ];
  if (invoice.paymentReference) rows.push(["Reference", invoice.paymentReference]);
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(v)}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Your booking is confirmed and paid. Here&rsquo;s your invoice:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#D83D27;font-weight:800;letter-spacing:1px">NABRI · INVOICE ${invoiceNo}</td></tr>${rowsHtml}</table>`;
  return sendEmail(
    email,
    `Booking confirmed · Invoice ${invoiceNo}`,
    renderEmail({
      title: `Booking confirmed · ${amountStr}`,
      bodyHtml,
      ctaText: "View booking",
      ctaUrl: `${WEB_ORIGIN}/bookings`,
      note: "Keep this email as your payment receipt. You can also view it anytime in the Nabri app.",
    }),
    `Hi ${name}, your booking is confirmed. Amount paid: ${amountStr}. Booking ref: ${invoiceNo}.`
  );
}

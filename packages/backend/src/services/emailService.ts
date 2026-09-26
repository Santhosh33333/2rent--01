import { createTransport } from "nodemailer";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { renderEmail, escHtml, paragraphHtml, WEB_ORIGIN } from "./emailTemplate";

export type EmailProviderName = "none" | "smtp" | "gmail" | "brevo" | "resend";

export function emailProvider(): EmailProviderName {
  const p = (env.EMAIL_PROVIDER || "none").toLowerCase();
  // Brevo Transactional Email API: api-key auth, IP-independent (SMTP relay is
  // bound to sender IP and breaks on cloud hosts with 525 Unauthorized IP).
  if (p === "brevo" && env.BREVO_API_KEY) return "brevo";
  if (p === "gmail" && env.GMAIL_USER && env.GMAIL_APP_PASSWORD) return "gmail";
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
  if (provider === "brevo" || provider === "smtp" || provider === "gmail" || provider === "resend") {
    return { provider, configured: true, requiredEnv: [], from: env.EMAIL_FROM };
  }
  const want = (env.EMAIL_PROVIDER || "none").toLowerCase();
  const required =
    want === "resend"
      ? ["RESEND_API_KEY", "EMAIL_FROM"]
      : want === "brevo"
        ? ["BREVO_API_KEY", "EMAIL_FROM"]
        : want === "gmail"
          ? ["GMAIL_USER", "GMAIL_APP_PASSWORD", "EMAIL_FROM"]
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
let gmailTransporter: ReturnType<typeof createTransport> | null = null;

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

// Gmail SMTP: smtp.gmail.com with requireTLS. Auth uses a Google App Password
// (16-char), not the account password. Sender must be the Gmail address itself.
function getGmailTransporter() {
  if (gmailTransporter) return gmailTransporter;
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  gmailTransporter = createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
  });
  return gmailTransporter;
}

async function sendViaBrevo(
  to: string,
  subject: string,
  html: string,
  text: string,
  opts?: SendEmailOptions
): Promise<{ ok: boolean; messageId?: string; error?: string; detail?: string }> {
  try {
    const { name, email } = parseFrom();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const payload: Record<string, any> = {
        sender: { name, email },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      };
      if (opts?.bcc?.length) payload.bcc = opts.bcc.map((e) => ({ email: e }));
      if (opts?.attachments?.length) {
        payload.attachment = opts.attachments.map((a) => ({ content: a.content.toString("base64"), name: a.filename }));
      }
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "api-key": env.BREVO_API_KEY || "",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
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

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
  opts?: SendEmailOptions
): Promise<{ ok: boolean; messageId?: string; error?: string; detail?: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const body: Record<string, any> = { from: env.EMAIL_FROM, to: [to], subject, html, text };
      if (opts?.bcc?.length) body.bcc = opts.bcc;
      if (opts?.attachments?.length) {
        body.attachments = opts.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }));
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(body),
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

export interface SendEmailOptions {
  attachments?: Array<{ filename: string; content: Buffer }>;
  bcc?: string[];
}

/**
 * Send one transactional email. Returns ok:false (never throws) when no
 * provider is configured or delivery fails — callers MUST check `ok`
 * before telling the user anything was sent.
 */
export async function sendEmail(to: string, subject: string, html: string, text?: string, opts?: SendEmailOptions): Promise<EmailResult> {
  const provider = emailProvider();
  const plain = text || html.replace(/<[^>]*>/g, "");
  if (provider === "none") {
    if (!env.isProduction) console.log(`[EMAIL] (dev, unconfigured) To: ${to} | Subject: ${subject}`);
    else console.warn("[EMAIL] not configured — email not delivered (suppressed from logs for PII safety).");
    return { ok: false, provider, error: "EMAIL_NOT_CONFIGURED" };
  }
  if (provider === "brevo") {
    const r = await sendViaBrevo(to, subject, html, plain, opts);
    if (!r.ok) console.error("[EMAIL] Brevo API failed:", r.error);
    return { ok: r.ok, provider, messageId: r.messageId, error: r.error, detail: r.detail };
  }
  if (provider === "resend") {
    const r = await sendViaResend(to, subject, html, plain, opts);
    if (!r.ok) console.error("[EMAIL] Resend failed:", r.error);
    return { ok: r.ok, provider, messageId: r.messageId, error: r.error, detail: r.detail };
  }
  if (provider === "gmail") {
    const tx = getGmailTransporter();
    if (!tx) return { ok: false, provider: "none", error: "EMAIL_NOT_CONFIGURED" };
    try {
      const info: any = await tx.sendMail({ from: env.EMAIL_FROM, to, subject, html, text: plain, attachments: opts?.attachments, bcc: opts?.bcc });
      return { ok: true, provider, messageId: info?.messageId };
    } catch (err: any) {
      const detail =
        err?.response !== undefined && typeof err.response === "string"
          ? err.response
          : err?.responseCode
            ? `${err.responseCode} ${String(err?.response || "")}`.trim()
            : err?.code
              ? String(err.code)
              : err?.message || "unknown";
      console.error("[EMAIL] Gmail SMTP failed:", detail);
      return { ok: false, provider, error: "EMAIL_DELIVERY_FAILED", detail };
    }
  }
  const tx = getTransporter();
  if (!tx) return { ok: false, provider: "none", error: "EMAIL_NOT_CONFIGURED" };
  try {
    const info: any = await tx.sendMail({ from: env.EMAIL_FROM, to, subject, html, text: plain, attachments: opts?.attachments, bcc: opts?.bcc });
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
  const label = purpose.toLowerCase().replace(/_/g, " ");
  const bodyHtml = `<p style="margin:0 0 14px">You asked to ${escHtml(label)} your ${escHtml(organization)} account. Enter the code below to continue &mdash; it&rsquo;s valid for <strong>${env.OTP_EXPIRY_MINUTES} minutes</strong>.</p>
<table class="nabri-code" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:10px 0 18px;background:#FBF7EF;border:1px solid #EFE4D4;border-radius:18px;padding:6px">
<tr><td align="center" style="background:#FFFFFF;border:1px dashed #E2D3BC;border-radius:14px;padding:24px 16px 20px">
<div style="font-family:Consolas,'Courier New',Menlo,monospace;font-size:40px;line-height:1;font-weight:800;letter-spacing:12px;color:#1C1917;padding-left:12px;margin:0">${escHtml(otp)}</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:#9A9184;text-transform:uppercase;margin-top:12px">One-time verification code</div>
</td></tr></table>
<p style="margin:0 0 14px">If you didn't request this, you can safely ignore this email &mdash; your account stays secure.</p>`;
  return sendEmail(
    email,
    subject,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: subject,
      kicker: "Security code",
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
<p style="margin:0 0 14px"><span style="font-size:18px">🎉</span> <strong class="nabri-fade d2" style="color:#1C1917">Welcome to Nabri!</strong></p>
<p class="nabri-fade d2" style="margin:0 0 14px">We&rsquo;re happy to have you with us. Nabri is built to help you connect, discover, travel, join activities, and create meaningful experiences with people around you. Your account has been successfully created.</p>
<p style="margin:0 0 14px;font-weight:800;color:#1C1917">🚀 What you can do with Nabri</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${featureRows}</table>
<table class="nabri-fade d3" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBF7EF;border:1px solid #EFE4D4;border-radius:14px;margin:0 0 18px;padding:0"><tr><td style="padding:14px 16px;font-size:12px;color:#6B6558;font-weight:800;letter-spacing:1px">YOUR ACCOUNT</td></tr>
<tr><td style="padding:0 16px 8px;font-size:13px;color:#6B6558">Name<strong style="display:block;color:#1C1917">${escHtml(displayName)}</strong></td></tr>
<tr><td style="padding:0 16px 8px;font-size:13px;color:#6B6558">Email<strong style="display:block;color:#1C1917">${escHtml(email)}</strong></td></tr>
<tr><td style="padding:0 16px 14px;font-size:13px;color:#6B6558">Account<strong style="display:block;color:#1C1917"><span class="nabri-pulse" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22A06B;margin-right:6px"></span>Successfully verified ✅</strong></td></tr></table>
<p class="nabri-fade d3" style="margin:0 0 14px">Start exploring Nabri and discover what&rsquo;s happening around you.</p>
<p style="margin:0 0 18px;font-style:italic;color:#4B453D">Welcome to Nabri — Connect. Discover. Experience.</p>
<p style="margin:0 0 6px">Regards,<br/><strong style="color:#1C1917">Team Nabri</strong><br/><a href="mailto:${supportEmail}" style="color:#0D378B;text-decoration:none">${supportEmail}</a></p>`;
  return sendEmail(
    email,
    `Welcome to Nabri, ${firstName}! 🎉`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Welcome to Nabri! 🎉`,
      kicker: "You're in!",
      bodyHtml,
      ctaText: "Start exploring",
      ctaUrl: WEB_ORIGIN,
      note: `If you didn't create this account, please contact our support team: ${env.SUPPORT_EMAIL}`,
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
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: "Welcome — let's get you started",
      kicker: "Getting started",
      bodyHtml,
      ctaText: "Open Nabri",
      ctaUrl: WEB_ORIGIN,
      note: "You're receiving this because you recently created a Nabri account.",
    }),
    `Hi ${displayName}, thanks for joining Nabri! Complete your profile and verify your account to unlock bookings and services.`
  );
}

export async function sendPasswordResetEmail(email: string, otp: string): Promise<EmailResult> {
  return sendOTPEmail(email, otp, "password reset", "Nabri", "Reset your Nabri password");
}

export async function sendSecurityAlertEmail(email: string, subject: string, body: string): Promise<EmailResult> {
  return sendEmail(
    email,
    `[Security] ${subject}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: subject,
      kicker: "Security alert",
      bodyHtml: `<p style="margin:0 0 14px">We detected unusual activity on your Nabri account.</p><table class="nabri-fade d2" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FFF7F5;border:1px solid #F5D9D3;border-radius:14px;margin:0 0 16px"><tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4B453D">${paragraphHtml(body)}</td></tr></table><p style="margin:0 0 14px"><strong>If this was you</strong> — you're all set. <strong>If it wasn't</strong>, change your password immediately and contact <a href="mailto:${escHtml(env.SUPPORT_EMAIL)}" style="color:#0D378B;text-decoration:none">${escHtml(env.SUPPORT_EMAIL)}</a>.</p>`,
      note: "This message was sent automatically. Do not reply to this email.",
    }),
    `${subject}: ${body}. Support: ${env.SUPPORT_EMAIL}`
  );
}

export async function sendBookingEmail(email: string, subject: string, body: string): Promise<EmailResult> {
  return sendEmail(
    email,
    subject,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: subject,
      kicker: "Nabri booking",
      bodyHtml: `<p style="margin:0 0 14px">Here's an update on your Nabri booking:</p><div class="nabri-fade d2" style="background:#FBF7EF;border:1px solid #EFE4D4;border-radius:14px;padding:16px 18px;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4B453D">${paragraphHtml(body)}</div><p style="margin:0">Need help? Reply to this email or reach us at <a href="mailto:${escHtml(env.SUPPORT_EMAIL)}" style="color:#0D378B;text-decoration:none">${escHtml(env.SUPPORT_EMAIL)}</a>.</p>`,
    }),
    `${subject}: ${body}`
  );
}

/** KYC decision email — sent to the applicant when an admin reviews their documents. */
// ============================================================================
// SOS ALERT EMAILS
// ============================================================================

export interface SosAlertEmailInput {
  recipientName: string | null | undefined;
  recipientRole: "admin" | "contact";
  userName: string;
  userPhone?: string | null;
  userEmail?: string | null;
  message?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  duringBooking?: boolean;
  alertId: string;
}

export function sosRecipients(): string[] {
  const configured = (env.SOS_ALERT_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const primary = (env.ADMIN_EMAIL || "santhoshkrishna958@gmail.com").trim().toLowerCase();
  return Array.from(new Set([...configured, primary]));
}

// Sends the SOS alert to one address. Admin copies get the operational detail
// (live map, dashboard deep-link); the emergency contact gets a plain,
// reassuring notice with the map link and the user's phone number.
export async function sendSosAlertEmail(to: string, input: SosAlertEmailInput): Promise<EmailResult> {
  const isAdmin = input.recipientRole === "admin";
  const who = input.userName || "A Nabri member";
  const mapsLink =
    input.latitude != null && input.longitude != null
      ? `https://maps.google.com/?q=${input.latitude},${input.longitude}`
      : null;
  const dashboardLink = `${WEB_ORIGIN}/admin/sos`;
  const contactLine = input.userPhone
    ? `Call them back on <strong>${escHtml(input.userPhone)}</strong>`
    : "Contact them through the Nabri safety line";
  const locationBlock = mapsLink
    ? `<p style="margin:0 0 14px">Live location: <a href="${mapsLink}" style="color:#0D378B;font-weight:600">${escHtml(mapsLink)}</a></p>`
    : `<p style="margin:0 0 14px">No location was shared with this alert.</p>`;

  const bodyHtml = isAdmin
    ? `<p style="margin:0 0 14px"><strong>Emergency SOS triggered${input.duringBooking ? " during an active booking" : ""}.</strong></p>
       <p style="margin:0 0 8px">Member: <strong>${escHtml(who)}</strong>${input.userEmail ? ` (${escHtml(input.userEmail)})` : ""}</p>
       <p style="margin:0 0 8px">Phone: <strong>${escHtml(input.userPhone || "not provided")}</strong></p>
       <p style="margin:0 0 14px">Message: ${escHtml(input.message || "Emergency SOS")}</p>
       ${locationBlock}
       <p style="margin:0">${contactLine}.</p>`
    : `<p style="margin:0 0 14px">Hello ${escHtml(input.recipientName || "there")},</p>
       <p style="margin:0 0 14px">You are listed as the emergency contact for <strong>${escHtml(who)}</strong> on Nabri, and they have just triggered an SOS alert.${input.userPhone ? ` You can call them on <strong>${escHtml(input.userPhone)}</strong>.` : ""}</p>
       <p style="margin:0 0 14px">Their message: ${escHtml(input.message || "Emergency SOS")}</p>
       ${locationBlock}
       <p style="margin:0">If you are able to help, please reach them or the authorities first. Nabri's safety team has already been alerted by email.</p>`;

  return sendEmail(
    to,
    `SOS: ${who} needs emergency help`,
    renderEmail({
      supportEmail: env.SUPPORT_EMAIL,
      title: isAdmin ? "SOS alert raised" : "Emergency SOS — action may be needed",
      kicker: "Safety alert",
      bodyHtml,
      ctaText: isAdmin ? "Open SOS queue" : "Open live location",
      ctaUrl: isAdmin ? dashboardLink : mapsLink || dashboardLink,
      note: isAdmin
        ? "This alert was generated automatically. Reply to this email if you need to coordinate."
        : "You are receiving this because you are the registered emergency contact on Nabri.",
    }),
    isAdmin
      ? `SOS triggered by ${who}. Phone: ${input.userPhone || "not provided"}. Message: ${input.message || "Emergency SOS"}.${mapsLink ? ` Location: ${mapsLink}` : ""}`
      : `${who} (Nabri member) triggered an SOS alert.${input.userPhone ? ` Call: ${input.userPhone}.` : ""}${mapsLink ? ` Location: ${mapsLink}` : ""}`
  );
}

export async function sendKycEmail(email: string, name: string, approved: boolean, rejectionReason?: string): Promise<EmailResult> {
  const subject = approved ? "KYC verification approved" : "KYC verification needs attention";
  const bodyHtml = approved
    ? `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Good news — your identity check was <strong>approved</strong>. You now have full access to bookings, events and partner services.</p><p style="margin:0">Keep your documents up to date in case we ever need to re-verify you.</p>`
    : `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Unfortunately your identity check was <strong>not approved</strong>${rejectionReason ? `: ${escHtml(rejectionReason)}` : "."}</p><p style="margin:0">Please correct the details and resubmit your documents.</p>`;
  return sendEmail(
    email,
    subject,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: approved ? "You're verified!" : "KYC update",
      kicker: approved ? "Verified" : "Action needed",
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
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Your booking is confirmed and paid. Here&rsquo;s your invoice:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · INVOICE ${invoiceNo}</td></tr>${rowsHtml}</table>`;
  return sendEmail(
    email,
    `Booking confirmed · Invoice ${invoiceNo}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Booking confirmed · ${amountStr}`,
      kicker: "Payment receipt",
      bodyHtml,
      ctaText: "View booking",
      ctaUrl: `${WEB_ORIGIN}/bookings`,
      note: "Keep this email as your payment receipt. You can also view it anytime in the Nabri app.",
    }),
    `Hi ${name}, your booking is confirmed. Amount paid: ${amountStr}. Booking ref: ${invoiceNo}.`
  );
}

export interface CompletedBookingEmailData {
  bookingId: string;
  serviceType: string;
  scheduledAt: Date;
  completedAt: Date;
  startLocation: string;
  endLocation: string;
  finalAmount: number;
  platformFee: number;
  partnerEarning: number;
  paymentMethod: string;
  paymentReference?: string;
  durationMinutes: number;
}

function rupee(n: number): string {
  return `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function serviceLabel(s: string): string {
  return (s || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Booking-completion email to the CUSTOMER: final invoice + rating prompt. */
export async function sendBookingCompletedEmail(email: string, name: string, d: CompletedBookingEmailData): Promise<EmailResult> {
  const invoiceNo = d.bookingId.slice(0, 8).toUpperCase();
  const days = Math.max(1, Math.round((d.completedAt.getTime() - d.scheduledAt.getTime()) / 86400000) + 1);
  const scheduled = new Date(d.scheduledAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const doneAt = new Date(d.completedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
  const rows: Array<[string, string]> = [
    ["Service", serviceLabel(d.serviceType)],
    ["Booked for", scheduled],
    ["Completed", doneAt],
    ["Pickup", d.startLocation],
    ["Drop-off", d.endLocation],
    ["Duration", d.durationMinutes ? `${d.durationMinutes} min` : "—"],
    ["Payment", (d.paymentMethod || "ONLINE").toLowerCase().replace(/_/g, " ")],
    ["Final amount", rupee(d.finalAmount)],
  ];
  if (d.paymentReference) rows.push(["Reference", d.paymentReference]);
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(String(v))}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Your Nabri booking is <strong>complete</strong>. Here's your final invoice:</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · COMPLETED · ${invoiceNo}</td></tr>${rowsHtml}</table><p style="margin:0 0 14px">How was your experience? A short rating helps the partner and keeps the community honest.</p>`;
  return sendEmail(
    email,
    `Booking completed · Final invoice ${invoiceNo}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Booking completed · ${rupee(d.finalAmount)}`,
      kicker: "Invoice · completed",
      bodyHtml,
      ctaText: "Rate your partner",
      ctaUrl: `${WEB_ORIGIN}/bookings/${d.bookingId}/rate`,
      note: "Need help? Reply to this email and we'll get back to you — usually within a few hours.",
    }),
    `Hi ${name}, your booking is complete. Final amount ${rupee(d.finalAmount)}. Ref ${invoiceNo}.`
  );
}

/** Earnings receipt email to the PARTNER after a completed booking. */
export async function sendPartnerEarningsEmail(email: string, name: string, d: CompletedBookingEmailData & { walletBalance: number }): Promise<EmailResult> {
  const invoiceNo = d.bookingId.slice(0, 8).toUpperCase();
  const rows: Array<[string, string]> = [
    ["Service", serviceLabel(d.serviceType)],
    ["Completed", new Date(d.completedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" })],
    ["Customer fare", rupee(d.finalAmount)],
    ["Platform fee", `−${rupee(d.platformFee)}`],
    ["You earned", rupee(d.partnerEarning)],
    ["Wallet balance", rupee(d.walletBalance)],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(v)}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Nice work — you've completed booking ${invoiceNo} and earned <strong>${rupee(d.partnerEarning)}</strong>, now in your Nabri wallet.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · EARNINGS · ${invoiceNo}</td></tr>${rowsHtml}</table><p style="margin:0">Withdraw anytime from your partner wallet.</p>`;
  return sendEmail(
    email,
    `You earned ${rupee(d.partnerEarning)} · Booking ${invoiceNo} completed`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `You earned ${rupee(d.partnerEarning)}`,
      kicker: "Earnings · completed",
      bodyHtml,
      ctaText: "View partner wallet",
      ctaUrl: `${WEB_ORIGIN}/partner/wallet`,
      note: "Need help? Reply to this email and we'll get back to you.",
    }),
    `Hi ${name}, you earned ${rupee(d.partnerEarning)} for booking ${invoiceNo}. Wallet balance: ${rupee(d.walletBalance)}.`
  );
}

export interface WithdrawalEmailData {
  withdrawalId: string;
  amount: number;
  method: string;
  status: string;
  createdAt?: Date;
  processedAt?: Date;
  rejectionReason?: string;
  walletBalance?: number;
}

function withdrawalMethodLabel(method: string): string {
  return method === "UPI" ? "UPI" : "bank account";
}

/** Withdrawal request submitted — confirms the hold and shows the processing timeline. */
export async function sendWithdrawalRequestedEmail(email: string, name: string, d: WithdrawalEmailData): Promise<EmailResult> {
  const requested = d.createdAt ? new Date(d.createdAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }) : "";
  const rows: Array<[string, string]> = [
    ["Withdrawal ID", d.withdrawalId.slice(0, 8).toUpperCase()],
    ["Amount", rupee(d.amount)],
    ["Method", withdrawalMethodLabel(d.method)],
    ["Requested", requested],
    ["Status", "Under review"],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(String(v))}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">We received your withdrawal request of <strong>${rupee(d.amount)}</strong> and the amount has been set aside in your wallet. An admin will review it shortly.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · WITHDRAWAL REQUESTED</td></tr>${rowsHtml}</table><p style="margin:0 0 14px">We'll email you the moment your payment is completed. You can also check the status anytime in your wallet.</p>`;
  return sendEmail(
    email,
    `Withdrawal requested · ${rupee(d.amount)}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Withdrawal of ${rupee(d.amount)} requested`,
      kicker: "Wallet withdrawal",
      bodyHtml,
      ctaText: "View wallet",
      ctaUrl: `${WEB_ORIGIN}/wallet`,
      note: "Keep this email as confirmation that your withdrawal request was received.",
    }),
    `Hi ${name}, your withdrawal request of ${rupee(d.amount)} was received and is under review.`
  );
}

/** Withdrawal payment completed — the money is on its way to the partner. */
export async function sendWithdrawalPaidEmail(email: string, name: string, d: WithdrawalEmailData): Promise<EmailResult> {
  const processed = d.processedAt ? new Date(d.processedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }) : "just now";
  const rows: Array<[string, string]> = [
    ["Withdrawal ID", d.withdrawalId.slice(0, 8).toUpperCase()],
    ["Amount paid", rupee(d.amount)],
    ["Method", withdrawalMethodLabel(d.method)],
    ["Paid on", processed],
    ["Wallet balance", d.walletBalance !== undefined ? rupee(d.walletBalance) : "—"],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(String(v))}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Great news — your withdrawal of <strong>${rupee(d.amount)}</strong> has been <strong>paid out</strong> to your ${escHtml(withdrawalMethodLabel(d.method))}.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · WITHDRAWAL PAID</td></tr>${rowsHtml}</table><p style="margin:0 0 14px">Depending on your bank or UPI provider, the funds may take a few hours to appear in your account.</p>`;
  return sendEmail(
    email,
    `Withdrawal paid · ${rupee(d.amount)}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Your ${rupee(d.amount)} withdrawal is paid`,
      kicker: "Withdrawal completed",
      bodyHtml,
      ctaText: "View wallet",
      ctaUrl: `${WEB_ORIGIN}/wallet`,
      note: "Need help? Reply to this email and we'll get back to you.",
    }),
    `Hi ${name}, your withdrawal of ${rupee(d.amount)} has been paid to your ${withdrawalMethodLabel(d.method)}.`
  );
}

/** Withdrawal rejected — the held amount is returned to the wallet. */
export async function sendWithdrawalRejectedEmail(email: string, name: string, d: WithdrawalEmailData): Promise<EmailResult> {
  const processed = d.processedAt ? new Date(d.processedAt).toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }) : "";
  const rows: Array<[string, string]> = [
    ["Withdrawal ID", d.withdrawalId.slice(0, 8).toUpperCase()],
    ["Amount returned", rupee(d.amount)],
    ["Wallet balance", d.walletBalance !== undefined ? rupee(d.walletBalance) : "—"],
    ["Processed", processed || "—"],
  ];
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#6B6558">${escHtml(k)}</td><td style="padding:10px 14px;border-top:1px solid #EFE8DC;font-size:13px;color:#1C1917;font-weight:600;text-align:right">${escHtml(String(v))}</td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 14px">Hi ${escHtml(name)},</p><p style="margin:0 0 14px">Your withdrawal request of <strong>${rupee(d.amount)}</strong> could not be completed${d.rejectionReason ? `: <em>${escHtml(d.rejectionReason)}</em>` : "."}</p><p style="margin:0 0 14px">The amount has been <strong>returned to your Nabri wallet</strong> and is available to use.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #EFE8DC;border-radius:14px;overflow:hidden;margin:0 0 20px"><tr><td style="background:#FBF7EF;padding:12px 14px;font-size:12px;color:#0D378B;font-weight:800;letter-spacing:1px">NABRI · WITHDRAWAL RETURNED</td></tr>${rowsHtml}</table><p style="margin:0">Please update your payment details and try again, or contact support if you think this was a mistake.</p>`;
  return sendEmail(
    email,
    `Withdrawal returned · ${rupee(d.amount)}`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: `Withdrawal request returned`,
      kicker: "Wallet withdrawal",
      bodyHtml,
      ctaText: "View wallet",
      ctaUrl: `${WEB_ORIGIN}/wallet`,
      note: "Your funds are safe — the amount was credited back to your wallet.",
    }),
    `Hi ${name}, your withdrawal of ${rupee(d.amount)} was not completed and the amount has been returned to your wallet.`
  );
}

/** Re-engagement ("we miss you") email for users inactive for 7+ days. */
export async function sendReengagementEmail(email: string, name: string, daysInactive = 7): Promise<EmailResult> {
  const displayName = name && name !== email ? name : "there";
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const perks: Array<[string, string, string]> = [
    ["🚀", "Back to it in seconds", "Log back in — your profile, bookings and communities are exactly where you left them."],
    ["🤝", "Fresh things around you", "New people, new walks, new help requests and events are happening near you right now."],
    ["💰", "Balances still safe", "Any wallet balance you have is secure and ready whenever you are."],
    ["💬", "Messages waiting", "Missed chats and requests? Catch up on everything in one tap."],
  ];
  const perkRows = perks
    .map(
      ([emoji, head, desc]) =>
        `<tr><td style="vertical-align:top;padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:34px;vertical-align:top"><div style="width:28px;height:28px;border-radius:9px;background:#FBF7EF;border:1px solid #EFE4D4;text-align:center;line-height:26px;font-size:14px">${emoji}</div></td><td style="padding:2px 0 0 10px;font-size:13.5px;line-height:1.5;color:#4B453D"><strong style="color:#1C1917">${escHtml(head)}</strong> ${escHtml(desc)}</td></tr></table></td></tr>`
    )
    .join("");
  const bodyHtml = `<p style="margin:0 0 12px">Hi <strong style="color:#1C1917">${escHtml(firstName)}</strong>,</p>
<p style="margin:0 0 14px">It&rsquo;s been a little while since you&rsquo;ve been on Nabri — <strong>${escHtml(String(daysInactive))} days</strong> to be exact. We wanted to check in, because there might be good stuff waiting for you.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px">${perkRows}</table>
<p style="margin:0 0 14px">Whenever you're ready, jump back in. It takes seconds and it&rsquo;s all still here.</p>
<p style="margin:0 0 18px;font-style:italic;color:#4B453D">See you soon — Team Nabri 💙</p>`;
  return sendEmail(
    email,
    `We miss you, ${firstName}! 👋`,
    renderEmail({ supportEmail: env.SUPPORT_EMAIL,
      title: "We miss you on Nabri",
      kicker: "Quick hello",
      bodyHtml,
      ctaText: "Back to Nabri",
      ctaUrl: WEB_ORIGIN,
      note: `You're receiving this because you have a Nabri account and haven't been active in ${daysInactive}+ days. Unsubscribe anytime by contacting ${env.SUPPORT_EMAIL}.`,
    }),
    `Hi ${firstName}, it's been ${daysInactive} days since you used Nabri. Come back and see what's new! Support: ${env.SUPPORT_EMAIL}`
  );
}

/**
 * Re-engagement sweep — finds verified, ACTIVE users who haven't been active
 * in 7+ days and sends one "we miss you" email, tracked in MarketingEmailLog so
 * nobody gets it twice. Batch-limited; never throws; purely fire-and-forget.
 */
export async function runReengagementSweep(batchSize = 200): Promise<{ scanned: number; sent: number; skipped: number }> {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const users = await prisma.user.findMany({
      where: {
        emailVerified: true,
        status: "ACTIVE",
        role: { notIn: ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"] },
        OR: [{ lastLoginAt: { lt: cutoff } }, { lastLoginAt: null }],
      },
      select: { id: true, email: true, fullName: true, lastLoginAt: true },
      take: batchSize,
      orderBy: { updatedAt: "desc" },
    });

    let sent = 0;
    let skipped = 0;
    for (const u of users) {
      const already = await prisma.marketingEmailLog
        .findUnique({ where: { campaign_userId: { campaign: "REENGAGEMENT_7D", userId: u.id } } })
        .catch(() => null);
      if (already) {
        skipped += 1;
        continue;
      }
      const last = u.lastLoginAt?.getTime() ?? Date.now() - 7 * 86400000;
      const days = Math.max(7, Math.round((Date.now() - last) / 86400000));
      const result = await sendReengagementEmail(u.email, u.fullName || u.email, days);
      if (result.ok) {
        await prisma.marketingEmailLog
          .create({ data: { campaign: "REENGAGEMENT_7D", userId: u.id, email: u.email, sentAt: new Date() } })
          .catch(() => undefined);
        sent += 1;
      } else {
        skipped += 1;
      }
    }
    console.log(`[EMAIL] Re-engagement sweep: ${users.length} scanned, ${sent} sent, ${skipped} skipped.`);
    return { scanned: users.length, sent, skipped };
  } catch (err) {
    console.error("[EMAIL] Re-engagement sweep failed:", err);
    return { scanned: 0, sent: 0, skipped: 0 };
  }
}

/** One call for both completion emails, built from REAL post-settlement DB data
 * (the Booking row is updated by finalizeBookingPrice with the verified final
 * amount, platform fee and partner earning before this runs). Fire-and-forget:
 * never blocks or fails the completion path.
 */
export async function sendBookingCompletionEmails(bookingId: string): Promise<{ userEmail: boolean; partnerEmail: boolean }> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, userId: true, partnerId: true, serviceType: true, scheduledAt: true, completedAt: true,
        startLocation: true, endLocation: true, finalAmount: true, estimatedAmount: true,
        platformFee: true, partnerEarning: true, paymentMethod: true, razorpayPaymentId: true, durationMinutes: true,
      },
    });
    if (!booking) return { userEmail: false, partnerEmail: false };
    const d: CompletedBookingEmailData = {
      bookingId: booking.id,
      serviceType: booking.serviceType,
      scheduledAt: booking.scheduledAt,
      completedAt: booking.completedAt || new Date(),
      startLocation: booking.startLocation,
      endLocation: booking.endLocation,
      finalAmount: booking.finalAmount ?? booking.estimatedAmount ?? 0,
      platformFee: booking.platformFee ?? 0,
      partnerEarning: booking.partnerEarning ?? 0,
      paymentMethod: booking.paymentMethod || "ONLINE",
      paymentReference: booking.razorpayPaymentId || undefined,
      durationMinutes: booking.durationMinutes || 0,
    };
    const customer = await prisma.user.findUnique({
      where: { id: booking.userId },
      select: { email: true, fullName: true },
    });
    const userEmail = customer
      ? (await sendBookingCompletedEmail(customer.email, customer.fullName || "there", d)).ok
      : false;
    let partnerEmail = false;
    if (booking.partnerId) {
      const partner = await prisma.partner.findUnique({
        where: { id: booking.partnerId },
        select: { userId: true },
      });
      if (partner) {
        const [partnerUser, wallet] = await Promise.all([
          prisma.user.findUnique({ where: { id: partner.userId }, select: { email: true, fullName: true } }),
          prisma.wallet.findUnique({ where: { userId: partner.userId }, select: { balance: true } }),
        ]);
        if (partnerUser) {
          partnerEmail = (await sendPartnerEarningsEmail(partnerUser.email, partnerUser.fullName || "there", {
            ...d,
            walletBalance: wallet ? Number(wallet.balance) : 0,
          })).ok;
        }
      }
    }
    return { userEmail, partnerEmail };
  } catch (err) {
    console.error("[EMAIL] Booking completion emails failed:", err);
    return { userEmail: false, partnerEmail: false };
  }
}

import { createTransport } from "nodemailer";
import { env } from "../config/env";
import { renderEmail, escHtml, WEB_ORIGIN } from "./emailTemplate";

export type EmailProviderName = "none" | "smtp" | "resend";

export function emailProvider(): EmailProviderName {
  const p = (env.EMAIL_PROVIDER || "none").toLowerCase();
  if (p === "smtp" && env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return "smtp";
  if (p === "resend" && env.RESEND_API_KEY) return "resend";
  // Explicit smtp request without credentials, or unknown name, degrades
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
  if (provider === "smtp") return { provider, configured: true, requiredEnv: [], from: env.EMAIL_FROM };
  if (provider === "resend")
    return { provider, configured: true, requiredEnv: [], from: env.EMAIL_FROM };
  const want = (env.EMAIL_PROVIDER || "none").toLowerCase();
  return {
    provider: "none",
    configured: false,
    requiredEnv:
      want === "resend"
        ? ["RESEND_API_KEY", "EMAIL_FROM"]
        : ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"],
    from: env.EMAIL_FROM,
  };
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

async function sendViaResend(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; messageId?: string; error?: string }> {
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
  if (provider === "resend") {
    const r = await sendViaResend(to, subject, html, plain);
    if (!r.ok) console.error("[EMAIL] Resend failed:", r.error);
    return { ok: r.ok, provider, messageId: r.messageId, error: r.error };
  }
  const tx = getTransporter();
  if (!tx) return { ok: false, provider: "none", error: "EMAIL_NOT_CONFIGURED" };
  try {
    const info: any = await tx.sendMail({ from: env.EMAIL_FROM, to, subject, html, text: plain });
    return { ok: true, provider, messageId: info?.messageId };
  } catch (err: any) {
    console.error("[EMAIL] SMTP failed:", err?.message);
    return { ok: false, provider, error: "EMAIL_DELIVERY_FAILED" };
  }
}

export async function sendOTPEmail(email: string, otp: string, purpose = "verification"): Promise<EmailResult> {
  const subject = `Your Nabri ${purpose} code`;
  const bodyHtml = `<div style="background:#FBF7EF;border:1px solid #EFE4D4;border-radius:16px;padding:22px 16px;text-align:center;margin:8px 0 18px"><div style="font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:900;letter-spacing:10px;color:#1C1917;padding-left:10px;margin:0">${escHtml(otp)}</div></div><p style="margin:0 0 12px;font-size:14px;color:#6B6558">Use this code to complete the <strong style="color:#1C1917">${escHtml(purpose)}</strong> step for your Nabri account. It expires in ${env.OTP_EXPIRY_MINUTES} minutes.</p><p style="margin:0;font-size:12px;color:#9A9184">If you didn't request this code, you can safely ignore this email.</p>`;
  return sendEmail(
    email,
    subject,
    renderEmail({
      title: `Your Nabri ${purpose} code`,
      bodyHtml,
      note: `This code expires in ${env.OTP_EXPIRY_MINUTES} minutes. Never share it with anyone, including Nabri support.`,
    }),
    `Your ${purpose} code is ${otp}. Expires in ${env.OTP_EXPIRY_MINUTES} minutes.`
  );
}

export async function sendWelcomeEmail(email: string, name: string): Promise<EmailResult> {
  return sendEmail(
    email,
    "Welcome to Nabri",
    renderEmail({
      title: `Welcome, ${escHtml(name)}!`,
      bodyHtml: `<p style="margin:0 0 14px">Your account is ready. Find trusted partners nearby, join local events, book homes and get quick help — all in one place.</p><p style="margin:0">Finish your profile and start exploring your city.</p>`,
      ctaText: "Explore Nabri",
      ctaUrl: WEB_ORIGIN,
      note: "You created this account on Nabri. If it wasn't you, please contact support immediately.",
    }),
    `Welcome to Nabri, ${name}! Your account is ready.`
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

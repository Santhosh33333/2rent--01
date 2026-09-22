import { createTransport } from "nodemailer";
import { env } from "../config/env";

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
  return `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h2 style="color:#4f46e5">Side Bud</h2><h3>${title}</h3>${body}<hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/><p style="color:#9ca3af;font-size:12px">Side Bud · Your Partner for Every Side of Life.</p></div>`;
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
  const subject = `Your Side Bud ${purpose} code`;
  const html = wrapHtml(
    `Your ${purpose} code is:`,
    `<div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#111;background:#f3f4f6;padding:16px;border-radius:8px;text-align:center">${otp}</div><p style="color:#6b7280;font-size:14px">This code expires in ${env.OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.</p><p style="color:#9ca3af;font-size:12px">If you didn't request this, please ignore this email.</p>`
  );
  return sendEmail(email, subject, html, `Your ${purpose} code is ${otp}. Expires in ${env.OTP_EXPIRY_MINUTES} minutes.`);
}

export async function sendWelcomeEmail(email: string, name: string): Promise<EmailResult> {
  return sendEmail(
    email,
    "Welcome to Side Bud",
    wrapHtml(`Welcome, ${name}!`, `<p>Your account is ready. Find partners, join events, and explore your city.</p>`),
    `Welcome to Side Bud, ${name}! Your account is ready.`
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

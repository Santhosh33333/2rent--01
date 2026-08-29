import { createTransport } from "nodemailer";
import { env } from "../config/env";

let transporter: ReturnType<typeof createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    console.warn("[EMAIL] SMTP not configured — emails will be logged only");
    return null;
  }

  transporter = createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });

  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
  const tx = getTransporter();
  if (!tx) {
    console.log(`[EMAIL] (dev) To: ${to} | Subject: ${subject}`);
    console.log(text || html);
    return true;
  }

  try {
    await tx.sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ""),
    });
    return true;
  } catch (err) {
    console.error("[EMAIL] Failed to send:", err);
    return false;
  }
}

export async function sendOTPEmail(email: string, otp: string, purpose = "verification"): Promise<boolean> {
  const subject = `Your RentBuddy ${purpose} code`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <h2 style="color:#10b981">RentBuddy</h2>
      <p>Your ${purpose} code is:</p>
      <div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#111;background:#f3f4f6;padding:16px;border-radius:8px;text-align:center">${otp}</div>
      <p style="color:#6b7280;font-size:14px">This code expires in ${env.OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.</p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
      <p style="color:#9ca3af;font-size:12px">If you didn't request this, please ignore this email.</p>
    </div>
  `;
  return sendEmail(email, subject, html, `Your ${purpose} code is ${otp}. Expires in ${env.OTP_EXPIRY_MINUTES} minutes.`);
}
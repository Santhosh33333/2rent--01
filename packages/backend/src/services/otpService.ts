import crypto from "crypto";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { sendOTPEmail, emailStatus } from "./emailService";
import { sendSmsMessage, smsStatus, smsProviderName } from "./smsService";

export const OTP_PURPOSES = [
  "SIGNUP",
  "LOGIN",
  "EMAIL_VERIFICATION",
  "PHONE_VERIFICATION",
  "PASSWORD_RESET",
  "CHANGE_PHONE",
  "CHANGE_EMAIL",
  "PARTNER_VERIFICATION",
  "SENSITIVE_ACTION",
] as const;

export type OtpPurpose = (typeof OTP_PURPOSES)[number];
export type OtpChannel = "EMAIL" | "SMS";

export function normalizeIdentifier(channel: OtpChannel, raw: string): string {
  const v = String(raw || "").trim();
  return channel === "EMAIL" ? v.toLowerCase() : v.replace(/[^\d+]/g, "");
}

export function maskIdentifier(channel: OtpChannel, identifier: string): string {
  if (channel === "EMAIL") {
    const [local, domain] = identifier.split("@");
    if (!domain) return "***";
    const head = (local || "").slice(0, 2);
    return `${head}***@${domain}`;
  }
  const digits = identifier.replace(/\D/g, "");
  return `******${digits.slice(-4)}`;
}

function randomCode(): string {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += String(bytes[i] % 10);
  return code;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

async function getLimit(key: string, fallback: number): Promise<number> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { key: `otp.${key}` } });
    if (row) {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch {
    // settings table unreadable — fall back to env
  }
  return fallback;
}

export interface OtpPolicy {
  expiryMinutes: number;
  maxAttempts: number;
  resendSeconds: number;
  maxPer15Min: number;
  maxPerHour: number;
  maxPerIpHour: number;
}

export async function otpPolicy(): Promise<OtpPolicy> {
  const [expiryMinutes, maxAttempts, resendSeconds, maxPer15Min, maxPerHour, maxPerIpHour] = await Promise.all([
    getLimit("expiry_minutes", env.OTP_EXPIRY_MINUTES),
    getLimit("max_attempts", env.OTP_MAX_ATTEMPTS),
    getLimit("resend_seconds", env.OTP_RESEND_SECONDS),
    getLimit("max_per_15min", env.OTP_MAX_PER_15MIN),
    getLimit("max_per_hour", env.OTP_MAX_PER_HOUR),
    getLimit("max_per_ip_hour", env.OTP_MAX_PER_IP_HOUR),
  ]);
  return { expiryMinutes, maxAttempts, resendSeconds, maxPer15Min, maxPerHour, maxPerIpHour };
}

export interface IssueResult {
  sent: boolean;
  maskedTo: string;
  channel: OtpChannel;
  purpose: string;
  expiresInSec: number;
  resendInSec: number;
  provider: string;
  messageId?: string;
  error?: string;
  code?: string;
}

/**
 * Issue an OTP: enforces resend cooldown + per-contact/hour + per-IP/hour
 * caps, stores only the SHA-256 hash, sends via the real provider, and
 * reports honestly whether the provider accepted the message.
 */
export async function issueOtp(opts: {
  channel: OtpChannel;
  identifier: string;
  purpose: OtpPurpose;
  userId?: string;
  ip?: string;
  userAgent?: string;
}): Promise<IssueResult> {
  const identifier = normalizeIdentifier(opts.channel, opts.identifier);
  if (!identifier || (opts.channel === "EMAIL" && !identifier.includes("@"))) {
    return fail(opts, "Enter a valid email address or phone number.");
  }
  const policy = await otpPolicy();
  const now = new Date();

  // Resend cooldown: latest live code for this identifier+purpose.
  const latest = await prisma.otpCode.findFirst({
    where: { identifier, purpose: opts.purpose, status: { in: ["CREATED", "SENDING", "SENT", "DELIVERED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (latest) {
    const ageSec = Math.floor((now.getTime() - latest.createdAt.getTime()) / 1000);
    if (ageSec < policy.resendSeconds) {
      return {
        sent: false,
        maskedTo: maskIdentifier(opts.channel, identifier),
        channel: opts.channel,
        purpose: opts.purpose,
        expiresInSec: Math.max(0, Math.floor((latest.expiresAt.getTime() - now.getTime()) / 1000)),
        resendInSec: policy.resendSeconds - ageSec,
        provider: latest.provider || "none",
        error: `Resend available in ${policy.resendSeconds - ageSec}s.`,
      };
    }
    // Supersede the older code so only the newest can verify.
    await prisma.otpCode.updateMany({
      where: { identifier, purpose: opts.purpose, status: { in: ["CREATED", "SENDING", "SENT", "DELIVERED"] } },
      data: { status: "CANCELLED" },
    });
  }

  // Rate caps.
  const since15 = new Date(now.getTime() - 15 * 60000);
  const sinceHour = new Date(now.getTime() - 3600000);
  const [n15, nHour, nIp] = await Promise.all([
    prisma.otpCode.count({ where: { identifier, createdAt: { gte: since15 } } }),
    prisma.otpCode.count({ where: { identifier, createdAt: { gte: sinceHour } } }),
    opts.ip
      ? prisma.otpCode.count({ where: { requestIp: opts.ip, createdAt: { gte: sinceHour } } })
      : Promise.resolve(0),
  ]);
  if (n15 >= policy.maxPer15Min || nHour >= policy.maxPerHour) {
    return fail(opts, "Too many codes requested. Wait a while and try again.", "OTP_RATE_LIMITED");
  }
  if (nIp >= policy.maxPerIpHour) {
    return fail(opts, "Too many requests from this network. Try again later.", "OTP_RATE_LIMITED");
  }

  const code = randomCode();
  const expiresAt = new Date(now.getTime() + policy.expiryMinutes * 60000);
  const row = await prisma.otpCode.create({
    data: {
      userId: opts.userId,
      identifier,
      channel: opts.channel,
      purpose: opts.purpose,
      codeHash: hashCode(code),
      expiresAt,
      maxAttempts: policy.maxAttempts,
      status: "SENDING",
      requestIp: opts.ip,
      userAgent: opts.userAgent?.slice(0, 300),
    },
  });

  // Deliver via the real provider. Nothing is reported as sent unless the
  // provider accepts it.
  if (opts.channel === "EMAIL") {
    const st = emailStatus();
    if (!st.configured) {
      await prisma.otpCode.update({ where: { id: row.id }, data: { status: "FAILED", provider: "none", failureReason: "EMAIL_NOT_CONFIGURED" } });
      return fail(opts, "Email sending is not configured yet. Contact support or try another method.", "EMAIL_NOT_CONFIGURED", { provider: "none" });
    }
    const label = opts.purpose.toLowerCase().replace(/_/g, " ");
    const r = await sendOTPEmail(identifier, code, label);
    await prisma.otpCode.update({
      where: { id: row.id },
      data: {
        status: r.ok ? "SENT" : "FAILED",
        provider: r.provider,
        providerMessageId: r.messageId,
        deliveryStatus: r.ok ? "SENT" : undefined,
        failureReason: r.ok ? undefined : r.error,
      },
    });
    if (!r.ok) return fail(opts, "Email could not be sent. Try again or use another method.", r.error || "EMAIL_DELIVERY_FAILED", { provider: r.provider });
    return {
      sent: true,
      maskedTo: maskIdentifier(opts.channel, identifier),
      channel: opts.channel,
      purpose: opts.purpose,
      expiresInSec: policy.expiryMinutes * 60,
      resendInSec: policy.resendSeconds,
      provider: r.provider,
      messageId: r.messageId,
    };
  }

  // SMS channel.
  const sms = smsStatus();
  if (!sms.configured) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { status: "FAILED", provider: "none", failureReason: "SMS_NOT_CONFIGURED" } });
    return fail(opts, "SMS is not configured yet. Use email code instead.", "SMS_NOT_CONFIGURED", { provider: "none" });
  }
  const smsProvider = smsProviderName();
  try {
    await sendSmsMessage(identifier, `Your Nabri ${opts.purpose.toLowerCase().replace(/_/g, " ")} code is: ${code}. Expires in ${policy.expiryMinutes} min. Do not share it.`);
    await prisma.otpCode.update({ where: { id: row.id }, data: { status: "SENT", provider: smsProvider, deliveryStatus: "SENT" } });
    return {
      sent: true,
      maskedTo: maskIdentifier(opts.channel, identifier),
      channel: opts.channel,
      purpose: opts.purpose,
      expiresInSec: policy.expiryMinutes * 60,
      resendInSec: policy.resendSeconds,
      provider: smsProvider,
    };
  } catch (err: any) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { status: "FAILED", provider: smsProvider, failureReason: err?.message?.slice(0, 300) } });
    return fail(opts, "SMS could not be sent. Try again or use email.", "SMS_DELIVERY_FAILED", { provider: smsProvider });
  }
}

function fail(
  opts: { channel: OtpChannel; purpose: string },
  message: string,
  code = "OTP_REQUEST_FAILED",
  extra: Partial<IssueResult> = {}
): IssueResult {
  return {
    sent: false,
    maskedTo: "",
    channel: opts.channel,
    purpose: opts.purpose,
    expiresInSec: 0,
    resendInSec: 0,
    provider: "none",
    error: message,
    code,
    ...extra,
  } as IssueResult;
}

export interface VerifyResult {
  ok: boolean;
  error?: string;
  attemptsLeft?: number;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a code: purpose-bound (a SIGNUP code never verifies LOGIN),
 * single-use, attempt-limited with LOCKED state, lazy expiry marking.
 */
export async function verifyOtp(opts: {
  channel: OtpChannel;
  identifier: string;
  purpose: OtpPurpose;
  code: string;
}): Promise<VerifyResult> {
  const identifier = normalizeIdentifier(opts.channel, opts.identifier);
  const code = String(opts.code || "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code." };

  const row = await prisma.otpCode.findFirst({
    where: { identifier, purpose: opts.purpose, status: { in: ["SENT", "DELIVERED", "FAILED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { ok: false, error: "No active code for this request. Ask for a new one." };
  if (row.status === "FAILED") return { ok: false, error: "That code was never delivered. Ask for a new one." };
  if (row.attemptCount >= row.maxAttempts) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { status: "LOCKED" } }).catch(() => {});
    return { ok: false, error: "Too many wrong attempts. Ask for a new code." };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { status: "EXPIRED" } }).catch(() => {});
    return { ok: false, error: "That code expired. Ask for a new one." };
  }
  if (!timingSafeEqual(hashCode(code), row.codeHash)) {
    const attempts = row.attemptCount + 1;
    await prisma.otpCode.update({
      where: { id: row.id },
      data: { attemptCount: attempts, status: attempts >= row.maxAttempts ? "LOCKED" : undefined },
    }).catch(() => {});
    return { ok: false, error: "Wrong code. Check and try again.", attemptsLeft: Math.max(0, row.maxAttempts - attempts) };
  }
  await prisma.otpCode.update({
    where: { id: row.id },
    data: { status: "VERIFIED", verifiedAt: new Date(), attemptCount: row.attemptCount + 1 },
  }).catch(() => {});
  return { ok: true };
}

/** Rotate a verified row so it can never verify twice (defense in depth). */
export async function consumeOtp(identifier: string, purpose: OtpPurpose): Promise<void> {
  await prisma.otpCode
    .updateMany({ where: { identifier, purpose, status: "VERIFIED" }, data: { status: "CANCELLED" } })
    .catch(() => {});
}

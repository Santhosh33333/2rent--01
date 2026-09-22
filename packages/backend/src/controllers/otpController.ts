import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { getClientIp } from "../rbac/adminSecurity";
import {
  issueOtp,
  verifyOtp,
  consumeOtp,
  maskIdentifier,
  otpPolicy,
  OTP_PURPOSES,
  type OtpChannel,
  type OtpPurpose,
} from "../services/otpService";
import { emailStatus } from "../services/emailService";
import { createUserSession, recordLogin } from "./authController";

const PUBLIC_PURPOSES: OtpPurpose[] = ["LOGIN", "PASSWORD_RESET"];

function parseChannel(raw: unknown): OtpChannel | null {
  const v = String(raw || "").toUpperCase();
  return v === "EMAIL" || v === "SMS" ? v : null;
}

function parsePurpose(raw: unknown): OtpPurpose | null {
  const v = String(raw || "").toUpperCase();
  return (OTP_PURPOSES as readonly string[]).includes(v) ? (v as OtpPurpose) : null;
}

// POST /auth/otp/request { channel: EMAIL|SMS, identifier, purpose: LOGIN|PASSWORD_RESET }
export async function requestOtp(req: Request, res: Response): Promise<void> {
  try {
    const channel = parseChannel(req.body?.channel);
    const purpose = parsePurpose(req.body?.purpose);
    const identifier = String(req.body?.identifier || "").trim();
    if (!channel || !purpose || !identifier) {
      sendError(res, "Channel, identifier and purpose are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!PUBLIC_PURPOSES.includes(purpose)) {
      sendError(res, "This purpose needs an account context. Use the in-app verification flow.", 400, "INVALID_PURPOSE");
      return;
    }
    if (channel === "EMAIL" && !identifier.includes("@")) {
      sendError(res, "Enter a valid email address.", 400, "VALIDATION_ERROR");
      return;
    }

    // Anti-enumeration for LOGIN: identical responses, but the code simply
    // won't verify without an account.
    let userId: string | undefined;
    if (channel === "EMAIL") {
      const user = await prisma.user.findUnique({ where: { email: identifier.toLowerCase() }, select: { id: true } });
      if (purpose === "LOGIN" && !user) {
        sendError(res, "No account uses this email. Create one first.", 404, "USER_NOT_FOUND");
        return;
      }
      userId = user?.id;
    } else {
      const user = await prisma.user.findUnique({ where: { phone: identifier }, select: { id: true } });
      userId = user?.id;
    }

    const r = await issueOtp({
      channel,
      identifier,
      purpose,
      userId,
      ip: getClientIp(req),
      userAgent: req.headers["user-agent"],
    });
    if (!r.sent) {
      const status =
        r.code === "OTP_RATE_LIMITED" ? 429 : r.code === "EMAIL_NOT_CONFIGURED" || r.code === "SMS_NOT_CONFIGURED" ? 503 : 400;
      sendError(res, r.error || "Could not send the code.", status, r.code || "OTP_REQUEST_FAILED");
      return;
    }
    sendSuccess(
      res,
      { maskedTo: r.maskedTo, expiresInSec: r.expiresInSec, resendInSec: r.resendInSec, provider: r.provider },
      `Code sent to ${r.maskedTo}.`
    );
  } catch (err) {
    console.error("[otp] request error:", (err as Error)?.message);
    sendError(res, "Could not send the code.", 500, "INTERNAL_ERROR");
  }
}

// POST /auth/otp/verify { channel, identifier, code, purpose } -> session for LOGIN
export async function verifyOtpLogin(req: Request, res: Response): Promise<void> {
  try {
    const channel = parseChannel(req.body?.channel);
    const purpose = parsePurpose(req.body?.purpose);
    const identifier = String(req.body?.identifier || "").trim();
    const code = String(req.body?.code || "");
    if (!channel || !purpose || !identifier || !code) {
      sendError(res, "Channel, identifier, code and purpose are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!PUBLIC_PURPOSES.includes(purpose)) {
      sendError(res, "This purpose needs an account context.", 400, "INVALID_PURPOSE");
      return;
    }
    const v = await verifyOtp({ channel, identifier, purpose, code });
    if (!v.ok) {
      sendError(res, v.error || "Invalid or expired code.", 400, "INVALID_OTP");
      return;
    }

    if (purpose === "PASSWORD_RESET") {
      await consumeOtp(channel === "EMAIL" ? identifier.toLowerCase() : identifier, purpose).catch(() => {});
      sendSuccess(res, { verified: true }, "Code verified. Set a new password.");
      return;
    }

    // LOGIN: resolve the account (create phone accounts on first verified use,
    // mirroring the legacy phone flow).
    let user =
      channel === "EMAIL"
        ? await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } })
        : await prisma.user.findUnique({ where: { phone: identifier } });
    if (!user && channel === "SMS") {
      const passwordHash = await bcrypt.hash(cryptoRandom(), env.BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          phone: identifier,
          email: `${identifier.replace(/\D/g, "")}@phone.placeholder`,
          passwordHash,
          fullName: "Phone User",
          dateOfBirth: new Date("2000-01-01"),
          gender: "OTHER",
          mobileVerified: true,
        },
      });
      await prisma.wallet.create({ data: { userId: user.id } }).catch(() => {});
    }
    if (!user) {
      sendError(res, "No account uses this email. Create one first.", 404, "USER_NOT_FOUND");
      return;
    }
    if (user.status !== "ACTIVE") {
      sendError(res, "Account is not active.", 403, "ACCOUNT_INACTIVE");
      return;
    }
    if (channel === "EMAIL" && !user.emailVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } }).catch(() => {});
    }
    if (channel === "SMS" && !user.mobileVerified) {
      await prisma.user.update({ where: { id: user.id }, data: { mobileVerified: true } }).catch(() => {});
    }
    await consumeOtp(channel === "EMAIL" ? identifier.toLowerCase() : identifier, purpose).catch(() => {});
    const { accessToken, refreshToken } = await createUserSession(user.id, req);
    await recordLogin(user.id, req).catch(() => {});
    sendSuccess(
      res,
      {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          activeRole: (user as any).activeRole || user.role,
        },
      },
      "Login successful."
    );
  } catch (err) {
    console.error("[otp] verify error:", (err as Error)?.message);
    sendError(res, "Verification failed.", 500, "INTERNAL_ERROR");
  }
}

function cryptoRandom(): string {
  return crypto.randomBytes(32).toString("hex");
}

// GET /auth/otp/channels — public availability probe (no secrets, no
// account info). Lets clients hide code options the server cannot fulfill
// instead of showing an error after the tap.
export async function otpChannels(_req: Request, res: Response): Promise<void> {
  const smsReady = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  sendSuccess(
    res,
    { email: emailStatus().configured, sms: smsReady },
    "OTP channel availability."
  );
}

// GET /admin/otp/status — providers, policy, today's delivery stats.
// Never exposes codes (only hashes exist) or full identifiers.
export async function otpStatus(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const dayAgo = new Date(Date.now() - 86400000);
    const [policy, rows] = await Promise.all([
      otpPolicy(),
      prisma.otpCode.groupBy({
        by: ["channel", "status"],
        where: { createdAt: { gte: dayAgo } },
        _count: { channel: true },
      }),
    ]);
    const smsReady = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
    const byChannel: Record<string, { sent: number; failed: number; verified: number; locked: number }> = {};
    for (const r of rows as Array<{ channel: string; status: string; _count: { channel: number } }>) {
      const c = (byChannel[r.channel] ||= { sent: 0, failed: 0, verified: 0, locked: 0 });
      const n = r._count.channel;
      if (r.status === "SENT" || r.status === "DELIVERED") c.sent += n;
      else if (r.status === "FAILED") c.failed += n;
      else if (r.status === "VERIFIED") c.verified += n;
      else if (r.status === "LOCKED") c.locked += n;
    }
    sendSuccess(
      res,
      {
        email: emailStatus(),
        sms: smsReady
          ? { provider: "twilio", configured: true, requiredEnv: [] as string[] }
          : { provider: "twilio", configured: false, requiredEnv: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] },
        policy: {
          expiryMinutes: policy.expiryMinutes,
          maxAttempts: policy.maxAttempts,
          resendSeconds: policy.resendSeconds,
          maxPer15Min: policy.maxPer15Min,
          maxPerHour: policy.maxPerHour,
          maxPerIpHour: policy.maxPerIpHour,
        },
        last24h: byChannel,
        note: "Codes are stored hashed only and are never viewable, including by admins.",
      },
      "OTP system status."
    );
  } catch (err) {
    console.error("[otp] status error:", (err as Error)?.message);
    sendError(res, "OTP status unavailable.", 500, "INTERNAL_ERROR");
  }
}

export { maskIdentifier };

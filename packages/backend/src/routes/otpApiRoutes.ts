import { Router, Request, Response } from "express";
import { env } from "../config/env";
import {
  issueOtp,
  verifyOtp,
  consumeOtp,
  maskIdentifier,
  normalizeIdentifier,
  type OtpChannel,
  type OtpType,
  type OtpPurpose,
} from "../services/otpService";
import { sendSuccess, sendError } from "../utils/response";

/**
 * Public, self-contained OTP API — the reference repo (sauravhathi/otp-service)
 * rebuilt on Nabri's stack: Postgres + Prisma (SHA-256 hashed codes, never
 * plaintext), branded Brevo email, MSG91/Twilio SMS, rate limits + resend
 * cooldown + single-use verification from otpService.
 *
 *   POST /api/otp/generate  { channel?, email?, phone?, type?, size?,
 *                             organization?, subject?, purpose? }
 *   POST /api/otp/verify    { email? | phone?, otp, purpose? }
 */
const router = Router();

const SPAM_WORDS: string[] = (env.SPAM_BLOCK_WORDS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (SPAM_WORDS.length === 0) {
  SPAM_WORDS.push("free money", "bitcoin", "casino", "viagra", "reward", "download now", "click here");
}

function blockedBySpam(...fields: unknown[]): boolean {
  for (const f of fields) {
    const t = String(f || "").toLowerCase();
    if (SPAM_WORDS.some((w) => t.includes(w))) return true;
  }
  return false;
}

// POST /api/otp/generate
// Mirrors the reference: type = numeric | alphanumeric | alphabet, with an
// optional organization name + subject for the email. Defaults keep it
// drop-in compatible ({ email, type } alone works). "both" issues one code
// per channel (email + SMS) so either can be verified.
router.post("/generate", async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body || {};
    const channel = String(b.channel || "email").toLowerCase();
    const email = String(b.email || "").trim();
    const phone = String(b.phone || "").trim();
    const type = String(b.type || "numeric").toLowerCase();
    const size = Number.isFinite(Number(b.size)) ? Math.floor(Number(b.size)) : 6;
    const organization = String(b.organization || "Nabri").slice(0, 30);
    const subject = b.subject == null ? undefined : String(b.subject).slice(0, 120);

    if (!["email", "sms", "both"].includes(channel)) {
      sendError(res, "channel must be email, sms or both.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!["numeric", "alphanumeric", "alphabet"].includes(type)) {
      sendError(res, "type must be numeric, alphanumeric or alphabet.", 400, "VALIDATION_ERROR");
      return;
    }
    if (size < 4 || size > 10) {
      sendError(res, "size must be between 4 and 10.", 400, "VALIDATION_ERROR");
      return;
    }

    const wantEmail = channel === "email" || channel === "both";
    const wantSms = channel === "sms" || channel === "both";
    if (wantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendError(res, "A valid email is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (wantSms && !phone.replace(/\D/g, "").length) {
      sendError(res, "A valid phone is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (blockedBySpam(email, subject, organization, b.purpose)) {
      sendError(res, "Request flagged as spam.", 400, "SPAM_BLOCKED");
      return;
    }

    const ip = req.ip;
    const userAgent = req.headers["user-agent"];
    const purpose = String(b.purpose || "verification").slice(0, 40);
    const base = {
      purpose: "GENERIC" as OtpPurpose,
      purposeLabel: purpose,
      type: type as OtpType,
      size,
      ip,
      userAgent,
    };

    const results: Array<{ channel: OtpChannel; sent: boolean; maskedTo: string; provider: string; expiresInSec: number; resendInSec: number; messageId?: string; code?: string; error?: string }> = [];
    if (wantEmail) {
      const r = await issueOtp({
        ...base,
        channel: "EMAIL",
        identifier: email,
        organization,
        subject,
      });
      results.push(r);
    }
    if (wantSms) {
      const r = await issueOtp({
        ...base,
        channel: "SMS",
        identifier: phone,
        organization,
      });
      results.push(r);
    }

    const delivered = results.filter((r) => r.sent);
    if (delivered.length === 0) {
      const first = results[0];
      const status =
        first?.code === "OTP_RATE_LIMITED"
          ? 429
          : first?.code === "EMAIL_NOT_CONFIGURED" || first?.code === "SMS_NOT_CONFIGURED"
            ? 503
            : 400;
      sendError(res, first?.error || "Could not send the code.", status, first?.code || "OTP_REQUEST_FAILED", undefined, {
        channel: first?.channel,
      });
      return;
    }

    const to = delivered.map((r) => r.maskedTo);
    sendSuccess(
      res,
      {
        maskedTo: to,
        channel: delivered.map((r) => r.channel),
        provider: delivered.map((r) => r.provider),
        expiresInSec: delivered[0].expiresInSec,
        resendInSec: delivered[0].resendInSec,
        messageIds: delivered.map((r) => r.messageId).filter(Boolean),
      },
      `OTP is generated and sent to ${to.join(", ")}`
    );
  } catch (err) {
    console.error("[otp-api] generate error:", (err as Error)?.message);
    sendError(res, "Could not send the code.", 500, "INTERNAL_ERROR");
  }
});

// POST /api/otp/verify
// Verifies a GENERIC code by the channel implied by the identifier given.
// Success consumes the code (single use), matching the reference exactly.
router.post("/verify", async (req: Request, res: Response): Promise<void> => {
  try {
    const b = req.body || {};
    const otp = String(b.otp || "");
    const email = String(b.email || "").trim();
    const phone = String(b.phone || "").trim();
    const rawChannel = String(b.channel || "").toUpperCase();

    const channel: OtpChannel | null =
      rawChannel === "EMAIL" ? "EMAIL" : rawChannel === "SMS" ? "SMS" : email ? "EMAIL" : phone ? "SMS" : null;
    if (!channel) {
      sendError(res, "Provide an email or a phone number.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!otp) {
      sendError(res, "The OTP is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const identifier = channel === "EMAIL" ? normalizeIdentifier("EMAIL", email) : normalizeIdentifier("SMS", phone);

    const v = await verifyOtp({ channel, identifier, purpose: "GENERIC", code: otp, allowNonNumeric: true });
    if (!v.ok) {
      sendError(res, v.error || "Invalid or expired code.", 400, "INVALID_OTP", undefined, { attemptsLeft: v.attemptsLeft });
      return;
    }
    await consumeOtp(identifier, "GENERIC").catch(() => {});
    sendSuccess(res, { verified: true, channel, maskedTo: maskIdentifier(channel, identifier) }, "OTP is verified");
  } catch (err) {
    console.error("[otp-api] verify error:", (err as Error)?.message);
    sendError(res, "Verification failed.", 500, "INTERNAL_ERROR");
  }
});

export default router;
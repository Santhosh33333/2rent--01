import crypto from "crypto";
import { sendOTPEmail } from "../services/emailService";

const OTP_LENGTH = 6;

export function generateOTP(length: number = OTP_LENGTH): string {
  const digits = "0123456789";
  let otp = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

export function hashOTP(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export function verifyOTP(otp: string, hash: string): boolean {
  if (!otp || !hash) return false;
  return crypto.timingSafeEqual(Buffer.from(hashOTP(otp)), Buffer.from(hash));
}

export interface OtpChannel {
  email?: string;
  phone?: string;
}

export async function sendOTP(otp: string, channel: OtpChannel): Promise<void> {
  if (channel.email) {
    await sendOTPEmail(channel.email, otp, "verification");
  }
  if (channel.phone) {
    // TODO: integrate SMS provider (Twilio, etc.)
    if (process.env.NODE_ENV !== "production") {
      console.log(`[OTP] SMS not configured — delivery skipped`);
    }
  }
  if (!channel.email && !channel.phone) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[OTP] No delivery channel provided`);
    }
  }
}

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

async function sendSMS(phone: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER");
  }

  const twilio = (await import("twilio")).default;
  const client = twilio(accountSid, authToken);

  await client.messages.create({
    body: message,
    from: fromNumber,
    to: phone,
  });
}

export async function sendOTP(otp: string, channel: OtpChannel): Promise<void> {
  if (channel.email) {
    await sendOTPEmail(channel.email, otp, "verification");
  }
  if (channel.phone) {
    try {
      await sendSMS(channel.phone, `Your RentBuddy verification code is: ${otp}. It expires in 10 minutes. Do not share this code.`);
    } catch (err) {
      console.error(`[OTP] SMS delivery failed for ${channel.phone}:`, err);
      // In dev, log the OTP so developers can test without Twilio
      if (process.env.NODE_ENV !== "production") {
        console.log(`[OTP] Dev fallback — SMS OTP for ${channel.phone}: ${otp}`);
      }
    }
  }
  if (!channel.email && !channel.phone) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[OTP] No delivery channel provided`);
    }
  }
}

// SMS provider abstraction: twilio | msg91 | none.
//
// Keeps OTP / SOS delivery honest just like emailService — nothing is
// reported as sent unless the provider accepts it. MSG91 uses its classic
// send-http endpoint (route 4 / transactional); Twilio uses the npm SDK.

export type SmsProviderName = "twilio" | "msg91" | "none";

const MSG91_SEND_URL = "https://api.msg91.com/api/sendhttp.php";

export function smsProviderName(): SmsProviderName {
  const p = (process.env.SMS_PROVIDER || "none").toLowerCase();
  if (p === "msg91") return process.env.MSG91_AUTH_KEY ? "msg91" : "none";
  if (p === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
    return "twilio";
  return "none";
}

export function smsConfigured(): boolean {
  return smsProviderName() !== "none";
}

export function smsStatus(): { provider: SmsProviderName; configured: boolean; requiredEnv: string[] } {
  if (smsProviderName() !== "none") return { provider: smsProviderName(), configured: true, requiredEnv: [] };
  const want = (process.env.SMS_PROVIDER || "none").toLowerCase();
  return {
    provider: "none",
    configured: false,
    requiredEnv:
      want === "msg91"
        ? ["MSG91_AUTH_KEY"]
        : want === "twilio"
          ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]
          : ["SMS_PROVIDER", "MSG91_AUTH_KEY or TWILIO_ACCOUNT_SID"],
  };
}

/** Normalize an international phone into MSG91's 91XXXXXXXXXX format. */
export function normalizeIndiaPhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

function phoneError(phone: string): string {
  return `SMS provider for ${phone} failed`;
}

async function sendViaMsg91(phone: string, message: string): Promise<void> {
  const authkey = process.env.MSG91_AUTH_KEY;
  if (!authkey) throw new Error("MSG91 not configured — set MSG91_AUTH_KEY");
  const sender = (process.env.MSG91_SENDER_ID || "NABRI").replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
  const params = new URLSearchParams({
    authkey,
    mobiles: normalizeIndiaPhone(phone),
    sender,
    message,
    route: "4",
    country: "91",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${MSG91_SEND_URL}?${params.toString()}`, { method: "POST", signal: ctrl.signal });
    const text = await res.text();
    const trimmed = text.trim();
    // A numeric response is a delivered message id; anything else is an error
    // message (e.g. "message: Could not be delivered.", auth failures, etc.).
    if (!/^\d{6,}$/.test(trimmed)) {
      throw new Error(`MSG91: ${trimmed.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendViaTwilio(phone: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio not configured — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER");
  }
  const twilio = (await import("twilio")).default;
  await twilio(accountSid, authToken).messages.create({ body: message, from: fromNumber, to: phone });
}

/**
 * Send one SMS. Throws when the provider is unconfigured or rejects — callers
 * (OTP issue, SOS fan-out) decide whether that is critical or best-effort.
 */
export async function sendSmsMessage(phone: string, message: string): Promise<void> {
  const provider = smsProviderName();
  if (provider === "msg91") return sendViaMsg91(phone, message);
  if (provider === "twilio") return sendViaTwilio(phone, message);
  throw new Error(phoneError(phone));
}
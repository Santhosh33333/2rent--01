// SMS provider abstraction: twilio | msg91 | brevo | none.
//
// Keeps OTP / SOS delivery honest just like emailService — nothing is
// reported as sent unless the provider accepts it. MSG91 uses its classic
// send-http endpoint (route 4 / transactional); Twilio uses the npm SDK;
// Brevo (the user's own transactional account — same key family as email)
// uses the v3 transactionalSMS endpoint so no separate SMS vendor is needed.

export type SmsProviderName = "twilio" | "msg91" | "brevo" | "none";

const MSG91_SEND_URL = "https://api.msg91.com/api/sendhttp.php";
const BREVO_SMS_URL = "https://api.brevo.com/v3/transactionalSMS/sms";

export function smsProviderName(): SmsProviderName {
  const p = (process.env.SMS_PROVIDER || "none").toLowerCase();
  if (p === "msg91") {
    // msg91 chosen but the auth key was never added → fall back to the
    // account's own Brevo key (same account family as the working email
    // deliverer) so SMS delivery actually works instead of failing forever.
    if (process.env.MSG91_AUTH_KEY) return "msg91";
    if (process.env.BREVO_API_KEY) return "brevo";
    return "none";
  }
  if (p === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER)
    return "twilio";
  if (p === "brevo" && process.env.BREVO_API_KEY) return "brevo";
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
          : want === "brevo"
            ? ["BREVO_API_KEY", "SMS_SENDER_ID"]
            : ["SMS_PROVIDER", "MSG91_AUTH_KEY, TWILIO_ACCOUNT_SID, or BREVO_API_KEY"],
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
  const sender = (process.env.MSG91_SENDER_ID || process.env.SMS_SENDER_ID || "NABRI").replace(/[^A-Za-z0-9]/g, "").slice(0, 6);
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

/** Normalize any phone into E.164 (+country…). Defaults to India (91) for 10-digit numbers. */
function toE164(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return `+${digits}`;
}

async function sendViaBrevo(phone: string, message: string): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("Brevo SMS not configured — set BREVO_API_KEY");
  const sender = (process.env.SMS_SENDER_ID || process.env.MSG91_SENDER_ID || "NABRI").replace(/[^A-Za-z0-9]/g, "").slice(0, 11);
  if (sender.length < 3) throw new Error("SMS sender name must be 3-11 alphanumeric characters");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(BREVO_SMS_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": key,
      },
      body: JSON.stringify({
        type: "transactional",
        unicodeEnabled: true,
        sender,
        recipient: toE164(phone),
        content: message,
      }),
    });
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const code = data?.code || data?.error?.code;
      // 402 == insufficient SMS credits: surface it clearly so the dashboard
      // shows the true blocker instead of a vague delivery failure.
      let msg = data?.message || data?.error?.description || `HTTP ${res.status}`;
      if (Array.isArray(msg)) msg = msg.join(" | ");
      if (res.status === 402 || /credit/i.test(String(msg))) {
        throw new Error(`Brevo SMS: no transaction SMS credits on the Nabri account (${msg}).`);
      }
      throw new Error(`Brevo SMS: ${msg}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one SMS. Throws when the provider is unconfigured or rejects — callers
 * (OTP issue, SOS fan-out) decide whether that is critical or best-effort.
 */
export async function sendSmsMessage(phone: string, message: string): Promise<void> {
  const provider = smsProviderName();
  if (provider === "msg91") return sendViaMsg91(phone, message);
  if (provider === "twilio") return sendViaTwilio(phone, message);
  if (provider === "brevo") return sendViaBrevo(phone, message);
  throw new Error(phoneError(phone));
}
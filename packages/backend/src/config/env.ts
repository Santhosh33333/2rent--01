import { z } from "zod";
import crypto from "crypto";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("4000").transform(Number),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis (Bull queues + rate limiter) — optional in dev
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT — MUST be provided in production. In development a strong random secret is
  // generated at boot so a missing var never falls back to a known/guessable value.
  JWT_SECRET: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  JWT_ACCESS_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),

  // Security
  BCRYPT_SALT_ROUNDS: z.string().default("10").transform(Number),

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Explicit public web origin, used to build post-payment return URLs. Left
  // unset in production it falls back to the deployed origin rather than to the
  // CORS default, so an unset CORS_ORIGIN can never point a paying customer at
  // localhost. See config/publicOrigin.ts.
  PUBLIC_WEB_ORIGIN: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default("900000").transform(Number),
  RATE_LIMIT_MAX: z.string().default("600").transform(Number),
  AUTH_RATE_LIMIT_MAX: z.string().default("50").transform(Number),

  // Uploads
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_FILE_SIZE: z.string().default("5242880").transform(Number),
  // Videos are far bigger than photos; default 25 MB. Both land in the same
  // Postgres blob store — the only durable storage available. No adaptive/
  // CDN pipeline exists, so keep clips short.
  MAX_VIDEO_SIZE: z.string().default("26214400").transform(Number),

  // Admin seeding
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().optional(),

  // Firebase Admin SDK — optional in dev (server uses FIREBASE_SERVICE_ACCOUNT JSON blob at runtime)
  FIREBASE_PROJECT_ID: z.string().default("Sidebud-dev"),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default("dev@dev.com"),

  // Firebase optional extras
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Apple OAuth
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Cashfree - the only payment gateway. Razorpay was removed rather than left
  // as an option, so there is no second code path to drift out of sync and no
  // set of credentials for a gateway that never receives traffic.
  //
  // There is no separate webhook secret. Cashfree signs webhooks with the same
  // PG secret key used for API calls, so an earlier assumption that a distinct
  // CASHFREE_WEBHOOK_SECRET existed would have left setup impossible to
  // complete. If keys have been rotated, signature verification must use the
  // OLDEST active key pair, because that is the one Cashfree signs with.
  CASHFREE_APP_ID: z.string().default("cashfree_app_id_placeholder"),
  CASHFREE_SECRET_KEY: z.string().default("cashfree_secret_placeholder"),
  // "test" routes orders to Cashfree's sandbox, "production" to the live host.
  // Defaults to production, so an unset value cannot silently downgrade or
  // upgrade where real money moves. Test credentials only work on the sandbox
  // host and vice versa, so this must match whichever keys are configured.
  CASHFREE_API_ENV: z.enum(["test", "production"]).default("production"),

  // Payment settings
  PLATFORM_COMMISSION_PERCENT: z.string().default("10").transform(Number),
  MIN_BOOKING_AMOUNT: z.string().default("50").transform(Number),
  MAX_BOOKING_AMOUNT: z.string().default("10000").transform(Number),

  // Days of paid access one settled payment grants. Declared here because the
  // zod object strips unknown keys: reading process.env directly worked only by
  // accident and any value set in the environment was silently ignored, leaving
  // the hardcoded 30 in charge. A string so a typo fails validation instead of
  // coercing to NaN, and clamped so it cannot grant a nonsensical window.
  ACCESS_WINDOW_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .max(3650)
    .default(30),

  // Email (SMTP) — optional in dev, required for real OTP delivery
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default("587").transform(Number),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("Nabri <noreply@nabri.app>"),

  // Email provider abstraction: none | smtp | gmail | brevo | resend. SMTP (Brevo relay)
  // can fail with 525 "Unauthorized IP" because Brevo binds relay to the sender
  // IP — never stable on a cloud host with rotating egress. `brevo` uses the
  // Transactional Email API (api-key auth, IP-independent) and is the reliable
  // choice for production/Render. `gmail` sends via smtp.gmail.com using a
  // Google App Password (GMAIL_APP_PASSWORD) — the sender address must be the
  // Gmail address itself. `none` (default) reports EMAIL_NOT_CONFIGURED.
    EMAIL_PROVIDER: z.string().default("none"),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default("Nabri <noreply@nabri.app>"),
    SUPPORT_EMAIL: z.string().default("nabri.support@gmail.com"),
    BREVO_API_KEY: z.string().optional(),
    // Zoho transactional API, OAuth access token. Use this instead of Zoho SMTP
    // on a cloud host: Zoho's relay refuses any source IP that has not been
    // authorised in the admin console, which fails with "525 5.7.1 Unauthorized
    // IP address" on PaaS egress addresses that are not fixed in advance.
    ZOHO_ACCESS_TOKEN: z.string().optional(),
    ZOHO_API_TOKEN: z.string().optional(),
    // Zoho accounts are region-scoped: zoho.com, zoho.eu, zoho.in, zoho.com.au.
    // Wrong region returns an opaque 401, so it is explicit.
    ZOHO_API_REGION: z.string().optional(),

    // Google Group used as the Google Play closed-test tester list. Play exposes
    // testers to a personal account only as Google Groups, and a group's members
    // must join it themselves, so the beta confirmation email carries this
    // group's join link. Put the same address in Play Console under
    // Test your app > Closed testing > Manage track > Testers > Google Groups.
    BETA_TESTER_GROUP_EMAIL: z
      .string()
      .default("nabri-beta@googlegroups.com"),

  // Agreement archive: every issued agreement is blind-copied to these
  // recipients (comma-separated). Defaults to the primary super admin so legal
  // records always reach the owner; add more addresses here as needed.
  AGREEMENT_ARCHIVE_EMAILS: z.string().optional(),

  // Days a pre-consent account keeps full access after being told about the
  // current terms. The clock starts at notification, never at deploy, so no one
  // is locked out by a deadline they never saw. 0 means block immediately.
  LEGAL_RECONSENT_GRACE_DAYS: z.coerce.number().int().min(0).max(365).optional(),

  // Gmail SMTP — used when EMAIL_PROVIDER=gmail. Requires a Google App Password
  // (Google Account → Security → 2-Step Verification → App passwords). The
  // sending address is locked to GMAIL_USER; EMAIL_FROM should match it.
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),

  // OTP policy (admin-tunable via AppSettings otp.* keys, env = fallback).
  OTP_EXPIRY_MINUTES: z.string().default("10").transform(Number),
  OTP_MAX_ATTEMPTS: z.string().default("5").transform(Number),
  OTP_RESEND_SECONDS: z.string().default("30").transform(Number),
  OTP_MAX_PER_15MIN: z.string().default("3").transform(Number),
  OTP_MAX_PER_HOUR: z.string().default("5").transform(Number),
  OTP_MAX_PER_IP_HOUR: z.string().default("20").transform(Number),

  // Public OTP API (/api/otp): optional comma-separated keyword blocklist so
  // the generate endpoint rejects spammy org/subject/purpose text, mirroring
  // the reference otp-service spam gate. Defaults apply when unset.
  SPAM_BLOCK_WORDS: z.string().optional(),

  // Messaging provider abstraction: twilio | msg91 | brevo | whatsapp | none.
  // Without provider env, SMS OTP honestly reports SMS_NOT_CONFIGURED (email
  // fallback offered instead).
  SMS_PROVIDER: z.enum(["twilio", "msg91", "brevo", "whatsapp", "none"]).default("none"),
  SMS_SENDER_ID: z.string().optional(),
  SMS_REGION: z.string().default("IN"),

  // SMS (Twilio) — optional
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // SMS (MSG91) — optional. Free account needs just the auth key from
  // MSG91 → Settings → API Keys. MSG91_SENDER_ID is the 6-char transactional
  // sender (defaults to "NABRI"); DLT-approved sender/template may be required
  // for delivery in India.
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),

  // WhatsApp Business Cloud API — optional. Delivery inside the 24h
  // customer-service window is free, but standing this up needs a verified Meta
  // Business Manager, a WhatsApp Business Account, a permanent (not temporary)
  // system-user token, and a Meta-approved message template. WHATSAPP_OTP_TEMPLATE
  // must be the approved template NAME, and that template needs a {{1}}
  // placeholder for the code.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_OTP_TEMPLATE: z.string().optional(),
  WHATSAPP_OTP_LANGUAGE: z.string().default("en"),

  // Signup gate: when enabled, accounts that have BOTH an email and a phone
  // cannot log in until BOTH channels are OTP-verified. Admin accounts are
  // always exempt. Keep off until a real SMS provider is configured.
  REQUIRE_DUAL_VERIFICATION: z
    .string()
    .default("false")
    .transform((v) => v === "true" || v === "1"),

  // SOS: when set, every active SOS alert is also SMSed to this ops phone
  // (E.164), in addition to the user's emergency contact.
  SOS_SMS_TO: z.string().optional(),
  // Comma-separated list of admin addresses that receive SOS alert emails.
  // Defaults to ADMIN_EMAIL when unset.
  SOS_ALERT_EMAILS: z.string().optional(),

  // LocationIQ — optional in dev
  LOCATIONIQ_API_KEY: z.string().default("pk_dev_placeholder"),
  LOCATIONIQ_BASE_URL: z.string().default("https://us1.locationiq.com/v1"),
  LOCATIONIQ_TILE_URL: z.string().default("https://{s}.tile.locationiq.com/hot/{z}/{x}/{y}.png"),

  // TMDB (movies) — optional. Without TMDB_API_KEY the movies API reports
  // MOVIES_NOT_CONFIGURED and the app shows meetups only. Never fake data.
  TMDB_API_KEY: z.string().optional(),

  // Catalogue shape. These were previously hardcoded to India on every request,
  // which made the film list India-only by accident rather than by decision, and
  // made "show more" impossible to reason about. Defaults keep the current
  // behaviour; set TMDB_ORIGIN_COUNTRY to an empty value to drop the origin
  // filter entirely and show theatrical releases worldwide.
  TMDB_REGION: z.string().default("IN"),
  TMDB_ORIGIN_COUNTRY: z.string().default("IN"),
  // Original languages to keep, in priority order, comma separated.
  //
  // The app is built for Chennai, so the default is Tamil only. `region` is NOT a
  // language filter - it only affects release-date certification - which is why
  // the catalogue was showing Resident Evil and Spider-Man on a Tamil cinema app.
  //
  // TMDB's `with_original_language` rejects a comma list (it silently returns
  // zero results) and only accepts a pipe for OR, so `ta,en` here becomes
  // `ta|en` on the wire. Set it empty to drop the filter and show every language.
  TMDB_LANGUAGES: z.string().default("ta"),
  TMDB_INCLUDE_ADULT: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // How far ahead "coming soon" reaches. A film releasing today has to have been
  // listed before today, so this window is what guarantees that: anything inside
  // it is visible for COMING_SOON_DAYS before its release, not on release day.
  TMDB_COMING_SOON_DAYS: z.coerce.number().int().min(1).max(30).default(7),

  // Days ahead for the wider "upcoming" shelf.
  TMDB_UPCOMING_HORIZON_DAYS: z.coerce.number().int().min(7).max(365).default(120),

  // How far BACK "now playing" reaches, in days.
  //
  // This is the setting that decides whether the shelf is honest. The query used
  // to have an upper bound only (`primary_release_date.lte = today`) sorted by
  // popularity, so it answered "the most popular Indian film of all time" and a
  // 2021 release outranked a film that opened three days ago. A theatrical run
  // in India is roughly 4-6 weeks, so 45 days is a window that still contains
  // films genuinely in cinemas while dropping anything that finished its run.
  TMDB_NOW_PLAYING_WINDOW_DAYS: z.coerce.number().int().min(7).max(180).default(45),

  // Where "book tickets" sends people.
  //
  // NOT a search URL. BookMyShow has no public movie search endpoint - the
  // header search is a JavaScript modal with no addressable URL - so the
  // fabricated `https://in.bookmyshow.com/search?q=<title>` link that used to
  // be hardcoded in the mapper returned 404 for every film. This is the real
  // movies page, which resolves and asks the visitor for their city.
  //
  // Per-film deep links exist but need BookMyShow's internal EventCode
  // (`/movies/drishyam-the-conclusion/ET00477911`), which TMDB does not expose,
  // so they cannot be constructed from the data we have. Point this at a real
  // partner booking page if the business gets partner API access.
  TMDB_BOOKING_BASE_URL: z
    .string()
    .url()
    .default("https://in.bookmyshow.com/movies"),

  // How long a fetched feed stays fresh, and how often the proactive sync runs.
  // The sync exists so a release is on the shelf with real data before the day
  // it opens, instead of being fetched for the first time when people look.
  TMDB_CACHE_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  TMDB_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1440).default(360),

  // Account deletion
  //
  // Absolute ISO date until which users cannot delete their own account. An
  // administrator can always delete one through the admin status endpoint. See
  // services/accountDeletionPolicy.ts - an unparseable value fails CLOSED (the
  // freeze stays on) rather than opening deletion by accident.
  SELF_DELETION_FROZEN_UNTIL: z.string().optional(),

  // AI gateway — all optional. Without AI_API_BASE + AI_API_KEY the LLM
  // features honestly report AI_NOT_CONFIGURED; rules-based AI (matching,
  // safety flags, assistant router, admin summary) works without any key.
  //
  // AI_PROVIDER: "openai-compatible" (default) | "nim" | "gemini".
  //   "nim"    -> NVIDIA NIM free tier (https://integrate.api.nvidia.com/v1).
  //              Hosts open-weight models for $0 (e.g. meta/muse-glimmer-30b).
  //              Sign up at build.nvidia.com — free dev API key, no card.
  //   "gemini" -> Google AI Studio free tier
  //              (https://generativelanguage.googleapis.com/v1beta/openai/).
  //              Free key at aistudio.google.com/apikey (US-only data policy).
  //   "openai-compatible" -> any other /chat/completions endpoint.
  // When AI_PROVIDER is "nim" or "gemini", AI_API_BASE is optional (the
  // provider's well-known base URL is assumed) and AI_MODEL falls back to the
  // provider's flagship model (meta/muse-glimmer-30b / gemini-3.8-flash).
  AI_PROVIDER: z.enum(["openai-compatible", "nim", "gemini"]).optional(),
  AI_API_BASE: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_USER_QUOTA_PER_HOUR: z.string().optional(),

  // Demo sandbox accounts (fenced: invisible to real users and vice versa).
  DEMO_USER_EMAIL: z.string().optional(),
  DEMO_PARTNER_EMAIL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Runtime booleans attached after parse
interface RuntimeEnv extends Env {
  isProduction: boolean;
  isDevelopment: boolean;
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  const errors = parsed.error.flatten().fieldErrors;
  for (const [field, messages] of Object.entries(errors)) {
    console.error(`   ${field}: ${(messages as string[]).join(", ")}`);
  }
  throw new Error("Environment validation failed — server cannot start with missing/invalid vars.");
}

export const env = parsed.data as RuntimeEnv;

env.isProduction = env.NODE_ENV === "production";
env.isDevelopment = env.NODE_ENV === "development";

// JWT secret: never a known static fallback.
if (!env.JWT_SECRET) {
  if (env.isProduction) {
    throw new Error("JWT_SECRET is required in production. Set a strong secret in the environment.");
  }
  env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
}

// Production secret gates — fail fast (or loudly warn) on insecure config so a
// deployment can never silently run with placeholder/guessable secrets.
if (env.isProduction) {
  const placeholders = ["", "placeholder", "changeme", "dev", "test"];
  const isPlaceholder = (v: string | undefined) => !v || placeholders.includes(v.trim().toLowerCase());

  // Cashfree is RETIRED. Payments are collected manually against the platform
  // UPI QR and credited after an admin verifies the bank statement, so there is
  // no gateway credential the server needs in order to take money.
  //
  // This gate used to refuse to boot without CASHFREE_APP_ID and
  // CASHFREE_SECRET_KEY, which was correct while online checkout was the only
  // rail. Left in place it would make the retired dependency fatal: deleting the
  // keys - the whole point of retiring a gateway whose credentials were exposed -
  // would take the API down with them. A gateway that is not in use must not be
  // able to stop the service from starting.
  //
  // The webhook route still verifies signatures when keys ARE present, so an
  // unsigned callback can never settle a payment regardless of this block.
  const cashfreeKeysPresent =
    !isPlaceholder(env.CASHFREE_APP_ID) &&
    !isPlaceholder(env.CASHFREE_SECRET_KEY) &&
    !env.CASHFREE_APP_ID?.includes("placeholder") &&
    !env.CASHFREE_SECRET_KEY?.includes("placeholder");

  if (!cashfreeKeysPresent) {
    console.warn(
      "[env] Cashfree credentials are not configured — online checkout is unavailable. " +
        "This is expected: payments are collected manually via UPI.",
    );
  } else {
    // Only meaningful while the gateway is retired-but-present. If someone
    // restores keys and flips PAYMENT_MODE back to "gateway", this still catches
    // test keys aimed at the live host, which otherwise fail as an opaque auth
    // error on the first order, long after deploy.
    const expectsSandbox = env.CASHFREE_API_ENV === "test";
    const looksLikeTestKey = /^(test|sandbox)/i.test(env.CASHFREE_APP_ID || "");
    if (expectsSandbox !== looksLikeTestKey) {
      throw new Error(
        `CASHFREE_API_ENV is "${env.CASHFREE_API_ENV}" but CASHFREE_APP_ID looks like a ` +
          `${looksLikeTestKey ? "test" : "production"} key. Cashfree rejects credentials on the ` +
          "wrong host. Set CASHFREE_API_ENV to match the keys you configured.",
      );
    }
  }

  // SMTP: OTP email + transactional notifications won't be delivered without it.
  if (isPlaceholder(env.SMTP_HOST) || isPlaceholder(env.SMTP_USER) || isPlaceholder(env.SMTP_PASS)) {
    console.warn(
      "[env] WARNING: SMTP is not fully configured in production — email OTP and notifications will NOT be delivered.",
    );
  }

  // Firebase push/phone auth secrets must be real in production.
  if (isPlaceholder(env.FIREBASE_PRIVATE_KEY) && isPlaceholder(process.env.FIREBASE_SERVICE_ACCOUNT)) {
    console.warn(
      "[env] WARNING: Firebase credentials are not configured in production — push notifications and phone auth will be limited.",
    );
  }
}

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";

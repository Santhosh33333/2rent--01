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
  JWT_REFRESH_EXPIRY: z.string().default("7d"),

  // Security
  BCRYPT_SALT_ROUNDS: z.string().default("10").transform(Number),
  OTP_EXPIRY_MINUTES: z.string().default("10").transform(Number),

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.string().default("900000").transform(Number),
  RATE_LIMIT_MAX: z.string().default("600").transform(Number),
  AUTH_RATE_LIMIT_MAX: z.string().default("50").transform(Number),

  // Uploads
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_FILE_SIZE: z.string().default("5242880").transform(Number),

  // Admin seeding
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().optional(),

  // Firebase Admin SDK — optional in dev (server uses FIREBASE_SERVICE_ACCOUNT JSON blob at runtime)
  FIREBASE_PROJECT_ID: z.string().default("rentbuddy-dev"),
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

  // Razorpay — optional in dev
  RAZORPAY_KEY_ID: z.string().default("rzp_test_placeholder"),
  RAZORPAY_KEY_SECRET: z.string().default("razorpay_secret_placeholder"),
  RAZORPAY_WEBHOOK_SECRET: z.string().default("webhook_secret_placeholder"),

  // Payment settings
  PLATFORM_COMMISSION_PERCENT: z.string().default("10").transform(Number),
  MIN_BOOKING_AMOUNT: z.string().default("50").transform(Number),
  MAX_BOOKING_AMOUNT: z.string().default("10000").transform(Number),

  // Email (SMTP) — optional in dev, required for real OTP delivery
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default("587").transform(Number),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("RentBuddy <noreply@rentbuddy.app>"),

  // SMS (Twilio) — optional
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // LocationIQ — optional in dev
  LOCATIONIQ_API_KEY: z.string().default("pk_dev_placeholder"),
  LOCATIONIQ_BASE_URL: z.string().default("https://us1.locationiq.com/v1"),
  LOCATIONIQ_TILE_URL: z.string().default("https://{s}.tile.locationiq.com/hot/{z}/{x}/{y}.png"),

  // Clerk (legacy — optional)
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_JWKS_URL: z.string().default("https://willing-leech-39.clerk.accounts.dev/.well-known/jwks.json"),
});

export type Env = z.infer<typeof envSchema>;

// Runtime booleans attached after parse
interface RuntimeEnv extends Env {
  isProduction: boolean;
  isDevelopment: boolean;
}

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
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

  // Razorpay webhook signature verification is only as strong as this secret.
  // A placeholder here lets anyone forge payment callbacks.
  if (isPlaceholder(env.RAZORPAY_WEBHOOK_SECRET) || env.RAZORPAY_WEBHOOK_SECRET === "webhook_secret_placeholder") {
    throw new Error(
      "RAZORPAY_WEBHOOK_SECRET is required in production and must be the real webhook secret (not the placeholder).",
    );
  }

  // Razorpay API keys — payments will silently fail with placeholder keys.
  if (isPlaceholder(env.RAZORPAY_KEY_ID) || env.RAZORPAY_KEY_ID?.includes("placeholder")) {
    throw new Error(
      "RAZORPAY_KEY_ID is required in production and must be the real key (not the placeholder).",
    );
  }
  if (isPlaceholder(env.RAZORPAY_KEY_SECRET) || env.RAZORPAY_KEY_SECRET?.includes("placeholder")) {
    throw new Error(
      "RAZORPAY_KEY_SECRET is required in production and must be the real secret (not the placeholder).",
    );
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

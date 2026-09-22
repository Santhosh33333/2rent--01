import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { sendError } from "../utils/response";

const standardHeaders = true;
const legacyHeaders = false;

export const generalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders,
  legacyHeaders,
  handler: (_req, res) => {
    sendError(res, "Too many requests, please try again later.", 429, "RATE_LIMIT_EXCEEDED");
  },
});

export const authRateLimiter = rateLimit({
  windowMs: env.NODE_ENV === "development" ? 60000 : env.RATE_LIMIT_WINDOW_MS,
  max: env.NODE_ENV === "development" ? 1000 : env.AUTH_RATE_LIMIT_MAX,
  standardHeaders,
  legacyHeaders,
  handler: (_req, res) => {
    sendError(res, "Too many authentication attempts, please try again later.", 429, "AUTH_RATE_LIMIT_EXCEEDED");
  },
});

// OTP endpoints: strict per-contact buckets (spec: max 3 sends per 15 min
// per account/contact) plus IP-level throttling against SMS bombing.
// keyGenerator reads the parsed JSON body (express.json runs before routes).
export const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "development" ? 1000 : 3,
  standardHeaders,
  legacyHeaders,
  keyGenerator: (req: any) => {
    const id = req.body?.email || req.body?.phone || req.body?.identifier || "";
    return `otp-send:${String(id).toLowerCase()}|${req.ip}`;
  },
  handler: (_req, res) => {
    sendError(res, "Too many OTP requests. Wait a few minutes and try again.", 429, "OTP_RATE_LIMIT_EXCEEDED");
  },
});

export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "development" ? 1000 : 30,
  standardHeaders,
  legacyHeaders,
  keyGenerator: (req: any) => {
    const id = req.body?.email || req.body?.phone || req.body?.identifier || "";
    return `otp-verify:${String(id).toLowerCase()}|${req.ip}`;
  },
  handler: (_req, res) => {
    sendError(res, "Too many verification attempts. Try again later.", 429, "OTP_RATE_LIMIT_EXCEEDED");
  },
});

// AI endpoints: cost control per IP on top of per-user quotas in aiGateway.
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === "development" ? 1000 : 30,
  standardHeaders,
  legacyHeaders,
  handler: (_req, res) => {
    sendError(res, "AI is busy right now. Try again in a minute.", 429, "AI_RATE_LIMIT_EXCEEDED");
  },
});

// Search/autocomplete: DB-heavy, easy to abuse for scraping.
export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === "development" ? 1000 : 60,
  standardHeaders,
  legacyHeaders,
  handler: (_req, res) => {
    sendError(res, "Too many searches. Slow down a little.", 429, "SEARCH_RATE_LIMIT_EXCEEDED");
  },
});

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

import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";
import { sendError } from "../utils/response";

export function validateRequest(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({
      field: "param" in e ? e.param : "field" in e ? e.field : "unknown",
      message: e.msg,
    }));
    res.locals.validationErrors = formatted;

    // Name the problem instead of announcing that validation happened. Every
    // client in this app reads `message` and shows it, so the bare
    // "Validation failed." was the entire user-visible result - the per-field
    // reasons were computed one line above and then discarded. An admin who
    // typed no comment was told "Validation failed." rather than that a comment
    // is what is missing, which is the one thing they needed to know.
    const first = formatted[0]?.message?.trim() || "Validation failed.";
    const extraProblems = formatted.length - 1;
    const summary =
      extraProblems > 0
        ? `${first} (and ${extraProblems} more problem${extraProblems > 1 ? "s" : ""})`
        : first;

    // The full list travels in `extra.errors` so a client can highlight the
    // offending fields rather than only printing prose.
    sendError(res, summary, 422, "VALIDATION_ERROR", undefined, { errors: formatted });
    return;
  }
  next();
}

const XSS_PATTERNS = [
  /<\s*script\b[^>]*>([\s\S]*?)<\s*\/\s*script\s*>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi,
  /javascript\s*:/gi,
  /<\s*iframe\b[^>]*>/gi,
  /<\s*object\b[^>]*>/gi,
  /<\s*embed\b[^>]*>/gi,
];

function sanitizeString(value: string): string {
  let result = value;
  for (const pattern of XSS_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}

function deepSanitize(input: unknown): unknown {
  if (typeof input === "string") {
    return sanitizeString(input);
  }
  if (Array.isArray(input)) {
    return input.map(deepSanitize);
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      out[key] = deepSanitize(val);
    }
    return out;
  }
  return input;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") {
    req.body = deepSanitize(req.body);
  }
  if (req.query && typeof req.query === "object") {
    req.query = deepSanitize(req.query) as typeof req.query;
  }
  next();
}

import express, { type NextFunction, type Request, type Response } from "express";

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Keeps the original request bytes available for payment webhooks.
 *
 * Gateways sign the exact bytes they send, so verifying a re-serialised copy of
 * the parsed body can never match. Two properties are required:
 *
 *  - the bytes survive whatever Content-Type the gateway used. `express.json`
 *    only runs its `verify` hook when it chooses to parse, so a text/plain or
 *    Content-Type-less webhook would otherwise arrive with nothing to verify.
 *  - an unexpected body shape is not turned into a crash. `express.json` rejects
 *    bodies it cannot parse, which surfaced as a 500 on a form-encoded probe
 *    instead of the clean refusal the handler is designed to give.
 *
 * `express.raw` satisfies both: it never interprets the body, so it cannot fail
 * on content type or syntax. The body is decoded as JSON on a best-effort basis
 * only, so handlers can read fields; `rawBody` remains the authoritative signed
 * bytes. A body that is not JSON still reaches the handler, where signature
 * verification decides whether to accept it.
 *
 * Mount this on the webhook prefix only. Other API routes keep the normal
 * `express.json` parser.
 */
export function webhookRawBody() {
  return express.raw({ limit: "2mb", type: () => true });
}

export function attachWebhookRawBody(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.method !== "POST") return next();

  const raw = Buffer.isBuffer(req.body) ? req.body : undefined;
  if (!raw) return next();

  (req as RequestWithRawBody).rawBody = raw;
  try {
    req.body = raw.length > 0 ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    // Not JSON. Signature verification still runs against rawBody, so an
    // unparseable body is refused rather than trusted.
    req.body = {};
  }
  next();
}

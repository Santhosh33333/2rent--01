import express, { type Request, type Response } from "express";
import { describe, expect, it } from "vitest";

import {
  attachWebhookRawBody,
  webhookRawBody,
} from "../middleware/webhookRawBody";

type RawRequest = Request & { rawBody?: Buffer };

/**
 * Builds a webhook path with the real middleware chain in front of a handler
 * that reports what it received, so the assertions describe genuine requests
 * rather than hand-built objects.
 */
function buildHandler() {
  const app = express();
  app.post("/hook", webhookRawBody(), attachWebhookRawBody, (req, res) => {
    const r = req as RawRequest;
    res.status(200).json({
      hasRawBody: Buffer.isBuffer(r.rawBody),
      raw: r.rawBody?.toString("utf8") ?? null,
      body: req.body,
    });
  });
  return app;
}

interface HookEcho {
  hasRawBody: boolean;
  raw: string | null;
  body: Record<string, any>;
}

async function post(
  app: ReturnType<typeof buildHandler>,
  contentType: string | undefined,
  body: string,
) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: contentType ? { "content-type": contentType } : {},
      body,
    });
    return { status: res.status, json: (await res.json()) as HookEcho };
  } finally {
    server.close();
  }
}

describe("webhookRawBody", () => {
  it("preserves the exact bytes of a JSON webhook", async () => {
    const raw = '{"type":"PAYMENT_SUCCESS","order_id":"o_1"}';
    const { status, json } = await post(buildHandler(), "application/json", raw);

    expect(status).toBe(200);
    // Byte-for-byte, so a signature over these bytes can be checked.
    expect(json.raw).toBe(raw);
    expect(json.body.type).toBe("PAYMENT_SUCCESS");
  });

  it("preserves bytes sent as text/plain", async () => {
    const raw = '{"type":"PAYMENT_SUCCESS"}';
    const { status, json } = await post(buildHandler(), "text/plain", raw);

    expect(status).toBe(200);
    expect(json.hasRawBody).toBe(true);
    expect(json.raw).toBe(raw);
  });

  it("preserves bytes sent with no content type", async () => {
    const raw = '{"type":"PAYMENT_SUCCESS"}';
    const { status, json } = await post(buildHandler(), undefined, raw);

    expect(status).toBe(200);
    expect(json.raw).toBe(raw);
  });

  it("does not fail on a body it cannot parse", async () => {
    // A form-encoded or otherwise unexpected body must still reach the handler
    // so signature verification can refuse it. Treating it as a parse error
    // here would surface as a 500 and lose the request.
    const { status, json } = await post(
      buildHandler(),
      "application/x-www-form-urlencoded",
      "type=TEST",
    );

    expect(status).toBe(200);
    expect(json.hasRawBody).toBe(true);
    expect(json.raw).toBe("type=TEST");
    // Nothing is invented for a body that is not JSON.
    expect(json.body).toEqual({});
  });

  it("preserves whitespace that a reserialised body would lose", async () => {
    // This is the whole reason the buffer is kept: JSON.stringify would collapse
    // this formatting and the signature would never match.
    const raw = '{\n  "type":  "PAYMENT_SUCCESS"\n}';
    const { json } = await post(buildHandler(), "application/json", raw);

    expect(json.raw).toBe(raw);
  });

  it("does not invent a body for an empty payload", async () => {
    const { status, json } = await post(buildHandler(), "application/json", "");

    expect(status).toBe(200);
    expect(json.body).toEqual({});
  });

  it("still parses JSON nested structures for handler field access", async () => {
    const raw = '{"data":{"payment":{"cf_order_id":"o_9","amount":10.5}}}';
    const { json } = await post(buildHandler(), "application/json", raw);

    expect(json.body.data.payment.cf_order_id).toBe("o_9");
    expect(json.body.data.payment.amount).toBe(10.5);
  });
});

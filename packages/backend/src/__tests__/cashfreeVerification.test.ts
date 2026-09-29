/**
 * Cashfree payment verification tests.
 *
 * These are the anti-forgery guarantees. A payment system that trusts the
 * browser is one where "paid" is merely a suggestion, so each test asserts a
 * specific way a fake payment could be attempted and refused.
 *
 * The signature checks are exercised through the pure helpers, which take the
 * secret as an argument. That keeps these tests free of process.env mutation
 * (which re-runs full environment validation) and lets us prove the behaviour
 * for placeholder and wrong secrets directly.
 *
 * The HTTP layer is mocked throughout, so nothing reaches Cashfree and no money
 * moves.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";

// `vi.hoisted` runs before the imports below, which matters because importing
// the service transitively evaluates src/config/env.ts, and that module
// validates the environment and throws on anything missing. The project's
// vitest.setup.ts is not actually wired into vitest.config.ts, so each test
// file has to establish its own environment before import time.
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET = "test_refresh_secret_32chars_minimum!";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
  process.env.ADMIN_EMAIL = "test@test.com";
  process.env.ADMIN_PASSWORD = "TestPass123!";
  process.env.CASHFREE_APP_ID = "test_app_id";
  process.env.CASHFREE_SECRET_KEY = "test_secret_key";
});

import {
  isValidPaymentSignature,
  isValidWebhookSignature,
  isSuccessfulStatus,
  createOrder,
  fetchPayments,
} from "../services/cashfreeService";
import {
  normalizeIndianPhone,
  sanitizeCashfreeName,
} from "../services/paymentProvider";
const SECRET = "test_secret_key";

const signPayment = (orderId: string, paymentId: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(`${orderId}${paymentId}`).digest("hex");

// Cashfree signs `timestamp + rawBody` with the PG secret key and sends the
// result base64-encoded.
const signWebhook = (ts: string, raw: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(`${ts}${raw}`).digest("base64");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("client payment signature", () => {
  it("accepts a signature the provider would actually produce", () => {
    expect(isValidPaymentSignature("order_1", "pay_1", signPayment("order_1", "pay_1"), SECRET)).toBe(true);
  });

  it("rejects a signature forged with the wrong secret", () => {
    const forged = signPayment("order_1", "pay_1", "attacker_secret");
    expect(isValidPaymentSignature("order_1", "pay_1", forged, SECRET)).toBe(false);
  });

  it("rejects a real signature that belongs to a different order", () => {
    // The swap attack: genuine proof, replayed against someone else's order.
    expect(isValidPaymentSignature("order_2", "pay_1", signPayment("order_1", "pay_1"), SECRET)).toBe(false);
  });

  it("rejects a real signature for a different payment on the same order", () => {
    expect(isValidPaymentSignature("order_1", "pay_2", signPayment("order_1", "pay_1"), SECRET)).toBe(false);
  });

  it("rejects a signature that omits the order id (the 'pay_1' only' form)", () => {
    const partial = signPayment("", "pay_1");
    expect(isValidPaymentSignature("order_1", "pay_1", partial, SECRET)).toBe(false);
  });

  it("rejects empty or missing inputs rather than passing", () => {
    expect(isValidPaymentSignature("", "pay_1", "sig", SECRET)).toBe(false);
    expect(isValidPaymentSignature("order_1", "", "", SECRET)).toBe(false);
  });

  it("rejects when no secret is configured, instead of treating it as valid", () => {
    expect(isValidPaymentSignature("order_1", "pay_1", "anything", "")).toBe(false);
  });

  it("rejects a correctly-signed value whose length differs (truncated signature)", () => {
    const full = signPayment("order_1", "pay_1");
    expect(isValidPaymentSignature("order_1", "pay_1", full.slice(0, -2), SECRET)).toBe(false);
  });
});

describe("webhook signature", () => {
  // Real webhook bodies arrive with whitespace and arbitrary key order. That
  // formatting is precisely what JSON.stringify would discard, so the
  // round-tripped bytes differ from the bytes that were actually signed.
  const body = JSON.stringify(
    { type: "PAYMENT_SUCCESS", data: { payment: { payment_id: "pay_9" } } },
    null,
    2
  );
  const ts = "1617695238078";

  it("accepts the exact raw bytes the provider sent", () => {
    expect(isValidWebhookSignature(body, signWebhook(ts, body), SECRET, ts)).toBe(true);
  });

  it("accepts a Buffer body identically to a string body", () => {
    expect(
      isValidWebhookSignature(Buffer.from(body, "utf8"), signWebhook(ts, body), SECRET, ts)
    ).toBe(true);
  });

  it("rejects the re-serialised body a JSON round-trip would produce", () => {
    // Exactly the bug this mechanism exists to prevent: signing parsed-then-
    // re-stringified JSON instead of the bytes that were actually received.
    const reparsed = JSON.stringify(JSON.parse(body));
    expect(reparsed).not.toBe(body);
    expect(isValidWebhookSignature(reparsed, signWebhook(ts, body), SECRET, ts)).toBe(false);
  });

  it("rejects a payload altered by one character", () => {
    const tampered = body.replace("pay_9", "pay_8");
    expect(isValidWebhookSignature(tampered, signWebhook(ts, body), SECRET, ts)).toBe(false);
  });

  it("rejects an absent signature header", () => {
    expect(isValidWebhookSignature(body, undefined, SECRET, ts)).toBe(false);
    expect(isValidWebhookSignature(body, "", SECRET, ts)).toBe(false);
  });

  it("rejects a missing timestamp", () => {
    // The timestamp is part of the signed payload. Verifying without it would
    // compute a different HMAC and accept nothing real.
    expect(isValidWebhookSignature(body, signWebhook(ts, body), SECRET, undefined)).toBe(false);
  });

  it("rejects a signature made for a different timestamp", () => {
    expect(
      isValidWebhookSignature(body, signWebhook(ts, body), SECRET, "1617695238079")
    ).toBe(false);
  });

  it("rejects when the secret is unset rather than trusting the payload", () => {
    expect(isValidWebhookSignature(body, "anything", "", ts)).toBe(false);
  });

  it("rejects a hex signature where the provider sends base64", () => {
    // The encoding is part of the contract. Accepting a hex digest here would
    // mean a caller controls the encoding, which is a forgery surface.
    const hex = crypto.createHmac("sha256", SECRET).update(`${ts}${body}`).digest("hex");
    expect(isValidWebhookSignature(body, hex, SECRET, ts)).toBe(false);
  });

  it("matches the signature format Cashfree documents", () => {
    // base64 of HMAC-SHA256(timestamp + rawBody) keyed by the secret, so the
    // result is 44 characters ending in '='.
    const sig = signWebhook(ts, body);
    expect(sig).toHaveLength(44);
    expect(sig.endsWith("=")).toBe(true);
  });
});

describe("authoritative status check", () => {
  it("treats only PAID and CAPTURED as success", () => {
    expect(isSuccessfulStatus("PAID")).toBe(true);
    expect(isSuccessfulStatus("paid")).toBe(true);
    expect(isSuccessfulStatus("CAPTURED")).toBe(true);
  });

  it("does not treat pending, failed or unknown states as paid", () => {
    for (const status of ["PENDING", "ACTIVE", "FAILED", "VOIDED", "REFUNDED", "", undefined, null]) {
      expect(isSuccessfulStatus(status as never)).toBe(false);
    }
  });
});

  describe("order creation", () => {
    // Cashfree rejects an order with no customer_phone, and documents the
    // return_url as needing an {order_id} placeholder. Order-creation tests
    // therefore have to supply both to reach the network at all, which is
    // exactly the omission that turned a top-up into an opaque 500.
    const VALID_ORDER = {
      orderId: "o1",
      amount: 10,
      customerId: "c1",
      customerPhone: "9000000001",
      returnUrl: "https://2rent-01.vercel.app/wallet?order_id={order_id}",
    };

    it("refuses a zero or negative amount before calling the gateway", async () => {
      await expect(createOrder({ orderId: "o1", amount: 0, customerId: "c1" })).rejects.toThrow(
        /greater than zero/i
      );
      await expect(createOrder({ orderId: "o1", amount: -5, customerId: "c1" })).rejects.toThrow(
        /greater than zero/i
      );
      // Nothing was sent, so a malformed amount can never become a real charge.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses an order with no customer_phone, the field Cashfree requires", async () => {
      await expect(
        createOrder({ ...VALID_ORDER, customerPhone: undefined })
      ).rejects.toThrow(/customer_phone/i);
      // Refused locally: the gateway was never asked, so no half-created order
      // can be left behind to reconcile by hand.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a return_url that omits the {order_id} placeholder", async () => {
      await expect(
        createOrder({ ...VALID_ORDER, returnUrl: "https://2rent-01.vercel.app/wallet" })
      ).rejects.toThrow(/\{order_id\}/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a loopback return_url so live payers are not sent to localhost", async () => {
      await expect(
        createOrder({
          ...VALID_ORDER,
          returnUrl: "http://localhost:5173/wallet?order_id={order_id}",
        })
      ).rejects.toThrow(/loopback/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a return_url that is not an absolute URL", async () => {
      await expect(createOrder({ ...VALID_ORDER, returnUrl: "/wallet?order_id={order_id}" })).rejects.toThrow(
        /absolute URL/i
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends a well-formed customer_phone and the {order_id} placeholder", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: "o1", order_status: "ACTIVE" }),
      });

      await createOrder(VALID_ORDER);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body.customer_details.customer_phone).toBe("9000000001");
      expect(body.order_meta.return_url).toContain("{order_id}");
    });

    it("surfaces a gateway error rather than pretending the order exists", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => JSON.stringify({ message: "order_id already exists" }),
      });
      await expect(createOrder({ ...VALID_ORDER, orderId: "dup" })).rejects.toThrow(
        /order_id already exists/
      );
    });

    it("sends the API version and credentials Cashfree actually requires", async () => {
      // `x-cf-version` was silently ignored by the gateway, which would have left
      // every order call running on an unspecified API version. Cashfree reads
      // `x-api-version`.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: "o1", order_status: "ACTIVE" }),
      });

      await createOrder(VALID_ORDER);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-version"]).toBe("2025-01-01");
      expect(headers["x-client-id"]).toBe("test_app_id");
      expect(headers["x-client-secret"]).toBe("test_secret_key");
      // The misspelled header must not be sent at all.
      expect(headers["x-cf-version"]).toBeUndefined();
    });

    it("calls the production orders endpoint", async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ order_id: "o1", order_status: "ACTIVE" }),
      });

      await createOrder(VALID_ORDER);

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://api.cashfree.com/pg/orders");
    });
  });

describe("amount integrity", () => {
  it("reports the gateway's own amount so a mismatch is detectable", async () => {
    // Caller stored 500 rupees; Cashfree reports 5. A verification path that
    // only checked the status string would credit 500 for a 5 rupee payment.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ payments: [{ payment_id: "p1", payment_status: "PAID", payment_amount: 5 }] }),
    });
    const payments = await fetchPayments("o1");
    expect(payments[0].payment_status).toBe("PAID");
    expect(payments[0].payment_amount).toBe(5);
    expect(payments[0].payment_amount).not.toBe(500);
  });

  it("returns an empty list when the gateway reports no payments", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({}) });
    expect(await fetchPayments("o1")).toEqual([]);
  });

  it("returns an empty list for a bare array body instead of throwing", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "[]" });
    expect(await fetchPayments("o1")).toEqual([]);
  });

    it("does not let a non-JSON gateway response crash the verification path", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "<html>gateway error</html>" });
      expect(await fetchPayments("o1")).toEqual([]);
    });
  });

  describe("gateway input normalisation", () => {
    // Both of these feed the required customer_phone / customer_name fields, so
    // a stored number that is not already in gateway form must be reduced to it
    // rather than forwarded as-is and rejected.
    it("reduces stored phone numbers to the bare 10-digit national form", () => {
      expect(normalizeIndianPhone("+919000070900")).toBe("9000070900");
      expect(normalizeIndianPhone("919000070900")).toBe("9000070900");
      expect(normalizeIndianPhone("9000070900")).toBe("9000070900");
      expect(normalizeIndianPhone("+91 90000 70900")).toBe("9000070900");
    });

    it("refuses phone numbers that cannot be repaired into a national number", () => {
      // A landline, a too-short number, and an obviously absent value must all
      // be refused so the caller can ask the user to fix their profile.
      expect(normalizeIndianPhone("1234567890")).toBeNull();
      expect(normalizeIndianPhone("90000")).toBeNull();
      expect(normalizeIndianPhone("")).toBeNull();
      expect(normalizeIndianPhone(null)).toBeNull();
      expect(normalizeIndianPhone(undefined)).toBeNull();
    });

    it("strips characters the gateway rejects in a customer name", () => {
      expect(sanitizeCashfreeName("Priya  Sharma")).toBe("Priya Sharma");
      // Punctuation is removed and the gap it leaves is collapsed, so the name
      // stays a clean single-spaced string rather than a double space.
      expect(sanitizeCashfreeName("O'Brien & Sons")).toBe("OBrien Sons");
      expect(sanitizeCashfreeName("!!!")).toBeUndefined();
      expect(sanitizeCashfreeName(null)).toBeUndefined();
    });
  });

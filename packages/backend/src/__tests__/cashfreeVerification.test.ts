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
  process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
});

import {
  isValidPaymentSignature,
  isValidWebhookSignature,
  isSuccessfulStatus,
  createOrder,
  fetchPayments,
} from "../services/cashfreeService";

const SECRET = "test_secret_key";
const WEBHOOK_SECRET = "test_webhook_secret";

const signPayment = (orderId: string, paymentId: string, secret = SECRET) =>
  crypto.createHmac("sha256", secret).update(`${orderId}${paymentId}`).digest("hex");

const signWebhook = (raw: string, secret = WEBHOOK_SECRET) =>
  crypto.createHmac("sha256", secret).update(raw).digest("hex");

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

  it("accepts the exact raw bytes the provider sent", () => {
    expect(isValidWebhookSignature(body, signWebhook(body), WEBHOOK_SECRET)).toBe(true);
  });

  it("accepts a Buffer body identically to a string body", () => {
    expect(isValidWebhookSignature(Buffer.from(body, "utf8"), signWebhook(body), WEBHOOK_SECRET)).toBe(true);
  });

  it("rejects the re-serialised body a JSON round-trip would produce", () => {
    // Exactly the bug this mechanism exists to prevent: signing parsed-then-
    // re-stringified JSON instead of the bytes that were actually received.
    const reparsed = JSON.stringify(JSON.parse(body));
    expect(reparsed).not.toBe(body);
    expect(isValidWebhookSignature(reparsed, signWebhook(body), WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects a payload altered by one character", () => {
    const tampered = body.replace("pay_9", "pay_8");
    expect(isValidWebhookSignature(tampered, signWebhook(body), WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects an absent signature header", () => {
    expect(isValidWebhookSignature(body, undefined, WEBHOOK_SECRET)).toBe(false);
    expect(isValidWebhookSignature(body, "", WEBHOOK_SECRET)).toBe(false);
  });

  it("rejects when the webhook secret is unset rather than trusting the payload", () => {
    expect(isValidWebhookSignature(body, "anything", "")).toBe(false);
  });

  it("does not accept a signature made with the API secret", () => {
    // Guards against wiring the two Cashfree secrets into each other: signing
    // with the API secret must not satisfy webhook verification.
    expect(isValidWebhookSignature(body, signWebhook(body, SECRET), WEBHOOK_SECRET)).toBe(false);
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

  it("surfaces a gateway error rather than pretending the order exists", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ message: "order_id already exists" }),
    });
    await expect(createOrder({ orderId: "dup", amount: 10, customerId: "c1" })).rejects.toThrow(
      /order_id already exists/
    );
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

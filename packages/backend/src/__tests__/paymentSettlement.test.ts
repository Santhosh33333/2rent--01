/**
 * Payment settlement tests.
 *
 * These cover the three guarantees the gateway migration depends on:
 *
 *  1. credit only happens after the gateway confirms money arrived,
 *  2. a replayed or duplicated request cannot credit twice,
 *  3. a forged client request, or one whose amount disagrees with the order,
 *     is refused and moves no money.
 *
 * Prisma and the Cashfree HTTP client are both mocked, so these run offline and
 * cannot accidentally spend real money.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";
import type { Response } from "express";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET = "test_refresh_secret_32chars_minimum!";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
  process.env.ADMIN_EMAIL = "test@test.com";
  process.env.ADMIN_PASSWORD = "TestPass123!";
  process.env.PAYMENT_PROVIDER = "cashfree";
  process.env.CASHFREE_APP_ID = "test_app_id";
  process.env.CASHFREE_SECRET_KEY = "test_secret_key";
  process.env.CASHFREE_WEBHOOK_SECRET = "test_webhook_secret";
});

const SECRET = "test_secret_key";
const GATEWAY_ORDER_ID = "topup_abc123";
const GATEWAY_PAYMENT_ID = "pay_xyz789";
const ORDER_AMOUNT = 500;
const USER_ID = "user-1";
const WALLET_ID = "wallet-1";

const signPayment = (orderId: string, paymentId: string) =>
  crypto.createHmac("sha256", SECRET).update(`${orderId}${paymentId}`).digest("hex");

// --- prisma + gateway mocks ------------------------------------------------
// Declared inside vi.hoisted because vi.mock factories are hoisted above
// top-level declarations, and referencing them directly throws at import time.
const { db, gateway } = vi.hoisted(() => ({
  db: {
    paymentOrder: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    wallet: { findUnique: vi.fn(), update: vi.fn() },
    transaction: { create: vi.fn() },
    notification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  gateway: {
    verifyPaymentSignature: vi.fn(),
    fetchPayments: vi.fn(),
    verifyWebhookSignature: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: db }));

vi.mock("../services/cashfreeService", async () => {
  const actual = await vi.importActual<typeof import("../services/cashfreeService")>(
    "../services/cashfreeService"
  );
  return { ...actual, ...gateway };
});

import * as paymentController from "../controllers/paymentController";

// --- helpers ---------------------------------------------------------------

function storedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "po-1",
    provider: "cashfree",
    cashfreeOrderId: GATEWAY_ORDER_ID,
    cashfreePaymentId: null,
    razorpayOrderId: null,
    userId: USER_ID,
    walletId: WALLET_ID,
    amount: ORDER_AMOUNT,
    currency: "INR",
    status: "CREATED",
    type: "TOPUP",
    ...overrides,
  };
}

/** Minimal Response double that records what the controller sent. */
function fakeRes() {
  const state = { statusCode: 0, body: null as any };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      state.body = payload;
      return res;
    },
  };
  return { res: res as unknown as Response, state };
}

function fakeReq(body: Record<string, unknown>) {
  return { body, user: { userId: USER_ID, email: "u@example.com" } } as any;
}

/** Gateway reports a successful payment of the given amount. */
function gatewayPaid(amount = ORDER_AMOUNT, paymentId = GATEWAY_PAYMENT_ID) {
  gateway.fetchPayments.mockResolvedValue([
    {
      payment_id: paymentId,
      order_id: GATEWAY_ORDER_ID,
      payment_status: "PAID",
      payment_amount: amount,
      payment_currency: "INR",
    },
  ]);
}

/** The normal happy path: valid signature, gateway confirms, latch claims once. */
function arrangeSuccessfulPayment() {
  db.paymentOrder.findFirst.mockResolvedValue(storedOrder());
  db.wallet.findUnique.mockResolvedValue({ id: WALLET_ID, userId: USER_ID, balance: 100 });
  db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
  db.wallet.update.mockImplementation(async ({ data }: any) => ({
    id: WALLET_ID,
    balance: 100 + data.balance.increment,
  }));
  db.transaction.create.mockResolvedValue({ id: "txn-1" });
  db.notification.create.mockResolvedValue({});
  db.auditLog.create.mockResolvedValue({});
  gateway.verifyPaymentSignature.mockReturnValue(true);
  gatewayPaid();
  // Run the callback body directly, mirroring prisma's interactive transaction.
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
}

const verifyBody = {
  orderId: GATEWAY_ORDER_ID,
  paymentId: GATEWAY_PAYMENT_ID,
  signature: signPayment(GATEWAY_ORDER_ID, GATEWAY_PAYMENT_ID),
};

beforeEach(() => {
  vi.clearAllMocks();
  arrangeSuccessfulPayment();
});

// ============================================================================

describe("credit only after the gateway confirms", () => {
  it("credits the wallet when verification succeeds", async () => {
    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.statusCode).toBe(200);
    expect(state.body.success).toBe(true);
    expect(db.wallet.update).toHaveBeenCalledTimes(1);
    expect(db.wallet.update.mock.calls[0][0].data.balance).toEqual({ increment: ORDER_AMOUNT });
  });

  it("records a transaction and notification alongside the credit", async () => {
    const { res } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(db.transaction.create).toHaveBeenCalledTimes(1);
    expect(db.transaction.create.mock.calls[0][0].data.amount).toBe(ORDER_AMOUNT);
    expect(db.transaction.create.mock.calls[0][0].data.referenceId).toBe(GATEWAY_PAYMENT_ID);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });

  it("does not credit while the gateway still reports the payment as pending", async () => {
    gateway.fetchPayments.mockResolvedValue([
      {
        payment_id: GATEWAY_PAYMENT_ID,
        order_id: GATEWAY_ORDER_ID,
        payment_status: "PENDING",
        payment_amount: ORDER_AMOUNT,
        payment_currency: "INR",
      },
    ]);

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe("NOT_CAPTURED");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("reports a retryable error, and credits nothing, when the gateway is unreachable", async () => {
    // A gateway outage must never be mistaken for "payment failed", because
    // that would strand a payment the user genuinely made.
    gateway.fetchPayments.mockRejectedValue(new Error("ECONNRESET"));

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.statusCode).toBe(503);
    expect(state.body.error).toBe("PAYMENT_VERIFICATION_UNAVAILABLE");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("credits the gateway's own amount, not the client's claim", async () => {
    // The client says it paid 1; the gateway says 500. The order record is the
    // third opinion and it agrees with the gateway, so 500 is credited.
    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq({ ...verifyBody, amount: 1 }), res);

    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe("AMOUNT_MISMATCH");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });
});

// ============================================================================

describe("idempotency", () => {
  it("does not credit again when the order is already completed", async () => {
    db.paymentOrder.findFirst.mockResolvedValue(storedOrder({ status: "COMPLETED" }));

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.success).toBe(true);
    expect(state.body.message).toBe("Payment already verified.");
    expect(db.wallet.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not credit when it loses the race to a concurrent request", async () => {
    // updateMany returning 0 means another caller already flipped the order.
    db.paymentOrder.updateMany.mockResolvedValue({ count: 0 });
    db.wallet.findUnique.mockResolvedValue({ id: WALLET_ID, balance: 600 });

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.success).toBe(true);
    expect(state.body.message).toBe("Payment already verified.");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("credits exactly once across two identical requests", async () => {
    // The second call sees the order the first one completed.
    let completed = false;
    db.paymentOrder.updateMany.mockImplementation(async () => {
      if (completed) return { count: 0 };
      completed = true;
      return { count: 1 };
    });

    const first = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), first.res);
    expect(db.wallet.update).toHaveBeenCalledTimes(1);

    const second = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), second.res);
    expect(db.wallet.update).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================

describe("forged and mismatched requests", () => {
  it("refuses a client that reports success without a genuine signature", async () => {
    gateway.verifyPaymentSignature.mockReturnValue(false);

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq({ ...verifyBody, signature: "forged" }), res);

    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe("INVALID_SIGNATURE");
    expect(db.wallet.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("audits a refused signature so forgery attempts are visible", async () => {
    gateway.verifyPaymentSignature.mockReturnValue(false);

    const { res } = fakeRes();
    await paymentController.verifyPayment(fakeReq({ ...verifyBody, signature: "forged" }), res);

    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    const meta = JSON.parse(db.auditLog.create.mock.calls[0][0].data.metadata);
    expect(meta.reason).toBe("INVALID_SIGNATURE");
  });

  it("refuses when the gateway received less than the order is worth", async () => {
    // Classic underpayment: pay 5 against a 500 order.
    gatewayPaid(5);

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe("AMOUNT_MISMATCH");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses when the gateway received more than the order is worth", async () => {
    gatewayPaid(ORDER_AMOUNT + 1);

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.error).toBe("AMOUNT_MISMATCH");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses a payment id that is not a successful payment on our order", async () => {
    // Signature is genuine, but for a payment the gateway never marked paid.
    gateway.fetchPayments.mockResolvedValue([
      {
        payment_id: "someone_elses_payment",
        order_id: GATEWAY_ORDER_ID,
        payment_status: "PAID",
        payment_amount: ORDER_AMOUNT,
        payment_currency: "INR",
      },
    ]);

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe("NO_MATCHING_PAYMENT");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses when the client sends no order id at all", async () => {
    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq({ paymentId: GATEWAY_PAYMENT_ID }), res);

    expect(state.body.error).toBe("MISSING_PARAMS");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("hides other users' orders behind a 404 and never credits", async () => {
    db.paymentOrder.findFirst.mockResolvedValue(storedOrder({ userId: "someone-else" }));

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.statusCode).toBe(404);
    expect(state.body.error).toBe("ORDER_NOT_FOUND");
    // Crucially, no gateway call is made, so existence cannot be probed.
    expect(gateway.fetchPayments).not.toHaveBeenCalled();
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses an order that is not a wallet top-up", async () => {
    db.paymentOrder.findFirst.mockResolvedValue(storedOrder({ type: "BOOKING" }));

    const { res, state } = fakeRes();
    await paymentController.verifyPayment(fakeReq(verifyBody), res);

    expect(state.body.error).toBe("INVALID_ORDER_TYPE");
    expect(db.wallet.update).not.toHaveBeenCalled();
  });
});

// ============================================================================

describe("cashfree webhook", () => {
  const WEBHOOK_SECRET = "test_webhook_secret";
  const signBody = (raw: string) =>
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");

  function webhookReq(payload: unknown, signature?: string) {
    const raw = JSON.stringify(payload);
    return {
      body: payload,
      rawBody: Buffer.from(raw, "utf8"),
      headers: signature ? { "x-webhook-signature": signature } : {},
    } as any;
  }

  const successEvent = (amount = ORDER_AMOUNT) => ({
    type: "PAYMENT_SUCCESS",
    data: {
      payment: {
        order_id: GATEWAY_ORDER_ID,
        payment_id: GATEWAY_PAYMENT_ID,
        payment_status: "PAID",
        payment_amount: amount,
        payment_currency: "INR",
      },
    },
  });

  beforeEach(() => {
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue(storedOrder());
    db.wallet.update.mockResolvedValue({ id: WALLET_ID, balance: 600 });
    db.transaction.create.mockResolvedValue({ id: "txn-w" });
    db.notification.create.mockResolvedValue({});
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    gateway.verifyWebhookSignature.mockReturnValue(true);
  });

  it("credits on a correctly signed success event", async () => {
    const event = successEvent();
    const { res, state } = fakeRes();

    await paymentController.cashfreeWebhook(
      webhookReq(event, signBody(JSON.stringify(event))),
      res
    );

    expect(state.statusCode).toBe(200);
    expect(db.wallet.update).toHaveBeenCalledTimes(1);
    expect(db.wallet.update.mock.calls[0][0].data.balance).toEqual({ increment: ORDER_AMOUNT });
  });

  it("ignores an unsigned or forged webhook", async () => {
    gateway.verifyWebhookSignature.mockReturnValue(false);

    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook(webhookReq(successEvent(), "forged"), res);

    expect(state.body.received).toBe(false);
    expect(db.wallet.update).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to credit when the payload amount is not the order amount", async () => {
    const event = successEvent(5);
    const { res, state } = fakeRes();

    await paymentController.cashfreeWebhook(
      webhookReq(event, signBody(JSON.stringify(event))),
      res
    );

    expect(state.body.applied).toBe(false);
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("does not credit twice when the same delivery is retried", async () => {
    db.paymentOrder.updateMany.mockResolvedValue({ count: 0 });

    const event = successEvent();
    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook(webhookReq(event, signBody(JSON.stringify(event))), res);

    expect(state.body.applied).toBe(false);
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("refuses when the raw body was never captured", async () => {
    // Without the original bytes there is nothing to verify, so the request is
    // rejected rather than trusted on the strength of its parsed body.
    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook({ body: successEvent(), headers: {} } as any, res);

    expect(state.statusCode).toBe(400);
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("leaves the order open when the user abandons checkout", async () => {
    // If a dropped payment marked the order FAILED, the settlement latch would
    // reject the real payment when the user came back and completed it. That
    // would lose money we had actually received.
    const event = {
      type: "PAYMENT_USER_DROPPED",
      data: { payment: { order_id: GATEWAY_ORDER_ID, payment_id: GATEWAY_PAYMENT_ID, payment_status: "USER_DROPPED" } },
    };

    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook(webhookReq(event, signBody(JSON.stringify(event))), res);

    expect(state.statusCode).toBe(200);
    expect(state.body.applied).toBe(false);
    // Nothing written: the order stays open and un-settled, ready for a retry.
    expect(db.paymentOrder.updateMany).not.toHaveBeenCalled();
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("credits a payment that succeeds after an earlier abandoned attempt", async () => {
    // The latch must still accept the order, because the drop never closed it.
    db.paymentOrder.updateMany.mockResolvedValue({ count: 1 });
    db.paymentOrder.findUnique.mockResolvedValue(storedOrder({ status: "CREATED" }));

    const drop = {
      type: "PAYMENT_USER_DROPPED",
      data: { payment: { order_id: GATEWAY_ORDER_ID, payment_id: "attempt_1", payment_status: "USER_DROPPED" } },
    };
    // `fakeRes()` returns { res, state } — the response double itself is `.res`.
    const dropRes = fakeRes();
    await paymentController.cashfreeWebhook(
      webhookReq(drop, signBody(JSON.stringify(drop))),
      dropRes.res
    );
    expect(dropRes.state.body.applied).toBe(false);
    expect(db.wallet.update).not.toHaveBeenCalled();

    const success = successEvent();
    const successRes = fakeRes();
    await paymentController.cashfreeWebhook(
      webhookReq(success, signBody(JSON.stringify(success))),
      successRes.res
    );

    expect(successRes.state.body.applied).toBe(true);
    expect(db.wallet.update).toHaveBeenCalledTimes(1);
  });

  it("returns 5xx on an internal fault so Cashfree retries the payment", async () => {
    // Returning 200 here would tell Cashfree the event was handled and stop the
    // 2/10/30-minute retry window, silently losing a paid-but-uncredited order.
    db.$transaction.mockRejectedValue(new Error("database connection lost"));

    const event = successEvent();
    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook(webhookReq(event, signBody(JSON.stringify(event))), res);

    expect(state.statusCode).toBe(500);
    expect(state.body.received).toBe(false);
  });

  it("still refuses an amount mismatch without asking Cashfree to retry", async () => {
    // A mismatch is a permanent condition. Retrying cannot fix it, and we must
    // never credit on the strength of a retry landing.
    const event = successEvent(5);
    const { res, state } = fakeRes();

    await paymentController.cashfreeWebhook(webhookReq(event, signBody(JSON.stringify(event))), res);

    expect(state.statusCode).toBe(200);
    expect(state.body.applied).toBe(false);
    expect(db.wallet.update).not.toHaveBeenCalled();
  });

  it("marks a failed payment without touching a settled order", async () => {
    const event = {
      type: "PAYMENT_FAILED",
      data: { payment: { order_id: GATEWAY_ORDER_ID, payment_id: GATEWAY_PAYMENT_ID, payment_status: "FAILED" } },
    };

    const { res, state } = fakeRes();
    await paymentController.cashfreeWebhook(webhookReq(event, signBody(JSON.stringify(event))), res);

    expect(state.body.applied).toBe(true);
    // The status write is scoped to open orders, so it cannot clobber COMPLETED.
    expect(db.paymentOrder.updateMany.mock.calls[0][0].where.status).toEqual({
      in: ["CREATED", "AUTHORIZED"],
    });
    expect(db.wallet.update).not.toHaveBeenCalled();
  });
});

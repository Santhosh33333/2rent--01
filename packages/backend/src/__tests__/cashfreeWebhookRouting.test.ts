import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Behavioural coverage for the Cashfree webhook dispatcher.
 *
 * The regression these guard against is an ordering bug, not a value bug: the
 * refund branch used to sit *after* the `if (!orderId)` guard, and a real
 * refund payload carries `data.refund` rather than `data.payment`. Every
 * genuine refund was therefore answered 200 "No order in payload" and never
 * reached applyRefund, while the endpoint still reported success. A structural
 * test on source text would not have caught it, so these drive the controller.
 */

// Importing paymentController transitively evaluates src/config/env.ts, which
// validates and throws on anything missing. The project does not wire a global
// vitest.setup.ts (doing so would overwrite DATABASE_URL for the suites that
// need a real database), so the environment is established here instead.
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

// vi.mock factories are hoisted above these declarations, so the mock handles
// must live inside the factories rather than being captured by closure.
const { applyRefundMock, settleMock, paymentOrderUpdate, paymentOrderFindFirst } =
  vi.hoisted(() => ({
    applyRefundMock: vi.fn(),
    settleMock: vi.fn(),
    paymentOrderUpdate: vi.fn(),
    paymentOrderFindFirst: vi.fn(),
  }));

vi.mock("../services/refundService", () => ({
  applyRefund: applyRefundMock,
  hasAccess: vi.fn().mockResolvedValue(false),
  accessRemainingMs: vi.fn().mockResolvedValue(null),
  grantAccessWindow: vi.fn(),
  revokeAccessWindow: vi.fn(),
  ACCESS_DAYS: 30,
}));

// Signature verification is bypassed so these tests exercise payload routing
// only; signature correctness is covered elsewhere. rawBody must be present
// because the controller refuses to route without it.
vi.mock("../services/paymentProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/paymentProvider")>();
  return { ...actual, verifyInboundWebhook: vi.fn().mockReturnValue(true) };
});

vi.mock("../config/database", () => ({
  prisma: {
    paymentOrder: { findFirst: paymentOrderFindFirst, update: paymentOrderUpdate },
  },
}));

import { cashfreeWebhook } from "../controllers/paymentController";

function makeRes() {
  const res = {
    statusCode: 0 as number,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { body: Record<string, unknown> };
}

async function post(body: unknown) {
  const res = makeRes();
  // rawBody mirrors what the raw-body capture middleware attaches in production.
  await cashfreeWebhook(
    { body, rawBody: Buffer.from(JSON.stringify(body)) } as unknown as Request,
    res,
  );
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  applyRefundMock.mockResolvedValue({
    applied: true,
    refundId: "rf_1",
    amount: 100,
    accessRevoked: true,
  });
  settleMock.mockResolvedValue(true);
  paymentOrderFindFirst.mockResolvedValue(null);
});

describe("cashfree webhook routing", () => {
  it("routes a refund carrying only data.refund, which has no order_id", async () => {
    // This is the shape Cashfree actually sends. Before the fix this was
    // rejected upstream with "No order in payload" and never reached applyRefund.
    const res = await post({
      type: "REFUNDS",
      data: {
        refund: {
          refund_id: "rf_1",
          payment_id: "pay_1",
          refund_amount: 100,
          status: "REFUNDED",
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(applyRefundMock).toHaveBeenCalledWith({
      gatewayRefundId: "rf_1",
      gatewayPaymentId: "pay_1",
      payloadAmount: 100,
    });
    expect((res.body as { applied: boolean }).applied).toBe(true);
  });

  it.each(["REFUND", "AUTO_REFUND"])("handles %s the same way", async (type) => {
    await post({
      type,
      data: { refund: { refund_id: "rf_2", payment_id: "pay_1", status: "REFUNDED" } },
    });
    expect(applyRefundMock).toHaveBeenCalledTimes(1);
  });

  it("reports a refused refund honestly instead of claiming it was applied", async () => {
    applyRefundMock.mockResolvedValue({ applied: false, reason: "amount mismatch" });
    const res = await post({
      type: "REFUNDS",
      data: { refund: { refund_id: "rf_3", payment_id: "pay_1", status: "REFUNDED" } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.body as { applied: boolean; reason: string };
    expect(body.applied).toBe(false);
    expect(body.reason).toMatch(/mismatch/i);
  });

  it("does not treat a refund as a settlement and credit the wallet", async () => {
    await post({
      type: "REFUNDS",
      data: { refund: { refund_id: "rf_4", payment_id: "pay_1", status: "REFUNDED" } },
    });
    expect(settleMock).not.toHaveBeenCalled();
    expect(paymentOrderUpdate).not.toHaveBeenCalled();
  });

  it("still refuses an unidentifiable non-refund payload", async () => {
    const res = await post({ type: "PAYMENT_SUCCESS", data: {} });
    expect(res.statusCode).toBe(200);
    expect((res.body as { applied: boolean }).applied).toBe(false);
    expect(applyRefundMock).not.toHaveBeenCalled();
  });
});
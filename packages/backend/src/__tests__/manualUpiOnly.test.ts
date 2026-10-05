import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Response } from "express";

/**
 * Manual UPI is the only rail, and this pins the contract that makes it so.
 *
 * The previous default was the gateway, which meant a missing or unreadable
 * PAYMENT_MODE row sent a paying customer to hosted checkout that could not
 * complete. Cashfree is now retired, so "no configuration" has to resolve to
 * manual UPI - a slower payment, never a dead end.
 *
 * Credentials are placeholders throughout, which is the production reality now
 * that the Cashfree keys are not deployed. That is what lets one file assert both
 * failure shapes without the config cache having to be reset between them.
 */
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET = "test_refresh_secret_32chars_minimum!";
  process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
  process.env.ADMIN_EMAIL = "test@test.com";
  process.env.ADMIN_PASSWORD = "TestPass123!";
  process.env.PAYMENT_PROVIDER = "cashfree";
  process.env.CASHFREE_APP_ID = "cashfree_app_id_placeholder";
  process.env.CASHFREE_SECRET_KEY = "cashfree_secret_key_placeholder";
});

const { db } = vi.hoisted(() => ({
  db: {
    paymentOrder: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    wallet: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    transaction: { create: vi.fn() },
    notification: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    pricingConfig: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/config/database", () => ({ prisma: db }));

import * as paymentController from "../controllers/paymentController";
import { isGatewayLive, gatewayUnavailableReason, getPaymentMode, DEFAULT_PAYMENT_MODE } from "../services/paymentProvider";

const USER_ID = "user-1";
const UPI_ID = "sk12838328282@slc";

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

function fakeReq() {
  return { body: { amount: 500 }, user: { userId: USER_ID, email: "u@example.com" } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // No PAYMENT_MODE row at all: the state a fresh deployment is actually in.
  db.pricingConfig.findMany.mockResolvedValue([]);
  db.pricingConfig.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.key === "UPI_ID") return { value: UPI_ID };
    if (where?.key === "UPI_ACCOUNT_NAME") return { value: "Test Account" };
    return null;
  });
});

describe("manual UPI is the default rail", () => {
  it("defaults the mode to manual UPI, not the gateway", async () => {
    // The inversion this guards: the old check was `mode !== DEFAULT`, so making
    // manual UPI the default would have *enabled* the gateway whenever no config
    // row existed. The check is now against the explicit "gateway" value.
    expect(DEFAULT_PAYMENT_MODE).toBe("manual_upi");
    expect(await getPaymentMode()).toBe("manual_upi");
  });

  it("reports the gateway as unavailable and switched off", async () => {
    expect(await isGatewayLive()).toBe(false);
    expect(await gatewayUnavailableReason()).toBe("switched_off");
  });

  it("does not create a gateway order, a wallet row, or touch the gateway", async () => {
    const { res, state } = fakeRes();
    await paymentController.createOrder(fakeReq(), res);

    expect(state.statusCode).toBe(503);
    expect(state.body.error).toBe("MANUAL_UPI_ONLY");
    expect(db.paymentOrder.create).not.toHaveBeenCalled();
    expect(db.wallet.upsert).not.toHaveBeenCalled();
  });

  it("carries the UPI details so the client can show the QR instead of an error", async () => {
    // Without these the customer's only option is to contact support, which is not
    // an answer a payment screen can give.
    const { res, state } = fakeRes();
    await paymentController.createOrder(fakeReq(), res);

    expect(state.body.extra).toMatchObject({
      upiId: UPI_ID,
      upiAccountName: "Test Account",
      upiQrUrl: "/api/payments/upi-qr.png",
    });
  });

  it("tells the client which rail to use", async () => {
    const { res, state } = fakeRes();
    await paymentController.getPaymentConfig({} as any, res);

    expect(state.statusCode).toBe(200);
    expect(state.body.data.mode).toBe("manual_upi");
    expect(state.body.data.activeMethod).toBe("manual_upi");
    expect(state.body.data.gatewayEnabled).toBe(false);
    expect(state.body.data.cashfree).toBe(false);
    expect(state.body.data.upiManual).toBe(true);
    expect(state.body.data.upiId).toBe(UPI_ID);
  });
});
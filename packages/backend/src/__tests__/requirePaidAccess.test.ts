import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response } from "express";

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

const { hasAccessMock } = vi.hoisted(() => ({ hasAccessMock: vi.fn() }));

vi.mock("../services/refundService", () => ({
  hasAccess: hasAccessMock,
  accessRemainingMs: vi.fn().mockResolvedValue(0),
  grantAccessWindow: vi.fn(),
  revokeAccessWindow: vi.fn(),
  applyRefund: vi.fn(),
  ACCESS_DAYS: 30,
}));

import { readFileSync } from "fs";
import { join } from "path";
import { requirePaidAccess } from "../middleware/requirePaidAccess";
import { authenticateToken, requireKycVerified } from "../middleware/auth";

const readSrc = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

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
  return res as unknown as Response & { body: Record<string, { code?: string }> };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requirePaidAccess", () => {
  it("passes an entitled user through", async () => {
    hasAccessMock.mockResolvedValue(true);
    const next = vi.fn();
    const res = makeRes();
    await requirePaidAccess({ user: { userId: "u1" } } as never, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it("refuses an expired user with a code the client can act on", async () => {
    hasAccessMock.mockResolvedValue(false);
    const next = vi.fn();
    const res = makeRes();
    await requirePaidAccess({ user: { userId: "u1" } } as never, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("PAID_ACCESS_REQUIRED");
  });

  it("fails closed when the access check itself errors", async () => {
    // Failing open here is the same as shipping no gate: a database blip would
    // silently hand the paid surface to anyone who asked during it.
    hasAccessMock.mockRejectedValue(new Error("db down"));
    const next = vi.fn();
    const res = makeRes();
    await requirePaidAccess({ user: { userId: "u1" } } as never, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
  });

  it("checks the clock on every request rather than caching the decision", async () => {
    hasAccessMock.mockResolvedValue(true);
    const next = vi.fn();
    await requirePaidAccess({ user: { userId: "u1" } } as never, makeRes(), next);
    await requirePaidAccess({ user: { userId: "u1" } } as never, makeRes(), next);
    // Two requests, two reads. A cached verdict would outlive the window it was
    // based on, which is precisely the failure the timestamp exists to avoid.
    expect(hasAccessMock).toHaveBeenCalledTimes(2);
  });
});

describe("dating is behind the gate", () => {
  it("applies the paid-access middleware to the whole router", () => {
    const routes = readSrc("routes/datingRoutes.ts");
    expect(routes).toContain("requirePaidAccess");
    // router.use, so a route added later is covered by default rather than
    // depending on whoever writes it remembering to add the guard.
    expect(routes).toMatch(/router\.use\([^)]*requirePaidAccess/);
  });

  it("orders the gate after auth, since it reads the caller's identity", () => {
    const routes = readSrc("routes/datingRoutes.ts");
    const line = routes.split("\n").find((l) => l.includes("router.use(")) ?? "";
    expect(line.indexOf("authenticateToken")).toBeLessThan(line.indexOf("requirePaidAccess"));
    // And after KYC: an unverified user should be told to verify, not to pay.
    expect(line.indexOf("requireKycVerified")).toBeLessThan(
      line.indexOf("requirePaidAccess"),
    );
  });

  it("exposes the gate from auth as well, so other routes can reuse it", () => {
    expect(typeof authenticateToken).toBe("function");
    expect(typeof requireKycVerified).toBe("function");
  });
});
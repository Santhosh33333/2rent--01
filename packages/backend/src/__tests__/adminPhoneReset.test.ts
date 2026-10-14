import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Clearing a mobile number back to unset (Admin -> Users -> Change phone).
 *
 * This is the escape hatch for accounts created before the placeholder policy,
 * which still carry a fabricated `+91...` number from a social sign-up. Once the
 * account holds a placeholder the owner may set a real number exactly once
 * again (services/phonePolicy.ts), so the thing worth pinning here is that a
 * reset actually installs that placeholder and not some empty or real-looking
 * value, that the old number is gone from the "verified" bookkeeping, and that
 * an administrator performed it.
 */

const { prismaMock } = vi.hoisted(() => {
  // This config has no global setupFiles (by design), so a file that imports a
  // controller must establish the environment itself before the import runs.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET ??= "test_access_secret_32chars_minimum!";
  process.env.JWT_REFRESH_SECRET ??= "test_refresh_secret_32chars_minimum!";
  process.env.JWT_SECRET ??= "test_jwt_secret_32chars_minimum_2026!";
  process.env.ADMIN_EMAIL ??= "test@test.com";
  process.env.ADMIN_PASSWORD ??= "TestPass123!";
  process.env.CASHFREE_APP_ID ??= "test_cashfree_app_id";
  process.env.CASHFREE_SECRET_KEY ??= "test_cashfree_secret_key";
  process.env.GOOGLE_CLIENT_ID ??= "test.apps.googleusercontent.com";
  process.env.SMTP_HOST ??= "smtp.test.com";
  process.env.SMTP_USER ??= "test@test.com";
  process.env.SMTP_PASS ??= "testpass";

  return {
    prismaMock: {
      user: { findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
      verification: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import * as adminController from "../controllers/adminController";

const ADMIN = "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb";
const TARGET = "eeeeeeee-4444-4555-8666-ffffffffffff";

type MockRes = {
  statusCode: number;
  payload: any;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

/** `res` is typed `never` so it satisfies the express `Response` parameter
 *  without recreating the whole Response surface here (the repo's other
 *  controller tests do the same). Only `out` is ever read back. */
function makeRes(): { res: never; out: MockRes } {
  const out: MockRes = {
    statusCode: 0,
    payload: null,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.payload = b;
      return this;
    },
  };
  return { res: out as unknown as never, out };
}

const makeReq = (opts: { body?: Record<string, unknown>; targetId?: string } = {}) => ({
  params: { id: opts.targetId ?? TARGET },
  body: opts.body ?? {},
  user: { userId: ADMIN, role: "ADMIN", activeRole: "ADMIN" },
} as any);

const statusOf = (r: { out: MockRes }) => r.out.statusCode;
const body = (r: { out: MockRes }) => r.out.payload;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({
    id: TARGET,
    role: "USER",
    activeRole: "USER",
    phone: "+911234567890",
    mobileVerified: true,
  });
});

describe("admin reset of a mobile number", () => {
  it("installs the unset placeholder and audits the change", async () => {
    prismaMock.$transaction.mockResolvedValue([{}, {}, { count: 1 }]);

    const r = makeRes();
    await adminController.updateUserPhone(makeReq({ body: { reset: true } }), r.res);

    expect(statusOf(r)).toBe(200);
    // The whole point: a value that is obviously not a phone and that
    // isPlaceholderPhone() accepts, so the owner may set a real number once more.
    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.data.phone).toBe(`pending:${TARGET}`);
    expect(updateCall.data.mobileVerified).toBe(false);
    // Not a real number, so nothing downstream should be able to dial it or show
    // it as one.
    expect(updateCall.data.phone).toMatch(/^pending:/);

    // The old number must not survive as a verification record.
    expect(prismaMock.verification.updateMany).toHaveBeenCalledWith({
      where: { userId: TARGET, confirmedPhone: { not: null } },
      data: { confirmedPhone: null },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "RESET_USER_PHONE",
          entityId: TARGET,
          metadata: expect.stringContaining("+911234567890"),
        }),
      })
    );
    expect(body(r).data.phone).toBeNull();
    expect(body(r).data.phoneUnset).toBe(true);
    expect(body(r).data.phoneVerified).toBe(false);
  });

  it("does not run the duplicate-number check, since no number is being installed", async () => {
    prismaMock.$transaction.mockResolvedValue([{}, {}, { count: 0 }]);

    const r = makeRes();
    await adminController.updateUserPhone(makeReq({ body: { reset: true } }), r.res);

    expect(statusOf(r)).toBe(200);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a request with neither a new number nor a reset", async () => {
    const r = makeRes();
    await adminController.updateUserPhone(makeReq({ body: {} }), r.res);

    expect(statusOf(r)).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("still installs a real number when no reset is asked for", async () => {
    prismaMock.$transaction.mockResolvedValue([{}, {}, { count: 1 }]);
    prismaMock.user.findFirst.mockResolvedValue(null);

    const r = makeRes();
    await adminController.updateUserPhone(makeReq({ body: { phone: "+91 98123 45670" } }), r.res);

    expect(statusOf(r)).toBe(200);
    const updateCall = prismaMock.user.update.mock.calls[0][0];
    expect(updateCall.data.phone).toBe("+919812345670");
    expect(updateCall.data.mobileVerified).toBe(false);
    expect(prismaMock.user.findFirst).toHaveBeenCalled();
  });
});

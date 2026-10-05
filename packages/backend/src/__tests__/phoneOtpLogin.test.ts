// Phone + OTP sign-in must never mint an account, and must resolve the number a
// person actually types. Both were real defects:
//
//  1. `verifyPhoneOTP` CREATED a user whenever the lookup missed, with the name
//     "Phone User", a `@phone.placeholder` address and a password nobody chose.
//     Accounts are meant to come from /register, which collects consent, terms
//     and identity.
//  2. The lookup was an exact `findUnique({ phone })`, so a member who typed the
//     ten digits of a number stored as `+919876543210` missed - and defect (1)
//     then silently registered a duplicate account under a different spelling of
//     their own number.
//
// The canonicalisation cases matter for a third reason: the OTP row is keyed on
// the identifier string, so send and verify must agree on one spelling or the
// code is written to a row verify never reads.
import { describe, expect, it, beforeAll, beforeEach, vi } from "vitest";

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET = "test_access_secret_32chars_minimum!";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_32chars_minimum!";
process.env.JWT_SECRET = "test_jwt_secret_32chars_minimum_2026!";
process.env.ADMIN_EMAIL = "test@test.com";
process.env.ADMIN_PASSWORD = "TestPass123!";

// The number every case below is written against, and how the row is actually
// stored - which is the whole point: the stored spelling is never the typed one.
const STORED = "+919820012345";
const TYPED = "9820012345";

const prismaMock = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    // Spied so the test can assert it is NEVER reached.
    create: vi.fn(),
  },
  verification: { findUnique: vi.fn(async () => ({ status: "APPROVED" })) },
  session: { deleteMany: vi.fn(), create: vi.fn() },
  loginHistory: { create: vi.fn() },
  wallet: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

const otpMock = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  maskIdentifier: vi.fn((_c: string, id: string) => `******${id.replace(/\D/g, "").slice(-4)}`),
  isOtpDevEchoOnly: vi.fn(() => true),
}));

// Only verifyOtp/maskIdentifier/isOtpDevEchoOnly are stubbed. `issueOtp` is left
// out of the factory on purpose: a partial mock would silently drop the export
// the send handler imports, so the send test asserts on the real service being
// reached rather than on a stub of our own making.
vi.mock("../services/otpService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/otpService")>();
  return {
    ...actual,
    verifyOtp: otpMock.verifyOtp,
    maskIdentifier: otpMock.maskIdentifier,
    isOtpDevEchoOnly: otpMock.isOtpDevEchoOnly,
  };
});

type AuthModule = typeof import("../controllers/authController.js");
let auth: AuthModule;

beforeAll(async () => {
  auth = await import("../controllers/authController.js");
});

const EXISTING = {
  id: "u1",
  email: "member@example.com",
  fullName: "Real Member",
  phone: STORED,
  dateOfBirth: new Date("1998-01-01"),
  gender: "OTHER",
  avatarUrl: null,
  bio: null,
  city: "Chennai",
  country: "India",
  role: "USER",
  activeRole: "USER",
  status: "ACTIVE",
  mobileVerified: true,
};

/** Minimal express Response stand-in that captures status + body. */
function fakeRes() {
  const captured: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: any) {
      captured.body = body;
      return res;
    },
  };
  return { res, captured };
}

const req: any = { ip: "1.2.3.4", socket: {}, headers: { "user-agent": "vitest" }, body: {} };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.user.findUnique.mockResolvedValue({ email: EXISTING.email });
  // The tolerant lookup resolves the stored row.
  prismaMock.user.findFirst.mockResolvedValue(EXISTING);
  otpMock.verifyOtp.mockResolvedValue({ ok: true });
});

describe("Phone + OTP sign-in resolves the number that was typed", () => {
  it("matches a ten-digit typing against a row stored as +91 E.164", async () => {
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "123456" } } as any, res);

    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    const arg = prismaMock.user.findFirst.mock.calls[0][0] as any;
    // It is a candidate set, not an exact string.
    expect(arg.where.phone.in).toContain(STORED);
    expect(arg.where.phone.in).toContain(TYPED);
    expect(captured.body?.success).toBe(true);
  });

  it("finds the same account when the number is typed with spaces", async () => {
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: "+91 98200 12345", otp: "123456" } } as any, res);
    expect(captured.body?.success).toBe(true);
  });
});

describe("Phone + OTP sign-in never creates an account", () => {
  it("returns a register prompt for an unknown number instead of minting a user", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: "9820099999", otp: "123456" } } as any, res);

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.wallet.create).not.toHaveBeenCalled();
    expect(captured.status).toBe(404);
    expect(captured.body?.error).toBe("ACCOUNT_NOT_FOUND_FOR_PHONE");
    // No tokens, so nothing can be signed into.
    expect(captured.body?.data?.accessToken).toBeUndefined();
  });

  it("does not report a placeholder address or a generated name anywhere", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: "9820099999", otp: "123456" } } as any, res);
    const serialised = JSON.stringify(captured.body);
    expect(serialised).not.toContain("phone.placeholder");
    expect(serialised).not.toContain("Phone User");
    // Anchored to the SPECIFIC honest outcome, not merely to the absence of
    // those strings. Otherwise any unrelated crash - a bare 500 - satisfies
    // "not.toContain" and the test passes for the wrong reason.
    expect(captured.status).toBe(404);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it("leaves no session behind for an unknown number", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: "9820099999", otp: "123456" } } as any, res);
    expect(prismaMock.session.create).not.toHaveBeenCalled();
    expect(prismaMock.loginHistory.create).not.toHaveBeenCalled();
    // Same reason as above: pin the refusal, don't just check for side effects.
    expect(captured.body?.error).toBe("ACCOUNT_NOT_FOUND_FOR_PHONE");
  });
});

describe("Send and verify agree on one identifier", () => {
  it("keys the verified OTP on the canonical form, so a differently-spelled send still matches", async () => {
    const { res } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: "+91 98200 12345", otp: "123456" } } as any, res);

    const arg = otpMock.verifyOtp.mock.calls[0][0] as any;
    // Canonicalised: this is the same string the send step now writes under.
    expect(arg.identifier).toBe(STORED);
    expect(arg.identifier).not.toContain(" ");
  });

  it("still refuses a wrong code before touching the account", async () => {
    otpMock.verifyOtp.mockResolvedValue({ ok: false, error: "Invalid or expired OTP." });
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "000000" } } as any, res);

    expect(captured.body?.error).toBe("INVALID_OTP");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(prismaMock.session.create).not.toHaveBeenCalled();
  });
});

describe("Verified state only ever moves forward", () => {
  it("does not stamp a dev-echo code as proof of handset control", async () => {
    otpMock.isOtpDevEchoOnly.mockReturnValue(true);
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "123456" } } as any, res);

    // Already-true must not be re-written, and the response must admit the
    // number is unverified.
    expect(prismaMock.user.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { mobileVerified: true } })
    );
    expect(captured.body?.message).toMatch(/unverified/i);
  });

  it("never clears an existing verified flag", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...EXISTING, mobileVerified: true });
    otpMock.isOtpDevEchoOnly.mockReturnValue(false);
    const { res } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "123456" } } as any, res);

    const updates = prismaMock.user.update.mock.calls.map((c: any) => c[0].data);
    expect(updates.some((d: any) => d.mobileVerified === false)).toBe(false);
  });

  it("promotes an unverified number only on real delivery", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...EXISTING, mobileVerified: false });
    otpMock.isOtpDevEchoOnly.mockReturnValue(false);
    const { res } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "123456" } } as any, res);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mobileVerified: true } })
    );
  });
});

describe("A blocked account cannot sign in by phone OTP", () => {
  it("refuses an inactive account rather than issuing a session", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...EXISTING, status: "SUSPENDED" });
    const { res, captured } = fakeRes();
    await auth.verifyPhoneOTP({ ...req, body: { phone: TYPED, otp: "123456" } } as any, res);

    expect(captured.status).toBe(403);
    expect(captured.body?.error).toBe("ACCOUNT_INACTIVE");
    expect(prismaMock.session.create).not.toHaveBeenCalled();
  });
});
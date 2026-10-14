import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Google sign-in profile-picture rule.
 *
 * Signing in with Google used to copy the account's Google picture onto the
 * Nabri profile on EVERY sign-in, so a member who had set (or deliberately
 * removed) their own photo found it silently replaced by their Google avatar the
 * next time they signed in. The picture belongs to the member: Google may seed
 * it only when the account is first created, and never overwrite an existing one.
 */

const { prismaMock, firebaseMock, txMock } = vi.hoisted(() => {
  // No global setupFiles in this config, so a file importing a controller must
  // establish the environment before the import runs.
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
      user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
      session: { create: vi.fn(), deleteMany: vi.fn() },
      loginHistory: { create: vi.fn() },
      verification: { findUnique: vi.fn() },
      wallet: { create: vi.fn() },
      $transaction: vi.fn(),
    },
    firebaseMock: {
      getFirebaseAuth: vi.fn(() => ({})),
      verifyIdToken: vi.fn(),
      getUserByPhone: vi.fn(),
      getUserByEmail: vi.fn(),
      createUserWithPhone: vi.fn(),
      createUserWithEmail: vi.fn(),
    },
    txMock: {
      user: { create: vi.fn() },
      wallet: { create: vi.fn() },
    },
  };
});

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../services/firebaseAuthService", () => firebaseMock);
vi.mock("../services/trialAccessService", () => ({ grantSignupTrial: vi.fn() }));

import { googleSignIn } from "../controllers/authController";

const GOOGLE_PICTURE = "https://lh3.googleusercontent.com/a/photo.jpg";
const MY_PHOTO = "/uploads/my-own-photo.jpg";

function makeRes() {
  const out: any = {
    statusCode: 0,
    payload: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.payload = b; return this; },
  };
  return out;
}

const req = {
  body: { idToken: "stub-id-token" },
  ip: "127.0.0.1",
  socket: { remoteAddress: "127.0.0.1" },
  headers: {},
} as unknown as never;

beforeEach(() => {
  vi.clearAllMocks();
  firebaseMock.getFirebaseAuth.mockReturnValue({});
  firebaseMock.verifyIdToken.mockResolvedValue({
    uid: "google-123",
    email: "user@example.com",
    name: "User Name",
    picture: GOOGLE_PICTURE,
  });
  prismaMock.user.findUnique.mockResolvedValue({ email: "user@example.com" });
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.session.create.mockResolvedValue({});
  prismaMock.session.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.loginHistory.create.mockResolvedValue({});
  prismaMock.verification.findUnique.mockResolvedValue(null);
});

describe("Google sign-in and the profile picture", () => {
  it("never overwrites an existing member's chosen picture", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      fullName: "User Name",
      phone: "+919876543211",
      role: "USER",
      activeRole: "USER",
      avatarUrl: MY_PHOTO,
    });

    const res = makeRes();
    await googleSignIn(req, res as never);

    expect(res.statusCode).toBe(200);
    // The member's own photo must survive the Google sign-in untouched...
    const avatarWrites = prismaMock.user.update.mock.calls.filter(
      (call: any[]) => call[0]?.data && "avatarUrl" in call[0].data,
    );
    expect(avatarWrites).toHaveLength(0);
    // ...and the session payload must echo their photo, not Google's.
    expect(res.payload.data.user.avatarUrl).toBe(MY_PHOTO);
  });

  it("still seeds the Google picture on a brand-new account", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
    txMock.user.create.mockResolvedValue({
      id: "user-new",
      email: "user@example.com",
      fullName: "User Name",
      phone: "+919876543211",
      role: "USER",
      activeRole: "USER",
      avatarUrl: GOOGLE_PICTURE,
    });
    txMock.wallet.create.mockResolvedValue({});

    const res = makeRes();
    await googleSignIn(req, res as never);

    expect(res.statusCode).toBe(200);
    const created = txMock.user.create.mock.calls[0][0];
    expect(created.data.avatarUrl).toBe(GOOGLE_PICTURE);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The social-signup phone placeholder and the "set a real number exactly once"
 * rule.
 *
 * Google never returns a phone number, so those accounts used to store a
 * fabricated `+91<provider id prefix>` - a plausible Indian mobile that could
 * even collide with a genuine user's number. They now store a `pending:` marker
 * and the owner may claim a number once, after which it is admin-only. These
 * tests pin both halves so the fabrication cannot come back.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../config/env", () => ({
  env: new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => (typeof prop === "string" ? "test" : undefined),
  }),
}));
vi.mock("../services/socketService", () => ({ getIO: () => null }));
vi.mock("../services/emailService", () => ({
  sendSosAlertEmail: vi.fn(),
  sosRecipients: vi.fn(() => []),
}));

import { isPlaceholderPhone, placeholderPhone, PLACEHOLDER_PHONE_PREFIX } from "../services/phonePolicy";
import { maskPhone, phoneForViewer } from "../services/phoneVisibility";
import { updateProfile } from "../controllers/userController";

const ME = "user-1-1111-1111-111111111111";
const REAL = "9820012345";
const REAL_E164 = "+919820012345";

function makeRes() {
  const out: any = {
    statusCode: 0,
    payload: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.payload = b; return this; },
  };
  return out;
}

describe("phonePolicy", () => {
  it("treats empty and the placeholder as no number, a real number as set", () => {
    expect(isPlaceholderPhone(null)).toBe(true);
    expect(isPlaceholderPhone(undefined)).toBe(true);
    expect(isPlaceholderPhone("")).toBe(true);
    expect(isPlaceholderPhone(placeholderPhone("google-sub-1"))).toBe(true);
    expect(isPlaceholderPhone(REAL_E164)).toBe(false);
  });

  it("builds a placeholder that is not a dialable number and is unique per account", () => {
    const a = placeholderPhone("sub-a");
    const b = placeholderPhone("sub-b");
    expect(a.startsWith(PLACEHOLDER_PHONE_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^\+91\d{10}$/);
  });

  it("never renders a placeholder as a phone number, to anyone", () => {
    const p = placeholderPhone("google-sub-1");
    expect(maskPhone(p)).toBeNull();
    expect(phoneForViewer(p, ME, ME)).toEqual({ phone: null, phoneVisible: false, phoneMasked: false });
    expect(phoneForViewer(p, "someone-else", ME).phone).toBeNull();
  });
});

describe("updateProfile phone rules", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findFirst.mockReset();
    prismaMock.user.update.mockReset();
  });

  it("lets a placeholder (social) account set a real number once, stored unverified", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "A", gender: "OTHER", city: "", dateOfBirth: null, phone: placeholderPhone("sub-1"),
    });
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue({
      id: ME, fullName: "A", dateOfBirth: null, bio: null, city: "", country: null,
      gender: "OTHER", phone: REAL_E164, mobileVerified: false, role: "USER", activeRole: "USER",
    });
    const res = makeRes();

    await updateProfile({ user: { userId: ME }, body: { phone: REAL } } as never, res as never);

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: REAL_E164, mobileVerified: false }),
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload?.success).toBe(true);
  });

  it("refuses to change a number that is already real", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "A", gender: "OTHER", city: "Chennai", dateOfBirth: null, phone: REAL_E164,
    });
    const res = makeRes();

    await updateProfile({ user: { userId: ME }, body: { phone: "9876500000" } } as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(res.payload?.error).toBe("PHONE_CHANGE_ADMIN_ONLY");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid number", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "A", gender: "OTHER", city: "", dateOfBirth: null, phone: placeholderPhone("sub-1"),
    });
    const res = makeRes();

    await updateProfile({ user: { userId: ME }, body: { phone: "12345" } } as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses a sample number that a real person could not be reached on", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "A", gender: "OTHER", city: "", dateOfBirth: null, phone: placeholderPhone("sub-1"),
    });
    const res = makeRes();

    await updateProfile({ user: { userId: ME }, body: { phone: "9876543210" } } as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.payload?.error).toBe("PHONE_PLACEHOLDER");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses a number already registered to someone else", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      fullName: "A", gender: "OTHER", city: "", dateOfBirth: null, phone: placeholderPhone("sub-1"),
    });
    prismaMock.user.findFirst.mockResolvedValue({ id: "someone-else" });
    const res = makeRes();

    await updateProfile({ user: { userId: ME }, body: { phone: REAL } } as never, res as never);

    expect(res.statusCode).toBe(409);
    expect(res.payload?.error).toBe("PHONE_TAKEN");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The 18+ gate and the "date of birth is frozen once chosen" rule.
 *
 * The profile self-edit path used to accept any past date and let the owner
 * rewrite it freely - both a way around the legal minimum age and a way to
 * re-age an account. These tests pin the shared policy so the rule cannot
 * silently loosen again.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
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

import {
  ageInYears,
  isDateOfBirthLocked,
  parseDateOfBirth,
  DEFAULT_SIGNUP_DOB,
} from "../services/dateOfBirthPolicy";
import { updateProfile } from "../controllers/userController";

const ME = "user-1-1111-1111-111111111111";

function makeRes() {
  const out: any = {
    statusCode: 0,
    payload: null,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.payload = b; return this; },
  };
  return out;
}

describe("dateOfBirthPolicy", () => {
  it("accepts an adult date of birth", () => {
    const r = parseDateOfBirth("1995-06-15");
    expect(r.ok).toBe(true);
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    const r = parseDateOfBirth("15/06/1995");
    expect(r.ok).toBe(false);
  });

  it("rejects a future date", () => {
    const future = new Date();
    future.setUTCFullYear(future.getUTCFullYear() + 1);
    const r = parseDateOfBirth(future.toISOString().slice(0, 10));
    expect(r.ok).toBe(false);
  });

  it("rejects an under-18 date of birth", () => {
    const now = new Date();
    const minor = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate() + 1));
    const r = parseDateOfBirth(minor.toISOString().slice(0, 10));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/18/);
  });

  it("accepts the exact 18th birthday", () => {
    const now = new Date();
    const exactly18 = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()));
    const r = parseDateOfBirth(exactly18.toISOString().slice(0, 10));
    expect(r.ok).toBe(true);
  });

  it("counts whole years correctly across the birthday boundary", () => {
    const now = new Date(Date.UTC(2026, 0, 14));
    expect(ageInYears(new Date(Date.UTC(2008, 0, 14)), now)).toBe(18);
    expect(ageInYears(new Date(Date.UTC(2008, 0, 15)), now)).toBe(17);
    expect(ageInYears(new Date(Date.UTC(1998, 5, 1)), now)).toBe(27);
  });

  it("treats the signup placeholder and null as not-yet-chosen, everything else as locked", () => {
    expect(isDateOfBirthLocked(null)).toBe(false);
    expect(isDateOfBirthLocked(DEFAULT_SIGNUP_DOB)).toBe(false);
    expect(isDateOfBirthLocked("1995-06-15")).toBe(true);
  });
});

describe("updateProfile date-of-birth rules", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset();
  });

  it("refuses an under-18 date of birth", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ fullName: "A", gender: "OTHER", city: "", dateOfBirth: null });
    const res = makeRes();
    const now = new Date();
    const minor = new Date(Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate() + 1));

    await updateProfile(
      { user: { userId: ME }, body: { dateOfBirth: minor.toISOString().slice(0, 10) } } as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses to change a date of birth that has already been chosen", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ fullName: "A", gender: "OTHER", city: "Chennai", dateOfBirth: new Date("1990-01-01T00:00:00.000Z") });
    const res = makeRes();

    await updateProfile(
      { user: { userId: ME }, body: { dateOfBirth: "1991-02-02" } } as never,
      res as never,
    );

    expect(res.statusCode).toBe(403);
    expect(res.payload?.error).toBe("DATE_OF_BIRTH_CHANGE_ADMIN_ONLY");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("allows a social-signup member to choose their real date once", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ fullName: "A", gender: "OTHER", city: "", dateOfBirth: new Date("2000-01-01T00:00:00.000Z") });
    prismaMock.user.update.mockResolvedValue({ id: ME, fullName: "A", dateOfBirth: new Date("1995-06-15T00:00:00.000Z"), bio: null, city: "", country: null, gender: "OTHER", role: "USER", activeRole: "USER" });
    const res = makeRes();

    await updateProfile(
      { user: { userId: ME }, body: { dateOfBirth: "1995-06-15" } } as never,
      res as never,
    );

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dateOfBirth: new Date("1995-06-15T00:00:00.000Z") }) }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.payload?.success).toBe(true);
  });
});

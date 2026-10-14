import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The KYC step-1 phone rule.
 *
 * A social sign-up that never supplied a number holds a `pending:<provider id>`
 * placeholder, which cannot match anything the user types. Requiring a match
 * therefore made step 1 impossible to pass - the user re-entered the same
 * details and was refused every time. A placeholder must instead be adoptable;
 * a real stored number must stay admin-only.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    verification: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    verificationHistory: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import { submitPersonalDetails } from "../controllers/verificationController";

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

const body = {
  fullName: "Asha Rao",
  dateOfBirth: "1995-06-15",
  gender: "FEMALE",
  city: "Chennai",
  country: "India",
  address: "12 Street",
  // Deliberately NOT a run/counter (9876543211 breaks its run at the last
  // digit); 9876543210 would be refused as a sample number on entry.
  phone: "9876543211",
};

function setup(accountPhone: string | null) {
  prismaMock.verification.findUnique.mockResolvedValue({ id: "ver-1", status: "NOT_STARTED", personalDetails: null });
  prismaMock.user.findUnique.mockResolvedValue({ phone: accountPhone });
}

describe("submitPersonalDetails phone rule", () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.update.mockReset().mockReturnValue({});
    prismaMock.verification.findUnique.mockReset();
    prismaMock.verification.create.mockReset();
    prismaMock.verification.update.mockReset().mockReturnValue({});
    prismaMock.verificationHistory.create.mockReset().mockReturnValue({});
    prismaMock.$transaction.mockReset().mockImplementation(async (ops: unknown) => ops);
  });

  it("adopts the number when the account holds only a placeholder", async () => {
    setup("pending:google-123");
    const res = makeRes();
    await submitPersonalDetails({ user: { userId: ME }, body } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const arg = prismaMock.user.update.mock.calls[0][0] as { data: { phone?: string } };
    expect(arg.data.phone).toBe("+919876543211");
  });

  it("refuses a number that does not match a real account number", async () => {
    setup("+919000000001");
    const res = makeRes();
    await submitPersonalDetails({ user: { userId: ME }, body } as never, res as never);
    expect(res.statusCode).toBe(422);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("accepts a matching number without rewriting it", async () => {
    setup("+919876543211");
    const res = makeRes();
    await submitPersonalDetails({ user: { userId: ME }, body } as never, res as never);
    expect(res.statusCode).toBe(200);
    const arg = prismaMock.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect("phone" in arg.data).toBe(false);
  });
});

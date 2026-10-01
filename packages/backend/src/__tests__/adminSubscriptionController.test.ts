import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, auditMock } = vi.hoisted(() => ({
  prismaMock: {
    subscriptionPlan: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    subscription: { count: vi.fn(), groupBy: vi.fn() },
  },
  auditMock: vi.fn(async () => {}),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../rbac/audit", () => ({ auditAdminAction: auditMock }));

import * as ctrl from "../controllers/adminSubscriptionController";

type MockRes = {
  statusCode: number;
  payload: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function makeRes(): { res: MockRes; out: MockRes } {
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
  return { res: out, out };
}

function makeReq(body: Record<string, unknown> = {}, params: Record<string, string> = {}) {
  return { body, params, user: { userId: "admin_1" } } as never;
}

const EXISTING = {
  id: "plan_1",
  code: "nabri_monthly",
  name: "Nabri Monthly",
  price: 10,
  currency: "INR",
  durationDays: 30,
  trialDays: 1,
  isActive: true,
  displayOrder: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.subscriptionPlan.findUnique.mockResolvedValue(EXISTING);
  prismaMock.subscriptionPlan.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({ ...EXISTING, ...data }),
  );
  prismaMock.subscriptionPlan.findMany.mockResolvedValue([EXISTING]);
  prismaMock.subscription.groupBy.mockResolvedValue([
    { planId: "plan_1", status: "ACTIVE", _count: { _all: 2 } },
  ]);
  prismaMock.subscription.count.mockResolvedValue(0);
});

describe("admin updatePlan", () => {
  it("rejects a non-positive price without writing", async () => {
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({ price: 0 }), res as never);
    expect(out.statusCode).toBe(400);
    expect(prismaMock.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed currency code", async () => {
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({ currency: "rupees" }), res as never);
    expect(out.statusCode).toBe(400);
    expect(prismaMock.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("rejects a fractional trial length", async () => {
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({ trialDays: 1.5 }), res as never);
    expect(out.statusCode).toBe(400);
  });

  it("rejects an empty update rather than silently no-op", async () => {
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({}), res as never);
    expect(out.statusCode).toBe(400);
    expect((out.payload as { error?: string }).error).toBe("NO_CHANGES");
  });

  it("applies a price change and records an audit entry", async () => {
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({ price: 19, reason: "seasonal" }), res as never);
    expect(out.statusCode).toBe(200);
    expect(prismaMock.subscriptionPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { price: 19 } }),
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRICING_PLAN_UPDATE",
        section: "PRICING",
        reason: "seasonal",
      }),
    );
  });

  it("404s an unknown plan code", async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(null);
    const { res, out } = makeRes();
    await ctrl.updatePlan(makeReq({ price: 5 }, { code: "nope" }), res as never);
    expect(out.statusCode).toBe(404);
  });
});

describe("admin togglePlan", () => {
  it("refuses to deactivate a plan that still has active subscribers", async () => {
    prismaMock.subscription.count.mockResolvedValue(3);
    const { res, out } = makeRes();
    await ctrl.togglePlan(makeReq({}, { code: "nabri_monthly" }), res as never);
    expect(out.statusCode).toBe(409);
    expect(prismaMock.subscriptionPlan.update).not.toHaveBeenCalled();
  });

  it("deactivates when no active subscribers remain", async () => {
    const { res, out } = makeRes();
    await ctrl.togglePlan(makeReq({}, { code: "nabri_monthly" }), res as never);
    expect(out.statusCode).toBe(200);
    expect(prismaMock.subscriptionPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});

describe("admin createPlan", () => {
  it("rejects a duplicate plan code", async () => {
    const { res, out } = makeRes();
    await ctrl.createPlan(
      makeReq({ code: "nabri_monthly", name: "Dup", price: 10, durationDays: 30 }),
      res as never,
    );
    expect(out.statusCode).toBe(409);
    expect(prismaMock.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it("normalises the code and defaults the currency", async () => {
    prismaMock.subscriptionPlan.findUnique.mockResolvedValue(null);
    prismaMock.subscriptionPlan.create.mockResolvedValue(EXISTING);
    const { res, out } = makeRes();
    await ctrl.createPlan(
      makeReq({ code: "  Nabri_Pro  ", name: "Pro", price: 149, durationDays: 365 }),
      res as never,
    );
    expect(out.statusCode).toBe(200);
    expect(prismaMock.subscriptionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: "nabri_pro", currency: "INR" }),
      }),
    );
  });
});

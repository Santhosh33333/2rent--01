import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    connectionCategory: { findMany: vi.fn() },
    connectionRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    connectionRequestRecipient: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    partner: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    userBlock: { findMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../services/socketService", () => ({ emitToUser: vi.fn(), getIO: vi.fn(() => null) }));

import * as service from "../services/connectionRequestService";
import { emitToUser } from "../services/socketService";
import * as ctrl from "../controllers/connectionRequestController";

const now = new Date("2026-10-17T10:00:00.000Z");

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req_1",
    requesterId: "u1",
    categoryKey: "DATING",
    mode: "CALL",
    status: "SEARCHING",
    partnerId: null,
    expiresAt: new Date(now.getTime() + 120_000),
    pricePerMinute: "1.00",
    estimatedMinutes: 10,
    totalAmount: "0.00",
    connectedAt: null,
    endedAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

type MockRes = {
  statusCode: number;
  payload: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function makeRes(): { res: MockRes; out: MockRes } {
  const out: MockRes = {
    statusCode: 200,
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

function authed(userId = "u1") {
  return { user: { userId } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Empty category table -> the read path falls back to the ten built-in
  // defaults (DATING: chat free, call ₹1/min, video off).
  prismaMock.connectionCategory.findMany.mockResolvedValue([]);
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.connectionRequestRecipient.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.connectionRequestRecipient.createMany.mockResolvedValue({ count: 1 });
});

describe("mode pricing helpers", () => {
  const category = {
    key: "DATING",
    label: "Dating",
    description: null,
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: 0,
    callPricePerMinute: 1,
    videoPricePerMinute: 3,
    enabled: true,
    sortOrder: 10,
  };

  it("reads the price for the chosen channel", () => {
    expect(service.priceFor(category, "CHAT")).toBe(0);
    expect(service.priceFor(category, "CALL")).toBe(1);
    expect(service.priceFor(category, "VIDEO")).toBe(3);
  });

  it("honours each channel's enabled flag", () => {
    expect(service.modeEnabled(category, "CHAT")).toBe(true);
    expect(service.modeEnabled(category, "VIDEO")).toBe(false);
  });

  it("recognises only the three real modes", () => {
    expect(service.isConnectionMode("CALL")).toBe(true);
    expect(service.isConnectionMode("VIDEO")).toBe(true);
    expect(service.isConnectionMode("walking")).toBe(false);
  });
});

describe("createConnectionRequest validation", () => {
  it("rejects a missing category", async () => {
    const out = await service.createConnectionRequest("u1", { mode: "CALL" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an unknown mode", async () => {
    const out = await service.createConnectionRequest("u1", { categoryKey: "DATING", mode: "TELEPATHY" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a category that does not exist", async () => {
    const out = await service.createConnectionRequest("u1", { categoryKey: "NOPE", mode: "CALL" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("INVALID_CATEGORY");
  });

  it("refuses a channel the category does not offer (video is off by default)", async () => {
    const out = await service.createConnectionRequest("u1", { categoryKey: "DATING", mode: "VIDEO" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("MODE_DISABLED");
  });

  it("refuses a second search while one is already open", async () => {
    prismaMock.connectionRequest.findFirst.mockResolvedValue({ id: "existing" });
    const out = await service.createConnectionRequest("u1", { categoryKey: "DATING", mode: "CALL" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("ALREADY_SEARCHING");
  });

  it("says so honestly when no partner is eligible", async () => {
    prismaMock.connectionRequest.findFirst.mockResolvedValue(null);
    prismaMock.partner.findMany.mockResolvedValue([]);
    const out = await service.createConnectionRequest("u1", { categoryKey: "DATING", mode: "CALL" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("NO_PARTNERS_AVAILABLE");
    expect(prismaMock.connectionRequest.create).not.toHaveBeenCalled();
  });
});

describe("createConnectionRequest happy path", () => {
  beforeEach(() => {
    prismaMock.connectionRequest.findFirst.mockResolvedValue(null);
    prismaMock.partner.findMany.mockResolvedValue([
      { id: "p1", userId: "u2" },
      { id: "p2", userId: "u3" },
    ]);
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    prismaMock.connectionRequest.create.mockResolvedValue(requestRow());
  });

  it("snapshots the price onto the request", async () => {
    await service.createConnectionRequest("u1", { categoryKey: "dating", mode: "CALL" });
    const data = prismaMock.connectionRequest.create.mock.calls[0][0].data;
    expect(data.categoryKey).toBe("DATING");
    expect(data.pricePerMinute).toBe(1);
    expect(data.status).toBe("SEARCHING");
    expect(data.partnerId).toBeUndefined();
  });

  it("fans out a realtime event and an inbox row to every eligible partner", async () => {
    const out = await service.createConnectionRequest("u1", { categoryKey: "DATING", mode: "CALL" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.notified).toBe(2);
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.connectionRequestRecipient.createMany).toHaveBeenCalledTimes(1);
    const rows = prismaMock.connectionRequestRecipient.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ requestId: "req_1", partnerId: "p1", status: "SENT" });
  });
});

describe("acceptConnectionRequest", () => {
  it("refuses a caller who is not a partner", async () => {
    prismaMock.partner.findUnique.mockResolvedValue(null);
    const out = await service.acceptConnectionRequest("u9", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("NOT_PARTNER");
  });

  it("refuses an unapproved partner", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1", status: "PENDING" });
    const out = await service.acceptConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("PARTNER_NOT_APPROVED");
  });

  it("refuses accepting your own request", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1", status: "APPROVED" });
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow({ requesterId: "u2" }));
    const out = await service.acceptConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("SELF_CONNECT_NOT_ALLOWED");
  });

  it("refuses a partner the request was not sent to", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1", status: "APPROVED" });
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow());
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue(null);
    const out = await service.acceptConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("NOT_INVITED");
  });

  it("loses the race when the atomic claim affects no row", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1", status: "APPROVED" });
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow());
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue({ id: "r1", status: "SENT" });
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 0 });
    const out = await service.acceptConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("ALREADY_ACCEPTED");
  });

  it("claims the request, notifies the requester and stands the losers down", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1", status: "APPROVED" });
    prismaMock.connectionRequest.findUnique
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(requestRow({ status: "ACCEPTED", partnerId: "p1", connectedAt: now }));
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue({ id: "r1", status: "SENT" });
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.findUnique.mockResolvedValue({ fullName: "Pat" });
    prismaMock.connectionRequestRecipient.findMany.mockResolvedValue([
      { partner: { userId: "u3" } },
    ]);

    const out = await service.acceptConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(true);
    const claim = prismaMock.connectionRequest.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: "req_1", status: "SEARCHING", partnerId: null });
    // Requester told, and the remaining partner told it is gone.
    expect(emitToUser).toHaveBeenCalledWith("u1", "connection_update", expect.objectContaining({ status: "ACCEPTED" }));
    expect(emitToUser).toHaveBeenCalledWith("u3", "connection_taken", expect.anything());
  });
});

describe("declineConnectionRequest", () => {
  it("refuses a partner who was not invited", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue(null);
    const out = await service.declineConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("NOT_INVITED");
  });

  it("refuses a second response", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue({ id: "r1", status: "DECLINED" });
    const out = await service.declineConnectionRequest("u2", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("ALREADY_RESPONDED");
  });

  it("expires the request when the last invited partner declines", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue({ id: "r1", status: "SENT" });
    prismaMock.connectionRequestRecipient.update.mockResolvedValue({});
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow());
    prismaMock.connectionRequestRecipient.count.mockResolvedValue(0);
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 1 });

    await service.declineConnectionRequest("u2", "req_1");

    expect(prismaMock.connectionRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED" } })
    );
  });

  it("keeps the request open while other partners can still accept", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequestRecipient.findUnique.mockResolvedValue({ id: "r1", status: "SENT" });
    prismaMock.connectionRequestRecipient.update.mockResolvedValue({});
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow());
    prismaMock.connectionRequestRecipient.count.mockResolvedValue(2);

    await service.declineConnectionRequest("u2", "req_1");
    expect(prismaMock.connectionRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe("cancelConnectionRequest", () => {
  it("refuses cancelling someone else's request", async () => {
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow({ requesterId: "u2" }));
    const out = await service.cancelConnectionRequest("u1", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("FORBIDDEN");
  });

  it("refuses cancelling a request that already found a partner", async () => {
    prismaMock.connectionRequest.findUnique.mockResolvedValue(requestRow({ status: "ACCEPTED", partnerId: "p1" }));
    const out = await service.cancelConnectionRequest("u1", "req_1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("NOT_SEARCHING");
  });

  it("cancels an open request of the caller", async () => {
    prismaMock.connectionRequest.findUnique
      .mockResolvedValueOnce(requestRow())
      .mockResolvedValueOnce(requestRow({ status: "CANCELLED" }));
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 1 });
    const out = await service.cancelConnectionRequest("u1", "req_1");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.request.status).toBe("CANCELLED");
  });
});

describe("listIncomingForPartner", () => {
  it("returns nothing for a caller with no partner profile", async () => {
    prismaMock.partner.findUnique.mockResolvedValue(null);
    expect(await service.listIncomingForPartner("u9")).toEqual([]);
  });

  it("maps the category label onto each offer", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequestRecipient.findMany.mockResolvedValue([
      {
        id: "r1",
        requestId: "req_1",
        sentAt: now,
        request: {
          categoryKey: "DATING",
          mode: "CALL",
          pricePerMinute: "1.00",
          estimatedMinutes: 10,
          expiresAt: new Date(now.getTime() + 60_000),
          notes: null,
          requester: { fullName: "Ann" },
        },
      },
    ]);

    const items = await service.listIncomingForPartner("u2");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      requestId: "req_1",
      categoryLabel: "Dating",
      mode: "CALL",
      pricePerMinute: 1,
      requesterName: "Ann",
    });
    // Only live offers: the query filters on an open, unexpired request.
    const where = prismaMock.connectionRequestRecipient.findMany.mock.calls[0][0].where;
    expect(where.request).toMatchObject({ status: "SEARCHING" });
  });
});

describe("expireRequest", () => {
  it("does nothing when the request is no longer searching", async () => {
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 0 });
    await service.expireRequest("req_1");
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it("expires and notifies the requester when the window lapses", async () => {
    prismaMock.connectionRequest.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.connectionRequest.findUnique.mockResolvedValue({ requesterId: "u1", mode: "CALL" });
    await service.expireRequest("req_1");
    expect(emitToUser).toHaveBeenCalledWith("u1", "connection_update", expect.objectContaining({ status: "EXPIRED" }));
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });
});

describe("controller", () => {
  it("returns 400 on a malformed create", async () => {
    const { res, out } = makeRes();
    await ctrl.createRequest(authed(), res as never); // no body -> validation error
    expect(out.statusCode).toBe(400);
  });

  it("maps 'no partners' to 503, not a false success", async () => {
    prismaMock.connectionRequest.findFirst.mockResolvedValue(null);
    prismaMock.partner.findMany.mockResolvedValue([]);
    const { res, out } = makeRes();
    await ctrl.createRequest({ user: { userId: "u1" }, body: { categoryKey: "DATING", mode: "CALL" } } as never, res as never);
    expect(out.statusCode).toBe(503);
    const payload = out.payload as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("NO_PARTNERS_AVAILABLE");
  });

  it("returns 201 and the created request on success", async () => {
    prismaMock.connectionRequest.findFirst.mockResolvedValue(null);
    prismaMock.partner.findMany.mockResolvedValue([{ id: "p1", userId: "u2" }]);
    prismaMock.userBlock.findMany.mockResolvedValue([]);
    prismaMock.connectionRequest.create.mockResolvedValue(requestRow());
    const { res, out } = makeRes();
    await ctrl.createRequest({ user: { userId: "u1" }, body: { categoryKey: "DATING", mode: "CALL" } } as never, res as never);
    expect(out.statusCode).toBe(201);
    const payload = out.payload as { success: boolean; data: { request: { id: string } } };
    expect(payload.success).toBe(true);
    expect(payload.data.request.id).toBe("req_1");
  });

  it("lists the caller's own incoming offers", async () => {
    prismaMock.partner.findUnique.mockResolvedValue({ id: "p1" });
    prismaMock.connectionRequest.findMany.mockResolvedValue([]);
    prismaMock.connectionRequestRecipient.findMany.mockResolvedValue([]);
    const { res, out } = makeRes();
    await ctrl.listIncoming(authed("u2"), res as never);
    const payload = out.payload as { success: boolean; data: { items: unknown[] } };
    expect(payload.success).toBe(true);
    expect(payload.data.items).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression cover for the walking-request list ownership scope.
 *
 * `getWalkingRequests` previously built its `where` from `status` alone, so it
 * returned every row in the table to any authenticated KYC-verified caller,
 * including other users' start/end locations, notes and fares. The detail
 * endpoint was already scoped; these tests pin the list to the same rule so the
 * two cannot drift apart again.
 */
const { prismaMock, isAdminTierMock, sendSuccessMock, sendErrorMock } = vi.hoisted(() => ({
  prismaMock: {
    walkingRequest: { findMany: vi.fn(), count: vi.fn() },
  },
  isAdminTierMock: vi.fn(() => false),
  sendSuccessMock: vi.fn(),
  sendErrorMock: vi.fn(),
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));
vi.mock("../rbac/activeRole", () => ({ isAdminTierRole: isAdminTierMock }));
vi.mock("../utils/response", () => ({
  sendSuccess: sendSuccessMock,
  sendError: sendErrorMock,
}));
vi.mock("../services/pricingEngine", () => ({
  calculatePrice: vi.fn(async () => ({ finalAmount: 100 })),
  getConfig: vi.fn(async () => ({})),
}));

import { getWalkingRequests } from "../controllers/walkingRequestController";
import type { AuthedRequest } from "../middleware/authTypes";

const CALLER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function makeReq(query: Record<string, string> = {}, userId = CALLER) {
  return {
    user: { userId, email: "caller@test.local", role: "USER", activeRole: "USER" },
    query,
  } as unknown as AuthedRequest;
}

const res = {} as never;

/** Pull the `where` actually handed to Prisma so we assert on real query shape. */
function whereUsed() {
  return prismaMock.walkingRequest.findMany.mock.calls[0][0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  isAdminTierMock.mockReturnValue(false);
  prismaMock.walkingRequest.findMany.mockResolvedValue([]);
  prismaMock.walkingRequest.count.mockResolvedValue(0);
});

describe("getWalkingRequests ownership scope", () => {
  it("scopes a normal user to their own requester, assigned and applicant rows", async () => {
    await getWalkingRequests(makeReq(), res);

    const where = whereUsed();
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toEqual([
      { requesterId: CALLER },
      { acceptedById: CALLER },
      { applications: { some: { applicantId: CALLER } } },
    ]);
  });

  it("never emits an unscoped query for a non-admin", async () => {
    await getWalkingRequests(makeReq(), res);

    // The leak was a `where` with no OR clause at all, which matched all rows.
    expect(whereUsed()).not.toEqual({});
    expect(whereUsed().requesterId).toBeUndefined();
  });

  it("keeps the status filter while adding the ownership scope", async () => {
    await getWalkingRequests(makeReq({ status: "OPEN" }), res);

    const where = whereUsed();
    expect(where.status).toBe("OPEN");
    expect(where.OR).toHaveLength(3);
  });

  it("applies the same scope to the count so pagination total cannot leak", async () => {
    await getWalkingRequests(makeReq(), res);

    const countWhere = prismaMock.walkingRequest.count.mock.calls[0][0].where;
    expect(countWhere.OR).toHaveLength(3);
  });

  it("uses the caller's own id, not a value derived from the query string", async () => {
    await getWalkingRequests(makeReq({ status: "OPEN" }, CALLER), res);

    const serialised = JSON.stringify(whereUsed());
    expect(serialised).toContain(CALLER);
    expect(serialised).not.toContain(OTHER);
  });

  it("keeps the unscoped list for admin-tier support roles", async () => {
    isAdminTierMock.mockReturnValue(true);

    await getWalkingRequests(makeReq(), res);

    expect(whereUsed().OR).toBeUndefined();
  });

  it("returns a paginated envelope on success", async () => {
    prismaMock.walkingRequest.findMany.mockResolvedValue([{ id: "wr_1" }]);
    prismaMock.walkingRequest.count.mockResolvedValue(1);

    await getWalkingRequests(makeReq({ page: "2", limit: "5" }), res);

    expect(sendSuccessMock).toHaveBeenCalledWith(
      res,
      { items: [{ id: "wr_1" }], page: 2, limit: 5, total: 1 },
    );
  });
});
import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    connectionCategory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../config/database", () => ({ prisma: prismaMock }));

import * as service from "../services/connectionCategoryService";
import * as ctrl from "../controllers/connectionCategoryController";

function row(overrides: Record<string, unknown> = {}) {
  return {
    key: "DATING",
    label: "Dating",
    description: null,
    chatEnabled: true,
    callEnabled: true,
    videoEnabled: false,
    isPaid: true,
    chatPricePerMinute: "0.00",
    callPricePerMinute: "1.00",
    videoPricePerMinute: "0.00",
    enabled: true,
    sortOrder: 10,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("connection category defaults", () => {
  it("ships the ten requested categories with unique keys", () => {
    const keys = service.CONNECTION_CATEGORY_DEFAULTS.map((c) => c.key);
    expect(service.CONNECTION_CATEGORY_DEFAULTS).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    expect(keys).toContain("DATING");
    expect(keys).toContain("OTHER");
  });

  it("keeps chat free and calls at the existing ₹1/min default", () => {
    for (const c of service.CONNECTION_CATEGORY_DEFAULTS) {
      expect(c.chatPricePerMinute).toBe(0);
      expect(c.callPricePerMinute).toBe(1);
      expect(c.chatEnabled).toBe(true);
    }
  });

  it("leaves video off by default", () => {
    for (const c of service.CONNECTION_CATEGORY_DEFAULTS) {
      expect(c.videoEnabled).toBe(false);
    }
  });
});

describe("serializeCategory", () => {
  it("converts Decimal-like values to plain numbers", () => {
    const out = service.serializeCategory(row());
    expect(out.callPricePerMinute).toBe(1);
    expect(out.chatPricePerMinute).toBe(0);
    expect(typeof out.callPricePerMinute).toBe("number");
  });

  it("tolerates missing prices", () => {
    const out = service.serializeCategory(row({ callPricePerMinute: null, chatPricePerMinute: undefined }));
    expect(out.callPricePerMinute).toBe(0);
    expect(out.chatPricePerMinute).toBe(0);
  });
});

describe("normalizeCategoryInput", () => {
  it("upper-cases and trims the key", () => {
    expect(service.normalizeCategoryInput({ key: "  movie_buddy " }).key).toBe("MOVIE_BUDDY");
  });

  it("only returns fields that were supplied", () => {
    const out = service.normalizeCategoryInput({ label: "  Hi  " });
    expect(out).toEqual({ label: "Hi" });
  });

  it("clamps a negative price to zero", () => {
    expect(service.normalizeCategoryInput({ callPricePerMinute: -5 }).callPricePerMinute).toBe(0);
  });

  it("rounds prices to two decimals", () => {
    expect(service.normalizeCategoryInput({ callPricePerMinute: 1.239 }).callPricePerMinute).toBe(1.24);
  });

  it("coerces boolean strings", () => {
    const out = service.normalizeCategoryInput({ chatEnabled: "false", callEnabled: "true" });
    expect(out.chatEnabled).toBe(false);
    expect(out.callEnabled).toBe(true);
  });
});

describe("listPublic", () => {
  it("returns the built-in defaults (source: defaults) while the table is empty", async () => {
    prismaMock.connectionCategory.findMany.mockResolvedValue([]);
    const result = await service.listPublic();
    expect(result.source).toBe("defaults");
    expect(result.items).toHaveLength(10);
  });

  it("returns only enabled rows from the database", async () => {
    prismaMock.connectionCategory.findMany.mockResolvedValue([row({ label: "Dating" })]);
    const result = await service.listPublic();
    expect(result.source).toBe("db");
    expect(result.items[0].label).toBe("Dating");
    expect(prismaMock.connectionCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { enabled: true } })
    );
  });
});

describe("listAll", () => {
  it("returns defaults when there are no rows", async () => {
    prismaMock.connectionCategory.findMany.mockResolvedValue([]);
    const result = await service.listAll();
    expect(result.source).toBe("defaults");
    expect(result.items).toHaveLength(10);
  });
});

describe("seedDefaults", () => {
  it("creates missing keys and skips existing ones", async () => {
    prismaMock.connectionCategory.findUnique
      .mockResolvedValueOnce({ id: "existing" })
      .mockResolvedValue(null);
    prismaMock.connectionCategory.create.mockResolvedValue(row());
    const result = await service.seedDefaults();
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(service.CONNECTION_CATEGORY_DEFAULTS.length - 1);
  });

  it("never overwrites an existing row", async () => {
    prismaMock.connectionCategory.findUnique.mockResolvedValue({ id: "existing" });
    prismaMock.connectionCategory.create.mockResolvedValue(row());
    await service.seedDefaults();
    expect(prismaMock.connectionCategory.create).not.toHaveBeenCalled();
  });
});

describe("createCategory / updateCategory / deleteCategory", () => {
  it("creates with normalized data", async () => {
    prismaMock.connectionCategory.create.mockResolvedValue(row());
    await service.createCategory({ key: "dating", label: "Dating", callPricePerMinute: 1 });
    const arg = prismaMock.connectionCategory.create.mock.calls[0][0];
    expect(arg.data.key).toBe("DATING");
  });

  it("returns null when updating a missing category", async () => {
    prismaMock.connectionCategory.findUnique.mockResolvedValue(null);
    expect(await service.updateCategory("nope", { label: "x" })).toBeNull();
  });

  it("returns false when deleting a missing category", async () => {
    prismaMock.connectionCategory.findUnique.mockResolvedValue(null);
    expect(await service.deleteCategory("nope")).toBe(false);
  });
});

describe("controller", () => {
  it("returns the public catalogue", async () => {
    prismaMock.connectionCategory.findMany.mockResolvedValue([]);
    const { res, out } = makeRes();
    await ctrl.getConnectionCategories({} as never, res as never);
    const payload = out.payload as { success: boolean; data: { items: unknown[] } };
    expect(payload.success).toBe(true);
    expect(payload.data.items).toHaveLength(10);
  });

  it("rejects a create without key or label", async () => {
    const { res, out } = makeRes();
    await ctrl.adminCreateCategory({ body: { label: "No key" } } as never, res as never);
    expect(out.statusCode).toBe(400);
  });

  it("maps a unique-constraint failure to 409", async () => {
    const conflict = Object.assign(new Error("dup"), { code: "P2002" });
    prismaMock.connectionCategory.create.mockRejectedValue(conflict);
    const { res, out } = makeRes();
    await ctrl.adminCreateCategory({ body: { key: "DATING", label: "Dating" } } as never, res as never);
    expect(out.statusCode).toBe(409);
  });

  it("404s an update for a missing id", async () => {
    prismaMock.connectionCategory.findUnique.mockResolvedValue(null);
    const { res, out } = makeRes();
    await ctrl.adminUpdateCategory({ params: { id: "gone" }, body: { label: "x" } } as never, res as never);
    expect(out.statusCode).toBe(404);
  });
});

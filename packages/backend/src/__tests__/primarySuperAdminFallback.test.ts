import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from "../config/database";
import { ensurePrimarySuperAdminActive } from "../rbac/primarySuperAdmin";

/**
 * Pins the fallback that unblocked a SUSPENDED super admin in production.
 *
 * With ADMIN_EMAIL unset the repair used to return early, so the account stayed
 * suspended across every deploy and login answered 403 ACCOUNT_INACTIVE. The
 * fallback reads the role from the database instead of baking in an address.
 */
async function loadWithEnv(partialEnv: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("../config/env", () => ({ env: partialEnv }));
  return import("../rbac/primarySuperAdmin.js");
}

describe("ensurePrimarySuperAdminActive without ADMIN_EMAIL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("repairs the account the database already marks SUPER_ADMIN", async () => {
    const mod = await loadWithEnv({});
    (prisma.user.findFirst as any).mockResolvedValue({
      id: "u1",
      status: "SUSPENDED",
      activeRole: null,
      role: "SUPER_ADMIN",
      suspendedUntil: new Date(),
    });
    (prisma.user.update as any).mockResolvedValue({});

    await mod.ensurePrimarySuperAdminActive();

    // The identity comes from the DB, never from a literal in source.
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "SUPER_ADMIN" } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({ status: "ACTIVE", activeRole: "SUPER_ADMIN" }),
      }),
    );
  });

  it("does not throw when no super admin exists yet", async () => {
    const mod = await loadWithEnv({});
    (prisma.user.findFirst as any).mockResolvedValue(null);
    await expect(mod.ensurePrimarySuperAdminActive()).resolves.toBeUndefined();
    expect(prisma.user.update).not.toHaveBeenCalled();
    vi.doUnmock("../config/env");
    vi.resetModules();
  });

  it("prefers the configured email over the role fallback when both exist", async () => {
    const mod = await loadWithEnv({ ADMIN_EMAIL: "ops@example.com" });
    (prisma.user.findUnique as any).mockResolvedValue({
      id: "u2",
      status: "ACTIVE",
      activeRole: "SUPER_ADMIN",
      role: "SUPER_ADMIN",
      suspendedUntil: null,
    });

    await mod.ensurePrimarySuperAdminActive();

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "ops@example.com" } }),
    );
    // An explicit ADMIN_EMAIL must not silently start repairing other accounts.
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    vi.doUnmock("../config/env");
    vi.resetModules();
  });

  it("leaves a healthy account untouched", async () => {
    const mod = await loadWithEnv({});
    (prisma.user.findFirst as any).mockResolvedValue({
      id: "u3",
      status: "ACTIVE",
      activeRole: "SUPER_ADMIN",
      role: "SUPER_ADMIN",
      suspendedUntil: null,
    });

    await mod.ensurePrimarySuperAdminActive();

    expect(prisma.user.update).not.toHaveBeenCalled();
    vi.doUnmock("../config/env");
    vi.resetModules();
  });
});

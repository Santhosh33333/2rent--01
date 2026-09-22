import { prisma } from "../config/database";

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "MODERATOR",
  "SUPPORT",
  "FINANCE",
  "SUPPORT_ADMIN",
  "FINANCE_ADMIN",
  "KYC_ADMIN",
  "MARKETING_ADMIN",
  "PARTNER_ADMIN",
];

/**
 * Self-healing admin provisioning: guarantees an AdminUser row (and its
 * AdminRole) for an admin-tier account. Fresh/seeded-super-admin accounts
 * often have the User.role flag but no AdminUser row, which silently
 * disabled inbox delivery, security profiles, and session limits.
 * Idempotent — existing rows are returned untouched.
 */
export async function ensureAdminUser(userId: string, roleName: string): Promise<string> {
  const existing = await prisma.adminUser.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing.id;
  const role = ADMIN_ROLES.includes(roleName) ? roleName : "ADMIN";
  const adminRole = await prisma.adminRole.upsert({
    where: { name: role },
    update: {},
    create: {
      name: role,
      displayName: role,
      permissions: JSON.stringify(role === "SUPER_ADMIN" ? ["*"] : []),
      isSystem: true,
    },
  });
  const created = await prisma.adminUser.upsert({
    where: { userId },
    update: { roleId: adminRole.id },
    create: {
      userId,
      roleId: adminRole.id,
      permissions: JSON.stringify(role === "SUPER_ADMIN" ? ["*"] : []),
    },
  });
  return created.id;
}

export async function ensureAdminUsers(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role: true, activeRole: true },
  });
  for (const u of users) {
    const role = u.activeRole || u.role || "ADMIN";
    if (!ADMIN_ROLES.includes(role)) continue;
    out.set(u.id, await ensureAdminUser(u.id, role));
  }
  return out;
}

export async function activeAdminUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ role: { in: ADMIN_ROLES } }, { activeRole: { in: ADMIN_ROLES } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

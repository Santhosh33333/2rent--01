/**
 * Seed the 6-platform admin accounts required by the FINAL SECURITY TEST.
 *  - 1 SUPER_ADMIN (full access)
 *  - 1 SUPPORT_ADMIN   (Support only)
 *  - 1 FINANCE_ADMIN   (Revenue + Wallet + Withdrawals)
 *  - 1 KYC_ADMIN       (KYC only)
 *  - 1 MARKETING_ADMIN (Offers + Coupons + Content)
 *  - 1 PARTNER_ADMIN   (Partners + Jobs)
 *
 * Each delegated admin is granted ONLY the section/action permissions from its
 * role template. Super Admin is granted full access implicitly by the backend
 * (role check), so it stores "*".
 *
 * Idempotent: re-running updates credentials/permissions instead of duplicating.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { env } from "../src/config/env";
import { ADMIN_ROLES, ROLE_TEMPLATES, expandTemplate, Section, Action } from "../src/rbac/sections";

const prisma = new PrismaClient();

/**
 * Resolve an admin password. A known constant default is NEVER used:
 *  - if the env var is set (>=8 chars) it is used,
 *  - in production a missing/short password throws (deploy must supply secrets),
 *  - in development a strong random password is generated and printed (so it is
 *    never a guessable baked-in value, but dev seeding still works).
 */
function resolveAdminPassword(envVar: string, email: string): string {
  const v = process.env[envVar];
  if (v && v.length >= 8) return v;
  if (env.isProduction) {
    throw new Error(`[seed-admins] ${envVar} must be set (>=8 chars) in production for ${email}.`);
  }
  const gen = crypto.randomBytes(10).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, 14) + "Aa1";
  console.warn(`[seed-admins] Generated random DEV password for ${email} (set ${envVar} to keep it stable): ${gen}`);
  return gen;
}

if (env.isProduction && !process.env.SEED_FORCE) {
  console.error("[seed-admins] Refusing to run in production. Set SEED_FORCE=1 to override.");
  process.exit(1);
}

type Spec = {
  email: string;
  phone: string;
  fullName: string;
  password: string;
  role: string; // activeRole
  permissions: string[]; // effective permission tokens
};

function permsFor(role: string): string[] {
  if (role === "SUPER_ADMIN") return ["*"];
  const t = ROLE_TEMPLATES[role];
  if (!t) return [];
  return expandTemplate(t as Partial<Record<Section, Action[]>>);
}

const SPECS: Spec[] = [
  {
    email: env.ADMIN_EMAIL ?? "santhoshkrishna958@gmail.com",
    phone: "+917305716800",
    fullName: env.ADMIN_NAME ?? "Super Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD", env.ADMIN_EMAIL ?? "santhoshkrishna958@gmail.com"),
    role: "SUPER_ADMIN",
    permissions: permsFor("SUPER_ADMIN"),
  },
  {
    email: "support@rentbuddy.app",
    phone: "+919876543211",
    fullName: "Support Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_SUPPORT", "support@rentbuddy.app"),
    role: "SUPPORT_ADMIN",
    permissions: permsFor("SUPPORT_ADMIN"),
  },
  {
    email: "finance@rentbuddy.app",
    phone: "+919876543212",
    fullName: "Finance Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_FINANCE", "finance@rentbuddy.app"),
    role: "FINANCE_ADMIN",
    permissions: permsFor("FINANCE_ADMIN"),
  },
  {
    email: "kyc@rentbuddy.app",
    phone: "+919876543213",
    fullName: "KYC Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_KYC", "kyc@rentbuddy.app"),
    role: "KYC_ADMIN",
    permissions: permsFor("KYC_ADMIN"),
  },
  {
    email: "marketing@rentbuddy.app",
    phone: "+919876543214",
    fullName: "Marketing Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_MARKETING", "marketing@rentbuddy.app"),
    role: "MARKETING_ADMIN",
    permissions: permsFor("MARKETING_ADMIN"),
  },
  {
    email: "partner@rentbuddy.app",
    phone: "+919876543215",
    fullName: "Partner Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_PARTNER", "partner@rentbuddy.app"),
    role: "PARTNER_ADMIN",
    permissions: permsFor("PARTNER_ADMIN"),
  },
];

async function ensureAdminRole(name: string, permissions: string[]) {
  const existing = await prisma.adminRole.findUnique({ where: { name } });
  if (existing) {
    // Keep role template in sync.
    return prisma.adminRole.update({ where: { name }, data: { permissions: JSON.stringify(permissions), isSystem: true } });
  }
  return prisma.adminRole.create({ data: { name, displayName: name, permissions: JSON.stringify(permissions), isSystem: true } });
}

async function main(): Promise<void> {
  for (const s of SPECS) {
    const passwordHash = await bcrypt.hash(s.password, env.BCRYPT_SALT_ROUNDS);
    const existing = await prisma.user.findFirst({ where: { OR: [{ email: s.email }, { phone: s.phone }] } });

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, role: s.role, activeRole: s.role, status: "ACTIVE", emailVerified: true },
        })
      : await prisma.user.create({
          data: {
            email: s.email,
            phone: s.phone,
            passwordHash,
            fullName: s.fullName,
            dateOfBirth: new Date("1990-01-01"),
            gender: "OTHER",
            role: s.role,
            activeRole: s.role,
            status: "ACTIVE",
            emailVerified: true,
          },
        });

    const role = await ensureAdminRole(s.role, s.permissions);
    await prisma.adminUser.upsert({
      where: { userId: user.id },
      update: { roleId: role.id, permissions: JSON.stringify(s.permissions) },
      create: { userId: user.id, roleId: role.id, permissions: JSON.stringify(s.permissions) },
    });

    console.log(`✓ ${s.role.padEnd(16)} ${user.email}  (${s.permissions.length} permissions)`);
  }
  console.log("\nAdmin seed complete. 6 accounts provisioned.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

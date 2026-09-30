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
/**
 * Resolve an admin password, or null when an *optional* delegated admin has none
 * configured.
 *
 * The five delegated admins (support/finance/kyc/marketing/partner) are
 * optional: they are provisioned later through the admin console. Previously a
 * missing ADMIN_PASSWORD_* threw, so recovering the break-glass super admin in
 * production required inventing six passwords at once - and the seed failed
 * before it provisioned anything. Requiring only the account that actually
 * unlocks the system, and skipping the rest with a visible warning, is what
 * makes recovery a one-command operation.
 *
 * The primary super admin stays mandatory: without it there is no way back into
 * a production database, so failing loudly is correct there.
 */
function resolveAdminPassword(envVar: string, email: string, optional = false): string | null {
  const v = process.env[envVar];
  if (v && v.length >= 8) return v;
  if (optional) {
    console.warn(
      `[seed-admins] Skipping optional account ${email}: ${envVar} is not set (>=8 chars).`,
    );
    return null;
  }
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
  password: string | null; // null => optional account with no password set; skipped
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
    password: resolveAdminPassword("ADMIN_PASSWORD_SUPPORT", "support@rentbuddy.app", true),
    role: "SUPPORT_ADMIN",
    permissions: permsFor("SUPPORT_ADMIN"),
  },
  {
    email: "finance@rentbuddy.app",
    phone: "+919876543212",
    fullName: "Finance Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_FINANCE", "finance@rentbuddy.app", true),
    role: "FINANCE_ADMIN",
    permissions: permsFor("FINANCE_ADMIN"),
  },
  {
    email: "kyc@rentbuddy.app",
    phone: "+919876543213",
    fullName: "KYC Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_KYC", "kyc@rentbuddy.app", true),
    role: "KYC_ADMIN",
    permissions: permsFor("KYC_ADMIN"),
  },
  {
    email: "marketing@rentbuddy.app",
    phone: "+919876543214",
    fullName: "Marketing Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_MARKETING", "marketing@rentbuddy.app", true),
    role: "MARKETING_ADMIN",
    permissions: permsFor("MARKETING_ADMIN"),
  },
  {
    email: "partner@rentbuddy.app",
    phone: "+919876543215",
    fullName: "Partner Admin",
    password: resolveAdminPassword("ADMIN_PASSWORD_PARTNER", "partner@rentbuddy.app", true),
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
  // Optional delegated admins with no configured password are dropped here
  // rather than created with an unusable one.
  const specs = SPECS.filter((s): s is Spec & { password: string } => s.password !== null);

  for (const s of specs) {
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
  const skipped = SPECS.length - specs.length;
  // Reports the real number. A hardcoded "6" here was actively misleading: a
  // recovery run that provisioned only the super admin still claimed all six,
  // which would let an operator believe the delegated admins exist when they
  // do not.
  console.log(
    `\nAdmin seed complete. ${specs.length} account(s) provisioned` +
      (skipped > 0 ? `, ${skipped} optional account(s) skipped (set their ADMIN_PASSWORD_* to create them).` : "."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

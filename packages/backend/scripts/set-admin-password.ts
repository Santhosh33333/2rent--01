import bcrypt from "bcryptjs";
import { prisma } from "../src/config/database";
import { env } from "../src/config/env";

/**
 * Set the primary super admin's password directly in the database.
 *
 * This exists because the in-app reset path refuses to touch the primary super
 * admin (see isPrimarySuperAdmin / adminController), and the OTP flow needs a
 * phone round-trip. This is the break-glass recovery route.
 *
 * The new password is read from NEW_ADMIN_PASSWORD and is never written to a
 * file, echoed, or logged. Rounds match the app's own BCRYPT_SALT_ROUNDS so the
 * stored hash is indistinguishable from one produced by the normal login path.
 *
 * Usage:
 *   $env:NEW_ADMIN_PASSWORD = "..." ; npx tsx scripts/set-admin-password.ts
 */

async function main(): Promise<void> {
  const password = process.env.NEW_ADMIN_PASSWORD;
  const email = (env.ADMIN_EMAIL ?? "").trim().toLowerCase();

  if (!password) {
    console.error("NEW_ADMIN_PASSWORD is not set. Nothing was changed.");
    process.exit(1);
  }
  if (!email) {
    console.error("ADMIN_EMAIL is not configured. Nothing was changed.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found for the configured admin email. Nothing was changed.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_SALT_ROUNDS);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: "ACTIVE" },
    });

    // Clear the admin lockout. Resetting only the password is not enough: once
    // the failed-attempt counter trips, checkAdminLockout keeps rejecting the
    // new password with ACCOUNT_LOCKED, so this script would appear to do
    // nothing. Absence of an AdminUser row is tolerated, since the primary super
    // admin can authenticate without one.
    const admin = await tx.adminUser.findUnique({ where: { userId: user.id } });
    if (admin) {
      await tx.adminUser.update({
        where: { userId: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorType: "USER",
        action: "ADMIN_PASSWORD_SET_VIA_SCRIPT",
        entityType: "User",
        entityId: user.id,
        metadata: JSON.stringify({
          note: "break-glass local recovery; password never logged",
          lockoutCleared: Boolean(admin),
        }),
      },
    });
  });

  // Deliberately prints no password, no hash, no length.
  console.log(`Password updated for the super admin account.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error("Failed:", err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
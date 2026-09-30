import { prisma } from '../config/database'
import { env } from '../config/env'

/**
 * The primary super admin (break-glass account).
 *
 * This account must never be suspendable and must never be able to enter the
 * customer "user view" -- it holds no wallet, books no rentals, and should not
 * appear anywhere a member can see it.
 *
 * It currently exists with `status: SUSPENDED` in production, which produced
 * `403 "Account is not active."` on every login path. Because a suspension
 * normally requires an authenticated admin to lift, the account could not be
 * rescued from inside the app: it locked out its own only route back in.
 *
 * `ensurePrimarySuperAdminActive()` runs at boot, clears any suspension, and
 * records an audit row, so the account cannot stay locked out again. This is a
 * deliberate trade-off: an operator who suspends the break-glass account for
 * incident response will see it restored on the next deploy. That is the
 * intended behaviour, because the account is the only guaranteed way back into
 * an admin-gated production database.
 */

/** Email of the primary super admin, or null when unset. */
export function primarySuperAdminEmail(): string | null {
  const e = (env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  return e || null;
}

/** True when this email is the primary super admin. */
export function isPrimarySuperAdmin(email?: string | null): boolean {
  const primary = primarySuperAdminEmail();
  if (!primary) return false;
  return (email ?? '').trim().toLowerCase() === primary;
}

/**
 * Throw when a caller tries to suspend the primary super admin.
 * Kept as a guard so every future status-mutation path must opt out of it.
 */
export function assertNotPrimarySuperAdmin(email: string | null | undefined, action = 'suspend'): void {
  if (!isPrimarySuperAdmin(email)) return;
  const err = new Error('The primary super admin cannot be suspended.') as Error & {
    status?: number;
  };
  err.status = 403;
  throw err;
}

/**
 * Clear any suspension on the primary super admin and restore the admin
 * surface. Idempotent, and a no-op when the account is already healthy.
 */
export async function ensurePrimarySuperAdminActive(): Promise<void> {
  const email = primarySuperAdminEmail();

  const select = { id: true, status: true, activeRole: true, role: true, suspendedUntil: true } as const;

  // With ADMIN_EMAIL unset, fall back to whoever the database already says is
  // the super admin rather than doing nothing.
  //
  // The repair used to be a no-op in that case, which is how a SUSPENDED
  // super admin survived every deploy: ADMIN_EMAIL is optional in the env
  // schema and was not set in production, so the one guaranteed way back into an
  // admin-gated database stayed locked out. Reading the role from the database
  // hardcodes no identity, which is the constraint that matters - the
  // protectedRootAccount tests forbid baking a mailbox into this module because
  // that mailbox would become the account nobody can suspend.
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select })
    : ((await prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN' },
        select,
        orderBy: { createdAt: 'asc' },
      })) ?? null);

  if (!user) {
    console.warn(
      email
        ? `[primary-super-admin] ${email} does not exist yet; run the admin seed.`
        : '[primary-super-admin] ADMIN_EMAIL is unset and no SUPER_ADMIN account exists yet; run the admin seed.',
    );
    return;
  }

  const needsStatusHeal = user.status !== 'ACTIVE' || user.suspendedUntil != null;
  const needsSurfaceHeal = user.activeRole !== user.role;

  if (!needsStatusHeal && !needsSurfaceHeal) return;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: 'ACTIVE',
      suspendedUntil: null,
      suspensionReason: null,
      activeRole: user.role ?? 'SUPER_ADMIN',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'RESTORE_PRIMARY_SUPER_ADMIN',
      entityType: 'USER',
      entityId: user.id,
      metadata: JSON.stringify({
        previousStatus: user.status,
        previousSuspendedUntil: user.suspendedUntil,
        previousActiveRole: user.activeRole,
        note: 'Primary super admin self-healed at boot; this account is never suspendable.',
      }),
    },
  });

  console.warn(
    `[primary-super-admin] repaired ${email}: status ${user.status} -> ACTIVE, activeRole ${user.activeRole} -> ${user.role ?? 'SUPER_ADMIN'}`,
  );
}

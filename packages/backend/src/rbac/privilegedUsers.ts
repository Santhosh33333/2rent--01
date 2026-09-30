import { Prisma } from '@prisma/client'
import { ADMIN_TIER_ROLES, isAdminTierRole } from './activeRole'

/**
 * Privileged accounts must not appear in, or be targetable from, any surface an
 * ordinary member can reach.
 *
 * The audit behind this found admin emails exposed through the event attendee
 * list and the blocked-users list, admin names suggested by global search, and
 * directory filters that excluded only `ADMIN`/`SUPER_ADMIN` while ignoring the
 * eight delegated tiers (SUPPORT, KYC_ADMIN, PARTNER_ADMIN, ...). It also found
 * arbitrary-id lookups that would happily open a chat with, block, or befriend
 * a privileged account, which doubles as an existence oracle: a caller could
 * tell "no such user" from "that user is an admin".
 *
 * Both columns are checked on purpose. `role` is the account's real tier, while
 * `activeRole` is the surface an admin previews. Checking only `activeRole`
 * would hide a delegated admin who is currently previewing the customer app,
 * and checking only `role` would miss accounts that carry a privileged
 * `activeRole` from an earlier promotion.
 */

/** A user is privileged if either column names an admin tier. */
export function isPrivilegedUser(user?: {
  role?: string | null
  activeRole?: string | null
} | null): boolean {
  return isAdminTierRole(user?.role) || isAdminTierRole(user?.activeRole)
}

/**
 * Prisma `where` fragment that hides every privileged account.
 *
 * Spread it into a query: `where: { status: 'ACTIVE', ...NOT_PRIVILEGED }`.
 *
 * `activeRole` is nullable, and `notIn` alone would drop null rows because
 * `NULL NOT IN (...)` is null rather than true. The explicit `activeRole: null`
 * branch keeps ordinary members, who never have a preview role, visible.
 */
export const NOT_PRIVILEGED: Prisma.UserWhereInput = {
  AND: [
    { role: { notIn: [...ADMIN_TIER_ROLES] } },
    {
      OR: [
        { activeRole: null },
        { activeRole: { notIn: [...ADMIN_TIER_ROLES] } },
      ],
    },
  ],
}

/**
 * Guard for endpoints that take a user id from the request.
 *
 * Throws the same 404 as a missing user, so a caller cannot distinguish
 * "privileged" from "does not exist" and use the endpoint to enumerate staff.
 */
export function assertNotPrivileged(user: {
  id: string
  role?: string | null
  activeRole?: string | null
} | null): void {
  if (!user) {
    const err = new Error('User not found') as Error & { status?: number }
    err.status = 404
    throw err
  }
  if (isPrivilegedUser(user)) {
    const err = new Error('User not found') as Error & { status?: number }
    err.status = 404
    throw err
  }
}

export { ADMIN_TIER_ROLES }

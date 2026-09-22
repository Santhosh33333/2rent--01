import { prisma } from "../config/database";

/**
 * Interactive transactions for money-moving paths (completion settlement,
 * UPI verification, refunds, withdrawals, booking creation).
 *
 * Prisma defaults (maxWait 2s, timeout 5s) assume a fast local database.
 * Against hosted Postgres (~1s per round-trip) any transaction with more
 * than a few statements dies with "Transaction already closed" and the
 * user sees a 500 AFTER their money/OTP steps succeeded. These budgets
 * fit the observed latency with headroom.
 */
export function moneyTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return (prisma as any).$transaction(fn, { maxWait: 15000, timeout: 45000 });
}

/** Lighter budget for short admin/user mutations (2-4 statements). */
export function shortTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return (prisma as any).$transaction(fn, { maxWait: 10000, timeout: 20000 });
}

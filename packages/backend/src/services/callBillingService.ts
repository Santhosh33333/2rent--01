/**
 * Metered call billing.
 *
 * Money model: hold at answer, capture on end, release the difference.
 *
 *   answer  -> heldBalance += rate x maxBillableMinutes   (reservation)
 *   end     -> charge rate x billable minutes from balance
 *              and return (held - charged) to the available balance
 *
 * Why a hold rather than a post-hoc debit: without a reservation a user with a
 * zero balance can start a call, consume minutes, and then be unable to pay,
 * so the service is delivered and uncharged. A hold makes the call impossible
 * to start unless the funds are already committed.
 *
 * Concurrency: every balance mutation is a single guarded UPDATE ... WHERE, so
 * correctness comes from the database rather than from an in-process mutex. The
 * existing `withUserLock` in walletController is a Map of per-user mutexes in a
 * single Node process - it protects nothing across multiple instances and
 * nothing across a restart, which is exactly the situation a hold has to
 * survive (a deploy mid-call must not lose the reservation). A guarded
 * updateMany/atomic update is the only primitive that holds with more than one
 * process behind the load balancer.
 *
 * Time: all billing decisions use the database server's clock via `now()` in
 * the query itself. Duration is never taken from a client-supplied value,
 * because a client that reports its own call length reports whatever it likes.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";

/** Transaction ledger type for an actual capture. A hold is not a movement of
 *  money, so it deliberately writes no Transaction row: the CallCharge row is
 *  the record of the reservation, and the ledger only ever records money that
 *  really moved. */
export const CALL_USAGE_TRANSACTION_TYPE = "CALL_USAGE";

export type CallEndReason =
  | "CLIENT_END"
  | "PEER_END"
  | "MAX_DURATION"
  | "INSUFFICIENT_FUNDS"
  | "ADMIN_REVERSAL"
  | "ABANDONED";

export class BillingError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 402) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
  }
}

export interface CallBillingTerms {
  /** Rupees charged per started minute, from PricingConfig. */
  ratePerMinute: number;
  /** Ceiling on what a single call may consume, in minutes. */
  maxBillableMinutes: number;
  /** True when per-minute charging is switched on. */
  enabled: boolean;
}

function toMoney(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Two decimals, matching the Decimal(10,2) columns. Rounding here rather than
  // at the boundary keeps "what the user was quoted" and "what was taken" equal.
  return Math.round(n * 100) / 100;
}

/** Reads the admin-configurable terms. Missing or nonsensical config falls back
 *  to a safe default rather than throwing: billing must not be what takes the
 *  call API down. */
export async function getCallTerms(): Promise<CallBillingTerms> {
  const [rate, maxMinutes, enabled] = await Promise.all([
    getConfig("CALL_RATE_PER_MINUTE", 1),
    getConfig("CALL_MAX_BILLABLE_MINUTES", 60),
    getConfig("CALL_BILLING_ENABLED", 0),
  ]);
  const r = Number(rate);
  return {
    // A negative or absurd rate is clamped rather than trusted: this value
    // reaches a money multiplier.
    ratePerMinute: toMoney(Number.isFinite(r) && r > 0 ? r : 1),
    maxBillableMinutes:
      Number.isFinite(Number(maxMinutes)) && Number(maxMinutes) > 0
        ? Math.min(600, Math.floor(Number(maxMinutes)))
        : 60,
    enabled: Number(enabled) === 1,
  };
}

/**
 * Reserves funds for a call that is about to connect.
 *
 * The reservation and the CallCharge row are written in one transaction, and
 * the balance update is guarded on available funds, so two concurrent calls
 * from the same wallet cannot both pass the affordability check.
 */
export async function holdForCall(params: {
  callId: string;
  callerId: string;
  receiverId: string;
  terms: CallBillingTerms;
}): Promise<{ heldAmount: number; ratePerMinute: number; maxBillableMinutes: number }> {
  const { callId, callerId, receiverId, terms } = params;
  const heldAmount = toMoney(terms.ratePerMinute * terms.maxBillableMinutes);

  if (heldAmount <= 0) {
    throw new BillingError("ZERO_HOLD", "Call rate is zero; billing cannot reserve funds.", 500);
  }

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId: callerId } });
    if (!wallet) {
      throw new BillingError("NO_WALLET", "No wallet found for this account.", 404);
    }

    const available = Number(wallet.balance) - Number(wallet.heldBalance);
    if (available < heldAmount) {
      // Surfaced with the shortfall so the client can say what is needed, and
      // it is the same guard the atomic update below enforces, so the message
      // can never disagree with the decision.
      throw new BillingError(
        "INSUFFICIENT_BALANCE",
        `Needs INR ${heldAmount.toFixed(2)} available to start this call; you have INR ${available.toFixed(2)}.`,
      );
    }

    // Guarded update, written as raw SQL because the invariant involves two
    // columns: after the reservation, spendable = balance - heldBalance must
    // not go negative. Expressing that as `balance >= heldBalance + $held`
    // lets Postgres evaluate it against the CURRENT row inside the same
    // statement, so a concurrent reservation that committed first makes this
    // match zero rows. Reading-then-comparing (a compare-and-swap on values
    // fetched earlier in the transaction) would only be safe under serializable
    // isolation; this is correct under READ COMMITTED, which is what we run.
    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Wallet"
         SET "heldBalance" = "heldBalance" + ${heldAmount},
             "updatedAt"   = now()
       WHERE id = ${wallet.id}
         AND "balance" - "heldBalance" >= ${heldAmount}
      RETURNING id`;
    if (claimed.length !== 1) {
      const fresh = await tx.wallet.findUnique({ where: { id: wallet.id } });
      const free = toMoney(Number(fresh?.balance ?? 0) - Number(fresh?.heldBalance ?? 0));
      throw new BillingError(
        "INSUFFICIENT_BALANCE",
        `Needs INR ${heldAmount.toFixed(2)} available to start this call; you have INR ${free.toFixed(2)}.`,
      );
    }

    // startedAt comes from the database clock, not the application host, so a
    // skewed deploy host cannot shorten or lengthen a billable call.
    const started = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() as now`;
    const startedAt = started[0]?.now ?? new Date();

    await tx.callCharge.create({
      data: {
        callId,
        callerId,
        receiverId,
        walletId: wallet.id,
        ratePerMinute: new Prisma.Decimal(terms.ratePerMinute),
        heldAmount: new Prisma.Decimal(heldAmount),
        status: "HELD",
        billableSeconds: 0,
        startedAt,
      },
    });

    return { heldAmount, startedAt };
  });

  return {
    heldAmount: result.heldAmount,
    ratePerMinute: terms.ratePerMinute,
    maxBillableMinutes: terms.maxBillableMinutes,
  };
}

/**
 * Settles a held call: charges the billable minutes and returns the remainder
 * of the reservation.
 *
 * Idempotent by construction. The transition is a guarded updateMany on
 * `status = 'HELD'`, so the first caller to settle wins and every later attempt
 * (a hangup racing a disconnect, a retried request) finds zero rows and
 * changes nothing. That matters because end-of-call is exactly where duplicate
 * delivery is normal.
 */
export async function settleCall(
  callId: string,
  endReason: CallEndReason = "CLIENT_END"
): Promise<{ charged: number; refunded: number; billableSeconds: number } | null> {
  return prisma.$transaction(async (tx) => {
    const charge = await tx.callCharge.findUnique({ where: { callId } });
    if (!charge) return null;
    if (charge.status !== "HELD") return null; // already settled

    const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() as now`;
    const now = clock[0]?.now ?? new Date();

    // Duration is measured server-side, from the row's own startedAt, and is
    // clamped to the hold's ceiling. A clock that appears to run backwards
    // bills nothing rather than a negative amount.
    const elapsedMs = now.getTime() - charge.startedAt.getTime();
    const cappedMs = Math.min(Math.max(elapsedMs, 0), Number(charge.heldAmount) / Number(charge.ratePerMinute) * 60_000);
    const billableSeconds = Math.floor(cappedMs / 1000);
    // Partial minutes are not billed: the rate is "per minute", so a 20 second
    // call is 0 minutes. Charging a pro-rated fraction would contradict the
    // rate the user agreed to.
    const billableMinutes = Math.floor(billableSeconds / 60);
    const charged = toMoney(Number(charge.ratePerMinute) * billableMinutes);
    // Informational only: the portion of the reservation that was never
    // consumed. The whole hold is released below, not just this difference.
    const refunded = toMoney(Number(charge.heldAmount) - charged);

    // Claim the settlement before moving money. One winner; everyone else sees
    // count 0 and returns.
    const claimed = await tx.callCharge.updateMany({
      where: { id: charge.id, status: "HELD" },
      data: {
        status: "CHARGED",
        chargedAmount: new Prisma.Decimal(charged),
        refundedAmount: new Prisma.Decimal(refunded),
        billableSeconds,
        endedAt: now,
        endReason,
        updatedAt: now,
      },
    });
    if (claimed.count !== 1) return null;

    // The ENTIRE reservation leaves heldBalance, whatever was consumed.
    // Only the consumed part left `balance` above, so releasing the full hold
    // is what returns the unused reservation to spendable funds. Releasing
    // (held - charged) instead would leave `charged` stranded in heldBalance
    // forever and quietly shrink a caller's spendable balance by the cost of
    // every call they have ever made.
    if (charged > 0) {
      const debited = await tx.wallet.updateMany({
        where: { id: charge.walletId, balance: { gte: new Prisma.Decimal(charged) } },
        data: { balance: { decrement: new Prisma.Decimal(charged) } },
      });
      if (debited.count !== 1) {
        // Should be unreachable: the funds are held, so they are in `balance`.
        // If it ever fires the ledger and the reservation have diverged, and a
        // silent partial would be worse than a loud failure.
        throw new BillingError(
          "SETTLE_INCONSISTENT",
          "Reserved funds were not found at settlement; the hold must be reconciled.",
          500,
        );
      }
      await tx.transaction.create({
        data: {
          walletId: charge.walletId,
          userId: charge.callerId,
          type: CALL_USAGE_TRANSACTION_TYPE,
          status: "COMPLETED",
          amount: new Prisma.Decimal(charged),
          description: `Call usage: ${billableMinutes} min @ INR ${Number(charge.ratePerMinute).toFixed(2)}/min`,
          referenceId: callId,
        },
      });
    }

    const heldTotal = toMoney(Number(charge.heldAmount));
    if (heldTotal > 0) {
      await tx.wallet.update({
        where: { id: charge.walletId },
        data: { heldBalance: { decrement: new Prisma.Decimal(heldTotal) } },
      });
    }

    await tx.callLog
      .update({
        where: { id: callId },
        data: { status: "ENDED", endedAt: now, duration: billableSeconds },
      })
      .catch(() => {
        // The charge is the record of truth for money. CallLog is a
        // convenience view, so a failure here must not roll back a settled
        // charge; the reconciliation sweep repairs it.
      });

    return { charged, refunded, billableSeconds };
  });
}

/**
 * Releases a hold without charging, for a call that connected but produced no
 * billable minute (instant hangup) or whose settlement must be undone by an
 * admin. Charges nothing; returns the full reservation.
 */
export async function releaseHold(
  callId: string,
  endReason: CallEndReason = "ABANDONED"
): Promise<{ refunded: number } | null> {
  return prisma.$transaction(async (tx) => {
    const charge = await tx.callCharge.findUnique({ where: { callId } });
    if (!charge || charge.status !== "HELD") return null;

    const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() as now`;
    const now = clock[0]?.now ?? new Date();
    const amount = toMoney(Number(charge.heldAmount));

    const claimed = await tx.callCharge.updateMany({
      where: { id: charge.id, status: "HELD" },
      data: {
        status: "RELEASED",
        chargedAmount: new Prisma.Decimal(0),
        refundedAmount: new Prisma.Decimal(amount),
        billableSeconds: 0,
        endedAt: now,
        endReason,
        updatedAt: now,
      },
    });
    if (claimed.count !== 1) return null;

    if (amount > 0) {
      await tx.wallet.update({
        where: { id: charge.walletId },
        data: { heldBalance: { decrement: new Prisma.Decimal(amount) } },
      });
    }

    return { refunded: amount };
  });
}

/**
 * Sweep for reservations orphaned by a crash or deploy between answer and
 * settle. A held row whose call has ended but was never settled would otherwise
 * strand a caller's money indefinitely.
 */
export async function reconcileOrphanedHolds(olderThanMinutes = 120): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stale = await prisma.callCharge.findMany({
    where: { status: "HELD", startedAt: { lt: cutoff } },
    select: { callId: true },
  });
  let released = 0;
  for (const row of stale) {
    const r = await releaseHold(row.callId, "ABANDONED");
    if (r) released += 1;
  }
  return released;
}

/** Caller-facing balance view. `available` is what can actually be spent, and
 *  is deliberately the headline number: showing `balance` alone would invite a
 *  user to start a call their held funds cannot cover. */
export async function getSpendableBalance(userId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) return null;
  const balance = toMoney(wallet.balance);
  const held = toMoney(wallet.heldBalance);
  return { balance, held, available: toMoney(balance - held) };
}

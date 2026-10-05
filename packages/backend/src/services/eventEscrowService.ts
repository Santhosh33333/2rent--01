/**
 * Nabri event fee escrow.
 *
 * THE BUG THIS FIXES
 * -----------------
 * `eventPaymentService.payMyShare` debited the payer and stopped. It wrote a
 * `Transaction` of type `EVENT_SHARE` and moved on. Nothing anywhere in the
 * codebase ever credited the event organizer - `Event.paidAt` and
 * `Event.paymentStatus` existed but no code path set them from a settle. So an
 * attendee's fee left their wallet and reached no one. The organizer's money
 * was never in the app at all, which is also why "the host gets their amount"
 * could not be delivered: there was no delivery mechanism to point at.
 *
 * WHAT ESCROW MEANS HERE
 * ---------------------
 * On payment the money does NOT leave the payer. It moves into
 * `Wallet.heldBalance`, which the codebase already defined for prepaid call
 * billing with exactly the right semantics:
 *
 *     available = balance - heldBalance
 *
 * so the payer still owns the money (it stays in `balance`, visible and
 * refundable) but cannot spend it while the event is live. That is what "hold
 * the money" means in this system, and reusing it keeps ONE definition of
 * spendable money rather than adding a second balance that could disagree.
 *
 * `heldBalance` is a single number shared with call billing, so a per-hold
 * ledger row (`EventEscrow`) is required as well: without it there is no way to
 * know which rupees a refund should free, and refunding one attendee could
 * un-hold a call's reservation.
 *
 * WHERE MONEY GOES ON SETTLEMENT (and why this conserves it)
 * --------------------------------------------------------
 * Payer starts with balance 500, held 0. Pays a 200 share with a 20 fee.
 *
 *   hold     balance 500, held 200, available 300. Nothing has left the payer.
 *   release  payer balance 300, held 0. Organizer balance +180. Platform +20.
 *            300 + 180 + 20 = 500. Nothing created, nothing destroyed.
 *   refund   payer balance 500, held 0, available 500. Organizer +0.
 *            500 in, 500 out. Nothing created, nothing destroyed.
 *
 * The rule that matters: on RELEASE the payer's `balance` drops by the FULL
 * amount (the money really does leave them) and `heldBalance` drops by the same;
 * on REFUND only `heldBalance` drops (the money never left, so nothing may be
 * debited). Getting that backwards on either path either invents money or
 * strands it in `heldBalance` forever, shrinking the payer's spendable balance
 * by a cost they have already been refunded for.
 *
 * CONCURRENCY
 * -----------
 * Every balance mutation is a single guarded `UPDATE ... WHERE`, so Postgres
 * evaluates the invariant against the CURRENT row inside the same statement. A
 * read-then-compare would only be safe under SERIALIZABLE; this is correct
 * under READ COMMITTED, which is what this database runs. Each settlement also
 * claims its escrow row with a conditional update (status = 'HELD'), so two
 * concurrent decisions - an admin refund racing the auto-release sweep - settle
 * exactly once and the loser is told why.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
  EVENT_DISPUTE_WINDOW_HOURS,
  canStillReport,
  isDisputeOpen,
  releaseEligibleAt as releaseEligibleFrom,
  settlementReferenceEnd,
} from "./eventJoinPolicy";

/** Failure with a stable machine code and a message fit to show a user. */
export class EscrowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "EscrowError";
  }
}

/** Money is rounded to paise at every boundary so nothing drifts by a fraction. */
export function toMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Platform cut on an event payout.
 *
 * A flat 0 today, and named here as a single constant rather than sprinkled
 * through the code so turning it on is a one-line change. It is held BACK from
 * the organizer's payout (`amount - fee`), never added on top, because adding
 * it on top would charge the payer more than the share they were quoted.
 */
export const EVENT_PLATFORM_FEE = 0;

export interface HeldEscrow {
  escrowId: string;
  eventId: string;
  amount: number;
  releaseEligibleAt: Date;
}

/**
 * Reserve the payer's fee into escrow.
 *
 * MUST be called inside the caller's transaction, immediately after the share
 * has been claimed (PENDING -> PAID). Passing the transaction in rather than
 * opening one here is deliberate: the wallet guard, the share transition and the
 * escrow row have to commit together, or a crash between them leaves a share
 * marked PAID with no escrow behind it - the exact "money vanished" state this
 * whole module exists to eliminate.
 *
 * Idempotent by way of `EventEscrow.eventShareId` being unique: a second call
 * for the same share returns the existing hold instead of reserving twice.
 */
export async function holdShareInEscrow(
  tx: Prisma.TransactionClient,
  args: {
    eventId: string;
    eventShareId: string;
    payerId: string;
    organizerId: string;
    amount: number;
    startTime: Date;
    endTime: Date | null;
  },
): Promise<HeldEscrow> {
  const amount = toMoney(args.amount);
  if (!(amount > 0)) {
    // A zero or negative share must never create a hold. Zero would otherwise
    // write a ledger row that later "releases" nothing while still marking the
    // event settled, which reads as a successful payout of nothing.
    throw new EscrowError("INVALID_AMOUNT", "The amount to hold must be greater than zero.", 422);
  }

  const existing = await tx.eventEscrow.findUnique({
    where: { eventShareId: args.eventShareId },
    select: { id: true, amount: true, releaseEligibleAt: true },
  });
  if (existing) {
    return {
      escrowId: existing.id,
      eventId: args.eventId,
      amount: toMoney(Number(existing.amount)),
      releaseEligibleAt: existing.releaseEligibleAt,
    };
  }

  const wallet = await tx.wallet.findUnique({
    where: { userId: args.payerId },
    select: { id: true },
  });
  if (!wallet) {
    throw new EscrowError("WALLET_NOT_FOUND", "No wallet was found for this account.", 404);
  }

  // Guarded reserve. `balance - heldBalance >= amount` keeps spendable money
  // non-negative after the hold; a concurrent reservation that committed first
  // makes this match zero rows, which is the correct outcome, not an error to
  // retry blindly.
  const claimed = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "Wallet"
       SET "heldBalance" = "heldBalance" + ${new Prisma.Decimal(amount)},
           "updatedAt"   = now()
     WHERE id = ${wallet.id}
       AND "balance" - "heldBalance" >= ${new Prisma.Decimal(amount)}
    RETURNING id`;
  if (claimed.length !== 1) {
    const fresh = await tx.wallet.findUnique({
      where: { id: wallet.id },
      select: { balance: true, heldBalance: true },
    });
    const available = toMoney(Number(fresh?.balance ?? 0) - Number(fresh?.heldBalance ?? 0));
    throw new EscrowError(
      "INSUFFICIENT_BALANCE",
      `Needs INR ${amount.toFixed(2)} available to join this event; you have INR ${available.toFixed(2)}.`,
    );
  }

  // Fixed now, from the event's own end, so retuning the dispute window later
  // cannot move a deadline the payer already saw.
  const releaseAt = releaseEligibleFrom(
    settlementReferenceEnd(args.endTime, args.startTime),
  );
  const fee = toMoney(EVENT_PLATFORM_FEE);
  // Clamped: a fee larger than the share would make the payout negative and a
  // negative wallet increment is how money gets created out of nowhere.
  const payout = toMoney(Math.max(0, amount - Math.min(fee, amount)));

  const row = await tx.eventEscrow.create({
    data: {
      eventId: args.eventId,
      eventShareId: args.eventShareId,
      payerId: args.payerId,
      organizerId: args.organizerId,
      amount: new Prisma.Decimal(amount),
      platformFee: new Prisma.Decimal(toMoney(amount - payout)),
      organizerPayout: new Prisma.Decimal(payout),
      releaseEligibleAt: releaseAt,
    },
    select: { id: true },
  });

  await tx.transaction.create({
    data: {
      walletId: wallet.id,
      userId: args.payerId,
      type: "EVENT_ESCROW_HELD",
      status: "COMPLETED",
      amount: new Prisma.Decimal(amount),
      description: "Held for an event fee (released or refunded after the event)",
      referenceId: row.id,
    },
  });

  return { escrowId: row.id, eventId: args.eventId, amount, releaseEligibleAt: releaseAt };
}

/**
 * Shared tail for both settlement outcomes.
 *
 * Both release and refund do the same three things in the same order - claim
 * the row, move the payer's wallet, mark the share and the event - differing
 * only in which wallets move. Keeping them in one function is what guarantees
 * the two paths cannot drift into disagreeing about, say, whether the share
 * ends up PAID or REFUNDED.
 */
async function settleEscrow(
  escrowId: string,
  decision: "RELEASED" | "REFUNDED",
  adminId: string | null,
  note: string,
  now: Date,
): Promise<{ escrowId: string; eventId: string; amount: number; paidOut: number }> {
  // A decision with no explanation is not accepted. "Your money was returned"
  // is not an answer to "why did you take my money for an event that never
  // happened", and the payer is emailed this text verbatim.
  const trimmed = (note ?? "").trim();
  if (trimmed.length < 4) {
    throw new EscrowError(
      "DECISION_NOTE_REQUIRED",
      "Add a short note explaining this decision. The person who paid will see it.",
      422,
    );
  }

  return prisma.$transaction(async (tx) => {
    const escrow = await tx.eventEscrow.findUnique({
      where: { id: escrowId },
      select: {
        id: true,
        eventId: true,
        eventShareId: true,
        payerId: true,
        organizerId: true,
        amount: true,
        organizerPayout: true,
        status: true,
      },
    });
    if (!escrow) throw new EscrowError("ESCROW_NOT_FOUND", "That payment record no longer exists.", 404);
    if (escrow.status !== "HELD" && escrow.status !== "DISPUTED") {
      // Already RELEASED or REFUNDED. Reporting this rather than silently
      // succeeding is the point: a double-click on "refund all" must not pay
      // twice, and the operator needs to see that it was a no-op.
      throw new EscrowError(
        "ALREADY_SETTLED",
        `This payment was already ${escrow.status.toLowerCase()}. Nothing was changed.`,
        409,
      );
    }

    const amount = toMoney(Number(escrow.amount));
    const payout = toMoney(Number(escrow.organizerPayout));
    const payerWallet = await tx.wallet.findUnique({
      where: { userId: escrow.payerId },
      select: { id: true },
    });
    if (!payerWallet) {
      throw new EscrowError("WALLET_NOT_FOUND", "The payer has no wallet to settle.", 404);
    }

    // Claim FIRST. If two admins (or an admin and the sweep) decide at the same
    // moment, exactly one guarded update reports a claimed row and the other
    // throws ALREADY_SETTLED before any money has moved.
    const claimed = await tx.eventEscrow.updateMany({
      where: { id: escrow.id, status: { in: ["HELD", "DISPUTED"] } },
      data: {
        status: decision,
        decidedById: adminId,
        decisionNote: trimmed,
        ...(decision === "RELEASED" ? { releasedAt: now } : { refundedAt: now }),
      },
    });
    if (claimed.count !== 1) {
      throw new EscrowError("ALREADY_SETTLED", "This payment was already settled.", 409);
    }

    // Un-hold first on both paths. On release the payer's balance also drops by
    // the full amount, because the money genuinely leaves them; on refund it does
    // not, because it never left. See the header comment for the arithmetic.
    const released = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Wallet"
         SET "heldBalance" = "heldBalance" - ${new Prisma.Decimal(amount)},
             ${decision === "RELEASED"
               ? Prisma.sql`"balance" = "balance" - ${new Prisma.Decimal(amount)},`
               : Prisma.empty}
             "updatedAt" = now()
       WHERE id = ${payerWallet.id}
         AND "heldBalance" >= ${new Prisma.Decimal(amount)}
      RETURNING id`;
    if (released.length !== 1) {
      // Means the held total drifted below this one hold. Throwing here rolls
      // back the whole settlement rather than leaving the escrow marked settled
      // with the payer's heldBalance still containing this amount forever.
      throw new EscrowError(
        "HELD_BALANCE_MISMATCH",
        "The reserved amount did not match the payment record. Nothing was changed; an admin needs to check this wallet.",
        500,
      );
    }

    if (decision === "RELEASED" && payout > 0) {
      const orgWallet = await tx.wallet.findUnique({
        where: { userId: escrow.organizerId },
        select: { id: true },
      });
      if (!orgWallet) {
        throw new EscrowError(
          "ORGANIZER_WALLET_NOT_FOUND",
          "The organizer has no wallet to pay into. Nothing was changed.",
          404,
        );
      }
      await tx.wallet.update({
        where: { id: orgWallet.id },
        data: { balance: { increment: new Prisma.Decimal(payout) } },
      });
      await tx.transaction.create({
        data: {
          walletId: orgWallet.id,
          userId: escrow.organizerId,
          type: "EVENT_ESCROW_EARNED",
          status: "COMPLETED",
          amount: new Prisma.Decimal(payout),
          description: "Event fee earned",
          referenceId: escrow.id,
        },
      });
    }

    // The share's terminal state differs per outcome: released money was earned,
    // refunded money never happened. Collapsing these into one status would make
    // the cost sheet lie about who actually got paid.
    await tx.eventShare.updateMany({
      where: { id: escrow.eventShareId },
      data: { status: decision === "RELEASED" ? "PAID" : "REFUNDED" },
    });
    await tx.transaction.create({
      data: {
        walletId: payerWallet.id,
        userId: escrow.payerId,
        type: decision === "RELEASED" ? "EVENT_ESCROW_RELEASED" : "EVENT_ESCROW_REFUNDED",
        status: "COMPLETED",
        amount: new Prisma.Decimal(amount),
        description:
          decision === "RELEASED"
            ? "Event fee paid to the organizer"
            : "Event fee refunded - the event was not held",
        referenceId: escrow.id,
      },
    });

    await refreshEventSettlement(tx, escrow.eventId, now);
    await tx.auditLog.create({
      data: {
        // NULL, not a sentinel string. `AuditLog.actorId` is a real foreign key
        // to User, so "system:escrow-sweep" is not just ugly - it fails the FK
        // constraint and rolls back the settlement. `actorType` is what records
        // that this was automatic, which is the distinction that actually
        // matters when reading the log.
        actorId: adminId,
        actorType: adminId ? "ADMIN" : "SYSTEM",
        action: `EVENT_ESCROW_${decision}`,
        entityType: "EventEscrow",
        entityId: escrow.id,
        metadata: JSON.stringify({
          eventId: escrow.eventId,
          amount,
          payout,
          note: trimmed,
        }),
      },
    });

    return { escrowId: escrow.id, eventId: escrow.eventId, amount, paidOut: payout };
  });
}

/** Pay the organizer. Used by the sweep and by an admin clearing an event. */
export function releaseEscrow(escrowId: string, adminId: string | null, note: string) {
  return settleEscrow(escrowId, "RELEASED", adminId, note, new Date());
}

/** Give the payer their money back. */
export function refundEscrow(escrowId: string, adminId: string | null, note: string) {
  return settleEscrow(escrowId, "REFUNDED", adminId, note, new Date());
}

/**
 * Recompute an event's settlement status from its escrow rows.
 *
 * Derived rather than incremented so it cannot drift: running it twice, or
 * running it after a partial settlement, produces the same answer.
 */
async function refreshEventSettlement(
  tx: Prisma.TransactionClient,
  eventId: string,
  now: Date,
): Promise<void> {
  const rows = await tx.eventEscrow.findMany({
    where: { eventId },
    select: { status: true },
  });
  if (rows.length === 0) return;

  const has = (s: string) => rows.some((r) => r.status === s);
  let status: string;
  if (has("DISPUTED")) status = "IN_DISPUTE";
  else if (has("HELD")) status = "PENDING";
  else if (has("REFUNDED") && has("RELEASED")) status = "PARTIALLY_SETTLED";
  else if (has("REFUNDED")) status = "REFUNDED";
  else status = "RELEASED";

  await tx.event.update({
    where: { id: eventId },
    data: {
      settlementStatus: status,
      settledAt: has("HELD") || has("DISPUTED") ? null : now,
    },
  });
}

/**
 * Freeze one payer's hold because a report was filed.
 *
 * Only ever moves HELD -> DISPUTED. It never refunds, because deciding whether
 * an event was fake requires a human who can look at what happened - the
 * platform cannot tell a cancelled-by-rain event from a fabricated one.
 */
export async function freezeEscrowForReport(
  tx: Prisma.TransactionClient,
  escrowId: string,
  now: Date,
): Promise<void> {
  const frozen = await tx.eventEscrow.updateMany({
    where: { id: escrowId, status: "HELD" },
    data: { status: "DISPUTED" },
  });
  // Zero rows is fine: the escrow may already be RELEASED (a report that raced
  // the deadline) or already DISPUTED (a second report on the same payment).
  if (frozen.count === 1) {
    const escrow = await tx.eventEscrow.findUnique({
      where: { id: escrowId },
      select: { eventId: true },
    });
    if (escrow) await refreshEventSettlement(tx, escrow.eventId, now);
  }
}

/** Freeze every unpaid hold on an event, because a report is about the event. */
export async function freezeAllEscrowsForEvent(eventId: string, now: Date): Promise<number> {
  const { count } = await prisma.eventEscrow.updateMany({
    where: { eventId, status: "HELD" },
    data: { status: "DISPUTED" },
  });
  if (count > 0) {
    await prisma.event.update({
      where: { id: eventId },
      data: { settlementStatus: "IN_DISPUTE" },
    });
  }
  return count;
}

export interface SweepResult {
  scanned: number;
  released: number;
  skippedDisputed: number;
  failed: number;
}

/**
 * Release every hold whose dispute window has closed with nothing against it.
 *
 * This is the "no report came, so pay the host" path. It runs on a timer and is
 * also exposed to an admin for an on-demand run.
 *
 * One escrow per iteration, each in its own transaction, and a failure is
 * counted rather than thrown: a single bad row must not stop the sweep from
 * releasing the other ninety-nine people's money. The failing id is logged so
 * the operator can act, instead of the whole queue silently stalling.
 */
export async function sweepReleasableEscrows(now = new Date()): Promise<SweepResult> {
  const due = await prisma.eventEscrow.findMany({
    where: { status: "HELD", releaseEligibleAt: { lte: now } },
    select: { id: true },
    orderBy: { releaseEligibleAt: "asc" },
    take: 500,
  });

  const result: SweepResult = { scanned: due.length, released: 0, skippedDisputed: 0, failed: 0 };
  for (const row of due) {
    try {
      await releaseEscrow(
        row.id,
        null,
        "Released automatically: the event finished and no report was filed within 24 hours.",
      );
      result.released += 1;
    } catch (err: any) {
      // Two very different outcomes share this catch, and conflating them is how a
      // real problem becomes invisible.
      //
      // ALREADY_SETTLED just means a concurrent release, or an admin, decided this
      // escrow first. The row is settled and the money moved exactly once, so it is
      // a normal race and belongs in the "someone else got there" tally.
      //
      // HELD_BALANCE_MISMATCH is the opposite: the payer's heldBalance no longer
      // covers this one hold, so the settlement rolled back and the money is
      // genuinely unaccounted for. The error it throws says outright that "an admin
      // needs to check this wallet". Folding it into skippedDisputed counted it as
      // benign and skipped the log line, which is the one thing an operator would
      // have looked for -- a silent, repeating drift that only shows up later as a
      // wallet that does not add up. It has to be counted as failed and logged.
      if (err?.code === "ALREADY_SETTLED") {
        result.skippedDisputed += 1;
        continue;
      }
      result.failed += 1;
      console.error(
        `[ESCROW] auto-release failed for escrow ${row.id}: ${err?.code ?? ""} ${err?.message ?? err}`,
      );
    }
  }
  return result;
}

/**
 * How much of an event's fee money is where. Used by the admin queue and the
 * organizer's own payout screen, so nobody has to add up wallet numbers by hand.
 */
export async function eventEscrowSummary(eventId: string) {
  const rows = await prisma.eventEscrow.findMany({
    where: { eventId },
    select: { status: true, amount: true, organizerPayout: true, releaseEligibleAt: true },
  });
  const now = new Date();
  const sum = (pick: (r: (typeof rows)[number]) => boolean, col: "amount" | "organizerPayout") =>
    toMoney(rows.filter(pick).reduce((acc, r) => acc + Number(r[col]), 0));

  return {
    total: rows.length,
    held: sum((r) => r.status === "HELD", "amount"),
    disputed: sum((r) => r.status === "DISPUTED", "amount"),
    released: sum((r) => r.status === "RELEASED", "organizerPayout"),
    refunded: sum((r) => r.status === "REFUNDED", "amount"),
    // What the organizer would receive if every remaining hold released cleanly.
    pendingPayout: sum(
      (r) => r.status === "HELD" || r.status === "DISPUTED",
      "organizerPayout",
    ),
    disputeOpenFor: rows
      .filter((r) => r.status === "HELD" && isDisputeOpen(r.releaseEligibleAt, now))
      .length,
    windowHours: EVENT_DISPUTE_WINDOW_HOURS,
  };
}

/** Re-exported so callers can check a deadline without importing the policy module. */
export { canStillReport, isDisputeOpen };
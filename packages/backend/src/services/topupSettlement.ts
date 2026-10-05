/**
 * Settling a manual-UPI top-up: the one place a wallet is credited from a bank
 * reference.
 *
 * This exists as a service rather than staying inside
 * adminController.verifyTopupRequest because there are now two callers - an
 * admin clicking "verify", and bank-statement reconciliation crediting a matched
 * line - and two implementations of "credit a wallet" is precisely how a
 * double-credit bug gets written. Whichever path asks, the guard, the ledger
 * entry and the audit record are the same code.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { moneyTransaction } from "../utils/db";
import { ACCESS_DAYS } from "./refundService";

/**
 * Who asked for the credit. Recorded on the ledger entry and the audit log so a
 * statement-driven credit is never mistaken for a human decision when someone
 * is reconstructing what happened months later.
 */
export type SettleSource = "MANUAL" | "RECONCILED";

/** Thrown when the request was already settled. Callers map this to a 409. */
export class AlreadySettledError extends Error {
  constructor() {
    super("ALREADY_SETTLED");
    this.name = "AlreadySettledError";
  }
}

/** The shape both callers have: enough to credit, and the reference to record. */
export interface SettleableTopup {
  id: string;
  userId: string;
  amount: Prisma.Decimal | number | string;
  referenceNumber: string;
}

function toNumber(value: Prisma.Decimal | number | string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Top-up amount is not a number: ${String(value)}`);
  }
  return n;
}

/**
 * Credit a wallet for a verified top-up.
 *
 * The claim is the load-bearing part: the status transition is a conditional
 * updateMany on VERIFICATION_PENDING, so exactly one caller can ever win the
 * row. That is what makes it safe for reconciliation to run while an admin has
 * the same request open in front of them, and what makes a double-clicked
 * "apply" harmless.
 *
 * The whole credit is one transaction. A wallet increment without its ledger row
 * would leave money in a balance that no report explains; a ledger row without
 * the increment would explain money that never arrived.
 */
export async function settleTopupRequest(
  row: SettleableTopup,
  actorId: string,
  source: SettleSource,
  note?: string,
): Promise<void> {
  const amount = toNumber(row.amount);
  if (amount <= 0) {
    throw new Error(`Refusing to credit a non-positive top-up amount: ${amount}`);
  }

  await moneyTransaction(async (tx) => {
    // Conditional claim. Losers get count 0 and must not touch the wallet.
    const claimed = await tx.topupRequest.updateMany({
      where: { id: row.id, status: "VERIFICATION_PENDING" },
      data: {
        status: "VERIFIED",
        verifiedByAdminId: actorId,
        verificationNote: note ?? null,
      },
    });
    if (claimed.count !== 1) throw new AlreadySettledError();

    // upsert rather than find-then-create, matching the ten other wallet call
    // sites: a missing wallet is a recoverable state, not a reason to refuse to
    // pay someone who already sent the money.
    const wallet = await tx.wallet.upsert({
      where: { userId: row.userId },
      update: { balance: { increment: amount } },
      create: { userId: row.userId, balance: amount },
    });

    await tx.transaction.create({
      data: {
        userId: row.userId,
        walletId: wallet.id,
        type: "TOPUP",
        amount,
        status: "SUCCESS",
        description:
          source === "RECONCILED"
            ? `Bank statement reconciliation (UTR ${row.referenceNumber})`
            : `Manual UPI top-up (UTR ${row.referenceNumber})`,
        referenceId: `TOPUP-${row.id.slice(0, 8)}`,
      },
    });

    // Extend the access window in the same transaction as the credit.
    //
    // It used to happen only in the Cashfree settlement path, which is now
    // unreachable. So with the gateway retired a customer could pay by UPI, be
    // credited correctly, and still be refused by requirePaidAccess forever -
    // money taken, nothing received. The window has to be part of what settling
    // means, not a side effect of one provider's webhook.
    //
    // Additive from the later of now and the current expiry, so paying early does
    // not waste days the customer already paid for.
    //
    // Uses tx rather than grantAccessWindow: that helper reads through the shared
    // client, and calling it inside this transaction would be a second connection
    // reading a user row this transaction is writing - it would extend from a
    // stale accessUntil and silently overwrite it on commit.
    const existing = await tx.user.findUnique({
      where: { id: row.userId },
      select: { accessUntil: true },
    });
    if (!existing) throw new Error("USER_NOT_FOUND");

    const now = new Date();
    const base =
      existing.accessUntil && existing.accessUntil > now ? existing.accessUntil : now;
    await tx.user.update({
      where: { id: row.userId },
      data: {
        accessUntil: new Date(base.getTime() + ACCESS_DAYS * 24 * 60 * 60 * 1000),
        accessSource: "TOPUP",
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "ADMIN",
        action: source === "RECONCILED" ? "TOPUP_RECONCILED" : "TOPUP_VERIFIED",
        entityType: "TopupRequest",
        entityId: row.id,
        metadata: JSON.stringify({
          amount,
          referenceNumber: row.referenceNumber,
          source,
          accessDaysGranted: ACCESS_DAYS,
        }),
      },
    });
  });

  // Outside the transaction on purpose. createNotification runs through the
  // shared prisma client, so inside this transaction it would be a second
  // connection trying to read a row this transaction has not committed yet - and
  // a failed notification must never roll back a credit that already happened.
  await prisma.notification.create({
    data: {
      userId: row.userId,
      title: "Wallet topped up",
      body: `Rs ${amount} added to your wallet. ${note ?? ""}`.trim(),
      data: JSON.stringify({ kind: "TOPUP_VERIFIED", topupId: row.id }),
    },
  });
}

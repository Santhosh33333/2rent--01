/**
 * Settling a manual-UPI booking payment: the one place a UPI claim becomes a
 * paid, partner-dispatched booking.
 *
 * Mirrors `topupSettlement.ts` and exists for the same reason. This logic used to
 * live inside `adminController.verifyUpiPayment`, which meant bank-statement
 * reconciliation could not reuse it - and a second hand-written copy of "debit
 * the wallet, confirm the booking, find a partner" is precisely how a
 * double-debit gets written. Whichever path asks, the claim, the ledger entry,
 * the booking transition, the audit record and the notification are this code.
 *
 * The claim is the load-bearing part. The status transition is a conditional
 * updateMany on VERIFICATION_PENDING, so exactly one caller can win the row:
 * reconciliation running while an admin has the same payment open in front of
 * them is safe, and a double-clicked "apply" is harmless.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { moneyTransaction } from "../utils/db";
import * as partnerMatching from "./partnerMatchingEngine";

/** Thrown when the payment was already settled. Callers map this to a 409. */
export class AlreadySettledError extends Error {
  constructor() {
    super("ALREADY_SETTLED");
    this.name = "AlreadySettledError";
  }
}

/** Thrown when the payer cannot cover the booking from their wallet. */
export class InsufficientBalanceError extends Error {
  constructor() {
    super("INSUFFICIENT_BALANCE");
    this.name = "InsufficientBalanceError";
  }
}

/** Which path asked. Recorded so a statement-driven settle is never mistaken for a click. */
export type UpiSettleSource = "MANUAL" | "RECONCILED";

/** The fields both callers have. The booking is read inside, so it cannot go stale. */
export interface SettleableUpi {
  id: string;
  userId: string;
  amount: Prisma.Decimal | number | string;
}

export interface UpiSettlementResult {
  bookingId: string;
  /** False when the booking was already PAID and escrow was therefore not re-taken. */
  escrowHeld: boolean;
}

function toNumber(value: Prisma.Decimal | number | string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`UPI amount is not a number: ${String(value)}`);
  }
  return n;
}

/**
 * Verify a UPI payment: hold the booking's escrow, mark the claim verified, and
 * dispatch partner matching.
 *
 * The whole money movement is one transaction. A wallet decrement without its
 * ledger row leaves a balance no report explains; a ledger row without the
 * decrement explains money that never moved.
 */
export async function settleUpiPayment(
  row: SettleableUpi,
  actorId: string,
  source: UpiSettleSource,
  note?: string,
): Promise<UpiSettlementResult> {
  const amount = toNumber(row.amount);

  const result = await moneyTransaction(async (tx) => {
    const upi = await tx.upiPayment.findUnique({
      where: { id: row.id },
      include: { booking: true },
    });
    if (!upi) throw new Error("UPI_PAYMENT_NOT_FOUND");

    // Conditional claim. A loser gets count 0 and must not touch the wallet.
    const claimed = await tx.upiPayment.updateMany({
      where: { id: row.id, status: "VERIFICATION_PENDING" },
      data: {
        status: "VERIFIED",
        verifiedByAdminId: actorId,
        verificationNote: note ?? null,
      },
    });
    if (claimed.count !== 1) throw new AlreadySettledError();

    const booking = upi.booking;
    // Hold escrow only if this booking has not already been paid (idempotent).
    let escrowHeld = false;
    if (booking.paymentStatus !== "PAID") {
      const wallet = await tx.wallet.findUnique({ where: { userId: upi.userId } });
      if (!wallet) throw new Error("WALLET_MISSING");
      if (Number(wallet.balance) < amount) throw new InsufficientBalanceError();
      await tx.wallet.update({
        where: { userId: upi.userId },
        data: { balance: { decrement: amount } },
      });
      await tx.transaction.create({
        data: {
          userId: upi.userId,
          walletId: wallet.id,
          bookingId: booking.id,
          type: "WALLET_DEBIT",
          amount,
          status: "SUCCESS",
          description: `UPI booking payment - ${booking.serviceType}`,
        },
      });
      escrowHeld = true;
    }

    await tx.booking.updateMany({
      where: { id: booking.id, paymentStatus: "VERIFICATION_PENDING" },
      data: {
        status: "PARTNER_SEARCHING",
        paymentStatus: "PAID",
        paymentVerifiedAt: new Date(),
        paymentMethod: "UPI_MANUAL",
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "ADMIN",
        action: source === "RECONCILED" ? "UPI_PAYMENT_RECONCILED" : "UPI_PAYMENT_VERIFIED",
        entityType: "Booking",
        entityId: booking.id,
        metadata: JSON.stringify({
          referenceNumber: upi.referenceNumber,
          amount,
          note,
          source,
        }),
      },
    });

    return { bookingId: booking.id, escrowHeld };
  });

  // Outside the transaction on purpose: createNotification uses the shared
  // prisma client, so inside it would be a second connection reading a row this
  // transaction has not committed. A failed notification must never roll back a
  // payment that already went through.
  await prisma.notification.create({
    data: {
      userId: row.userId,
      title: "Payment Verified",
      body: `Your UPI payment for booking ${result.bookingId.slice(0, 8)} is verified. Searching for a partner.`,
      data: JSON.stringify({ bookingId: result.bookingId }),
    },
  });

  const booking = await prisma.booking.findUnique({
    where: { id: result.bookingId },
    select: {
      serviceType: true,
      startLocation: true,
      endLocation: true,
      startLatitude: true,
      startLongitude: true,
      endLatitude: true,
      endLongitude: true,
      durationMinutes: true,
      userId: true,
    },
  });

  // Same dispatch the manual path has always done, so a booking settled by
  // reconciliation is indistinguishable from one an admin clicked.
  if (booking) {
    partnerMatching
      .assignPartnerToBooking(result.bookingId, {
        serviceType: booking.serviceType,
        startLocation: booking.startLocation,
        endLocation: booking.endLocation,
        startLatitude: booking.startLatitude || undefined,
        startLongitude: booking.startLongitude || undefined,
        endLatitude: booking.endLatitude || undefined,
        endLongitude: booking.endLongitude || undefined,
        durationMinutes: booking.durationMinutes || undefined,
        userId: booking.userId,
      })
      .catch((e) => console.error("[UPI] dispatch error:", e));
  }

  return result;
}
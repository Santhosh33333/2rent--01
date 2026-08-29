import { prisma } from "../config/database";
import { emitToUser, getIO } from "./socketService";
import { sendPushNotification } from "./notificationService";

/**
 * Job dispatch pipeline.
 *
 * When a booking enters PARTNER_SEARCHING it is broadcast to every eligible
 * partner (service match + APPROVED + available + not blocked). Partners get
 * a realtime `new_job` event plus a persisted notification. If nobody claims
 * the job within DISPATCH_WINDOW_MS the booking expires and the user is
 * notified. The first partner to accept wins (atomic claim lives in the
 * controllers); everyone else is told the job was taken.
 */

export const DISPATCH_WINDOW_MS = 2 * 60 * 1000;

const expiryTimers = new Map<string, NodeJS.Timeout>();

interface DispatchTarget {
  id: string;
  userId: string;
}

function jobPayload(booking: {
  id: string;
  serviceType: string;
  scheduledAt: Date | null;
}) {
  // Privacy: exact pickup/drop addresses are withheld from the broadcast pool.
  // Precise location is released to the accepting partner after assignment.
  return {
    type: "NEW_JOB",
    bookingId: booking.id,
    serviceType: booking.serviceType,
    scheduledAt: booking.scheduledAt ? booking.scheduledAt.toISOString() : null,
    expiresAt: new Date(Date.now() + DISPATCH_WINDOW_MS).toISOString(),
  };
}

/**
 * Partners eligible to receive this job: approved, offering the service,
 * currently available, and not blocked by / blocking the booking's user.
 */
async function findEligiblePartners(booking: {
  serviceType: string;
  userId: string;
}): Promise<DispatchTarget[]> {
  const serviceFilter =
    booking.serviceType === "CARRY_BUDDY" ? { providesCarry: true } : { providesWalking: true };

  const partners = await prisma.partner.findMany({
    where: {
      ...serviceFilter,
      status: "APPROVED",
      isAvailable: true,
      // Eligibility includes KYC: never dispatch to partners who cannot accept.
      user: {
        status: "ACTIVE",
        verification: { status: { in: ["APPROVED", "VERIFIED"] } },
      },
      NOT: {
        user: { blocksInitiated: { some: { blockedId: booking.userId } } },
      },
    },
    select: { id: true, userId: true },
  });

  // Exclude partners blocked BY the booking user.
  if (partners.length > 0) {
    const blocker = await prisma.userBlock.findMany({
      where: { blockerId: booking.userId },
      select: { blockedId: true },
    });
    const blockedIds = new Set(blocker.map((b) => b.blockedId));
    return partners.filter((p) => !blockedIds.has(p.userId));
  }

  return partners;
}

async function persistNotification(userId: string, title: string, body: string, data: unknown) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: JSON.stringify(data),
      },
    });
  } catch (err) {
    console.error("[DISPATCH] Failed to persist notification:", err);
  }
}

/**
 * Fan a newly-created (or re-dispatched) booking out to eligible partners.
 * Fire-and-forget safe: never throws into the caller's flow.
 */
export async function dispatchBooking(bookingId: string): Promise<void> {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        serviceType: true,
        startLocation: true,
        endLocation: true,
        scheduledAt: true,
        status: true,
      },
    });

    if (!booking || booking.status !== "PARTNER_SEARCHING") return;

    const targets = await findEligiblePartners(booking);
    if (targets.length === 0) {
      scheduleExpiry(bookingId);
      return;
    }

    const payload = jobPayload(booking);
    const expiresAt = new Date(Date.now() + DISPATCH_WINDOW_MS);
    const serviceLabel = booking.serviceType === "CARRY_BUDDY" ? "Carry Buddy" : "Walking";

    for (const target of targets) {
      emitToUser(target.userId, "new_job", payload);
      void persistNotification(
        target.userId,
        "New job nearby",
        `A ${serviceLabel} job is available. Open the app to view details and accept.`,
        payload
      );
      void sendPushNotification(
        target.userId,
        "New job nearby",
        `A ${serviceLabel} job is available. Open the app to view details and accept.`,
        { bookingId: booking.id, type: "NEW_JOB" }
      );
    }

    // Persist dispatch queue rows (admin timeline + expiry bookkeeping).
    try {
      await prisma.dispatchRequest.createMany({
        data: targets.map((t) => ({
          bookingId: booking.id,
          partnerId: t.id,
          status: "SENT",
          expiresAt,
        })),
        skipDuplicates: true,
      });
    } catch (queueErr) {
      console.error("[DISPATCH] Failed to persist dispatch queue:", queueErr);
    }

    scheduleExpiry(bookingId);
  } catch (err) {
    console.error("[DISPATCH] dispatchBooking failed:", err);
  }
}

function scheduleExpiry(bookingId: string): void {
  clearExpiryTimer(bookingId);
  const timer = setTimeout(() => {
    void expireBooking(bookingId);
  }, DISPATCH_WINDOW_MS);
  timer.unref?.();
  expiryTimers.set(bookingId, timer);
}

function clearExpiryTimer(bookingId: string): void {
  const existing = expiryTimers.get(bookingId);
  if (existing) {
    clearTimeout(existing);
    expiryTimers.delete(bookingId);
  }
}

/** Mark an unclaimed booking EXPIRED after its dispatch window lapses. */
async function expireBooking(bookingId: string): Promise<void> {
  expiryTimers.delete(bookingId);
  try {
    const claimed = await prisma.booking.updateMany({
      where: { id: bookingId, status: "PARTNER_SEARCHING", partnerId: null },
      data: { status: "EXPIRED" },
    });
    if (claimed.count !== 1) return;

    // Queue bookkeeping: unclaimed requests are now EXPIRED.
    try {
      await prisma.dispatchRequest.updateMany({
        where: { bookingId, status: { in: ["SENT", "VIEWED"] } },
        data: { status: "EXPIRED", respondedAt: new Date() },
      });
    } catch (queueErr) {
      console.error("[DISPATCH] Failed to expire dispatch queue:", queueErr);
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, estimatedAmount: true, paymentStatus: true, refundStatus: true },
    });
    if (!booking) return;

    // Release the actual escrow hold on expiry, regardless of paymentStatus.
    // The hold (WALLET_DEBIT / CARRY_BUDDY_ESCROW) is taken at booking creation,
    // so an expired-unclaimed job must always give the money back.
    const escrowDebit = await prisma.transaction.findFirst({
      where: { bookingId: booking.id, type: { in: ["WALLET_DEBIT", "CARRY_BUDDY_ESCROW"] }, status: { in: ["SUCCESS", "PENDING"] } },
      orderBy: { createdAt: "desc" },
    });
    if (
      escrowDebit &&
      (booking.refundStatus === "NONE" || booking.refundStatus === null) &&
      Number(escrowDebit.amount || 0) > 0
    ) {
      try {
        await prisma.$transaction(async (tx) => {
          const wallet = await tx.wallet.upsert({
            where: { userId: booking.userId },
            create: { userId: booking.userId },
            update: {},
          });
          await tx.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: Number(escrowDebit.amount) } },
          });
          await tx.transaction.create({
            data: {
              userId: booking.userId,
              walletId: wallet.id,
              bookingId: booking.id,
              type: "REFUND",
              amount: Number(escrowDebit.amount),
              status: "SUCCESS",
              description: "Refund - booking expired unclaimed",
            },
          });
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              refundStatus: "REFUND_COMPLETED",
              refundAmount: Number(escrowDebit.amount),
              refundCompletedAt: new Date(),
            },
          });
        });
      } catch (refundErr) {
        console.error("[DISPATCH] Failed to refund expired booking:", refundErr);
      }
    }

    emitToUser(booking.userId, "booking_update", {
      bookingId,
      status: "EXPIRED",
      message: "No partner accepted this job in time.",
    });
    void persistNotification(
      booking.userId,
      "Job expired",
      "No partner accepted your request in time. Please try booking again.",
      { bookingId, type: "JOB_EXPIRED" }
    );
    getIO()?.to(`booking_${bookingId}`).emit("booking_update", {
      bookingId,
      status: "EXPIRED",
      timestamp: Date.now(),
    });

  } catch (err) {
    console.error("[DISPATCH] expireBooking failed:", err);
  }
}

/**
 * Lazy sweep for bookings whose in-process timer was lost (e.g. server
 * restart). Called before partner job listings so stale offers never show.
 */
export async function expireStaleSearches(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DISPATCH_WINDOW_MS);
    const stale = await prisma.booking.updateMany({
      where: { status: "PARTNER_SEARCHING", partnerId: null, createdAt: { lt: cutoff } },
      data: { status: "EXPIRED" },
    });
  } catch (err) {
    console.error("[DISPATCH] expireStaleSearches failed:", err);
  }
}

/**
 * Mark this partner's pending offers as VIEWED when they open the job list.
 */
export async function markDispatchesViewed(partnerId: string): Promise<void> {
  try {
    await prisma.dispatchRequest.updateMany({
      where: { partnerId, status: "SENT", viewedAt: null },
      data: { status: "VIEWED", viewedAt: new Date() },
    });
  } catch (err) {
    console.error("[DISPATCH] markDispatchesViewed failed:", err);
  }
}

/**
 * After a partner wins the atomic claim: stop the expiry timer, tell the
 * user their job was accepted, update the booking room, and inform all
 * other eligible partners that the job is gone.
 */
export async function onBookingClaimed(bookingId: string, winnerUserId: string): Promise<void> {
  clearExpiryTimer(bookingId);
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        serviceType: true,
        startLocation: true,
        endLocation: true,
      },
    });
    if (!booking) return;

    const winner = await prisma.partner.findUnique({
      where: { userId: winnerUserId },
      include: { user: { select: { fullName: true } } },
    });

    // Queue bookkeeping: winner ACCEPTED, everyone else CANCELLED.
    try {
      if (winner) {
        await prisma.dispatchRequest.updateMany({
          where: { bookingId, status: { in: ["SENT", "VIEWED"] } },
          data: { status: "CANCELLED", respondedAt: new Date() },
        });
        await prisma.dispatchRequest.updateMany({
          where: { bookingId, partnerId: winner.id },
          data: { status: "ACCEPTED", respondedAt: new Date() },
        });
      }
    } catch (queueErr) {
      console.error("[DISPATCH] Failed to update dispatch queue on claim:", queueErr);
    }

    // Notify the booking owner.
    emitToUser(booking.userId, "booking_update", {
      bookingId,
      status: "PARTNER_ACCEPTED",
      partnerName: winner?.user.fullName ?? "Your partner",
    });
    void persistNotification(
      booking.userId,
      "Partner found!",
      `${winner?.user.fullName ?? "A partner"} accepted your ${booking.startLocation} job.`,
      { bookingId, type: "JOB_ACCEPTED" }
    );
    getIO()?.to(`booking_${bookingId}`).emit("booking_update", {
      bookingId,
      status: "PARTNER_ACCEPTED",
      timestamp: Date.now(),
    });

    // Tell other eligible partners the job is taken.
    const targets = await findEligiblePartners(booking);
    for (const target of targets) {
      if (target.userId === winnerUserId) continue;
      emitToUser(target.userId, "job_taken", { bookingId });
      void persistNotification(
        target.userId,
        "Job taken",
        "Another partner already accepted this job.",
        { bookingId, type: "JOB_TAKEN" }
      );
    }
  } catch (err) {
    console.error("[DISPATCH] onBookingClaimed failed:", err);
  }
}

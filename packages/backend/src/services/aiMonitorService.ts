import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";

// ============================================================================
// Rules-based job monitoring (spec 107).
// These are transparent heuristics — NOT an opaque "AI". Every flag is an
// AuditLog row for ADMIN review. Nothing here suspends, bans, or penalises
// any user/partner automatically.
// ============================================================================

async function flag(entityType: string, entityId: string, signal: string, metadata: Record<string, any>): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: null,
        actorType: "SYSTEM",
        action: "AI_FLAG",
        entityType,
        entityId,
        metadata: JSON.stringify({ signal, ...metadata }),
      },
    });
  } catch {
    /* monitoring must never break the booking flow */
  }
}

/** Partner accepts far more jobs in a short window than plausible. */
export async function checkAcceptStorm(partnerUserId: string): Promise<void> {
  const windowMin = 10;
  const threshold = await getConfig("AI_ACCEPT_STORM_THRESHOLD", 10);
  const since = new Date(Date.now() - windowMin * 60_000);
  const count = await prisma.auditLog.count({
    where: { actorId: partnerUserId, action: "BOOKING_ACCEPT", createdAt: { gte: since } },
  });
  if (count > threshold) {
    await flag("User", partnerUserId, "ACCEPT_STORM", { acceptsIn10Min: count, threshold });
  }
}

/** Job completed implausibly fast (accept -> complete with ~no work time). */
export async function checkInstantCompletion(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { startedAt: true, completedAt: true, partnerId: true },
  });
  if (!booking?.startedAt || !booking?.completedAt) return;
  const minutes = (booking.completedAt.getTime() - booking.startedAt.getTime()) / 60_000;
  const minPlausible = await getConfig("AI_MIN_PLAUSIBLE_JOB_MINUTES", 5);
  if (minutes < minPlausible) {
    await flag("Booking", bookingId, "INSTANT_COMPLETION", {
      durationMinutes: Math.round(minutes * 100) / 100,
      minPlausible,
      partnerId: booking.partnerId,
    });
  }
}

/** Repeated OTP failures on one booking (possible brute force / sharing abuse). */
export async function checkOtpAbuse(bookingId: string, kind: "START" | "COMPLETION", attempts: number): Promise<void> {
  const threshold = await getConfig("AI_OTP_ABUSE_THRESHOLD", 4);
  if (attempts >= threshold) {
    await flag("Booking", bookingId, "OTP_ABUSE", { kind, attempts, threshold });
  }
}

import { prisma } from "../config/database";

/**
 * Persist a booking state-change audit row to BookingLog.
 * Best-effort: never throws into the caller's flow.
 */
export async function logBookingTransition(params: {
  bookingId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorId?: string | null;
  actorType?: "USER" | "PARTNER" | "SYSTEM" | "ADMIN";
  note?: string;
}): Promise<void> {
  try {
    await prisma.bookingLog.create({
      data: {
        bookingId: params.bookingId,
        fromStatus: params.fromStatus ?? null,
        toStatus: params.toStatus,
        actorId: params.actorId ?? null,
        actorType: params.actorType ?? "SYSTEM",
        note: params.note ?? null,
      },
    });
  } catch (err) {
    console.error("[BookingLog] Failed to log transition:", err);
  }
}

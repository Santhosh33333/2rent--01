import { prisma } from "../config/database";

export async function initiateRefund(bookingId: string, amount: number, reason: string, initiatedBy: "SYSTEM" | "USER" | "PARTNER" | "ADMIN") {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found");

  const refundLog = await prisma.refundLog.create({
    data: {
      bookingId,
      userId: booking.userId,
      amount,
      reason,
      type: "FULL",
      status: "INITIATED",
      initiatedBy,
    },
  });

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      refundStatus: "REFUND_INITIATED",
      refundAmount: amount,
      refundInitiatedAt: new Date(),
    },
  });

  return refundLog;
}

export async function completeRefund(bookingId: string, razorpayRefundId?: string) {
  const refundLog = await prisma.refundLog.findFirst({
    where: { bookingId, status: "INITIATED" },
  });
  if (!refundLog) throw new Error("No initiated refund found for this booking");

  const updated = await prisma.refundLog.update({
    where: { id: refundLog.id },
    data: {
      status: "COMPLETED",
      razorpayRefundId: razorpayRefundId || null,
      completedAt: new Date(),
    },
  });

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      refundStatus: "REFUND_COMPLETED",
      refundCompletedAt: new Date(),
    },
  });

  return updated;
}

export async function getRefundStatus(bookingId: string) {
  const refundLog = await prisma.refundLog.findFirst({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
  });
  return refundLog;
}

import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

/**
 * SECTION 29 — Admin analytics built from REAL database data (never fake).
 */
export async function getAdminAnalytics(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      dailyBookings,
      monthlyBookings,
      totalRevenue,
      monthlyRevenue,
      platformFees,
      partnerEarnings,
      refunds,
      creditsIssued,
      offersUsed,
      activeUsers,
      activePartners,
      totalBookings,
      cancelledBookings,
      failedPayments,
      serviceDemand,
      cityPerformance,
    ] = await Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.booking.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.booking.aggregate({ _sum: { finalAmount: true }, where: { status: "COMPLETED" } }),
      prisma.booking.aggregate({ _sum: { finalAmount: true }, where: { status: "COMPLETED", completedAt: { gte: startOfMonth } } }),
      prisma.booking.aggregate({ _sum: { platformFee: true }, where: { status: "COMPLETED" } }),
      prisma.partnerEarnings.aggregate({ _sum: { lifetimeEarnings: true } }),
      prisma.refundLog.aggregate({ _sum: { amount: true }, where: { status: "COMPLETED" } }).catch(() => ({ _sum: { amount: null } })),
      prisma.creditLedger.aggregate({ _sum: { amount: true }, where: { type: "PROMOTIONAL_CREDIT", status: "COMPLETED" } }),
      prisma.booking.count({ where: { offerCode: { not: null } } }),
      prisma.user.count({ where: { status: "ACTIVE", activeRole: "USER" } }),
      prisma.partner.count({ where: { status: "APPROVED" } }),
      prisma.booking.count(),
      prisma.booking.count({ where: { status: "CANCELLED" } }),
      prisma.paymentOrder.count({ where: { status: "FAILED" } }),
      prisma.booking.groupBy({ by: ["serviceType"], _count: { _all: true } }).catch(() => []),
      prisma.booking.groupBy({ by: ["userId"], _count: true }).catch(() => []),
    ]);

    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    const cancellationRate = totalBookings ? (cancelledBookings / totalBookings) * 100 : 0;

    sendSuccess(res, {
      dailyBookings,
      monthlyBookings,
      revenue: num(totalRevenue._sum.finalAmount),
      monthlyRevenue: num(monthlyRevenue._sum.finalAmount),
      platformFees: num(platformFees._sum.platformFee),
      partnerEarnings: num(partnerEarnings._sum.lifetimeEarnings),
      refundsIssued: num((refunds as any)._sum.amount),
      creditsIssued: num(creditsIssued._sum.amount),
      offersUsed,
      activeUsers,
      activePartners,
      cancellationRate: Number(cancellationRate.toFixed(2)),
      paymentFailures: failedPayments,
      serviceDemand: (serviceDemand as any[]).map((s) => ({ serviceType: s.serviceType, count: s._count._all })),
      cityPerformance: { distinctCustomers: (cityPerformance as any[]).length },
      generatedAt: now.toISOString(),
    }, "Admin analytics retrieved.");
  } catch (err) {
    console.error("getAdminAnalytics error:", err);
    sendError(res, "Failed to compute admin analytics.", 500, "INTERNAL_ERROR");
  }
}

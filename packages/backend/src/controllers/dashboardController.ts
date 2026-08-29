import { Response } from "express";
import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";

export async function getDashboardStats(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const activeRole = req.user!.activeRole || req.user!.role || "USER";

    switch (activeRole) {
      case "USER":
        await getUserStats(userId, res);
        break;
      case "PARTNER":
        await getPartnerStats(userId, res);
        break;
      case "SUPER_ADMIN":
      case "ADMIN":
      case "MODERATOR":
      case "SUPPORT":
      case "FINANCE":
        await getAdminStats(userId, res);
        break;
      default:
        await getUserStats(userId, res);
    }
  } catch (err) {
    console.error("getDashboardStats error:", err);
    sendError(res, "Failed to fetch dashboard stats.", 500, "INTERNAL_ERROR");
  }
}

async function getUserStats(userId: string, res: Response) {
  const [friendCount, bookingCount, communityCount, eventCount, wallet] = await Promise.all([
    prisma.friendship.count({
      where: { OR: [{ requesterId: userId }, { addresseeId: userId }], status: "ACCEPTED" },
    }),
    prisma.walkingRequest.count({ where: { requesterId: userId } }),
    prisma.communityMember.count({ where: { userId } }),
    prisma.eventAttendee.count({ where: { userId } }),
    prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
  ]);

  sendSuccess(res, {
    role: "USER",
    stats: {
      friends: friendCount,
      bookings: bookingCount,
      communities: communityCount,
      events: eventCount,
      walletBalance: wallet?.balance || 0,
    },
    navConfig: {
      items: [
        { to: "/dashboard", icon: "Home", label: "Home" },
        { to: "/communities", icon: "Users", label: "Social" },
        { to: "/messages", icon: "MessageCircle", label: "Chat" },
        { to: "/events", icon: "Calendar", label: "Events" },
        { to: "/profile", icon: "User", label: "Profile" },
      ],
    },
  });
}

async function getPartnerStats(userId: string, res: Response) {
  const [partner, activeJobs, nearbyJobs, completedJobs, wallet] = await Promise.all([
    prisma.partner.findUnique({
      where: { userId },
      select: { totalEarnings: true, rating: true, totalJobs: true, completedJobs: true },
    }),
    prisma.booking.count({
      where: { partnerId: { not: null }, status: { in: ["PARTNER_ACCEPTED", "OTP_GENERATED", "IN_PROGRESS"] } },
    }),
    prisma.booking.count({ where: { status: "PARTNER_SEARCHING" } }),
    prisma.booking.count({ where: { partnerId: { not: null }, status: "COMPLETED" } }),
    prisma.wallet.findUnique({ where: { userId }, select: { balance: true } }),
  ]);

  sendSuccess(res, {
    role: "PARTNER",
    stats: {
      todayRequests: nearbyJobs,
      activeJobs,
      totalEarnings: partner?.totalEarnings || 0,
      walletBalance: wallet?.balance || 0,
      avgRating: partner?.rating || 0,
      completedJobs: completedJobs || partner?.completedJobs || 0,
      totalJobs: partner?.totalJobs || 0,
    },
    navConfig: {
      items: [
        { to: "/partner/dashboard", icon: "LayoutDashboard", label: "Dashboard" },
        { to: "/partner/jobs", icon: "ClipboardList", label: "Jobs" },
        { to: "/partner/map", icon: "Map", label: "Map" },
        { to: "/partner/wallet", icon: "Wallet", label: "Wallet" },
        { to: "/partner/profile", icon: "User", label: "Profile" },
      ],
    },
  });
}

async function getAdminStats(userId: string, res: Response) {
  const [totalUsers, activePartners, pendingKYC, totalRevenue, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.walkingPartner.count({ where: { status: "APPROVED" } }),
    prisma.verification.count({ where: { status: { in: ["SUBMITTED", "PENDING_REVIEW", "UNDER_VERIFICATION"] } } }),
    prisma.transaction.aggregate({ where: { status: "COMPLETED" }, _sum: { amount: true } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, fullName: true, email: true, createdAt: true },
    }),
  ]);

  sendSuccess(res, {
    role: "ADMIN",
    stats: {
      totalUsers,
      activePartners,
      pendingKYC,
      totalRevenue: totalRevenue._sum.amount || 0,
      recentUsers,
    },
  });
}

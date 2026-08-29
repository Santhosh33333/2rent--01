import { prisma } from "../config/database";

export async function findAvailablePartners(serviceType: "WALKING" | "CARRY_BUDDY", limit?: number) {
  const where = serviceType === "WALKING"
    ? { status: "APPROVED", isAvailable: true, providesWalking: true }
    : { status: "APPROVED", isAvailable: true, providesCarry: true };

  const partners = await prisma.partner.findMany({
    where,
    include: {
      user: {
        // Privacy: partner contact details stay private in discovery lists.
        select: { id: true, fullName: true, avatarUrl: true, city: true },
      },
    },
    take: limit ?? 20,
  });

  return partners;
}

export async function getPartnerStats(partnerId: string) {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner) throw new Error("Partner not found");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayBookings = await prisma.booking.findMany({
    where: {
      partnerId,
      createdAt: { gte: todayStart },
    },
  });

  const todayJobs = todayBookings.length;
  const todayEarnings = todayBookings.reduce((sum, b) => sum + (b.partnerEarning || 0), 0);

  const activeJob = await prisma.booking.findFirst({
    where: {
      partnerId,
      status: { in: ["IN_PROGRESS", "OTP_GENERATED"] },
    },
  });

  return {
    todayJobs,
    todayEarnings,
    totalJobs: partner.totalJobs,
    totalEarnings: partner.totalEarnings,
    averageRating: partner.averageRating,
    activeJob,
  };
}

export async function updateAvailability(partnerId: string, isAvailable: boolean) {
  const partner = await prisma.partner.update({
    where: { id: partnerId },
    data: { isAvailable },
  });
  return partner;
}

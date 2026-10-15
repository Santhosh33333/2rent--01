import { prisma } from "../config/database";
import { isUserOnline } from "./socketService";
import { isUserOnlineShared } from "./redisClient";

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

// Bound the presence fan-out so the picker stays fast. Each candidate costs one
// presence check; 100 is well within a single request on the free instance.
const PRESENCE_BATCH = 100;

/**
 * Whether this user is connected right now. Redis is authoritative when it is
 * configured (multi-instance); with no Redis the in-memory socket registry is
 * the truth, which is the case on the single free instance.
 */
export async function isPartnerUserOnline(userId: string): Promise<boolean> {
  const shared = await isUserOnlineShared(userId);
  return shared === null ? isUserOnline(userId) : shared;
}

export interface OnlineCompanion {
  partnerId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  city: string | null;
  rating: number;
  completedJobs: number;
  isOnline: true;
}

/**
 * People who can take an in-app call/chat session right now.
 *
 * Eligible = the same rule dispatch uses (approved, available, verified) minus
 * the viewer and anyone either side has blocked, and actually connected. The
 * contact details of a partner are never exposed here.
 */
export async function findOnlineCompanions(viewerId: string, limit = 30): Promise<OnlineCompanion[]> {
  const [blockedByViewer, blockedViewer] = await Promise.all([
    prisma.userBlock.findMany({ where: { blockerId: viewerId }, select: { blockedId: true } }),
    prisma.userBlock.findMany({ where: { blockedId: viewerId }, select: { blockerId: true } }),
  ]);
  const excluded = new Set<string>([viewerId]);
  for (const b of blockedByViewer) excluded.add(b.blockedId);
  for (const b of blockedViewer) excluded.add(b.blockerId);

  const partners = await prisma.partner.findMany({
    where: {
      status: "APPROVED",
      isAvailable: true,
      user: {
        status: "ACTIVE",
        verification: { status: { in: ["APPROVED", "VERIFIED"] } },
      },
    },
    select: {
      id: true,
      userId: true,
      rating: true,
      averageRating: true,
      completedJobs: true,
      user: { select: { fullName: true, avatarUrl: true, city: true } },
    },
    // Best-rated, most-experienced people first.
    orderBy: [{ averageRating: "desc" }, { completedJobs: "desc" }],
    take: PRESENCE_BATCH,
  });

  const candidates = partners.filter((p) => !excluded.has(p.userId));
  const presence = await Promise.all(candidates.map((p) => isPartnerUserOnline(p.userId)));

  const online: OnlineCompanion[] = [];
  for (let i = 0; i < candidates.length && online.length < limit; i++) {
    if (!presence[i]) continue;
    const p = candidates[i];
    online.push({
      partnerId: p.id,
      userId: p.userId,
      displayName: p.user.fullName ?? "",
      avatarUrl: p.user.avatarUrl ?? null,
      city: p.user.city ?? null,
      rating: p.averageRating || p.rating || 0,
      completedJobs: p.completedJobs,
      isOnline: true,
    });
  }
  return online;
}

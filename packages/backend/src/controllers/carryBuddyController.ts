import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

const PLATFORM_FEE_PERCENT = 0.1;
const MAX_CARRY_FARE = 100000;

class CarryFlowError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function createRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { itemType, itemDescription, startLocation, endLocation, startTime, durationMinutes, fare, notes } = req.body;

    const parsedFare = Number(fare);
    if (!Number.isFinite(parsedFare) || parsedFare <= 0) {
      sendError(res, "A positive fare is required for carry buddy requests.", 400, "INVALID_FARE");
      return;
    }
    if (parsedFare > MAX_CARRY_FARE) {
      sendError(res, `Maximum carry buddy fare is ${MAX_CARRY_FARE}.`, 400, "FARE_EXCEEDS_LIMIT");
      return;
    }
    const parsedStart = new Date(startTime);
    if (Number.isNaN(parsedStart.getTime())) {
      sendError(res, "Valid start time is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const userId = req.user!.userId;

    const request = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new CarryFlowError("WALLET_NOT_FOUND");

      // Re-read inside the transaction so concurrent spends are accounted for.
      const lockedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
      if (!lockedWallet || Number(lockedWallet.balance) < parsedFare) {
        throw new CarryFlowError("INSUFFICIENT_FUNDS");
      }

      const created = await tx.carryBuddyRequest.create({
        data: {
          requesterId: userId,
          itemType,
          itemDescription,
          startLocation,
          endLocation,
          startTime: parsedStart,
          durationMinutes: durationMinutes ? Number(durationMinutes) : null,
          fare: round2(parsedFare),
          notes,
          status: "OPEN",
        },
      });

      // Escrow: hold the fare at posting time; released to partner on completion
      // or refunded on cancellation. Single debit for the whole lifecycle.
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: round2(parsedFare) } },
      });

      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: "CARRY_BUDDY_ESCROW",
          status: "PENDING",
          amount: round2(parsedFare),
          description: "Carry buddy fare held in escrow",
          referenceId: created.id,
        },
      });

      return created;
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "CARRY_BUDDY_CREATE",
        entityType: "CarryBuddyRequest",
        entityId: request.id,
        metadata: JSON.stringify({ fare: round2(parsedFare) }),
      },
    });

    sendSuccess(res, request, "Carry buddy request created.", 201);
  } catch (err: any) {
    if (err instanceof CarryFlowError) {
      if (err.code === "INSUFFICIENT_FUNDS") {
        sendError(res, "Insufficient wallet balance to cover the escrowed fare.", 400, "INSUFFICIENT_FUNDS");
        return;
      }
      if (err.code === "WALLET_NOT_FOUND") {
        sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND");
        return;
      }
    }
    sendError(res, "Failed to create carry buddy request.", 500, "INTERNAL_ERROR");
  }
}

export async function getRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.carryBuddyRequest.findMany({
        where: { status: "OPEN" },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { requester: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      prisma.carryBuddyRequest.count({ where: { status: "OPEN" } }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve carry buddy requests.", 500, "INTERNAL_ERROR");
  }
}

async function isEligibleCarrier(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, activeRole: true } });
  if (!user) return false;
  if (user.role === "CARRY_BUDDY_PARTNER" || user.activeRole === "CARRY_BUDDY_PARTNER") return true;
  const partner = await prisma.partner.findUnique({ where: { userId }, select: { status: true } });
  return partner?.status === "APPROVED";
}

export async function acceptRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const request = await prisma.carryBuddyRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.status !== "OPEN") {
      sendError(res, "Request is no longer open.", 400, "INVALID_STATUS");
      return;
    }
    if (request.requesterId === userId) {
      sendError(res, "Cannot accept your own request.", 400, "INVALID_ACTION");
      return;
    }
    if (!(await isEligibleCarrier(userId))) {
      sendError(res, "Approved carry partners only can accept requests.", 403, "PARTNER_REQUIRED");
      return;
    }

    // Atomic claim + fee computation in one transaction: first acceptor wins.
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.carryBuddyRequest.updateMany({
        where: { id, status: "OPEN" },
        data: { status: "ACCEPTED", acceptedById: userId },
      });
      if (claimed.count !== 1) throw new CarryFlowError("ALREADY_ACCEPTED");

      const fare = Number(request.fare);
      const platformFee = round2(fare * PLATFORM_FEE_PERCENT);
      const partnerEarning = round2(fare - platformFee);

      return tx.carryBuddyRequest.update({
        where: { id },
        data: { platformFee, partnerEarning },
      });
    });

    sendSuccess(res, updated, "Carry buddy request accepted.");
  } catch (err: any) {
    if (err instanceof CarryFlowError && err.code === "ALREADY_ACCEPTED") {
      sendError(res, "Request is no longer open.", 409, "ALREADY_ACCEPTED");
      return;
    }
    sendError(res, "Failed to accept carry buddy request.", 500, "INTERNAL_ERROR");
  }
}

export async function completeRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const request = await prisma.carryBuddyRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.requesterId !== userId && request.acceptedById !== userId) {
      sendError(res, "Not part of this request.", 403, "FORBIDDEN");
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Conditional claim: COMPLETED exactly once; replays and races rejected here.
      const claimed = await tx.carryBuddyRequest.updateMany({
        where: { id, status: "ACCEPTED" },
        data: { status: "COMPLETED", completedAt: new Date(), confirmedAt: new Date() },
      });
      if (claimed.count !== 1) throw new CarryFlowError("NOT_CLAIMABLE");

      const earning = Number(request.partnerEarning ?? request.fare ?? 0);
      if (earning > 0 && request.acceptedById) {
        let wallet = await tx.wallet.findUnique({ where: { userId: request.acceptedById } });
        if (!wallet) {
          wallet = await tx.wallet.create({ data: { userId: request.acceptedById } });
        }
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: earning } },
        });
        await tx.transaction.create({
          data: {
            userId: request.acceptedById,
            walletId: wallet.id,
            type: "CARRY_BUDDY_EARNING",
            status: "COMPLETED",
            amount: earning,
            description: "Carry buddy job earning",
            referenceId: `${id}:EARNING`,
          },
        });
      }

      return tx.carryBuddyRequest.findUnique({ where: { id } });
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "CARRY_BUDDY_COMPLETE",
        entityType: "CarryBuddyRequest",
        entityId: id,
        metadata: JSON.stringify({ completedBy: userId === request.requesterId ? "REQUESTER" : "PARTNER" }),
      },
    });

    sendSuccess(res, result, "Carry buddy request completed.");
  } catch (err: any) {
    if (err instanceof CarryFlowError && err.code === "NOT_CLAIMABLE") {
      sendError(res, "Request must be accepted before completing, or was already completed.", 409, "INVALID_STATUS");
      return;
    }
    sendError(res, "Failed to complete carry buddy request.", 500, "INTERNAL_ERROR");
  }
}

export async function cancelRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const request = await prisma.carryBuddyRequest.findUnique({ where: { id } });
    if (!request || request.requesterId !== userId) {
      sendError(res, "Request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }

    const refunded = await prisma.$transaction(async (tx) => {
      // Conditional claim: refund exactly once even under concurrent cancels.
      const claimed = await tx.carryBuddyRequest.updateMany({
        where: { id, requesterId: userId, status: "OPEN" },
        data: { status: "CANCELLED" },
      });
      if (claimed.count !== 1) throw new CarryFlowError("NOT_OPEN");

      let wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new CarryFlowError("WALLET_NOT_FOUND");

      const escrowAmount = Number(request.fare);
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { increment: escrowAmount } },
      });
      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          type: "CARRY_BUDDY_REFUND",
          status: "COMPLETED",
          amount: escrowAmount,
          description: "Carry buddy escrow refunded on cancellation",
          referenceId: `${id}:REFUND`,
        },
      });
      // Retire the held ledger row so it no longer shows as pending money.
      await tx.transaction.updateMany({
        where: { referenceId: id, type: "CARRY_BUDDY_ESCROW", status: "PENDING" },
        data: { status: "FAILED", description: "Escrow released: request cancelled by requester" },
      });
      return true;
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "CARRY_BUDDY_CANCEL",
        entityType: "CarryBuddyRequest",
        entityId: id,
        metadata: JSON.stringify({ refundedFare: Number(request.fare), settled: refunded }),
      },
    });

    sendSuccess(res, undefined, "Carry buddy request cancelled and escrow refunded.");
  } catch (err: any) {
    if (err instanceof CarryFlowError && err.code === "NOT_OPEN") {
      sendError(res, "Only open requests can be cancelled.", 409, "INVALID_STATUS");
      return;
    }
    if (err instanceof CarryFlowError && err.code === "WALLET_NOT_FOUND") {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND");
      return;
    }
    sendError(res, "Failed to cancel carry buddy request.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.carryBuddyRequest.findMany({
        where: { requesterId: userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { acceptedBy: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      prisma.carryBuddyRequest.count({ where: { requesterId: userId } }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve your carry buddy requests.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyJobs(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.carryBuddyRequest.findMany({
        where: { acceptedById: userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { requester: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      prisma.carryBuddyRequest.count({ where: { acceptedById: userId } }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve your carry buddy jobs.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PARTNER-FACING STATS / PROFILE / REVIEWS / EARNINGS / AVAILABILITY
// ============================================================================

export async function getMyStats(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [activeJobs, completedAgg, ratingAgg, partnerRow] = await Promise.all([
      prisma.carryBuddyRequest.count({
        where: { acceptedById: userId, status: "ACCEPTED" },
      }),
      prisma.carryBuddyRequest.aggregate({
        where: { acceptedById: userId, status: "COMPLETED" },
        _count: { _all: true },
        _sum: { partnerEarning: true },
      }),
      prisma.rating.aggregate({
        where: { ratedId: userId, targetType: { in: ["CARRY_BUDDY", "PARTNER"] } },
        _avg: { score: true },
      }),
      prisma.partner.findUnique({ where: { userId }, select: { rating: true } }),
    ]);

    sendSuccess(res, {
      activeJobs,
      completedJobs: completedAgg._count._all,
      totalEarnings: Number(completedAgg._sum.partnerEarning ?? 0),
      rating: Number(ratingAgg._avg.score ?? partnerRow?.rating ?? 0),
    });
  } catch (err) {
    sendError(res, "Failed to load stats.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyProfile(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [user, partnerRow] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true, avatarUrl: true, city: true },
      }),
      prisma.partner.findUnique({ where: { userId } }),
    ]);
    if (!user) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    const completed = await prisma.carryBuddyRequest.count({
      where: { acceptedById: userId, status: "COMPLETED" },
    });
    const totalAssigned = await prisma.carryBuddyRequest.count({
      where: { acceptedById: userId, status: { in: ["ACCEPTED", "COMPLETED", "CANCELLED"] } },
    });

    sendSuccess(res, {
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      city: user.city,
      isAvailable: partnerRow?.isAvailable ?? true,
      rating: Number(partnerRow?.rating ?? 0),
      completedDeliveries: Math.max(completed, partnerRow?.completedJobs ?? 0),
      avgDeliveryTime: "—",
      acceptanceRate: totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 100,
    });
  } catch (err) {
    sendError(res, "Failed to load profile.", 500, "INTERNAL_ERROR");
  }
}

export async function toggleAvailability(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { isAvailable } = req.body as { isAvailable?: boolean };
    if (typeof isAvailable !== "boolean") {
      sendError(res, "isAvailable must be a boolean.", 400, "VALIDATION_ERROR");
      return;
    }
    const existing = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!existing) {
      sendError(res, "Partner profile not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }
    const updated = await prisma.partner.update({
      where: { userId: req.user!.userId },
      data: { isAvailable },
    });
    sendSuccess(res, { isAvailable: updated.isAvailable }, "Availability updated.");
  } catch (err) {
    sendError(res, "Failed to update availability.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyReviews(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const rows = await prisma.rating.findMany({
      where: { ratedId: req.user!.userId, targetType: { in: ["CARRY_BUDDY", "PARTNER"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { rater: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    sendSuccess(res, {
      items: rows.map((r) => ({
        id: r.id,
        rating: r.score,
        comment: r.comment,
        createdAt: r.createdAt,
        userName: r.rater.fullName,
        userAvatar: r.rater.avatarUrl,
      })),
      total: rows.length,
    });
  } catch (err) {
    sendError(res, "Failed to load reviews.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyEarnings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const periodSum = async (gte: Date) => {
      const agg = await prisma.carryBuddyRequest.aggregate({
        where: { acceptedById: userId, status: "COMPLETED", completedAt: { gte } },
        _sum: { partnerEarning: true },
      });
      return Number(agg._sum.partnerEarning ?? 0);
    };

    const [totalAgg, today, week, month] = await Promise.all([
      prisma.carryBuddyRequest.aggregate({
        where: { acceptedById: userId, status: "COMPLETED" },
        _sum: { partnerEarning: true },
      }),
      periodSum(startOfToday),
      periodSum(startOfWeek),
      periodSum(startOfMonth),
    ]);

    const recentRows = await prisma.carryBuddyRequest.findMany({
      where: { acceptedById: userId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 30,
      include: { requester: { select: { fullName: true } } },
    });

    sendSuccess(res, {
      total: Number(totalAgg._sum.partnerEarning ?? 0),
      today,
      week,
      month,
      transactions: recentRows.map((r) => ({
        id: r.id,
        type: "CREDIT" as const,
        amount: Number(r.partnerEarning ?? 0),
        description: `Carry job — ${r.itemType}${r.requester ? ` for ${r.requester.fullName}` : ""}`,
        createdAt: r.completedAt ?? r.createdAt,
      })),
    });
  } catch (err) {
    sendError(res, "Failed to load earnings.", 500, "INTERNAL_ERROR");
  }
}

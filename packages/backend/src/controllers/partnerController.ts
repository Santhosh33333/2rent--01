import * as crypto from "crypto";
import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import * as partnerMatching from "../services/partnerMatchingEngine";
import * as bookingEngine from "../services/bookingEngine";
import { expireStaleSearches, onBookingClaimed, markDispatchesViewed } from "../services/dispatchService";
import { notifyBookingStatusChange } from "../controllers/notificationController";
import { buildReferralRewardService } from "./referralController";

const settleReferralReward = buildReferralRewardService();

export async function applyAsPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { providesWalking, providesCarry, bankAccountName, bankAccountNumber, bankIfsc, upiId } = req.body;

    const partner = await prisma.partner.upsert({
      where: { userId },
      create: {
        userId,
        status: "APPLIED",
        providesWalking,
        providesCarry,
        bankAccountName,
        bankAccountNumber,
        bankIfsc,
        upiId,
      },
      update: {
        status: "APPLIED",
        providesWalking,
        providesCarry,
        bankAccountName,
        bankAccountNumber,
        bankIfsc,
        upiId,
      },
    });

    await prisma.roleApplication.upsert({
      where: { userId_role: { userId, role: "PARTNER" } },
      create: { userId, role: "PARTNER", status: "PENDING" },
      update: { status: "PENDING" },
    });

    sendSuccess(res, partner, "Partner application submitted.", 201);
  } catch (err) {
    sendError(res, "Failed to submit partner application.", 500, "INTERNAL_ERROR");
  }
}

export async function getPartnerStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });

    if (!partner) {
      sendSuccess(res, { status: "NONE" });
      return;
    }

    sendSuccess(res, {
      status: partner.status,
      providesWalking: partner.providesWalking,
      providesCarry: partner.providesCarry,
      isAvailable: partner.isAvailable,
      rating: partner.rating,
      averageRating: partner.averageRating,
      totalJobs: partner.totalJobs,
      completedJobs: partner.completedJobs,
      cancelledJobs: partner.cancelledJobs,
      totalEarnings: partner.totalEarnings,
      bankAccountName: partner.bankAccountName,
      bankAccountNumber: partner.bankAccountNumber,
      bankIfsc: partner.bankIfsc,
      upiId: partner.upiId,
      latitude: partner.latitude,
      longitude: partner.longitude,
      createdAt: partner.createdAt,
    });
  } catch (err) {
    sendError(res, "Failed to retrieve partner status.", 500, "INTERNAL_ERROR");
  }
}

export async function getNearbyBookings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    // Never surface stale offers: expire unclaimed jobs past their window.
    await expireStaleSearches();

    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner || partner.status !== "APPROVED") {
      sendError(res, "Partner not approved.", 403, "PARTNER_NOT_APPROVED");
      return;
    }
    void markDispatchesViewed(partner.id);

    // Don't re-show jobs this partner has already declined.
    const rejected = await prisma.dispatchRequest.findMany({
      where: { partnerId: partner.id, status: "REJECTED" },
      select: { bookingId: true },
    });
    const rejectedIds = new Set(rejected.map((r) => r.bookingId));

    const where: any = {
      status: { in: ["PARTNER_SEARCHING", "PAYMENT_SUCCESSFUL"] },
    };

    if (partner.providesWalking && !partner.providesCarry) {
      where.serviceType = "WALKING";
    } else if (!partner.providesWalking && partner.providesCarry) {
      where.serviceType = "CARRY_BUDDY";
    }

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true,
        serviceType: true,
        status: true,
        scheduledAt: true,
        durationMinutes: true,
        estimatedAmount: true,
        createdAt: true,
        itemType: true,
        itemDescription: true,
        notes: true,
        // Privacy: exact coordinates/addresses are withheld until a partner is
        // assigned. Only coarse, non-identifying info is broadcast to the pool.
        user: { select: { id: true, avatarUrl: true, city: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    // Mask the requester's full name down to a first name + initial for the feed.
    const masked = bookings
      .filter((b: any) => !rejectedIds.has(b.id))
      .map((b: any) => ({
      ...b,
      user: b.user
        ? {
            id: b.user.id,
            avatarUrl: b.user.avatarUrl,
            city: b.user.city,
            displayName: (b.user.fullName || "").split(" ")[0] || "User",
          }
        : null,
    }));

    sendSuccess(res, masked, "Nearby bookings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve nearby bookings.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });

    if (!partner || partner.status !== "APPROVED") {
      sendError(res, "Partner not approved.", 403, "PARTNER_NOT_APPROVED");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    // Atomic claim: first accepting partner wins; concurrent acceptors conflict.
    const claimed = await prisma.booking.updateMany({
      where: { id, status: "PARTNER_SEARCHING", partnerId: null },
      data: {
        partnerId: partner.id,
        status: "PARTNER_ACCEPTED",
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "Booking was already accepted by another partner.", 409, "ALREADY_ACCEPTED");
      return;
    }

    // Stop expiry timer, notify user + losing partners in realtime.
    void onBookingClaimed(id, req.user!.userId);
    void notifyBookingStatusChange(booking.id, booking.userId, "PARTNER_ACCEPTED");

    const updated = await prisma.booking.findUnique({
      where: { id },
      include: { partner: { select: { id: true, userId: true } } },
    });

    sendSuccess(res, updated, "Booking accepted.");
  } catch (err) {
    sendError(res, "Failed to accept booking.", 500, "INTERNAL_ERROR");
  }
}

export async function rejectBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id }, select: { status: true } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    if (booking.status !== "PARTNER_SEARCHING" && booking.status !== "PAYMENT_SUCCESSFUL") {
      sendError(res, "This booking can no longer be rejected.", 400, "NOT_REJECTABLE");
      return;
    }

    // Record the rejection so this partner is not re-offered the same job.
    await prisma.dispatchRequest.upsert({
      where: { bookingId_partnerId: { bookingId: id, partnerId: partner.id } },
      create: {
        bookingId: id,
        partnerId: partner.id,
        status: "REJECTED",
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
      update: { status: "REJECTED", respondedAt: new Date() },
    });

    sendSuccess(res, undefined, "Booking rejected.");
  } catch (err) {
    sendError(res, "Failed to reject booking.", 500, "INTERNAL_ERROR");
  }
}

export async function generateOTP(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });

    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    if (booking.partnerId !== partner.id) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    // Cryptographically random 6-digit OTP (CSPRNG), hashed at rest
    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    const claimed = await prisma.booking.updateMany({
      where: { id, partnerId: partner.id, status: { in: ["PARTNER_ACCEPTED", "OTP_GENERATED"] } },
      data: {
        otp: otpHash,
        otpGeneratedAt: new Date(),
        status: "OTP_GENERATED",
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "OTP cannot be generated at this stage.", 400, "INVALID_STATUS");
      return;
    }

    // The OTP goes to the USER (who confirms service delivery) — never to the
    // partner requesting it.
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Service Verification Code",
        body: `Your verification code is ${otp}. Share it with your partner only after the service is done.`,
        data: JSON.stringify({ bookingId: id, type: "BOOKING_OTP" }),
      },
    });

    sendSuccess(res, undefined, "OTP generated and sent to the customer.");
  } catch (err) {
    sendError(res, "Failed to generate OTP.", 500, "INTERNAL_ERROR");
  }
}

export async function verifyOTP(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { otp: submittedOtp } = req.body;
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });

    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    if (booking.partnerId !== partner.id) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    if (booking.status !== "OTP_GENERATED" || !booking.otp || !booking.otpGeneratedAt) {
      sendError(res, "No active OTP for this booking.", 400, "INVALID_OTP");
      return;
    }

    // OTP expires 10 minutes after generation
    const otpAgeMs = Date.now() - new Date(booking.otpGeneratedAt).getTime();
    if (otpAgeMs > 10 * 60 * 1000) {
      sendError(res, "OTP expired. Ask the customer for a new code.", 400, "OTP_EXPIRED");
      return;
    }

    // Timing-safe hash comparison
    const submittedHash = crypto.createHash("sha256").update(String(submittedOtp)).digest("hex");
    const a = Buffer.from(submittedHash, "hex");
    const b = Buffer.from(booking.otp, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      sendError(res, "Invalid OTP.", 400, "INVALID_OTP");
      return;
    }

    // Conditional transition + single-use: clears the OTP so it cannot replay
    const claimed = await prisma.booking.updateMany({
      where: { id, partnerId: partner.id, status: "OTP_GENERATED", otp: booking.otp },
      data: {
        otpVerifiedAt: new Date(),
        startedAt: new Date(),
        otp: null,
        status: "IN_PROGRESS",
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "Invalid OTP.", 400, "INVALID_OTP");
      return;
    }

    void notifyBookingStatusChange(booking.id, booking.userId, "IN_PROGRESS");

    sendSuccess(res, undefined, "OTP verified.");
  } catch (err) {
    sendError(res, "Failed to verify OTP.", 500, "INTERNAL_ERROR");
  }
}

export async function completeBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });

    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    if (booking.partnerId !== partner.id) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    if (booking.status !== "IN_PROGRESS") {
      sendError(res, "Booking is not in progress.", 400, "INVALID_STATUS");
      return;
    }

    // Cash bookings are settled peer-to-peer: the user pays the partner directly,
    // so the platform must NOT also credit the partner's withdrawable wallet
    // (that would be phantom money). Online/PAID bookings are credited normally.
    let bookingNotes: Record<string, any> = {};
    try {
      bookingNotes = booking.notes ? JSON.parse(booking.notes) : {};
    } catch {
      // malformed notes — treat as non-cash
    }
    const isCash =
      (booking as any).paymentStatus === "PENDING_CASH" || bookingNotes.paymentMethod === "CASH";

    const now = new Date();
    const waitingMinutes = req.body.waitingMinutes ? Math.floor(Number(req.body.waitingMinutes)) : 0;
    let settled: any = null;

    const result = await prisma.$transaction(async (tx) => {
      // Atomic claim: only the assigned partner, only once
      const claimed = await tx.booking.updateMany({
        where: { id, partnerId: partner.id, status: "IN_PROGRESS" },
        data: {
          status: "COMPLETED",
          completedAt: now,
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      const updatedBooking = await tx.booking.findUnique({ where: { id } });

      // Settle the FINAL price from the VERIFIED actual duration (server timer
      // startedAt -> completedAt) using the frozen pricing snapshot. This also
      // refunds the user's prepaid wallet debit if the run was shorter than
      // estimated. finalizeBookingPrice runs inside this same transaction so a
      // completed booking can never exist without its settlement entry.
      const startedAt = updatedBooking?.startedAt as Date | null;
      const actualDurationMinutes = startedAt && updatedBooking?.completedAt
        ? Math.max(1, Math.round((updatedBooking.completedAt.getTime() - startedAt.getTime()) / 60000))
        : (updatedBooking?.durationMinutes || 0);
      settled = await bookingEngine.finalizeBookingPrice(id, actualDurationMinutes, waitingMinutes, tx);
      const partnerEarning = settled.partnerEarning;

      // Ensure the wallet row exists; only deposit for online (platform-collected) payments.
      const wallet = await tx.wallet.upsert({
        where: { userId: partner.userId },
        create: { userId: partner.userId, balance: 0 },
        update: {},
      });

      if (!isCash) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: partnerEarning } },
        });

        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            userId: partner.userId,
            bookingId: id,
            type: "PARTNER_EARNING",
            status: "COMPLETED",
            amount: partnerEarning,
            description: `Earnings for booking ${id}`,
          },
        });
      }

      const updatedPartner = await tx.partner.update({
        where: { id: partner.id },
        data: {
          totalJobs: { increment: 1 },
          totalEarnings: { increment: partnerEarning },
          completedJobs: { increment: 1 },
        },
      });

      await tx.partnerLevel.upsert({
        where: { userId: partner.userId },
        create: { userId: partner.userId, level: "BRONZE" },
        update: {},
      });

      const earnings = await tx.partnerEarnings.upsert({
        where: { userId: partner.userId },
        create: {
          userId: partner.userId,
          lifetimeEarnings: partnerEarning,
          todayEarnings: partnerEarning,
          weeklyEarnings: partnerEarning,
          monthlyEarnings: partnerEarning,
          completedJobs: 1,
          lastEarningAt: now,
        },
        update: {
          lifetimeEarnings: { increment: partnerEarning },
          todayEarnings: { increment: partnerEarning },
          weeklyEarnings: { increment: partnerEarning },
          monthlyEarnings: { increment: partnerEarning },
          completedJobs: { increment: 1 },
          lastEarningAt: now,
        },
      });

      await tx.earningDetail.create({
        data: {
          earningsId: earnings.id,
          bookingId: id,
          amount: partnerEarning,
          type: "JOB_COMPLETION",
          platformFee: settled?.platformFee ?? booking.platformFee ?? 0,
          commissionDeduction: 0,
          netAmount: partnerEarning,
          status: "COMPLETED",
        },
      });

      return updatedBooking;
    });

    if (!result) {
      sendError(res, "Booking is not in progress or not assigned to you.", 400, "INVALID_STATUS");
      return;
    }

    // Reflect the settled final price + any refund in the response payload.
    const responsePayload: any = { ...result };
    if (settled) {
      responsePayload.finalAmount = settled.finalAmount;
      responsePayload.refundAmount = settled.refunded;
      responsePayload.platformFee = settled.platformFee;
      responsePayload.partnerEarning = settled.partnerEarning;
    }

    void notifyBookingStatusChange(booking.id, booking.userId, "COMPLETED");

    // Referral rewards unlock on the referee's first completed booking — this is the
    // real completion path partners use, so settle here (claim-guarded, idempotent).
    void settleReferralReward(booking.userId);

    sendSuccess(res, responsePayload, "Booking completed.");
  } catch (err) {
    sendError(res, "Failed to complete booking.", 500, "INTERNAL_ERROR");
  }
}

export async function getPartnerBookings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const status = req.query.status as string | undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const where: any = { partnerId: partner.id };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    sendSuccess(res, { items, total, page, limit });
  } catch (err) {
    sendError(res, "Failed to retrieve partner bookings.", 500, "INTERNAL_ERROR");
  }
}

export async function getPerformance(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const earnings = await prisma.partnerEarnings.findUnique({ where: { userId: partner.userId } });
    const partnerLevel = await prisma.partnerLevel.findUnique({ where: { userId: partner.userId } });

    // Date boundaries
    const now = new Date();
    const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);

    // Fetch all completed bookings for this partner
    const allCompleted = await prisma.booking.findMany({
      where: { partnerId: partner.id, status: "COMPLETED" },
      select: { id: true, partnerEarning: true, completedAt: true },
      orderBy: { completedAt: "asc" },
    });

    const allCancelled = await prisma.booking.count({ where: { partnerId: partner.id, status: "CANCELLED" } });

    // Today / week / month earnings
    const todayEarnings = allCompleted
      .filter(b => b.completedAt && b.completedAt >= startOfToday)
      .reduce((s, b) => s + (b.partnerEarning ?? 0), 0);
    const weeklyEarnings = allCompleted
      .filter(b => b.completedAt && b.completedAt >= startOfWeek)
      .reduce((s, b) => s + (b.partnerEarning ?? 0), 0);
    const monthlyEarnings = allCompleted
      .filter(b => b.completedAt && b.completedAt >= startOfMonth)
      .reduce((s, b) => s + (b.partnerEarning ?? 0), 0);

    // Today / week jobs
    const todayJobs = allCompleted.filter(b => b.completedAt && b.completedAt >= startOfToday).length;
    const weeklyJobs = allCompleted.filter(b => b.completedAt && b.completedAt >= startOfWeek).length;

    // Build last-7-months bar chart data
    const monthlyJobCounts: number[] = [];
    const monthlyEarningsList: number[] = [];
    const monthLabels: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear(); const m = d.getMonth();
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0, 23, 59, 59);
      const jobsInMonth = allCompleted.filter(b => b.completedAt && b.completedAt >= start && b.completedAt <= end);
      monthlyJobCounts.push(jobsInMonth.length);
      monthlyEarningsList.push(jobsInMonth.reduce((s, b) => s + (b.partnerEarning ?? 0), 0));
      monthLabels.push(d.toLocaleString("default", { month: "short" }));
    }

    // Completion rate
    const totalAttempted = partner.completedJobs + allCancelled;
    const completionRate = totalAttempted > 0 ? Math.round((partner.completedJobs / totalAttempted) * 100) : 100;

    // Recent ratings for this partner
    const recentRatings = await prisma.rating.findMany({
      where: { ratedId: partner.userId, targetType: "PARTNER" },
      include: { rater: { select: { fullName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Determine level label
    const levelMap: Record<string, string> = {
      BRONZE: "Bronze",
      SILVER: "Silver",
      GOLD: "Gold",
      PLATINUM: "Platinum",
      DIAMOND: "Diamond",
    };
    const level = levelMap[partnerLevel?.level ?? "BRONZE"] ?? "Bronze";
    const levelPoints = partnerLevel?.points ?? 0;

    sendSuccess(res, {
      // Earnings
      todayEarnings,
      weeklyEarnings,
      monthlyEarnings,
      lifetimeEarnings: partner.totalEarnings,
      pendingEarnings: earnings?.pendingEarnings ?? 0,
      withdrawableBalance: earnings?.withdrawableBalance ?? 0,
      // Jobs
      todayJobs,
      weeklyJobs,
      totalJobs: partner.totalJobs,
      completedJobs: partner.completedJobs,
      cancelledJobs: allCancelled,
      completionRate,
      // Chart
      monthlyJobs: monthlyJobCounts,
      monthlyEarningsChart: monthlyEarningsList,
      monthLabels,
      // Rating & Level
      averageRating: partner.averageRating,
      level,
      levelPoints,
      recentRatings: recentRatings.map(r => ({
        id: r.id,
        userName: r.rater.fullName,
        userAvatar: r.rater.avatarUrl,
        rating: r.score,
        comment: r.comment ?? "",
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve performance stats.", 500, "INTERNAL_ERROR");
  }
}

export async function toggleAvailability(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const { isAvailable } = req.body;
    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data: { isAvailable },
    });

    sendSuccess(res, updated, "Availability updated.");
  } catch (err) {
    sendError(res, "Failed to update availability.", 500, "INTERNAL_ERROR");
  }
}

export async function updateLocation(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const { latitude, longitude } = req.body;

    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data: { latitude, longitude },
    });

    await (async () => {
      const existing = await prisma.partnerLocation.findFirst({ where: { partnerId: partner.id } });
      if (existing) {
        await prisma.partnerLocation.update({
          where: { id: existing.id },
          data: { latitude, longitude, updatedAt: new Date() },
        });
      } else {
        await prisma.partnerLocation.create({
          data: { partnerId: partner.id, latitude, longitude },
        });
      }
    })();

    sendSuccess(res, updated, "Location updated.");
  } catch (err) {
    sendError(res, "Failed to update location.", 500, "INTERNAL_ERROR");
  }
}

export async function getPartnerLocation(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }
    const loc = await prisma.partnerLocation.findUnique({ where: { partnerId: partner.id } });
    sendSuccess(res, loc ?? null, "Partner location retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve location.", 500, "INTERNAL_ERROR");
  }
}

export async function updateServices(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId } });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    const { providesWalking, providesCarry } = req.body;
    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data: { providesWalking, providesCarry },
    });

    sendSuccess(res, updated, "Services updated.");
  } catch (err) {
    sendError(res, "Failed to update services.", 500, "INTERNAL_ERROR");
  }
}

export async function getPartnerRatings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const partner = await prisma.partner.findUnique({
      where: { userId: id },
      select: {
        userId: true,
        rating: true,
        averageRating: true,
        totalJobs: true,
        user: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
      },
    });
    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }
    const ratings = await prisma.rating.findMany({
      where: { ratedId: id, targetType: { in: ["PARTNER", "CARRY_BUDDY"] } },
      include: { rater: { select: { id: true, fullName: true, avatarUrl: true, city: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const items = ratings.map((r) => ({
      id: r.id,
      rating: r.score,
      comment: r.comment,
      createdAt: r.createdAt,
      userName: r.rater.fullName,
      userAvatar: r.rater.avatarUrl,
    }));
    const sum = items.reduce((acc, r) => acc + r.rating, 0);
    sendSuccess(res, {
      partner: partner.user,
      rating: partner.rating ?? 0,
      averageRating: partner.averageRating ?? (items.length ? +(sum / items.length).toFixed(2) : 0),
      totalReviews: items.length,
      items,
    });
  } catch (err) {
    sendError(res, "Failed to retrieve partner ratings.", 500, "INTERNAL_ERROR");
  }
}

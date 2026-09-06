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
import { ensureConversation } from "./messageController";
import {
  isExpired,
  OTP_MAX_ATTEMPTS,
  parseNotes,
  verifyOtpHash,
  verifyStartOtp,
} from "../services/jobWorkflowService";
import { checkAcceptStorm, checkInstantCompletion, checkOtpAbuse } from "../services/aiMonitorService";

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

    // Anomaly watch (admin review only, never auto-punish).
    void checkAcceptStorm(req.user!.userId);

    // Open the User <-> assigned Partner conversation immediately so chat
    // works from the moment of acceptance (spec 102). Best-effort.
    void (async () => {
      try {
        await ensureConversation(booking.userId, req.user!.userId);
        await prisma.notification.create({
          data: {
            userId: booking.userId,
            title: "Partner assigned",
            body: "Your partner accepted. You can now chat from Messages.",
            data: JSON.stringify({ bookingId: id, type: "CHAT_READY" }),
          },
        });
      } catch { /* never block accept */ }
    })();

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

    // Cryptographically random 6-digit OTP (CSPRNG), hashed at rest.
    // This is the START code: the user shares it in person on arrival and
    // the partner enters it to start the job (spec 90). Stored hashed in
    // BOTH the legacy column and the workflow notes record (attempts/expiry).
    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
    const now = new Date();

    const existingNotes = parseNotes(booking.notes);
    existingNotes.startOtp = {
      hash: otpHash,
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      attempts: 0,
      verifiedAt: null,
    };
    if (!existingNotes.trip) existingNotes.trip = { phase: "NOT_STARTED" };

    const claimed = await prisma.booking.updateMany({
      where: { id, partnerId: partner.id, status: { in: ["PARTNER_ACCEPTED", "OTP_GENERATED"] } },
      data: {
        otp: otpHash,
        otpGeneratedAt: now,
        otpVerifiedAt: null,
        status: "OTP_GENERATED",
        notes: JSON.stringify(existingNotes),
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "OTP cannot be generated at this stage.", 400, "INVALID_STATUS");
      return;
    }

    // The OTP goes to the USER (who reads it out in person on arrival) —
    // never to the partner requesting it.
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Service Start Code",
        body: `Your start code is ${otp}. Share it with your partner in person when they arrive. Never share it in chat.`,
        data: JSON.stringify({ bookingId: id, type: "BOOKING_OTP" }),
      },
    });

    sendSuccess(res, undefined, "Start code generated and sent to the customer.");
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

    // Single enforced entry into IN_PROGRESS: verified START OTP inside the
    // scheduled time window (spec 84/90). Direct starts are rejected there.
    await verifyStartOtp(id, req.user!.userId, String(submittedOtp ?? "").trim());

    void notifyBookingStatusChange(id, (await prisma.booking.findUnique({ where: { id }, select: { userId: true } }))?.userId ?? "", "IN_PROGRESS");

    sendSuccess(res, undefined, "OTP verified. Job started.");
  } catch (err: any) {
    const code = err?.code ?? "INTERNAL_ERROR";
    const status = err?.status ?? (code === "BOOKING_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 409);
    if (code === "INTERNAL_ERROR") console.error("[verifyOTP]", err?.message);
    sendError(res, err?.message || "Failed to verify OTP.", status, code);
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

    if (booking.status === "COMPLETED") {
      sendSuccess(res, booking, "Booking already completed.");
      return;
    }

    // Completion requires the request-then-code flow (spec 94/95): the
    // partner must have requested completion and must enter the user's
    // completion code. Direct IN_PROGRESS -> COMPLETED is rejected.
    if (booking.status !== "COMPLETION_REQUESTED") {
      sendError(res, "Request completion first and enter the user's completion code. Direct completion is not allowed.", 409, "COMPLETION_OTP_REQUIRED");
      return;
    }
    const gateNotes = parseNotes(booking.notes);
    if (!gateNotes.completionOtp?.hash && !gateNotes.completionOtp?.verifiedAt) {
      sendError(res, "No active completion code. Ask the user to generate it.", 409, "COMPLETION_OTP_REQUIRED");
      return;
    }
    if (!gateNotes.completionOtp?.verifiedAt) {
      const code = String(req.body.completionOtp ?? "").trim();
      if (!code) {
        sendError(res, "Enter the completion code from the user.", 400, "COMPLETION_OTP_REQUIRED");
        return;
      }
      if (isExpired(gateNotes.completionOtp?.expiresAt, new Date())) {
        sendError(res, "Completion code expired. Ask the user for a new one.", 410, "OTP_EXPIRED");
        return;
      }
      if ((gateNotes.completionOtp?.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
        sendError(res, "Too many wrong attempts. Ask the user for a new code.", 429, "OTP_LOCKED");
        return;
      }
      if (!verifyOtpHash(code, gateNotes.completionOtp!.hash!)) {
        gateNotes.completionOtp!.attempts = (gateNotes.completionOtp!.attempts ?? 0) + 1;
        await prisma.booking.update({ where: { id }, data: { notes: JSON.stringify(gateNotes) } });
        void checkOtpAbuse(id, "COMPLETION", gateNotes.completionOtp!.attempts ?? 0);
        sendError(res, "Invalid completion code. Try again.", 400, "INVALID_OTP");
        return;
      }
      gateNotes.completionOtp!.verifiedAt = new Date().toISOString();
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
      // Atomic claim: only the assigned partner, only once, only from the
      // requested-completion state with a verified code.
      const claimed = await tx.booking.updateMany({
        where: { id, partnerId: partner.id, status: "COMPLETION_REQUESTED" },
        data: {
          status: "COMPLETED",
          completedAt: now,
          notes: JSON.stringify(gateNotes),
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
      sendError(res, "Completion code verification is required. Request completion first.", 400, "COMPLETION_OTP_REQUIRED");
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

    // Anomaly watch: implausibly fast jobs flagged for admin review only.
    void checkInstantCompletion(id);

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
    if (status) {
      const list = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      where.status = list.length > 1 ? { in: list } : list[0] ?? status;
    }

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

    const allCancelled = await prisma.booking.count({ where: { partnerId: partner.id, status: "CANCELLED" } });

    // Use DB aggregates instead of fetching all rows
    const [todayAgg, weekAgg, monthAgg] = await Promise.all([
      prisma.booking.aggregate({
        where: { partnerId: partner.id, status: "COMPLETED", completedAt: { gte: startOfToday } },
        _sum: { partnerEarning: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { partnerId: partner.id, status: "COMPLETED", completedAt: { gte: startOfWeek } },
        _sum: { partnerEarning: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { partnerId: partner.id, status: "COMPLETED", completedAt: { gte: startOfMonth } },
        _sum: { partnerEarning: true },
        _count: true,
      }),
    ]);

    const todayEarnings = Number(todayAgg._sum.partnerEarning ?? 0);
    const weeklyEarnings = Number(weekAgg._sum.partnerEarning ?? 0);
    const monthlyEarnings = Number(monthAgg._sum.partnerEarning ?? 0);
    const todayJobs = todayAgg._count;
    const weeklyJobs = weekAgg._count;

    // Build last-7-months bar chart data using DB aggregates
    const monthlyJobCounts: number[] = [];
    const monthlyEarningsList: number[] = [];
    const monthLabels: string[] = [];
    const monthAggregates = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setMonth(d.getMonth() - (6 - i));
        const y = d.getFullYear(); const m = d.getMonth();
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 0, 23, 59, 59);
        return prisma.booking.aggregate({
          where: { partnerId: partner.id, status: "COMPLETED", completedAt: { gte: start, lte: end } },
          _sum: { partnerEarning: true },
          _count: true,
        }).then((agg) => ({ count: agg._count, earnings: Number(agg._sum.partnerEarning ?? 0), label: d.toLocaleString("default", { month: "short" }) }));
      })
    );
    for (const m of monthAggregates) {
      monthlyJobCounts.push(m.count);
      monthlyEarningsList.push(m.earnings);
      monthLabels.push(m.label);
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

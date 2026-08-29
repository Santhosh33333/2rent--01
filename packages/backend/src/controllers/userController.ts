import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { getIO } from "../services/socketService";

export async function getProfile(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        fullName: true,
        dateOfBirth: true,
        gender: true,
        avatarUrl: true,
        bio: true,
        city: true,
        country: true,
        status: true,
        role: true,
        activeRole: true,
        emailVerified: true,
        mobileVerified: true,
        createdAt: true,
      },
    });
    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    // Expose KYC state so clients can gate features on admin approval.
    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true, rejectionReason: true },
    });
    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true, rejectionReason: true },
    });
    sendSuccess(
      res,
      {
        ...user,
        kycStatus: verification?.status ?? "NOT_STARTED",
        kycRejectionReason: verification?.rejectionReason ?? null,
        partnerStatus: partner?.status ?? null,
        isVerified: verification?.status === "APPROVED",
      },
      "Profile retrieved."
    );
  } catch (err) {
    sendError(res, "Failed to retrieve profile.", 500, "INTERNAL_ERROR");
  }
}

export async function updateProfile(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { fullName, bio, city, country, gender } = req.body;

    // Input validation with length limits
    const sanitized: Record<string, any> = {};
    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.length > 100) {
        sendError(res, "Full name must be 100 characters or less.", 400, "VALIDATION_ERROR");
        return;
      }
      sanitized.fullName = fullName.trim();
    }
    if (bio !== undefined) {
      if (typeof bio !== 'string' || bio.length > 500) {
        sendError(res, "Bio must be 500 characters or less.", 400, "VALIDATION_ERROR");
        return;
      }
      sanitized.bio = bio.trim();
    }
    if (city !== undefined) {
      if (typeof city !== 'string' || city.length > 100) {
        sendError(res, "City must be 100 characters or less.", 400, "VALIDATION_ERROR");
        return;
      }
      sanitized.city = city.trim();
    }
    if (country !== undefined) {
      if (typeof country !== 'string' || country.length > 100) {
        sendError(res, "Country must be 100 characters or less.", 400, "VALIDATION_ERROR");
        return;
      }
      sanitized.country = country.trim();
    }
    if (gender !== undefined) {
      if (!['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'].includes(gender)) {
        sendError(res, "Invalid gender value.", 400, "VALIDATION_ERROR");
        return;
      }
      sanitized.gender = gender;
    }

    if (Object.keys(sanitized).length === 0) {
      sendError(res, "No valid fields to update.", 400, "VALIDATION_ERROR");
      return;
    }

    const updated = await prisma.user.update({
      where: { id: req.user!.userId },
      data: sanitized,
      select: { id: true, fullName: true, bio: true, city: true, country: true, gender: true, role: true, activeRole: true },
    });
    sendSuccess(res, updated, "Profile updated.");
  } catch (err) {
    sendError(res, "Failed to update profile.", 500, "INTERNAL_ERROR");
  }
}

export async function uploadProfilePhoto(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "No file uploaded.", 400, "NO_FILE");
      return;
    }
    const avatarUrl = `/uploads/${req.file.filename}`;
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatarUrl },
    });
    sendSuccess(res, { avatarUrl }, "Profile photo uploaded.", 200);
  } catch (err) {
    sendError(res, "Failed to upload photo.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteAccount(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { status: "DEACTIVATED" },
    });
    await prisma.session.deleteMany({ where: { userId: req.user!.userId } });
    sendSuccess(res, undefined, "Account deactivated.");
  } catch (err) {
    sendError(res, "Failed to delete account.", 500, "INTERNAL_ERROR");
  }
}

export async function getLoginHistory(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.loginHistory.findMany({
        where: { userId: req.user!.userId },
        orderBy: { loggedInAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.loginHistory.count({ where: { userId: req.user!.userId } }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve login history.", 500, "INTERNAL_ERROR");
  }
}

export async function getDevices(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const devices = await prisma.device.findMany({
      where: { userId: req.user!.userId },
      orderBy: { lastActiveAt: "desc" },
    });
    sendSuccess(res, devices, "Devices retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve devices.", 500, "INTERNAL_ERROR");
  }
}

export async function removeDevice(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || device.userId !== req.user!.userId) {
      sendError(res, "Device not found.", 404, "DEVICE_NOT_FOUND");
      return;
    }
    await prisma.device.delete({ where: { id } });
    sendSuccess(res, undefined, "Device removed.");
  } catch (err) {
    sendError(res, "Failed to remove device.", 500, "INTERNAL_ERROR");
  }
}

export async function trustScore(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const score = await prisma.trustScore.findUnique({
      where: { userId: req.user!.userId },
    });
    sendSuccess(res, score ?? { score: 0 }, "Trust score retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve trust score.", 500, "INTERNAL_ERROR");
  }
}

export async function getProfileStats(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [walksCompleted, eventsJoined, rating, user] = await Promise.all([
      prisma.walkingRequest.count({ where: { completedById: userId, status: "COMPLETED" } }),
      prisma.eventAttendee.count({ where: { userId, status: { in: ["REGISTERED", "CHECKED_IN"] } } }),
      prisma.rating.aggregate({ _avg: { score: true }, where: { ratedId: userId } }),
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    ]);
    const joinedYear = user?.createdAt ? String(user.createdAt.getFullYear()) : "—";
    sendSuccess(res, {
      walksCompleted,
      eventsJoined,
      averageRating: rating._avg.score ? Number(rating._avg.score.toFixed(1)) : 0,
      joinedYear,
    }, "Profile stats retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve profile stats.", 500, "INTERNAL_ERROR");
  }
}

export async function getProfileFull(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true, email: true, phone: true, fullName: true, dateOfBirth: true,
        gender: true, avatarUrl: true, bio: true, city: true, country: true,
        status: true, emailVerified: true, mobileVerified: true, role: true, createdAt: true,
      },
    });
    if (!user) { sendError(res, "User not found.", 404, "USER_NOT_FOUND"); return; }
    const [verification, trustScore, partnerLevel, wallet] = await Promise.all([
      prisma.verification.findUnique({ where: { userId: req.user!.userId }, select: { status: true, govIdType: true } }),
      prisma.trustScore.findUnique({ where: { userId: req.user!.userId } }),
      prisma.partnerLevel.findUnique({ where: { userId: req.user!.userId } }),
      prisma.wallet.findUnique({ where: { userId: req.user!.userId }, select: { balance: true, currency: true } }),
    ]);
    sendSuccess(res, { ...user, verification, trustScore, partnerLevel, wallet }, "Full profile retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve profile.", 500, "INTERNAL_ERROR");
  }
}

export async function blockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { userId: blockedId } = req.body;
    if (blockedId === req.user!.userId) { sendError(res, "Cannot block yourself.", 400, "INVALID"); return; }
    const existing = await prisma.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: req.user!.userId, blockedId } } });
    if (existing) { sendError(res, "User already blocked.", 400, "ALREADY_BLOCKED"); return; }
    await prisma.userBlock.create({ data: { blockerId: req.user!.userId, blockedId } });
    sendSuccess(res, undefined, "User blocked.");
  } catch (err) {
    sendError(res, "Failed to block user.", 500, "INTERNAL_ERROR");
  }
}

export async function unblockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.userBlock.deleteMany({ where: { blockerId: req.user!.userId, blockedId: id } });
    sendSuccess(res, undefined, "User unblocked.");
  } catch (err) {
    sendError(res, "Failed to unblock user.", 500, "INTERNAL_ERROR");
  }
}

export async function getBlockedUsers(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: req.user!.userId },
      include: { blocked: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
    });
    sendSuccess(res, blocks, "Blocked users retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve blocked users.", 500, "INTERNAL_ERROR");
  }
}

export async function reportUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { targetId, targetType, reason, description } = req.body;
    const report = await prisma.report.create({
      data: { reporterId: req.user!.userId, targetId, targetType: targetType || "USER", reason, description },
    });
    sendSuccess(res, report, "Report submitted.", 201);
  } catch (err) {
    sendError(res, "Failed to submit report.", 500, "INTERNAL_ERROR");
  }
}

export async function getSosStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const active = await prisma.sosAlert.findFirst({ where: { userId: req.user!.userId, status: "ACTIVE" } });
    sendSuccess(res, { active: !!active, alert: active }, "SOS status retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve SOS status.", 500, "INTERNAL_ERROR");
  }
}

export async function triggerSos(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { latitude, longitude, message } = req.body;
    const alert = await prisma.sosAlert.create({
      data: { userId: req.user!.userId, latitude, longitude, message: message || "Emergency SOS" },
    });
    await prisma.notification.create({
      data: { userId: req.user!.userId, title: "SOS Alert Activated", body: "Your emergency alert has been sent. Stay safe.", data: JSON.stringify({ alertId: alert.id }) },
    });

    // Alert admins (and the assigned partner, if a booking is in progress) in real time.
    const activeBooking = await prisma.booking.findFirst({
      where: { userId: req.user!.userId, status: { in: ["PARTNER_ACCEPTED", "OTP_GENERATED", "IN_PROGRESS"] } },
      select: { id: true },
    });
    const payload = {
      alertId: alert.id,
      bookingId: activeBooking?.id ?? null,
      userId: req.user!.userId,
      message: alert.message,
      latitude: alert.latitude,
      longitude: alert.longitude,
      timestamp: alert.createdAt.getTime(),
    };
    const io = getIO();
    if (io) {
      io.to("admins").emit("sos_alert", payload);
      if (activeBooking) io.to(`booking_${activeBooking.id}`).emit("sos_alert", payload);
    }
    await prisma.auditLog
      .create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "SOS_TRIGGERED",
          entityType: "SosAlert",
          entityId: alert.id,
          metadata: JSON.stringify({ latitude, longitude, message: alert.message }),
        },
      })
      .catch(() => {});

    sendSuccess(res, alert, "SOS alert activated.", 201);
  } catch (err) {
    sendError(res, "Failed to trigger SOS.", 500, "INTERNAL_ERROR");
  }
}

export async function cancelSos(req: AuthedRequest, res: Response): Promise<void> {
  try {
    await prisma.sosAlert.updateMany({ where: { userId: req.user!.userId, status: "ACTIVE" }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    sendSuccess(res, undefined, "SOS alert cancelled.");
  } catch (err) {
    sendError(res, "Failed to cancel SOS.", 500, "INTERNAL_ERROR");
  }
}

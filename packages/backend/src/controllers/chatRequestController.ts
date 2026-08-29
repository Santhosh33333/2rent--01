import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

const MAX_REQUESTS_PER_DAY_DEFAULT = 10;
const COOLDOWN_DAYS_AFTER_REJECT_DEFAULT = 5;
const REQUEST_EXPIRY_DAYS_DEFAULT = 7;
const MAX_REQUESTS_TO_SAME_PERSON_DEFAULT = 3;
const SAME_PERSON_WINDOW_DAYS_DEFAULT = 30;

async function getOrCreateSettings(userId: string) {
  let settings = await prisma.chatRequestSettings.findUnique({ where: { userId } });
  if (!settings) {
    settings = await prisma.chatRequestSettings.create({
      data: { userId },
    });
  }
  return settings;
}

export async function sendChatRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const senderId = req.user?.userId;
    const { receiverId, message } = req.body;

    if (!senderId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    if (!receiverId) {
      sendError(res, "receiverId is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (senderId === receiverId) {
      sendError(res, "Cannot send a chat request to yourself.", 400, "SELF_REQUEST");
      return;
    }

    const [sender, receiver, senderSettings] = await Promise.all([
      prisma.user.findUnique({ where: { id: senderId }, select: { id: true, status: true, emailVerified: true, mobileVerified: true } }),
      prisma.user.findUnique({ where: { id: receiverId }, select: { id: true, status: true } }),
      getOrCreateSettings(senderId),
    ]);

    if (!sender || sender.status !== "ACTIVE") {
      sendError(res, "Sender account is inactive.", 403, "ACCOUNT_INACTIVE");
      return;
    }
    if (!receiver || receiver.status !== "ACTIVE") {
      sendError(res, "Receiver account not found or inactive.", 404, "NOT_FOUND");
      return;
    }

    const receiverSettings = await getOrCreateSettings(receiverId);

    if (receiverSettings.privacyLevel === "NOBODY") {
      sendError(res, "This user does not accept chat requests.", 403, "PRIVACY_RESTRICTED");
      return;
    }
    if (receiverSettings.privacyLevel === "VERIFIED_ONLY" && !sender.emailVerified && !sender.mobileVerified) {
      sendError(res, "This user only accepts chat requests from verified accounts.", 403, "VERIFICATION_REQUIRED");
      return;
    }

    const isBlocked = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
    });
    if (isBlocked) {
      sendError(res, "Unable to send chat request to this user.", 403, "BLOCKED");
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await prisma.chatRequest.count({
      where: { senderId, createdAt: { gte: todayStart }, status: { not: "EXPIRED" } },
    });
    if (todayCount >= senderSettings.maxRequestsPerDay) {
      sendError(res, `Daily limit of ${senderSettings.maxRequestsPerDay} chat requests reached.`, 429, "RATE_LIMIT_EXCEEDED");
      return;
    }

    const samePersonWindowStart = new Date();
    samePersonWindowStart.setDate(samePersonWindowStart.getDate() - senderSettings.samePersonWindowDays);
    const samePersonCount = await prisma.chatRequest.count({
      where: { senderId, receiverId, createdAt: { gte: samePersonWindowStart } },
    });
    if (samePersonCount >= senderSettings.maxRequestsToSamePerson) {
      sendError(res, `Limit of ${senderSettings.maxRequestsToSamePerson} requests to this person in ${senderSettings.samePersonWindowDays} days reached.`, 429, "RATE_LIMIT_EXCEEDED");
      return;
    }

    const now = new Date();
    const activeRequest = await prisma.chatRequest.findFirst({
      where: {
        senderId,
        receiverId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
    });
    if (activeRequest) {
      sendError(res, "You already have an active chat request with this user.", 409, "DUPLICATE_REQUEST");
      return;
    }

    // Already-connected pairs must never mint another request — accepting it
    // would violate @@unique([senderId, receiverId, status]) with ACCEPTED.
    const existingAccepted = await prisma.chatRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId, status: "ACCEPTED" },
          { senderId: receiverId, receiverId: senderId, status: "ACCEPTED" },
        ],
      },
    });
    if (existingAccepted) {
      sendError(res, "You are already connected with this user.", 409, "ALREADY_CONNECTED");
      return;
    }

    const rejectedRequest = await prisma.chatRequest.findFirst({
      where: { senderId, receiverId, status: "REJECTED", cooldownUntil: { gt: now } },
    });
    if (rejectedRequest) {
      const remaining = rejectedRequest.cooldownUntil!.getTime() - now.getTime();
      const days = Math.ceil(remaining / (1000 * 60 * 60 * 24));
      sendError(res, `Cooldown active. You can send another request in ${days} day(s).`, 429, "COOLDOWN_ACTIVE");
      return;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + receiverSettings.requestExpiryDays);

    const chatRequest = await prisma.chatRequest.create({
      data: {
        senderId,
        receiverId,
        message: message || null,
        expiresAt,
      },
      include: {
        sender: { select: { id: true, fullName: true, avatarUrl: true } },
        receiver: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });

    sendSuccess(res, { chatRequest }, "Chat request sent.", 201);
  } catch (err: any) {
    console.error("sendChatRequest error:", err);
    sendError(res, "Failed to send chat request.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptChatRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const chatRequest = await prisma.chatRequest.findUnique({ where: { id } });
    if (!chatRequest) {
      sendError(res, "Chat request not found.", 404, "NOT_FOUND");
      return;
    }
    if (chatRequest.receiverId !== userId) {
      sendError(res, "Only the receiver can accept this request.", 403, "FORBIDDEN");
      return;
    }
    if (chatRequest.status !== "PENDING") {
      sendError(res, "This request is no longer pending.", 400, "INVALID_STATUS");
      return;
    }
    if (new Date() > chatRequest.expiresAt) {
      // Collapse onto an existing EXPIRED tombstone for this pair to respect
      // @@unique([senderId, receiverId, status]) instead of crashing
      const olderExpired = await prisma.chatRequest.findFirst({
        where: {
          senderId: chatRequest.senderId,
          receiverId: chatRequest.receiverId,
          status: "EXPIRED",
          NOT: { id: chatRequest.id },
        },
      });
      if (olderExpired) {
        await prisma.chatRequest.delete({ where: { id: chatRequest.id } });
      } else {
        await prisma.chatRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      }
      sendError(res, "This request has expired.", 410, "EXPIRED");
      return;
    }

    // Defensive: an ACCEPTED row for this pair already exists (e.g. legacy data
    // or a race) — accepting would violate the pair-level unique constraint.
    const existingAccepted = await prisma.chatRequest.findFirst({
      where: {
        OR: [
          { senderId: chatRequest.senderId, receiverId: chatRequest.receiverId, status: "ACCEPTED" },
          { senderId: chatRequest.receiverId, receiverId: chatRequest.senderId, status: "ACCEPTED" },
        ],
        NOT: { id: chatRequest.id },
      },
    });
    if (existingAccepted) {
      await prisma.chatRequest.delete({ where: { id: chatRequest.id } }).catch(() => {});
      sendError(res, "You are already connected with this user.", 409, "ALREADY_CONNECTED");
      return;
    }

    const updated = await prisma.chatRequest.update({
      where: { id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
      include: {
        sender: { select: { id: true, fullName: true, avatarUrl: true } },
        receiver: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });

    // Provision the canonical chat thread for the newly connected pair.
    // Conversation rows use an ordered participant pair under
    // @@unique([participant1Id, participant2Id]); upsert keeps replays safe.
    const [p1, p2] = [updated.senderId, updated.receiverId].sort();
    await prisma.conversation.upsert({
      where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
      update: {},
      create: { participant1Id: p1, participant2Id: p2 },
    }).catch(() => {});

    await prisma.notification.create({
      data: {
        userId: updated.senderId,
        title: "Chat request accepted",
        body: `${updated.receiver.fullName} accepted your chat request.`,
        data: JSON.stringify({ kind: "CHAT_REQUEST_ACCEPTED", chatRequestId: updated.id }),
      },
    }).catch(() => {});

    sendSuccess(res, { chatRequest: updated }, "Chat request accepted.");
  } catch (err: any) {
    console.error("acceptChatRequest error:", err);
    sendError(res, "Failed to accept chat request.", 500, "INTERNAL_ERROR");
  }
}

export async function rejectChatRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;

    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const chatRequest = await prisma.chatRequest.findUnique({ where: { id } });
    if (!chatRequest) {
      sendError(res, "Chat request not found.", 404, "NOT_FOUND");
      return;
    }
    if (chatRequest.receiverId !== userId) {
      sendError(res, "Only the receiver can reject this request.", 403, "FORBIDDEN");
      return;
    }
    if (chatRequest.status !== "PENDING") {
      sendError(res, "This request is no longer pending.", 400, "INVALID_STATUS");
      return;
    }

    const receiverSettings = await getOrCreateSettings(chatRequest.receiverId);
    const cooldownUntil = new Date();
    cooldownUntil.setDate(cooldownUntil.getDate() + receiverSettings.cooldownDaysAfterReject);

    // The pair-level unique constraint @@unique([senderId, receiverId, status])
    // allows only ONE REJECTED row per sender/receiver pair. If an older
    // tombstone exists (previous rejection cycle), collapse this rejection
    // into it instead of crashing with P2002 on a second update.
    const olderTombstone = await prisma.chatRequest.findFirst({
      where: {
        senderId: chatRequest.senderId,
        receiverId: chatRequest.receiverId,
        status: "REJECTED",
        NOT: { id: chatRequest.id },
      },
    });

    let updated;
    if (olderTombstone) {
      await prisma.$transaction([
        prisma.chatRequest.delete({ where: { id: chatRequest.id } }),
        prisma.chatRequest.update({
          where: { id: olderTombstone.id },
          data: { rejectedAt: new Date(), cooldownUntil },
        }),
      ]);
      updated = { ...chatRequest, status: "REJECTED", rejectedAt: new Date(), cooldownUntil };
    } else {
      const claimed = await prisma.chatRequest.updateMany({
        where: { id, receiverId: userId, status: "PENDING" },
        data: { status: "REJECTED", rejectedAt: new Date(), cooldownUntil },
      });
      if (claimed.count !== 1) {
        sendError(res, "This request is no longer pending.", 400, "INVALID_STATUS");
        return;
      }
      updated = await prisma.chatRequest.findUnique({
        where: { id },
        include: {
          sender: { select: { id: true, fullName: true, avatarUrl: true } },
          receiver: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      });
    }

    sendSuccess(res, { chatRequest: updated }, "Chat request rejected.");
  } catch (err: any) {
    console.error("rejectChatRequest error:", err);
    sendError(res, "Failed to reject chat request.", 500, "INTERNAL_ERROR");
  }
}

export async function getSentRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const requests = await prisma.chatRequest.findMany({
      where: { senderId: userId },
      include: {
        receiver: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { requests }, "Sent chat requests retrieved.");
  } catch (err: any) {
    console.error("getSentRequests error:", err);
    sendError(res, "Failed to retrieve sent requests.", 500, "INTERNAL_ERROR");
  }
}

export async function getReceivedRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const requests = await prisma.chatRequest.findMany({
      where: { receiverId: userId, status: "PENDING", expiresAt: { gt: new Date() } },
      include: {
        sender: { select: { id: true, fullName: true, avatarUrl: true, city: true, emailVerified: true, mobileVerified: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { requests }, "Received chat requests retrieved.");
  } catch (err: any) {
    console.error("getReceivedRequests error:", err);
    sendError(res, "Failed to retrieve received requests.", 500, "INTERNAL_ERROR");
  }
}

export async function getChatRequestCounts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const [pendingReceived, todaySent] = await Promise.all([
      prisma.chatRequest.count({ where: { receiverId: userId, status: "PENDING", expiresAt: { gt: new Date() } } }),
      prisma.chatRequest.count({
        where: {
          senderId: userId,
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          status: { not: "EXPIRED" },
        },
      }),
    ]);
    const settings = await getOrCreateSettings(userId);
    sendSuccess(res, {
      pendingReceived,
      todaySent,
      dailyLimit: settings.maxRequestsPerDay,
    }, "Chat request counts retrieved.");
  } catch (err: any) {
    console.error("getChatRequestCounts error:", err);
    sendError(res, "Failed to retrieve counts.", 500, "INTERNAL_ERROR");
  }
}

export async function expireStaleRequests(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const stale = await prisma.chatRequest.findMany({
      where: { status: "PENDING", expiresAt: { lt: new Date() } },
      select: { id: true, senderId: true, receiverId: true },
    });

    let expired = 0;
    for (const request of stale) {
      try {
        // Per-row: a pair-level unique violation (older EXPIRED tombstone)
        // must not abort the whole batch
        await prisma.chatRequest.update({
          where: { id: request.id },
          data: { status: "EXPIRED" },
        });
        expired++;
      } catch (err: any) {
        if (err?.code === "P2002") {
          await prisma.chatRequest.delete({ where: { id: request.id } }).catch(() => {});
          expired++;
        } else {
          throw err;
        }
      }
    }

    sendSuccess(res, { expired }, "Stale requests expired.");
  } catch (err: any) {
    console.error("expireStaleRequests error:", err);
    sendError(res, "Failed to expire stale requests.", 500, "INTERNAL_ERROR");
  }
}

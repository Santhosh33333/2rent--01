import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

export async function getChatRequestSettings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    let settings = await prisma.chatRequestSettings.findUnique({ where: { userId } });
    if (!settings) {
      settings = await prisma.chatRequestSettings.create({ data: { userId } });
    }
    sendSuccess(res, { settings }, "Chat request settings retrieved.");
  } catch (err: any) {
    console.error("getChatRequestSettings error:", err);
    sendError(res, "Failed to retrieve settings.", 500, "INTERNAL_ERROR");
  }
}

export async function updateChatRequestSettings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const allowedFields = [
      "privacyLevel",
      "maxRequestsPerDay",
      "cooldownDaysAfterReject",
      "requestExpiryDays",
      "maxRequestsToSamePerson",
      "samePersonWindowDays",
      "allowCalls",
      "allowVideoCalls",
      "allowFileSharing",
      "allowImageSharing",
      "allowVoiceNotes",
      "allowLocationSharing",
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      sendError(res, "No valid fields to update.", 400, "VALIDATION_ERROR");
      return;
    }

    let settings = await prisma.chatRequestSettings.findUnique({ where: { userId } });
    if (!settings) {
      settings = await prisma.chatRequestSettings.create({ data: { userId, ...updates } });
    } else {
      settings = await prisma.chatRequestSettings.update({ where: { userId }, data: updates });
    }

    sendSuccess(res, { settings }, "Chat request settings updated.");
  } catch (err: any) {
    console.error("updateChatRequestSettings error:", err);
    sendError(res, "Failed to update settings.", 500, "INTERNAL_ERROR");
  }
}

export async function blockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { blockedId } = req.body;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    if (!blockedId) {
      sendError(res, "blockedId is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (userId === blockedId) {
      sendError(res, "Cannot block yourself.", 400, "SELF_BLOCK");
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    const existing = await prisma.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId } } });
    if (existing) {
      sendError(res, "User is already blocked.", 409, "ALREADY_BLOCKED");
      return;
    }

    await prisma.userBlock.create({ data: { blockerId: userId, blockedId } });

    await prisma.chatRequest.updateMany({
      where: {
        OR: [
          { senderId: userId, receiverId: blockedId, status: "PENDING" },
          { senderId: blockedId, receiverId: userId, status: "PENDING" },
        ],
      },
      data: { status: "REJECTED", rejectedAt: new Date() },
    });

    sendSuccess(res, { blocked: true }, "User blocked successfully.");
  } catch (err: any) {
    console.error("blockUser error:", err);
    sendError(res, "Failed to block user.", 500, "INTERNAL_ERROR");
  }
}

export async function unblockUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { blockedId } = req.params;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const existing = await prisma.userBlock.findUnique({ where: { blockerId_blockedId: { blockerId: userId, blockedId } } });
    if (!existing) {
      sendError(res, "Block not found.", 404, "NOT_FOUND");
      return;
    }

    await prisma.userBlock.delete({ where: { id: existing.id } });
    sendSuccess(res, { blocked: false }, "User unblocked successfully.");
  } catch (err: any) {
    console.error("unblockUser error:", err);
    sendError(res, "Failed to unblock user.", 500, "INTERNAL_ERROR");
  }
}

export async function getBlockedList(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: userId },
      include: {
        blocked: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { blocks }, "Blocked users retrieved.");
  } catch (err: any) {
    console.error("getBlockedList error:", err);
    sendError(res, "Failed to retrieve blocked list.", 500, "INTERNAL_ERROR");
  }
}

export async function muteUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { mutedId } = req.body;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    if (!mutedId) {
      sendError(res, "mutedId is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (userId === mutedId) {
      sendError(res, "Cannot mute yourself.", 400, "SELF_MUTE");
      return;
    }

    const existing = await prisma.muteList.findUnique({ where: { muterId_mutedId: { muterId: userId, mutedId } } });
    if (existing) {
      sendError(res, "User is already muted.", 409, "ALREADY_MUTED");
      return;
    }

    await prisma.muteList.create({ data: { muterId: userId, mutedId } });
    sendSuccess(res, { muted: true }, "User muted successfully.");
  } catch (err: any) {
    console.error("muteUser error:", err);
    sendError(res, "Failed to mute user.", 500, "INTERNAL_ERROR");
  }
}

export async function unmuteUser(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { mutedId } = req.params;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const existing = await prisma.muteList.findUnique({ where: { muterId_mutedId: { muterId: userId, mutedId } } });
    if (!existing) {
      sendError(res, "Mute not found.", 404, "NOT_FOUND");
      return;
    }

    await prisma.muteList.delete({ where: { id: existing.id } });
    sendSuccess(res, { muted: false }, "User unmuted successfully.");
  } catch (err: any) {
    console.error("unmuteUser error:", err);
    sendError(res, "Failed to unmute user.", 500, "INTERNAL_ERROR");
  }
}

export async function getMutedList(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const mutes = await prisma.muteList.findMany({
      where: { muterId: userId },
      include: {
        muted: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { mutes }, "Muted users retrieved.");
  } catch (err: any) {
    console.error("getMutedList error:", err);
    sendError(res, "Failed to retrieve muted list.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PRIVACY PREFERENCES
// ============================================================================

interface PrivacyPreferences {
  showOnlineStatus: boolean;
  showLastActive: boolean;
  allowProfileView: boolean;
  allowLocationSharing: boolean;
  showPhoneNumber: boolean;
  showEmail: boolean;
  searchableByPhone: boolean;
  dataSharing: boolean;
}

const DEFAULT_PRIVACY_PREFS: PrivacyPreferences = {
  showOnlineStatus: true,
  showLastActive: true,
  allowProfileView: true,
  allowLocationSharing: false,
  showPhoneNumber: false,
  showEmail: false,
  searchableByPhone: false,
  dataSharing: false,
};

export async function getPrivacyPreferences(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) { sendError(res, "Unauthorized.", 401, "UNAUTHORIZED"); return; }

    const entries = await prisma.appSettings.findMany({
      where: { key: { startsWith: `user:${userId}:privacy:` } },
    });
    const prefs = { ...DEFAULT_PRIVACY_PREFS };
    for (const entry of entries) {
      const prefKey = entry.key.replace(`user:${userId}:privacy:`, "") as keyof PrivacyPreferences;
      if (prefKey in prefs) {
        (prefs as any)[prefKey] = entry.dataType === "BOOLEAN" ? entry.value === "true" : entry.value === "true";
      }
    }
    sendSuccess(res, prefs, "Privacy preferences retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve privacy preferences.", 500, "INTERNAL_ERROR");
  }
}

export async function updatePrivacyPreferences(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) { sendError(res, "Unauthorized.", 401, "UNAUTHORIZED"); return; }

    const allowedFields = Object.keys(DEFAULT_PRIVACY_PREFS);
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    if (Object.keys(updates).length === 0) {
      sendError(res, "No valid fields to update.", 400, "VALIDATION_ERROR");
      return;
    }

    const upserts: Promise<any>[] = [];
    for (const [key, value] of Object.entries(updates)) {
      upserts.push(
        prisma.appSettings.upsert({
          where: { key: `user:${userId}:privacy:${key}` },
          update: { value: String(value), dataType: "BOOLEAN", updatedBy: userId },
          create: {
            key: `user:${userId}:privacy:${key}`,
            value: String(value),
            dataType: "BOOLEAN",
            category: "USER_PRIVACY",
            description: `Privacy preference: ${key}`,
            isPublic: false,
            updatedBy: userId,
          },
        })
      );
    }
    await Promise.all(upserts);

    // Return updated preferences
    const entries = await prisma.appSettings.findMany({
      where: { key: { startsWith: `user:${userId}:privacy:` } },
    });
    const prefs = { ...DEFAULT_PRIVACY_PREFS };
    for (const entry of entries) {
      const prefKey = entry.key.replace(`user:${userId}:privacy:`, "") as keyof PrivacyPreferences;
      if (prefKey in prefs) {
        (prefs as any)[prefKey] = entry.value === "true";
      }
    }
    sendSuccess(res, prefs, "Privacy preferences updated.");
  } catch (err) {
    sendError(res, "Failed to update privacy preferences.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REPORT CHAT
// ============================================================================

export async function reportChat(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    const { messageId, conversationId, reason, description } = req.body;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    if (!reason) {
      sendError(res, "reason is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const report = await prisma.chatReport.create({
      data: {
        reporterId: userId,
        messageId: messageId || null,
        conversationId: conversationId || null,
        reason,
        description: description || null,
      },
    });

    sendSuccess(res, { report }, "Chat report submitted.", 201);
  } catch (err: any) {
    console.error("reportChat error:", err);
    sendError(res, "Failed to submit report.", 500, "INTERNAL_ERROR");
  }
}

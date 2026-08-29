import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { emitToUser } from "../services/socketService";

// ============================================================================
// CONVERSATION HELPERS
// ============================================================================

/** Find-or-create the canonical Conversation row for a pair of users.
 *  Uses an atomic upsert on the unique (participant1Id, participant2Id) pair so
 *  two concurrent first messages between the same pair can never create duplicate
 *  Conversation rows (the previous find-then-create had a TOCTOU race that 500'd). */
export async function ensureConversation(a: string, b: string) {
  const [p1, p2] = [a, b].sort();
  return prisma.conversation.upsert({
    where: { participant1Id_participant2Id: { participant1Id: p1, participant2Id: p2 } },
    create: { participant1Id: p1, participant2Id: p2 },
    update: {},
  });
}

const USER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;

// ============================================================================
// SEND MESSAGE
// ============================================================================

export async function sendMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { receiverId, content } = req.body;

    if (!content) {
      sendError(res, "Message content is required.", 400, "VALIDATION_ERROR");
      return;
    }

    if (receiverId === req.user!.userId) {
      sendError(res, "Cannot send message to yourself.", 400, "INVALID_RECEIVER");
      return;
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true },
    });

    if (!receiver) {
      sendError(res, "Receiver not found.", 404, "RECEIVER_NOT_FOUND");
      return;
    }

    const isBlocked = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: req.user!.userId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: req.user!.userId },
        ],
      },
    });
    if (isBlocked) {
      sendError(res, "Unable to message this user.", 403, "BLOCKED");
      return;
    }

    const conversation = await ensureConversation(req.user!.userId, receiverId);

    const message = await prisma.message.create({
      data: {
        senderId: req.user!.userId,
        receiverId,
        conversationId: conversation.id,
        content,
        status: "SENT",
      },
      include: {
        sender: { select: USER_SELECT },
      },
    });

    // Keep the conversation list properly ordered + show a preview. The @updatedAt
    // field drives getConversations ordering, so bump it on every send; lastMessageId
    // powers any "last message" UI. Fire-and-forget: a failure here must not fail the send.
    prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(), lastMessageId: message.id },
      })
      .catch(() => {});

    // Realtime delivery to the receiver (if connected).
    emitToUser(receiverId, "new_message", {
      conversationId: conversation.id,
      messageId: message.id,
      senderId: message.senderId,
      senderName: message.sender.fullName,
      content,
      timestamp: message.createdAt,
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "MESSAGE_SEND",
        entityType: "Message",
        entityId: message.id,
      },
    });

    sendSuccess(res, message, "Message sent.", 201);
  } catch (err: any) {
    console.error("[sendMessage]", err?.message);
    sendError(res, "Failed to send message.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET CONVERSATIONS
// ============================================================================

export async function getConversations(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    // Merge in accepted chat connections that have no messages yet so new
    // threads appear immediately after a chat request is accepted.
    const accepted = await prisma.chatRequest.findMany({
      where: {
        status: "ACCEPTED",
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: { select: USER_SELECT },
        receiver: { select: USER_SELECT },
      },
    });

    for (const r of accepted) {
      await ensureConversation(r.senderId === userId ? r.receiverId : r.senderId, userId);
    }

    const conversations = await prisma.conversation.findMany({
      where: { OR: [{ participant1Id: userId }, { participant2Id: userId }] },
      include: {
        participant1: { select: USER_SELECT },
        participant2: { select: USER_SELECT },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    const convIds = conversations.map((c) => c.id);

    const unreadRows = await prisma.message.groupBy({
      by: ["conversationId"],
      where: { receiverId: userId, status: { not: "READ" }, conversationId: { in: convIds } },
      _count: { _all: true },
    });
    const unreadMap = new Map(unreadRows.map((u) => [u.conversationId, u._count._all]));

    const items = conversations.map((c) => {
      const partner = c.participant1Id === userId ? c.participant2 : c.participant1;
      const last = c.messages[0] ?? null;
      return {
        conversationId: c.id,
        partner,
        partnerId: partner.id,
        partnerName: partner.fullName,
        partnerAvatar: partner.avatarUrl,
        lastMessage: last?.content ?? null,
        lastMessageAt: last?.createdAt ?? null,
        unreadCount: unreadMap.get(c.id) ?? 0,
      };
    });

    items.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    });

    // Real total for pagination: number of conversations this user participates in
    // (after the accepted-request merge above has created any missing rows).
    const convTotal = await prisma.conversation.count({
      where: { OR: [{ participant1Id: userId }, { participant2Id: userId }] },
    });

    sendSuccess(res, { items, page, limit, total: convTotal });
  } catch (err: any) {
    console.error("[getConversations]", err?.message);
    sendError(res, "Failed to retrieve conversations.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET MESSAGES IN CONVERSATION
// ============================================================================

export async function getMessages(req: AuthedRequest, res: Response): Promise<void> {
  try {
    // Accepts EITHER the conversation uuid OR the other user's id.
    const raw = req.params.conversationId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const userId = req.user!.userId;

    let convId: string;

    const asUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    if (asUuid) {
      const membership = await prisma.conversation.findFirst({
        where: {
          id: raw,
          OR: [{ participant1Id: userId }, { participant2Id: userId }],
        },
        select: { id: true },
      });
      if (membership) {
        convId = membership.id;
      } else {
        // Not a known conversation — fall through and treat as a partner user id.
        const partner = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
        if (!partner || partner.id === userId) {
          sendError(res, "Access denied to this conversation.", 403, "FORBIDDEN");
          return;
        }
        const blocked = await prisma.userBlock.findFirst({
          where: {
            OR: [
              { blockerId: userId, blockedId: raw },
              { blockerId: raw, blockedId: userId },
            ],
          },
        });
        if (blocked) {
          sendError(res, "Unable to open this conversation.", 403, "BLOCKED");
          return;
        }
        const conv = await ensureConversation(userId, raw);
        convId = conv.id;
      }
    } else {
      // Treat as partner user id — verify existence, check blocks, resolve thread.
      const partner = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
      if (!partner || partner.id === userId) {
        sendError(res, "Invalid conversation.", 400, "INVALID_CONVERSATION");
        return;
      }
      const blocked = await prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: raw },
            { blockerId: raw, blockedId: userId },
          ],
        },
      });
      if (blocked) {
        sendError(res, "Unable to open this conversation.", 403, "BLOCKED");
        return;
      }
      const conv = await ensureConversation(userId, raw);
      convId = conv.id;
    }

    const [items, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sender: { select: USER_SELECT },
        },
      }),
      prisma.message.count({ where: { conversationId: convId } }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    console.error("[getMessages]", err?.message);
    sendError(res, "Failed to retrieve messages.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET UNREAD COUNTS
// ============================================================================

export async function getUnreadCounts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;

    const unread = await prisma.message.groupBy({
      by: ["conversationId"],
      where: { receiverId: userId, status: { not: "READ" } },
      _count: { id: true },
    });

    const byConversation: Record<string, number> = {};
    let total = 0;
    for (const row of unread) {
      byConversation[row.conversationId] = row._count.id;
      total += row._count.id;
    }

    sendSuccess(res, { total, byConversation }, "Unread counts retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve unread counts.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MARK MESSAGE AS READ
// ============================================================================

export async function markAsRead(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const message = await prisma.message.findUnique({ where: { id } });

    if (!message || message.receiverId !== req.user!.userId) {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { status: "READ", readAt: new Date() },
    });

    // Notify the original sender (in real time) so their "✓✓ read" receipt updates
    // even when they are not currently viewing the conversation.
    if (message.senderId !== req.user!.userId) {
      emitToUser(message.senderId, "messages_read", {
        conversationId: message.conversationId,
        messageIds: [message.id],
        readBy: req.user!.userId,
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "MESSAGE_READ",
        entityType: "Message",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Message marked as read.");
  } catch (err: any) {
    sendError(res, "Failed to mark message as read.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DELETE MESSAGE
// ============================================================================

export async function deleteMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const message = await prisma.message.findUnique({ where: { id } });

    if (!message || message.senderId !== req.user!.userId) {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { status: "DELETED", content: "[deleted]" },
    });

    // Tell the recipient so their view updates immediately instead of on next poll.
    emitToUser(message.receiverId, "message_deleted", {
      conversationId: message.conversationId,
      messageId: message.id,
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "MESSAGE_DELETE",
        entityType: "Message",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Message deleted.");
  } catch (err: any) {
    sendError(res, "Failed to delete message.", 500, "INTERNAL_ERROR");
  }
}

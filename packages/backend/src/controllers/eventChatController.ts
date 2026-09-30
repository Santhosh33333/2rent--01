/**
 * Event group thread.
 *
 * Access rule: the organizer and anyone on the event's attendee list. NOT the
 * whole app - a group thread that any member can read would leak an attendee's
 * phone number through the coordinator card and the attendee roster.
 *
 * Also enforced: staff/privileged accounts are excluded from the attendee list
 * itself (see NOT_PRIVILEGED), so they cannot join an event thread by
 * registering, which keeps moderation accounts out of member conversations.
 */
import { Response } from "express";
import { AuthedRequest } from "../middleware/authTypes";
import { prisma } from "../config/database";
import { sendError, sendSuccess } from "../utils/response";
import { NOT_PRIVILEGED } from "../rbac/privilegedUsers";
import { emitToUser } from "../services/socketService";

const MAX_LENGTH = 2000;
const MAX_MEDIA_LENGTH = 500;

/** Organizer or registered attendee? Drives both read and write. */
async function requireThreadMembership(eventId: string, userId: string): Promise<
  { ok: true } | { ok: false; status: number; code: string; message: string }
> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizerId: true, status: true },
  });
  if (!event) {
    return { ok: false, status: 404, code: "EVENT_NOT_FOUND", message: "Event not found." };
  }
  if (event.organizerId === userId) return { ok: true };

  const attendee = await prisma.eventAttendee.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { status: true },
  });
  // A cancelled RSVP loses the thread: they said they are not going.
  if (attendee && attendee.status !== "CANCELLED") return { ok: true };

  return {
    ok: false,
    status: 403,
    code: "NOT_ATTENDING",
    message: "Only people going to this event can join its chat.",
  };
}

const USER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;

export async function getEventMessages(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const eventId = req.params.id;
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const membership = await requireThreadMembership(eventId, userId);
    if (!membership.ok) {
      sendError(res, membership.message, membership.status, membership.code);
      return;
    }

    const [messages, total] = await Promise.all([
      prisma.eventGroupMessage.findMany({
        where: { eventId, status: { not: "DELETED" } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { sender: { select: USER_SELECT } },
      }),
      prisma.eventGroupMessage.count({ where: { eventId, status: { not: "DELETED" } } }),
    ]);

    // Oldest first for rendering; the query paginates from newest.
    const items = messages
      .map((m) => ({
        id: m.id,
        content: m.content,
        messageType: m.messageType,
        mediaUrl: m.mediaUrl,
        createdAt: m.createdAt,
        sender: m.sender,
        isMine: m.senderId === userId,
      }))
      .reverse();

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    console.error("[getEventMessages]", err?.message);
    sendError(res, "Failed to load the event chat.", 500, "INTERNAL_ERROR");
  }
}

export async function sendEventMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const eventId = req.params.id;
    const userId = req.user!.userId;
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    const messageType = req.body?.messageType === "IMAGE" ? "IMAGE" : "TEXT";
    const mediaUrl =
      typeof req.body?.mediaUrl === "string" ? req.body.mediaUrl.trim().slice(0, MAX_MEDIA_LENGTH) : null;

    if (!content && !mediaUrl) {
      sendError(res, "Message cannot be empty.", 400, "VALIDATION_ERROR");
      return;
    }
    if (content.length > MAX_LENGTH) {
      sendError(res, `Message cannot be longer than ${MAX_LENGTH} characters.`, 400, "VALIDATION_ERROR");
      return;
    }

    const membership = await requireThreadMembership(eventId, userId);
    if (!membership.ok) {
      sendError(res, membership.message, membership.status, membership.code);
      return;
    }

    const saved = await prisma.eventGroupMessage.create({
      data: { eventId, senderId: userId, content, messageType, mediaUrl: mediaUrl || null },
      include: { sender: { select: USER_SELECT } },
    });

    const payload = {
      id: saved.id,
      eventId,
      content: saved.content,
      messageType: saved.messageType,
      mediaUrl: saved.mediaUrl,
      createdAt: saved.createdAt,
      sender: saved.sender,
      isMine: false,
    };

    // Fan out to everyone else in the thread. Going through the attendee list
    // rather than a socket room means a member who is offline simply misses the
    // live push and picks it up from history on next load, which is the same
    // contract the 1:1 messenger has.
    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId, userId: { not: userId } },
      select: { userId: true },
    });
    for (const a of attendees) {
      emitToUser(a.userId, "event_message", payload);
    }

    sendSuccess(res, { ...payload, isMine: true });
  } catch (err: any) {
    console.error("[sendEventMessage]", err?.message);
    sendError(res, "Failed to send the message.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteEventMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const messageId = req.params.messageId;
    const userId = req.user!.userId;

    const existing = await prisma.eventGroupMessage.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, eventId: true, status: true },
    });
    if (!existing || existing.status === "DELETED") {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }
    // Sender only. The organizer does NOT get moderation power over attendees'
    // messages - hosting a meetup is not owning everyone's speech, and the 1:1
    // messenger is sender-only for the same reason. This also means an organizer
    // cannot use "delete" to silence a member's complaint about the event.
    if (existing.senderId !== userId) {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }

    await prisma.eventGroupMessage.update({
      where: { id: messageId },
      data: { status: "DELETED", content: "[deleted]", mediaUrl: null },
    });

    // Live-update the rest of the thread, otherwise a sender can retract a
    // message while everyone else's screen still shows it.
    const attendees = await prisma.eventAttendee.findMany({
      where: { eventId: existing.eventId, userId: { not: userId } },
      select: { userId: true },
    });
    for (const a of attendees) {
      emitToUser(a.userId, "event_message_deleted", {
        eventId: existing.eventId,
        messageId,
      });
    }

    sendSuccess(res, { id: messageId, deleted: true });
  } catch (err: any) {
    console.error("[deleteEventMessage]", err?.message);
    sendError(res, "Failed to delete the message.", 500, "INTERNAL_ERROR");
  }
}

/** Count of thread messages, used to decide whether to render the section. */
export async function getEventMessageCount(eventId: string): Promise<number> {
  return prisma.eventGroupMessage.count({ where: { eventId, status: { not: "DELETED" } } });
}

export { NOT_PRIVILEGED };
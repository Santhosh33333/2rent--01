import { prisma } from "../config/database";
import { sendPushNotification } from "./notificationService";

interface SenderProfile {
  id: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

/**
 * Persist an inbox entry and fire a push for a chat message.
 *
 * Chat was the one user-facing event that created no `Notification` row and
 * fired no push: `messageController` and the realtime `send_message` handler
 * only emitted over the socket. A recipient whose app was closed therefore saw
 * nothing at all - no inbox entry, no status-bar notification. This restores the
 * same treatment every other event (bookings, likes, calls) already gets.
 *
 * Always called fire-and-forget: a notification failure must never fail the
 * message send.
 */
export async function notifyNewMessage(
  receiverId: string,
  sender: { id: string; fullName?: string | null } | null,
  conversationId: string,
  preview: string,
): Promise<void> {
  const senderId = sender?.id ?? "";
  const name = sender?.fullName?.trim() || "Someone";
  const title = `New message from ${name}`;
  const trimmed = (preview || "").trim();
  const text = trimmed || "Sent you a message";
  const body = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  // The chat route is keyed by the *peer's user id* (`/messages/:userId`), not
  // the conversation id. Using conversationId here sent the in-app inbox tap to
  // `/messages/<conversationId>`, which the conversation page read as a user id
  // and fetched an empty thread for - i.e. tapping a message notification did
  // not open the chat. An empty route is a valid FCM data value and the router
  // ignores it.
  const data: Record<string, string> = {
    type: "message",
    conversationId,
    senderId,
    route: senderId ? `/messages/${senderId}` : "",
  };

  try {
    await prisma.notification.create({
      data: {
        userId: receiverId,
        title,
        body,
        data: JSON.stringify(data),
      },
    });
  } catch (err) {
    console.error("[notifyNewMessage] failed to create notification:", err);
  }

  // FCM data payloads must be string-valued.
  void sendPushNotification(receiverId, title, body, data);
}

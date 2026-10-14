import { prisma } from "../config/database";

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
 *
 * Note: only the inbox row is written here. The `Notification.create` middleware
 * (`server.ts`) fans every row out to the realtime event AND to FCM push, so an
 * explicit `sendPushNotification` here would deliver a second, identical push.
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
}

/**
 * Inbox entry + push for a group message. Same contract as notifyNewMessage,
 * but the route opens the group thread and several members may be notified for
 * one message. Fire-and-forget from the send path.
 */
export async function notifyGroupMessage(
  receiverId: string,
  sender: { id: string; fullName?: string | null } | null,
  groupId: string,
  groupName: string,
  preview: string,
): Promise<void> {
  const name = sender?.fullName?.trim() || "Someone";
  const title = `${groupName || "Group"}: ${name}`;
  const trimmed = (preview || "").trim();
  const text = trimmed || "Sent a message";
  const body = text.length > 140 ? `${text.slice(0, 137)}...` : text;
  try {
    await prisma.notification.create({
      data: {
        userId: receiverId,
        title,
        body,
        data: JSON.stringify({
          type: "group_message",
          groupId,
          route: `/messages/group/${groupId}`,
        }),
      },
    });
  } catch (err) {
    console.error("[notifyGroupMessage] failed to create notification:", err);
  }
}

/**
 * Inbox entry + push for a group invitation. The invitee taps through to the
 * groups area of Messages, where pending invitations are listed.
 */
export async function notifyGroupInvite(
  inviteeId: string,
  inviter: { id: string; fullName?: string | null } | null,
  groupId: string,
  groupName: string,
): Promise<void> {
  const name = inviter?.fullName?.trim() || "Someone";
  try {
    await prisma.notification.create({
      data: {
        userId: inviteeId,
        title: "Group invitation",
        body: `${name} invited you to join "${groupName}".`,
        data: JSON.stringify({
          type: "group_invite",
          groupId,
          route: `/messages?tab=groups`,
        }),
      },
    });
  } catch (err) {
    console.error("[notifyGroupInvite] failed to create notification:", err);
  }
}

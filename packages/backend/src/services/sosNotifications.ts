import { prisma } from "../config/database";

/**
 * Turns a raw SOS into the notification rows that actually reach someone.
 *
 * The socket handler already broadcasts `sos_alert` to the booking room and to
 * the shared admins room, but that only reaches sockets attached at that
 * instant - a backgrounded app, a recipient who never opened this booking, or
 * an admin whose socket dropped. A Notification row is what survives all of
 * that, because the middleware on `Notification.create` fans every row out to
 * both the realtime `notification` event and FCM push. One write therefore
 * covers the two states an emergency alert has to work in: the app being open,
 * and the app being closed.
 *
 * Rows are written one at a time on purpose. `createMany` is a different
 * Prisma action and never reaches that middleware, so a bulk write here would
 * land in the notification list and silently reach nobody's phone - which is
 * already what happens to the KYC admin fan-out.
 *
 * Every failure is absorbed. A database hiccup must not be able to take the
 * room alert down with it; the caller gets the list of who was actually
 * notified and nothing more.
 */

/** Mirrors the roles that join the `admins` socket room, so push and realtime
 *  agree on who is supposed to be watching an SOS. */
export const SOS_ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"] as const;

export interface SosNotifyInput {
  bookingId: string;
  /** Whoever pressed the button. Never notified about their own emergency. */
  triggeredBy: string;
  /** The two parties on the booking; either may be absent (unassigned). */
  partyUserIds: Array<string | null | undefined>;
  message: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Creates one `Emergency SOS` row per recipient.
 *
 * @returns the ids that were actually notified, so callers and tests can tell
 *          "nobody was notified" apart from "this returned quietly".
 */
export async function notifySosRecipients(input: SosNotifyInput): Promise<string[]> {
  const { bookingId, triggeredBy, partyUserIds, message, latitude, longitude } = input;

  const recipients = new Set<string>(
    partyUserIds.filter((id): id is string => Boolean(id)),
  );

  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: [...SOS_ADMIN_ROLES] }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const admin of admins) recipients.add(admin.id);
  } catch (err) {
    // Losing the admin list must not cost the two people on the booking their
    // alert, so the parties keep theirs either way.
    console.error("[SOS] could not load admin recipients:", err);
  }

  // The person who pressed the button already has their own confirmation on
  // screen. Pinging them with their own emergency adds noise and pulls
  // attention away from whoever has to respond to it.
  recipients.delete(triggeredBy);

  const location = latitude != null && longitude != null ? ` Location: ${latitude}, ${longitude}.` : "";
  const body = `${message} (booking ${bookingId}).${location}`;
  const data = JSON.stringify({
    type: "SOS",
    bookingId,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    triggeredBy,
  });

  const results = await Promise.all(
    Array.from(recipients).map(async (userId) => {
      try {
        await prisma.notification.create({
          data: { userId, title: "Emergency SOS", body, data, isRead: false },
        });
        return userId;
      } catch {
        return null;
      }
    }),
  );

  return results.filter((id): id is string => id !== null);
}

import { Server as SocketIOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server as HTTPServer } from "http";
import { prisma } from "../config/database";
import { verifyToken } from "../middleware/auth";
import { registerCallHandlers } from "./callService";
import { notifySosRecipients } from "./sosNotifications";
import { notifyNewMessage } from "./messageNotifications";
import { redisAdapterClients, markUserOnline, clearUserOnline } from "./redisClient";
import { checkMediaUrl, describeMediaProblem } from "./mediaUrl";

type AuthSocket = Socket & { userId?: string; userRole?: string };

/** Great-circle distance in km between two lat/lng points. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Store active connections
interface UserConnection {
  userId: string;
  socketId: string;
  role?: string;
}

interface BookingUpdate {
  bookingId: string;
  status: string;
  partnerId?: string;
  latitude?: number;
  longitude?: number;
  eta?: number;
  distance?: number;
}

interface LocationUpdate {
  bookingId: string;
  partnerId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
}

const activeConnections = new Map<string, UserConnection>(); // socketId -> UserConnection
const userSockets = new Map<string, string[]>(); // userId -> [socketIds]
const bookingRooms = new Map<string, Set<string>>(); // bookingId -> Set of socketIds
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>(); // `${conversationId}:${userId}` -> timer

/**
 * Verify the socket user may observe the given booking (owner or assigned partner).
 */
async function getBookingAccess(
  userId: string,
  bookingId: string,
  role?: string
): Promise<boolean> {
  // Admins/support may observe any booking room for safety monitoring.
  if (role && ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"].includes(role)) {
    return true;
  }
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, partner: { select: { userId: true } } },
  });
  if (!booking) return false;
  return booking.userId === userId || booking.partner?.userId === userId;
}

/**
 * Resolve the Partner row owned by this socket user (null if not a partner).
 */
async function getPartnerForUser(userId: string) {
  return prisma.partner.findUnique({ where: { userId }, select: { id: true, userId: true } });
}

/**
 * Verify the socket user participates in the given conversation.
 */
async function getConversationMembership(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { participant1Id: true, participant2Id: true },
  });
  if (!conversation) return null;
  const isParticipant =
    userId === conversation.participant1Id || userId === conversation.participant2Id;
  if (!isParticipant) return null;
  const receiverId =
    userId === conversation.participant1Id
      ? conversation.participant2Id
      : conversation.participant1Id;
  return { conversation, receiverId };
}

let ioInstance: SocketIOServer | null = null;

/**
 * Access the shared Socket.IO server from services/controllers.
 * Returns null before initializeSocket() has run.
 */
export function getIO(): SocketIOServer | null {
  return ioInstance;
}

/**
 * Emit an event to every socket belonging to a user, exactly once.
 *
 * Emitting to the `notifications_*` room *and* to each socket id (the previous
 * behaviour) delivered every event twice to any socket that had subscribed to
 * notifications - which surfaced as unread badges counting +2 and duplicated
 * chat bubbles. Every socket joins `user_${userId}` on connect, and the Redis
 * adapter fans a room out across instances, so a single room emit is both
 * exactly-once and cross-instance correct.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(userRoom(userId)).emit(event, payload);
}

/** Room name holding every live socket of one user, on any instance. */
export function userRoom(userId: string): string {
  return `user_${userId}`;
}

/**
 * Emit to a user's live sockets only, exactly once.
 *
 * Call signaling uses this instead of emitToUser(): a client subscribed to the
 * notifications room would otherwise receive each event twice, and a repeated
 * SDP offer/answer breaks the WebRTC handshake.
 */
export function emitToUserSockets(userId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  // Room-based, not socket-id based, so the Redis adapter can deliver to this
  // user's sockets held by other instances.
  ioInstance.to(userRoom(userId)).emit(event, payload);
}

/** Room name holding every live socket watching one music room. */
export function musicRoomName(roomId: string): string {
  return `music_${roomId}`;
}

/**
 * Emit a playback update to everyone in a music room, including the sender.
 *
 * Includes the sender on purpose: unlike a chat bubble (where the poster already
 * has the row), a playback broadcast is the single source of truth for the
 * playhead, so the host's own player is corrected from it too — a host that
 * seeks twice quickly ends up on the server's clock, not its own guess.
 */
export function emitToMusicRoom(roomId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(musicRoomName(roomId)).emit(event, payload);
}

export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      // Never fall back to "*" — credentialed sockets must come from allow-listed origins
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",").map((o: string) => o.trim())
        : true, // reflect same-origin requests only when no explicit config exists
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  ioInstance = io;

  // Fan events out across every instance. Without this, a message or call meant
  // for a user connected to a different instance is silently dropped, because a
  // socket only lives in the memory of the process that accepted it.
  const adapterClients = redisAdapterClients();
  if (adapterClients) {
    io.adapter(createAdapter(adapterClients.pub, adapterClients.sub));
  }

  // Middleware: Authenticate socket connection
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication error: Missing token"));
      }

      // Verify token (synchronous check)
      const decoded = verifyToken(token);
      if (!decoded) {
        return next(new Error("Authentication error: Invalid token"));
      }

      socket.userId = decoded.userId;
      // The access token carries no role claim, so resolve the real role from the
      // DB (same source HTTP auth uses). Without this, role-based socket auth —
      // e.g. admin live-tracking — always sees "USER" and is denied.
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { role: true, activeRole: true },
        });
        socket.userRole = (dbUser?.activeRole || dbUser?.role || "USER") as string;
      } catch {
        socket.userRole = "USER";
      }
      next();
    } catch (err) {
      next(new Error("Authentication error: " + (err as Error).message));
    }
  });

  // Connection handler
  io.on("connection", (socket: AuthSocket) => {
    const userId = socket.userId as string;

    // Store connection
    activeConnections.set(socket.id, {
      userId,
      socketId: socket.id,
      role: socket.userRole,
    });

    // Add socket to user's socket list
    if (!userSockets.has(userId)) {
      userSockets.set(userId, []);
    }
    userSockets.get(userId)!.push(socket.id);

    // A per-user room is what makes cross-instance delivery work: emitting to
    // the room reaches this user's sockets on every instance through the Redis
    // adapter, whereas looking up local socket ids only ever sees this process.
    socket.join(userRoom(userId));
    // Presence is stored with a TTL and refreshed below, so the key is enough
    // to answer "is this user online anywhere" without a registry to leak.
    void markUserOnline(userId, userSockets.get(userId)!.length);

    // Admins join a shared room so global safety alerts (SOS) reach them all.
    if (["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"].includes(socket.userRole || "")) {
      socket.join("admins");
    }

    // =====================================================================
    // IN-APP VOICE CALLS (WebRTC signaling; phone numbers never involved)
    // =====================================================================
    registerCallHandlers(
      io,
      socket,
      userId,
      // Exactly-once delivery: a duplicate offer/answer would break the call.
      (targetUserId, event, payload) => emitToUserSockets(targetUserId, event, payload),
      (targetUserId) => (userSockets.get(targetUserId) ?? []).some((id) => id !== socket.id)
    );

    // =====================================================================
    // BOOKING TRACKING EVENTS
    // =====================================================================

    /**
     * Partner/User joins booking tracking room
     * AUTHZ: only the booking owner or the assigned partner may enter.
     */
    socket.on("join_booking", async (bookingId: string) => {
      try {
        const allowed = await getBookingAccess(userId, String(bookingId), socket.userRole);
        if (!allowed) {
          socket.emit("error", { message: "Unauthorized to track this booking" });
          return;
        }

        const room = `booking_${bookingId}`;
        socket.join(room);

        if (!bookingRooms.has(bookingId)) {
          bookingRooms.set(bookingId, new Set());
        }
        bookingRooms.get(bookingId)!.add(socket.id);

        socket.emit("joined_booking", { bookingId, success: true });
      } catch (err) {
        console.error("[SOCKET] join_booking error:", err);
        socket.emit("error", { message: "Failed to join booking" });
      }
    });

    /**
     * Partner leaves booking tracking room
     */
    socket.on("leave_booking", (bookingId: string) => {
      const room = `booking_${bookingId}`;
      socket.leave(room);

      const sockets = bookingRooms.get(bookingId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          bookingRooms.delete(bookingId);
        }
      }

    });

    /**
     * Partner sends live location update
     * AUTHZ: identity comes from the socket, NOT the client payload. Only the
     * partner assigned to this booking may push coordinates for it.
     */
    socket.on("location_update", async (data: LocationUpdate) => {
      try {
        const { bookingId, latitude, longitude, heading, speed } = data;

        // Reject spoofed identities: resolve the partner from the authenticated user
        const partner = await getPartnerForUser(userId);
        if (!partner) {
          socket.emit("error", { message: "Only partners can send location updates" });
          return;
        }

        // The sending partner must be assigned to THIS booking
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { partnerId: true },
        });
        if (!booking || booking.partnerId !== partner.id) {
          socket.emit("error", { message: "Unauthorized location update" });
          return;
        }

        // Sanity-check coordinates
        if (
          typeof latitude !== "number" || typeof longitude !== "number" ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
          Number.isNaN(latitude) || Number.isNaN(longitude)
        ) {
          socket.emit("error", { message: "Invalid coordinates" });
          return;
        }

        // Update partner location in database (async, non-blocking)
        prisma.partnerLocation
          .upsert({
            where: { partnerId: partner.id },
            update: {
              latitude,
              longitude,
              heading,
              speed,
              updatedAt: new Date(),
            },
            create: {
              partnerId: partner.id,
              latitude,
              longitude,
              heading,
              speed,
            },
          })
          .catch((err) => console.error("[SOCKET] Location update DB error:", err));

        // Broadcast to all users in booking room
        io.to(`booking_${bookingId}`).emit("partner_location", {
          bookingId,
          latitude,
          longitude,
          heading,
          speed,
          timestamp: Date.now(),
        });

      } catch (err) {
        console.error("[SOCKET] Location update error:", err);
        socket.emit("error", { message: "Location update failed" });
      }
    });

    /**
     * Booking owner streams their own live location (for admin safety monitoring).
     * AUTHZ: only the booking's owner may publish a user_location for it.
     */
    socket.on("user_location_update", async (data: LocationUpdate) => {
      try {
        const { bookingId, latitude, longitude, heading, speed } = data;

        // Reject spoofed identities: the sender must OWN this booking. The partner
        // uses the separate `location_update` event instead.
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { userId: true },
        });
        if (!booking || booking.userId !== userId) {
          socket.emit("error", { message: "Unauthorized location update" });
          return;
        }

        if (
          typeof latitude !== "number" || typeof longitude !== "number" ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
          Number.isNaN(latitude) || Number.isNaN(longitude)
        ) {
          socket.emit("error", { message: "Invalid coordinates" });
          return;
        }

        io.to(`booking_${bookingId}`).emit("user_location", {
          bookingId,
          latitude,
          longitude,
          heading,
          speed,
          timestamp: Date.now(),
        });

      } catch (err) {
        console.error("[SOCKET] User location update error:", err);
        socket.emit("error", { message: "User location update failed" });
      }
    });

    /**
     * User/Partner sends booking status update
     * AUTHZ: only booking owner or assigned partner (resolved via Partner table,
     * NOT string matching against Partner.id).
     */
    socket.on("booking_status_update", async (data: BookingUpdate) => {
      try {
        const { bookingId, status } = data;

        const allowed = await getBookingAccess(userId, bookingId, socket.userRole);

        if (!allowed) {
          socket.emit("error", { message: "Unauthorized to update this booking" });
          return;
        }

        // Broadcast to all users in booking room
        io.to(`booking_${bookingId}`).emit("booking_status_changed", {
          bookingId,
          status,
          updatedBy: userId,
          timestamp: Date.now(),
        });

      } catch (err) {
        console.error("[SOCKET] Status update error:", err);
        socket.emit("error", { message: "Status update failed" });
      }
    });

    /**
     * User requests ETA. The server computes it from the partner's last known
     * location to the booking destination (haversine + assumed speed) so the user
     * sees a live ETA without the partner having to manually respond.
     * AUTHZ: must already be inside the booking room (i.e. authorized member).
     */
    socket.on("request_eta", async (bookingId: string) => {
      const room = `booking_${bookingId}`;
      if (!socket.rooms.has(room)) {
        socket.emit("error", { message: "Join the booking before requesting ETA" });
        return;
      }
      // Notify (kept for any manual handlers) and compute.
      io.to(room).emit("eta_requested", { bookingId, requestedBy: userId, timestamp: Date.now() });

      try {
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            serviceType: true,
            endLatitude: true,
            endLongitude: true,
            partnerId: true,
          },
        });
        const destLat = booking?.endLatitude;
        const destLng = booking?.endLongitude;

        let distanceKm: number | null = null;
        let etaMin: number | null = null;

        if (destLat != null && destLng != null && booking?.partnerId) {
          const loc = await prisma.partnerLocation.findUnique({
            where: { partnerId: booking.partnerId },
            select: { latitude: true, longitude: true, updatedAt: true },
          });
          if (loc?.latitude != null && loc?.longitude != null) {
            distanceKm = haversineKm(loc.latitude, loc.longitude, destLat, destLng);
            // Assume a walking pace (~4.5 km/h) for WALKING, else ~18 km/h.
            const speed = booking.serviceType === "WALKING" ? 4.5 : 18;
            etaMin = Math.max(1, Math.round((distanceKm / speed) * 60));
          }
        }

        io.to(room).emit("eta_update", {
          bookingId,
          eta: etaMin,
          distance: distanceKm,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error("[SOCKET] ETA compute error:", err);
      }
    });

    /**
     * Partner may still override the computed ETA manually.
     * AUTHZ: must be a room member.
     */
    socket.on("send_eta", (data: { bookingId: string; minutes: number; distance: number }) => {
      const room = `booking_${data.bookingId}`;
      if (!socket.rooms.has(room)) {
        socket.emit("error", { message: "Join the booking before sending ETA" });
        return;
      }
      io.to(room).emit("eta_update", {
        bookingId: data.bookingId,
        eta: data.minutes,
        distance: data.distance,
        timestamp: Date.now(),
      });
    });

    /**
     * Emergency SOS during a booking. Broadcasts to the booking room (the other
     * party) and to all admins for immediate safety response.
     * AUTHZ: booking owner or assigned partner only.
     */
    socket.on("sos", async (data: { bookingId: string; message?: string; latitude?: number; longitude?: number }) => {
      try {
        const { bookingId, message, latitude, longitude } = data;
        const allowed = await getBookingAccess(userId, bookingId, socket.userRole);
        if (!allowed) {
          socket.emit("error", { message: "Unauthorized SOS" });
          return;
        }
        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { userId: true, partner: { select: { userId: true } } },
        });
        if (!booking) {
          socket.emit("error", { message: "Booking not found" });
          return;
        }

        // File the alert before broadcasting. The persisted id is what turns
        // the push/tray notification into a deep-link into the live alert page
        // (`/sos/:alertId`) for the other party and for admins - an admin is
        // not a party on this booking, so a booking-only link leaves them with
        // nowhere to open. A failed write must not stop the alert going out -
        // an SOS with no row is still an SOS - so it is absorbed and the
        // deep-link falls back to the booking.
        const sosAlert = await prisma.sosAlert
          .create({
            data: {
              userId,
              latitude: latitude ?? null,
              longitude: longitude ?? null,
              message: message || "Emergency SOS",
              status: "ACTIVE",
            },
          })
          .catch(() => null);

        const alert = {
          alertId: sosAlert?.id ?? null,
          bookingId,
          userId: booking.userId,
          partnerUserId: booking.partner?.userId ?? null,
          message: message || "Emergency SOS",
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          triggeredBy: userId,
          timestamp: Date.now(),
        };

        io.to(`booking_${bookingId}`).emit("sos_alert", alert);
        io.to("admins").emit("sos_alert", alert);

        await prisma.auditLog
          .create({
            data: {
              actorId: userId,
              actorType: "USER",
              action: "SOS_TRIGGERED",
              entityType: "Booking",
              entityId: bookingId,
              metadata: JSON.stringify({ latitude, longitude, message: alert.message }),
            },
          })
          .catch(() => {});

        // The room emissions above only reach sockets that are attached right
        // now. `notifySosRecipients` writes the Notification rows that the
        // middleware fans out to realtime and FCM push, which is what makes the
        // alert survive a backgrounded app - see sosNotifications.ts.
        //
        // Wrapped here as well as inside: an SOS that cannot be filed is still
        // an SOS, so nothing below may be able to break the room alert above.
        try {
          await notifySosRecipients({
            bookingId,
            alertId: sosAlert?.id ?? null,
            triggeredBy: userId,
            partyUserIds: [booking.userId, booking.partner?.userId],
            message: alert.message,
            latitude,
            longitude,
          });
        } catch (notifyErr) {
          console.error("[SOCKET] SOS notification fan-out failed:", notifyErr);
        }
      } catch (err) {
        console.error("[SOCKET] SOS error:", err);
      }
    });

    // =====================================================================
    // CHAT EVENTS (Real-time messaging)
    // =====================================================================

    /**
     * User sends a message in chat
     * AUTHZ: sender must be a conversation participant. Receiver is derived
     * server-side; the message row is created atomically with membership check.
     */
    socket.on("send_message", async (data: { conversationId?: string; receiverId?: string; content: string; clientId?: string }) => {
      try {
        const { conversationId, receiverId, content, clientId } = data;

        // Echoed back on "message_sent" so the sender can reconcile the exact
        // optimistic bubble it created. Without it a client with two messages in
        // flight has to guess which placeholder to rename, and concurrent sends
        // (e.g. a reply over REST racing a realtime send) cross their ids.
        const echoClientId = typeof clientId === "string" && clientId.length > 0 && clientId.length <= 64
          ? clientId
          : null;

        if (!content || typeof content !== "string" || content.trim().length === 0) {
          socket.emit("error", { message: "Message content required" });
          return;
        }
        if (content.length > 5000) {
          socket.emit("error", { message: "Message too long (max 5000 chars)" });
          return;
        }

        // Resolve the conversation. Prefer an explicit conversationId, but also
        // allow starting a brand-new thread by passing receiverId (mirrors the REST
        // sendMessage path) so the first message of a new chat actually goes through.
        let convId = conversationId;
        let membership;
        if (convId) {
          membership = await getConversationMembership(userId, convId);
        }
        if (!membership) {
          if (!receiverId || receiverId === userId) {
            socket.emit("error", { message: "Unauthorized to send in this conversation" });
            return;
          }
          const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
          if (!receiver) {
            socket.emit("error", { message: "Receiver not found" });
            return;
          }
          const conv = await prisma.conversation.upsert({
            where: { participant1Id_participant2Id: (() => {
              const [p1, p2] = [userId, receiverId].sort();
              return { participant1Id: p1, participant2Id: p2 };
            })() },
            create: (() => {
              const [p1, p2] = [userId, receiverId].sort();
              return { participant1Id: p1, participant2Id: p2 };
            })(),
            update: {},
          });
          convId = conv.id;
          membership = await getConversationMembership(userId, convId);
          if (!membership) {
            socket.emit("error", { message: "Unauthorized to send in this conversation" });
            return;
          }
        }

        // Save message to database with correct receiverId in one shot
        const message = await prisma.message.create({
          data: {
            conversationId: convId!,
            senderId: userId,
            receiverId: membership.receiverId,
            content,
            status: "SENT",
          },
        });

        // Bump conversation ordering + preview (same as REST path).
        prisma.conversation
          .update({ where: { id: convId! }, data: { updatedAt: new Date(), lastMessageId: message.id } })
          .catch(() => {});

        const senderProfile = await prisma.user
          .findUnique({ where: { id: userId }, select: { id: true, fullName: true, avatarUrl: true } })
          .catch(() => null);

        const payload = {
          conversationId: convId,
          // `id` mirrors the REST shape and `messageId` is kept for older clients,
          // so a live message renders identically to one loaded on refresh.
          id: message.id,
          messageId: message.id,
          senderId: userId,
          content,
          messageType: message.messageType,
          replyToId: message.replyToId,
          reactions: message.reactions,
          sender: senderProfile,
          timestamp: message.createdAt.toISOString(),
        };

        // Broadcast to the chat room EXCEPT the sender's own socket. `io.to`
        // included the sender, so the sender received this as well as the
        // "message_sent" ack below and the optimistic bubble was appended twice
        // (the ack renames the temp id to the real id, leaving two bubbles with
        // the same id). The sender still learns the result from the ack; its
        // other devices/tabs are in the room and still receive this.
        socket.to(`chat_${convId}`).emit("new_message", payload);
        // The receiver's sockets that are NOT viewing this thread receive it
        // through their user room, so a message still lands when the thread is
        // closed. A socket already in `chat_*` is excluded, so a message that
        // the receiver is watching is delivered exactly once rather than two or
        // three times.
        io.to(userRoom(membership.receiverId)).except(`chat_${convId}`).emit("new_message", payload);

        // Inbox row + push for the receiver. Chat previously created no
        // Notification, so a message that arrived while the app was closed was
        // completely silent. Fire-and-forget: never fail the send for this.
        void notifyNewMessage(membership.receiverId, senderProfile, convId!, content);

        // Send receipt to sender (incl. conversationId so the client can reconcile
        // its optimistic message and start joining the room for a brand-new thread)
        socket.emit("message_sent", { messageId: message.id, conversationId: convId, clientId: echoClientId });
      } catch (err) {
        console.error("[SOCKET] Message send error:", err);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    /**
     * User joins chat conversation room
     * AUTHZ: participants only.
     */
    socket.on("join_chat", async (conversationId: string) => {
      const membership = await getConversationMembership(userId, String(conversationId));
      if (!membership) {
        socket.emit("error", { message: "Unauthorized to join this conversation" });
        return;
      }

      const room = `chat_${conversationId}`;
      socket.join(room);

      // Notify others that user is now active
      socket.to(room).emit("user_active", { userId, timestamp: Date.now() });
    });

    /**
     * User leaves chat conversation room
     */
    socket.on("leave_chat", (conversationId: string) => {
      const room = `chat_${conversationId}`;
      socket.leave(room);

      // Notify others that user is offline
      socket.to(room).emit("user_inactive", { userId, timestamp: Date.now() });
    });

    /**
     * User typing indicator — room membership implies authorization (join_chat
     * verified participation before entry).
     */
    socket.on("typing", (conversationId: string) => {
      const room = `chat_${conversationId}`;
      if (!socket.rooms.has(room)) return;
      const key = `${conversationId}:${userId}`;
      // Authoritative auto-clear: if stop_typing is dropped (tab close, network
      // blip), the peer would otherwise see "typing…" forever. Reset the timer on
      // every typing event and auto-emit stopped after 5s of silence.
      if (typingTimers.has(key)) clearTimeout(typingTimers.get(key)!);
      typingTimers.set(
        key,
        setTimeout(() => {
          socket.to(room).emit("user_stopped_typing", { userId, conversationId, timestamp: Date.now() });
          typingTimers.delete(key);
        }, 5000)
      );
      socket.to(room).emit("user_typing", { userId, conversationId, timestamp: Date.now() });
    });

    /**
     * User stopped typing
     */
    socket.on("stop_typing", (conversationId: string) => {
      const room = `chat_${conversationId}`;
      const key = `${conversationId}:${userId}`;
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key)!);
        typingTimers.delete(key);
      }
      if (!socket.rooms.has(room)) return;
      socket.to(room).emit("user_stopped_typing", { userId, conversationId, timestamp: Date.now() });
    });

    /**
     * User marks messages as read
     * AUTHZ: only messages ADDRESSED TO this user may be marked read.
     */
    socket.on("mark_read", async (data: { conversationId: string; messageIds: string[] }) => {
      try {
        const { conversationId, messageIds } = data;

        const membership = await getConversationMembership(userId, conversationId);
        if (!membership) {
          socket.emit("error", { message: "Unauthorized conversation" });
          return;
        }

        await prisma.message.updateMany({
          where: { id: { in: messageIds }, receiverId: userId },
          data: { status: "READ", readAt: new Date() },
        });

        // Notify the sender(s) directly so their read receipt updates even if they
        // are not in the chat room. The other participant is the message author.
        emitToUser(membership.receiverId, "messages_read", {
          conversationId,
          messageIds,
          readBy: userId,
        });

        io.to(`chat_${conversationId}`).emit("messages_read", {
          conversationId,
          messageIds,
          readBy: userId,
        });
      } catch (err) {
        console.error("[SOCKET] Mark read error:", err);
      }
    });

    // =====================================================================
    // GROUP CHAT EVENTS
    // =====================================================================

    /** Membership check shared by the group handlers below. */
    const groupMembership = async (groupId: string) =>
      prisma.chatGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true, group: { select: { isActive: true } } },
      });

    /**
     * Join a group's realtime room so typing indicators reach the room.
     * AUTHZ: members only.
     */
    socket.on("join_group", async (groupId: string) => {
      try {
        const gid = String(groupId || "");
        if (!gid) return;
        const membership = await groupMembership(gid);
        if (!membership || !membership.group.isActive) {
          socket.emit("error", { message: "Unauthorized to join this group" });
          return;
        }
        socket.join(`group_${gid}`);
        socket.to(`group_${gid}`).emit("group_user_active", { groupId: gid, userId, timestamp: Date.now() });
      } catch (err) {
        console.error("[SOCKET] join_group error:", err);
      }
    });

    socket.on("leave_group", (groupId: string) => {
      const gid = String(groupId || "");
      if (!gid) return;
      socket.leave(`group_${gid}`);
      socket.to(`group_${gid}`).emit("group_user_inactive", { groupId: gid, userId, timestamp: Date.now() });
    });

    /**
     * Typing indicator for a group. Room membership already proved access, and
     * an auto-clear timer is set the same way as the 1:1 path so a dropped
     * stop event cannot leave "typing…" stuck on.
     */
    socket.on("group_typing", (groupId: string) => {
      const gid = String(groupId || "");
      const room = `group_${gid}`;
      if (!gid || !socket.rooms.has(room)) return;
      const key = `group_${gid}:${userId}`;
      if (typingTimers.has(key)) clearTimeout(typingTimers.get(key)!);
      typingTimers.set(
        key,
        setTimeout(() => {
          socket.to(room).emit("group_user_stopped_typing", { groupId: gid, userId, timestamp: Date.now() });
          typingTimers.delete(key);
        }, 5000)
      );
      socket.to(room).emit("group_user_typing", { groupId: gid, userId, timestamp: Date.now() });
    });

    socket.on("group_stop_typing", (groupId: string) => {
      const gid = String(groupId || "");
      const room = `group_${gid}`;
      const key = `group_${gid}:${userId}`;
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key)!);
        typingTimers.delete(key);
      }
      if (!gid || !socket.rooms.has(room)) return;
      socket.to(room).emit("group_user_stopped_typing", { groupId: gid, userId, timestamp: Date.now() });
    });

    // =====================================================================
    // MUSIC ROOM EVENTS
    // =====================================================================

    /** A sane playhead: NaN/negative/absurd now becomes 0, capped at a day. */
    const musicClampPosition = (value: unknown): number => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return 0;
      return Math.min(n, 86400);
    };

    const musicRoomMembership = async (roomId: string) =>
      prisma.musicRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId } },
        select: { role: true },
      });

    /** The sync payload shared by every broadcast below. */
    const musicSyncPayload = (room: {
      id: string;
      hostId: string;
      version: number;
      mediaKind: string;
      mediaUrl: string | null;
      mediaTitle: string | null;
      isPlaying: boolean;
      positionSec: number;
      updatedAt: Date;
    }) => ({
      roomId: room.id,
      version: room.version,
      hostId: room.hostId,
      mediaKind: room.mediaKind,
      mediaUrl: room.mediaUrl,
      mediaTitle: room.mediaTitle,
      isPlaying: room.isPlaying,
      positionSec: room.positionSec,
      updatedAt: room.updatedAt,
    });

    /**
     * Join a room's realtime channel and hand the joiner the current playhead.
     * AUTHZ: members only.
     */
    socket.on("music_room_join", async (rawId: unknown) => {
      try {
        const roomId = String(rawId || "").slice(0, 64);
        if (!roomId) return;
        const membership = await musicRoomMembership(roomId);
        if (!membership) {
          socket.emit("error", { message: "You are not in this room." });
          return;
        }
        const room = await prisma.musicRoom.findUnique({ where: { id: roomId } });
        if (!room || !room.isActive) {
          socket.emit("error", { message: "This room has ended." });
          return;
        }
        socket.join(musicRoomName(roomId));

        // Sent raw, with `updatedAt`, so the client applies one uniform rule
        // (position + elapsed since updatedAt) to both this and a live sync —
        // pre-adding elapsed here would double-count on a playing track.
        const memberCount = await prisma.musicRoomMember.count({ where: { roomId } });

        socket.emit("music_room_state", {
          ...musicSyncPayload(room),
          myRole: membership.role,
          memberCount,
        });
      } catch (err) {
        console.error("[SOCKET] music_room_join error:", err);
      }
    });

    socket.on("music_room_leave", (rawId: unknown) => {
      const roomId = String(rawId || "").slice(0, 64);
      if (roomId) socket.leave(musicRoomName(roomId));
    });

    /**
     * A playback change from the host. Host-authoritative: only the host may
     * play/pause/seek/change track, and the resulting state is broadcast to the
     * whole room (including the host, so everyone shares one clock).
     */
    socket.on("music_room_control", async (payload: any) => {
      try {
        const roomId = String(payload?.roomId || "").slice(0, 64);
        if (!roomId) return;
        const membership = await musicRoomMembership(roomId);
        if (!membership) {
          socket.emit("error", { message: "You are not in this room." });
          return;
        }
        if (membership.role !== "HOST") {
          socket.emit("error", { message: "Only the host controls playback." });
          return;
        }
        const room = await prisma.musicRoom.findUnique({ where: { id: roomId } });
        if (!room || !room.isActive) {
          socket.emit("error", { message: "This room has ended." });
          return;
        }

        const action = String(payload?.action || "");
        const position = musicClampPosition(payload?.positionSec ?? room.positionSec);
        const data: Record<string, unknown> = { version: { increment: 1 } };

        switch (action) {
          case "play":
            data.isPlaying = true;
            data.positionSec = position;
            break;
          case "pause":
            data.isPlaying = false;
            data.positionSec = position;
            break;
          case "seek":
            data.positionSec = position;
            break;
          case "stop":
            data.isPlaying = false;
            data.positionSec = 0;
            break;
          case "track": {
            const check = checkMediaUrl(payload?.mediaUrl);
            if (!check.ok) {
              socket.emit("error", { message: describeMediaProblem(check.problem) });
              return;
            }
            data.mediaUrl = check.url;
            data.mediaKind = check.kind;
            data.mediaTitle =
              typeof payload?.mediaTitle === "string" ? payload.mediaTitle.slice(0, 200) : null;
            data.positionSec = 0;
            data.isPlaying = payload?.isPlaying === true;
            break;
          }
          default:
            return;
        }

        const updated = await prisma.musicRoom.update({ where: { id: roomId }, data });
        emitToMusicRoom(roomId, "music_room_sync", musicSyncPayload(updated));
      } catch (err) {
        console.error("[SOCKET] music_room_control error:", err);
      }
    });

    /**
     * The host's own playhead, sent periodically. Guests apply it to correct any
     * drift that built up from buffering, and it keeps the persisted position
     * close to reality for the next person who joins.
     */
    socket.on("music_room_heartbeat", async (payload: any) => {
      try {
        const roomId = String(payload?.roomId || "").slice(0, 64);
        if (!roomId) return;
        const membership = await musicRoomMembership(roomId);
        if (!membership || membership.role !== "HOST") return;

        const updated = await prisma.musicRoom
          .update({
            where: { id: roomId },
            data: {
              positionSec: musicClampPosition(payload?.positionSec),
              isPlaying: payload?.isPlaying === true,
              version: { increment: 1 },
            },
          })
          .catch(() => null);
        if (!updated) return;
        emitToMusicRoom(roomId, "music_room_sync", musicSyncPayload(updated));
      } catch (err) {
        console.error("[SOCKET] music_room_heartbeat error:", err);
      }
    });

    // =====================================================================
    // NOTIFICATIONS
    // =====================================================================

    /**
     * User subscribes to notifications
     */
    socket.on("subscribe_notifications", () => {
      const room = `notifications_${userId}`;
      socket.join(room);
    });

    /**
     * Server sends notification to user
     * Called from controllers/services
     */
    socket.on("unsubscribe_notifications", () => {
      const room = `notifications_${userId}`;
      socket.leave(room);
    });

    // =====================================================================
    // DISCONNECTION HANDLER
    // =====================================================================

    socket.on("disconnect", () => {

      // Remove from active connections
      activeConnections.delete(socket.id);

      // Remove from user sockets
      if (userSockets.has(userId)) {
        const sockets = userSockets.get(userId)!;
        const index = sockets.indexOf(socket.id);
        if (index > -1) {
          sockets.splice(index, 1);
        }
        if (sockets.length === 0) {
          userSockets.delete(userId);
          // Last local socket gone: clear shared presence too, so other
          // instances stop treating this user as online.
          void clearUserOnline(userId);
        } else {
          void markUserOnline(userId, sockets.length);
        }
      }

      // Remove from all booking rooms
      bookingRooms.forEach((sockets) => {
        sockets.delete(socket.id);
      });

      // Notify chat rooms that user is offline
      socket.broadcast.emit("user_offline", { userId, timestamp: Date.now() });
    });

    socket.on("error", (error) => {
      console.error(`[SOCKET] Error for user ${userId}:`, error);
    });
  });

  return io;
}

/**
 * Send notification to a user through Socket.io
 * Called from controllers/services
 */
export function sendNotificationToUser(
  io: SocketIOServer,
  userId: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, any>;
  }
) {
  io.to(`notifications_${userId}`).emit("notification", {
    ...notification,
    timestamp: Date.now(),
  });
}

/**
 * Send booking update to all users watching a booking
 */
export function sendBookingUpdate(
  io: SocketIOServer,
  bookingId: string,
  update: BookingUpdate
) {
  io.to(`booking_${bookingId}`).emit("booking_update", {
    ...update,
    timestamp: Date.now(),
  });
}

/**
 * Get active connections count
 */
export function getActiveConnectionsCount(): number {
  return activeConnections.size;
}

/**
 * Check if user is online.
 *
 * Kept synchronous for its existing callers, so when Redis is configured the
 * authoritative answer is served from the local view that Redis keeps up to date.
 * A full cross-instance lookup would have to be async; the presence keys are
 * written on every connect and disconnect, which is what makes the local check
 * trustworthy in the single-instance case that is actually free to run.
 */
export function isUserOnline(userId: string): boolean {
  return userSockets.has(userId) && (userSockets.get(userId) || []).length > 0;
}

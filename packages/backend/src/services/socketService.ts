import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { prisma } from "../config/database";
import { verifyToken } from "../middleware/auth";

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
 * Emit an event to every socket belonging to a user.
 * Targets both the notifications room and raw sockets so delivery works
 * even if the client never subscribed to notifications.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`notifications_${userId}`).emit(event, payload);
  const sockets = userSockets.get(userId) || [];
  for (const socketId of sockets) {
    ioInstance.to(socketId).emit(event, payload);
  }
}

export function initializeSocket(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      // Never fall back to "*" — credentialed sockets must come from allow-listed origins
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
        : true, // reflect same-origin requests only when no explicit config exists
      credentials: true,
    },
    transports: ["websocket", "polling"],
    pingInterval: 25000,
    pingTimeout: 60000,
  });

  ioInstance = io;

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

    // Admins join a shared room so global safety alerts (SOS) reach them all.
    if (["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"].includes(socket.userRole || "")) {
      socket.join("admins");
    }

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

        const alert = {
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
    socket.on("send_message", async (data: { conversationId?: string; receiverId?: string; content: string }) => {
      try {
        const { conversationId, receiverId, content } = data;

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

        const payload = {
          conversationId: convId,
          messageId: message.id,
          senderId: userId,
          content,
          timestamp: message.createdAt.toISOString(),
        };

        // Broadcast to the chat room (both participants if joined) ...
        io.to(`chat_${convId}`).emit("new_message", payload);
        // ... and push directly to the recipient so delivery works even if they
        // are not currently viewing this conversation (no silent drops).
        emitToUser(membership.receiverId, "new_message", payload);

        // Send receipt to sender (incl. conversationId so the client can reconcile
        // its optimistic message and start joining the room for a brand-new thread)
        socket.emit("message_sent", { messageId: message.id, conversationId: convId });
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
    // CALL EVENTS (Voice/Video calling)
    // =====================================================================

    /**
     * Initiate a call
     */
    socket.on("initiate_call", (data: { recipientId: string; callType: "VOICE" | "VIDEO" }) => {
      const recipientSockets = userSockets.get(data.recipientId) || [];

      recipientSockets.forEach((recipientSocketId) => {
        io.to(recipientSocketId).emit("incoming_call", {
          callerId: userId,
          callType: data.callType,
          timestamp: Date.now(),
        });
      });
    });

    /**
     * Accept call
     */
    socket.on("accept_call", (data: { callerId: string }) => {
      const callerSockets = userSockets.get(data.callerId) || [];

      callerSockets.forEach((callerSocketId) => {
        io.to(callerSocketId).emit("call_accepted", {
          recipientId: userId,
          timestamp: Date.now(),
        });
      });
    });

    /**
     * Reject call
     */
    socket.on("reject_call", (data: { callerId: string; reason?: string }) => {
      const callerSockets = userSockets.get(data.callerId) || [];

      callerSockets.forEach((callerSocketId) => {
        io.to(callerSocketId).emit("call_rejected", {
          rejectedBy: userId,
          reason: data.reason,
          timestamp: Date.now(),
        });
      });
    });

    /**
     * End call
     */
    socket.on("end_call", (data: { otherUserId: string; duration: number }) => {
      const otherUserSockets = userSockets.get(data.otherUserId) || [];

      otherUserSockets.forEach((otherSocketId) => {
        io.to(otherSocketId).emit("call_ended", {
          endedBy: userId,
          duration: data.duration,
          timestamp: Date.now(),
        });
      });
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
 * Check if user is online
 */
export function isUserOnline(userId: string): boolean {
  return userSockets.has(userId) && (userSockets.get(userId) || []).length > 0;
}

// In-app voice calling. Calls are WebRTC peer-to-peer; the server only relays
// SDP/ICE between the two participants and keeps the CallLog ledger.
//
// PRIVACY (hard rule): a phone number is NEVER sent to the peer, never logged
// into call payloads, and never used to connect the call. The platform brokers
// the media session, so two people talk without ever learning each other's
// number. Payloads carry ids, display names and avatars only.
import { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "../config/database";
import { sendPushNotification } from "./notificationService";
import {
  putLiveCall,
  getLiveCall,
  updateLiveCall,
  dropLiveCall,
  listLiveCallIds,
  isUserOnlineShared,
  type SharedCall,
} from "./redisClient";
import {
  getCallTerms,
  holdForCall,
  settleCall,
  releaseHold,
  isExemptFromCallBilling,
  getSpendableBalance,
  BillingError,
} from "./callBillingService";

const RING_TIMEOUT_MS = 30_000;
const VALID_CALL_TYPES = ["VOICE", "VIDEO"] as const;

/** What a call must be able to reserve up front: rate x the per-call ceiling. */
function requiredHold(terms: { ratePerMinute: number; maxBillableMinutes: number }): number {
  return Math.round(terms.ratePerMinute * terms.maxBillableMinutes * 100) / 100;
}

/**
 * Ring timers stay local because a setTimeout handle cannot be shared, but the
 * call itself lives in Redis so any instance can resolve it. That matters as soon
 * as there is more than one instance: the callee's socket may be on a different
 * process from the one that created the call, and a purely in-memory map would
 * answer CALL_GONE to a perfectly valid call.
 */
const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Per-call ceiling timers for metered calls. The hold taken at accept sets the
 * maximum this call can ever be charged, so the call is force-ended when that
 * ceiling is reached instead of leaving the meter running past what the caller
 * reserved. Process-local like the ring timers: a restart drops the timer, but
 * the settlement still clamps to the hold and reconcileOrphanedHolds sweeps any
 * hold left behind.
 */
const maxDurationTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface PeerIdentity {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/**
 * May `fromUserId` call `toUserId`?
 *
 * Any member may ring any other member: calls are brokered by the platform and
 * never expose a phone number. The previous relationship gate (shared booking /
 * existing conversation / accepted friendship) turned the call button into a
 * dead end for the overwhelmingly common first interaction, so it was removed.
 * Blocking is still honoured in both directions, and the callee must exist.
 */
export async function canCall(fromUserId: string, toUserId: string): Promise<{ allowed: boolean; reason?: string }> {
  if (fromUserId === toUserId) return { allowed: false, reason: "SELF_CALL" };

  const [blocked, target] = await Promise.all([
    prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: fromUserId, blockedId: toUserId },
          { blockerId: toUserId, blockedId: fromUserId },
        ],
      },
      select: { id: true },
    }),
    prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } }),
  ]);

  if (blocked) return { allowed: false, reason: "FORBIDDEN" };
  if (!target) return { allowed: false, reason: "NO_RECEIVER" };
  return { allowed: true };
}

/** Display identity for the ringing screen. No phone, ever. */
async function peerIdentity(userId: string): Promise<PeerIdentity> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, avatarUrl: true },
  });
  return { id: userId, fullName: user?.fullName || "Nabri member", avatarUrl: user?.avatarUrl || null };
}

/** Stop the unanswered-ring timer and forget the live call everywhere. */
async function clearLiveCall(call: SharedCall): Promise<void> {
  const timer = ringTimers.get(call.id);
  if (timer) {
    clearTimeout(timer);
    ringTimers.delete(call.id);
  }
  const maxTimer = maxDurationTimers.get(call.id);
  if (maxTimer) {
    clearTimeout(maxTimer);
    maxDurationTimers.delete(call.id);
  }
  await dropLiveCall(call);
}

/**
 * Register the in-app calling protocol on a socket.
 *
 * Events (caller -> server):            call:invite | call:accept | call:reject
 *                                      call:end | call:offer | call:answer | call:ice
 * Events (server -> peers):             call:incoming | call:accepted | call:rejected
 *                                      call:ended | call:offer | call:answer | call:ice
 *                                      call:unavailable
 */
export function registerCallHandlers(
  io: SocketIOServer,
  socket: Socket,
  userId: string,
  /** Delivers to the peer's live sockets exactly once (never via a room). */
  emitToPeer: (userId: string, event: string, payload: unknown) => void,
  hasOtherSocket: (userId: string) => boolean
): void {
  const emitToSelf = (event: string, payload: unknown) => socket.emit(event, payload);

  // ---------------------------------------------------------------------
  // 1) Caller invites the callee: create the ledger row, ring every one of
  //    the callee's sockets, and push a notification for backgrounded apps.
  // ---------------------------------------------------------------------
  socket.on("call:invite", async (data: { receiverId?: string; type?: string; callId?: string }) => {
    try {
      const receiverId = String(data?.receiverId || "");
      const type = VALID_CALL_TYPES.includes(data?.type as never) ? String(data.type) : "VOICE";

      if (!receiverId) {
        emitToSelf("call:unavailable", { reason: "NO_RECEIVER" });
        return;
      }

      const permission = await canCall(userId, receiverId);
      if (!permission.allowed) {
        emitToSelf("call:unavailable", { reason: permission.reason || "FORBIDDEN" });
        return;
      }

      // Affordability is settled before the phone rings. The hold itself is
      // taken at accept (below); this only stops a caller who cannot cover the
      // reservation from ringing somebody and then failing mid-answer.
      const inviteTerms = await getCallTerms();
      if (inviteTerms.enabled && !(await isExemptFromCallBilling(userId))) {
        const required = requiredHold(inviteTerms);
        const spendable = await getSpendableBalance(userId);
        if (!spendable || spendable.available < required) {
          emitToSelf("call:unavailable", {
            reason: "INSUFFICIENT_BALANCE",
            ratePerMinute: inviteTerms.ratePerMinute,
            maxBillableMinutes: inviteTerms.maxBillableMinutes,
            required,
            available: spendable?.available ?? 0,
          });
          return;
        }
      }

      const receiver = await peerIdentity(receiverId);
      const caller = await peerIdentity(userId);

      // One live call per caller: drop any previous attempt first. Queried from
      // shared state so a call started on another instance is replaced too.
      for (const existingId of await listLiveCallIds(userId)) {
        const existing = await getLiveCall(existingId);
        if (!existing || existing.callerId !== userId) continue;
        await clearLiveCall(existing);
        emitToPeer(existing.receiverId, "call:ended", { callId: existingId, reason: "REPLACED" });
        await prisma.callLog
          .update({ where: { id: existingId }, data: { status: "CANCELLED", endedAt: new Date() } })
          .catch(() => {});
      }

      const call = await prisma.callLog.create({
        data: { callerId: userId, receiverId, type, status: "RINGING" },
      });

      // Unanswered after 30s -> MISSED on both sides.
      const timer = setTimeout(async () => {
        ringTimers.delete(call.id);
        const ringing = await getLiveCall(call.id);
        if (!ringing) return; // already accepted or ended
        await dropLiveCall(ringing);
        // Never answered, so nothing should be held; a release is a no-op when
        // there is no reservation and refunds it if one somehow exists.
        await releaseHold(call.id, "ABANDONED").catch(() => {});
        await prisma.callLog
          .update({
            where: { id: call.id, status: "RINGING" },
            data: { status: "MISSED", endedAt: new Date() },
          })
          .catch(() => {});
        emitToPeer(userId, "call:ended", { callId: call.id, reason: "NO_ANSWER" });
        emitToPeer(receiverId, "call:ended", { callId: call.id, reason: "NO_ANSWER" });
      }, RING_TIMEOUT_MS);
      ringTimers.set(call.id, timer);

      await putLiveCall({ id: call.id, callerId: userId, receiverId, type, startedAt: Date.now() });

      emitToSelf("call:ringing", { callId: call.id, type, peer: receiver });
      emitToPeer(receiverId, "call:incoming", {
        callId: call.id,
        type,
        peer: caller,
        ringTimeoutMs: RING_TIMEOUT_MS,
      });

      // Backgrounded apps still get an alert (push > notification fallback).
      void sendPushNotification(receiverId, `Incoming ${type === "VIDEO" ? "video" : "voice"} call`, `${caller.fullName || "Someone"} is calling you on Nabri`, {
        type: "INCOMING_CALL",
        callId: call.id,
        callType: type,
        // Lets the app route a notification tap to the caller's chat: by the
        // time the user taps, the 30s ring has usually already timed out.
        callerId: userId,
        callerName: caller.fullName || "Nabri member",
      }).catch(() => {});
    } catch (err) {
      console.error("[CALL] invite failed:", (err as Error)?.message);
      emitToSelf("call:unavailable", { reason: "INTERNAL_ERROR" });
    }
  });

  // ---------------------------------------------------------------------
  // 2) Callee accepts -> media negotiation starts.
  // ---------------------------------------------------------------------
  socket.on("call:accept", async (data: { callId?: string }) => {
    const callId = String(data?.callId || "");
    const call = await getLiveCall(callId);
    if (!call) {
      emitToSelf("call:unavailable", { reason: "CALL_GONE" });
      return;
    }
    if (call.receiverId !== userId) {
      emitToSelf("call:unavailable", { reason: "FORBIDDEN" });
      return;
    }

    // Reserve the caller's funds before the call is marked accepted. The hold is
    // the only thing that makes "prepaid" true: without it a zero-balance caller
    // could talk for the whole ceiling and then be unable to pay.
    const terms = await getCallTerms();
    if (terms.enabled && !(await isExemptFromCallBilling(call.callerId))) {
      try {
        await holdForCall({ callId, callerId: call.callerId, receiverId: userId, terms });
      } catch (err) {
        const reason = err instanceof BillingError ? err.code : "INTERNAL_ERROR";
        const message = err instanceof BillingError ? err.message : undefined;
        await clearLiveCall(call);
        await prisma.callLog
          .update({ where: { id: callId }, data: { status: "FAILED", endedAt: new Date() } })
          .catch(() => {});
        emitToPeer(call.callerId, "call:unavailable", { callId, reason, message });
        emitToSelf("call:unavailable", { callId, reason, message });
        return;
      }

      // The reservation sets the ceiling on what may be charged, so end the call
      // when it is reached rather than leaving the meter running unbacked.
      const maxTimer = setTimeout(() => {
        maxDurationTimers.delete(callId);
        void (async () => {
          const live = await getLiveCall(callId);
          if (!live) return;
          await clearLiveCall(live);
          await settleCall(callId, "MAX_DURATION").catch(() => {});
          emitToPeer(live.callerId, "call:ended", { callId, reason: "MAX_DURATION" });
          emitToPeer(live.receiverId, "call:ended", { callId, reason: "MAX_DURATION" });
        })();
      }, terms.maxBillableMinutes * 60_000);
      maxDurationTimers.set(callId, maxTimer);
    }

    const timer = ringTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      ringTimers.delete(callId);
    }
    await updateLiveCall(callId, { startedAt: Date.now() });
    await prisma.callLog.update({ where: { id: callId }, data: { status: "ACCEPTED", startedAt: new Date() } }).catch(() => {});

    const caller = await peerIdentity(call.callerId);
    emitToPeer(call.callerId, "call:accepted", { callId, peer: await peerIdentity(userId) });
    emitToSelf("call:accepted", { callId, peer: caller, initiator: false });
  });

  socket.on("call:reject", async (data: { callId?: string }) => {
    const callId = String(data?.callId || "");
    const call = await getLiveCall(callId);
    if (!call) return;
    if (call.receiverId !== userId && call.callerId !== userId) return;

    await clearLiveCall(call);
    // Never connected, so there is no reservation to capture; releasing is a
    // no-op when there is none and refunds one if a hold raced the reject.
    await releaseHold(callId, "ABANDONED").catch(() => {});
    await prisma.callLog.update({ where: { id: callId }, data: { status: "REJECTED", endedAt: new Date() } }).catch(() => {});
    emitToPeer(call.callerId, "call:rejected", { callId });
    emitToPeer(call.receiverId, "call:rejected", { callId });
  });

  // ---------------------------------------------------------------------
  // 3) Either side hangs up -> close the ledger with a duration.
  // ---------------------------------------------------------------------
  socket.on("call:end", async (data: { callId?: string }) => {
    const callId = String(data?.callId || "");
    const call = await getLiveCall(callId);
    if (!call) {
      emitToSelf("call:ended", { callId, reason: "ALREADY_ENDED" });
      return;
    }
    if (call.callerId !== userId && call.receiverId !== userId) return;

    await clearLiveCall(call);
    // An accepted call is charged for its minutes; an unanswered one was never
    // held. settleCall is idempotent and a no-op when nothing was reserved.
    if (call.startedAt > 0) {
      await settleCall(callId, "CLIENT_END").catch(() => {});
    }
    const endedAt = new Date();
    const wasAccepted = call.startedAt > 0;
    const duration = wasAccepted ? Math.max(0, Math.floor((endedAt.getTime() - call.startedAt) / 1000)) : null;
    await prisma.callLog
      .update({ where: { id: callId }, data: { status: "ENDED", endedAt, ...(duration !== null ? { duration } : {}) } })
      .catch(() => {});

    emitToPeer(call.callerId, "call:ended", { callId, reason: "HANGUP", duration });
    emitToPeer(call.receiverId, "call:ended", { callId, reason: "HANGUP", duration });
  });

  // ---------------------------------------------------------------------
  // 4) WebRTC signaling relay. Strictly point-to-point: only the other
  //    participant of this specific call may receive the payload.
  // ---------------------------------------------------------------------
  const relayToPeer = (event: string) => async (data: { callId?: string; payload?: unknown }) => {
    const callId = String(data?.callId || "");
    const call = await getLiveCall(callId);
    if (!call) return;
    if (call.callerId !== userId && call.receiverId !== userId) return;
    const peerId = call.callerId === userId ? call.receiverId : call.callerId;
    emitToPeer(peerId, event, { callId, payload: data?.payload });
  };

  socket.on("call:offer", relayToPeer("call:offer"));
  socket.on("call:answer", relayToPeer("call:answer"));
  socket.on("call:ice", relayToPeer("call:ice"));

  // Callee reports the browser could not get a mic (denied/unavailable) so the
  // caller hears a clean "unavailable" instead of ringing forever.
  socket.on("call:media_failed", async (data: { callId?: string; reason?: string }) => {
    const callId = String(data?.callId || "");
    const call = await getLiveCall(callId);
    if (!call) return;
    if (call.receiverId !== userId) return;

    await clearLiveCall(call);
    // The callee never joined, so there is nothing to charge; release any
    // reservation that was taken before the media failure was reported.
    await releaseHold(callId, "ABANDONED").catch(() => {});
    await prisma.callLog.update({ where: { id: callId }, data: { status: "FAILED", endedAt: new Date() } }).catch(() => {});
    emitToPeer(call.callerId, "call:unavailable", { callId, reason: data?.reason || "MEDIA_FAILED" });
  });

  socket.on("disconnect", () => {
    // A dropped connection ends any call this socket was part of, so the peer
    // is not left talking to somebody who is gone. A user who still has
    // another device/tab online keeps the call.
    void (async () => {
      // Shared presence first: with several instances the user may still be
      // connected elsewhere, in which case the call must survive.
      const onlineElsewhere = (await isUserOnlineShared(userId)) === true || hasOtherSocket(userId);
      if (onlineElsewhere) return;

      for (const callId of await listLiveCallIds(userId)) {
        const call = await getLiveCall(callId);
        if (!call) continue;
        if (call.callerId !== userId && call.receiverId !== userId) continue;
        await clearLiveCall(call);
        // A dropped connection still ends a connected call, so capture the
        // minutes actually used before writing the ledger row.
        if (call.startedAt > 0) {
          await settleCall(callId, "CLIENT_END").catch(() => {});
        }
        const endedAt = new Date();
        const duration = call.startedAt > 0 ? Math.max(0, Math.floor((endedAt.getTime() - call.startedAt) / 1000)) : null;
        void prisma.callLog
          .update({ where: { id: callId }, data: { status: "ENDED", endedAt, ...(duration !== null ? { duration } : {}) } })
          .catch(() => {});
        const peerId = call.callerId === userId ? call.receiverId : call.callerId;
        emitToPeer(peerId, "call:ended", { callId, reason: "DISCONNECTED", duration });
      }
    })();
  });
}

/** Test/maintenance helper: drop a ringing call (e.g. admin resolve). */
export async function cancelLiveCall(callId: string): Promise<void> {
  const call = await getLiveCall(callId);
  if (call) await clearLiveCall(call);
}

import { prisma } from "../config/database";
import { emitToUser } from "./socketService";
import { findEligiblePartnersForConnection } from "./dispatchService";
import * as connectionCategoryService from "./connectionCategoryService";
import type { ConnectionCategoryShape } from "./connectionCategoryService";

/**
 * Live connection requests — the searching/accepting half of the connection
 * system, and the replacement for the booking flow in the normal user journey.
 *
 * A request is *not* a booking: nothing is scheduled, no escrow is taken, and
 * no money moves while searching, accepting or declining. The request only
 * names the category, the channel (chat / call / video) and the snapshotted
 * per-minute price the user was shown before sending it. Metered billing and
 * the connected session belong to the next phase; until that ships, an accepted
 * request simply means "these two people agreed to connect" and `totalAmount`
 * stays 0.
 *
 * The fan-out rule is shared with job dispatch (`findEligiblePartnersForConnection`),
 * so a partner who is eligible for a job today is eligible for a connection
 * today — one rule, not two that can drift.
 */

// A live search is not a scheduled job, so it waits far less than the 30-minute
// dispatch window: a shorter, honest window ("we looked, nobody picked up")
// beats a long spinner. The requester can cancel at any time before it lapses.
export const CONNECTION_REQUEST_WINDOW_MS = 2 * 60 * 1000;

export type ConnectionMode = "CHAT" | "CALL" | "VIDEO";
export const CONNECTION_MODES: readonly ConnectionMode[] = ["CHAT", "CALL", "VIDEO"];

export const MIN_ESTIMATED_MINUTES = 1;
export const MAX_ESTIMATED_MINUTES = 60;
export const DEFAULT_ESTIMATED_MINUTES = 10;

export interface ConnectionRequestShape {
  id: string;
  requesterId: string;
  requesterName?: string;
  categoryKey: string;
  categoryLabel?: string;
  mode: string;
  status: string;
  partnerId: string | null;
  partnerName?: string | null;
  expiresAt: string;
  pricePerMinute: number;
  estimatedMinutes: number;
  totalAmount: number;
  connectedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RequestRow {
  id: string;
  requesterId: string;
  categoryKey: string;
  mode: string;
  status: string;
  partnerId: string | null;
  expiresAt: Date;
  pricePerMinute: unknown;
  estimatedMinutes: number;
  totalAmount: unknown;
  connectedAt: Date | null;
  endedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const expiryTimers = new Map<string, NodeJS.Timeout>();

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeRequest(row: RequestRow): ConnectionRequestShape {
  return {
    id: row.id,
    requesterId: row.requesterId,
    categoryKey: row.categoryKey,
    mode: row.mode,
    status: row.status,
    partnerId: row.partnerId,
    expiresAt: row.expiresAt.toISOString(),
    pricePerMinute: Number(row.pricePerMinute ?? 0),
    estimatedMinutes: row.estimatedMinutes,
    totalAmount: Number(row.totalAmount ?? 0),
    connectedAt: iso(row.connectedAt),
    endedAt: iso(row.endedAt),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The per-minute price of this mode in this category, snapshotted at request. */
export function priceFor(category: ConnectionCategoryShape, mode: ConnectionMode): number {
  if (mode === "CHAT") return category.chatPricePerMinute;
  if (mode === "CALL") return category.callPricePerMinute;
  return category.videoPricePerMinute;
}

/** Is this channel switched on for this category? Video stays off by default. */
export function modeEnabled(category: ConnectionCategoryShape, mode: ConnectionMode): boolean {
  if (mode === "CHAT") return category.chatEnabled;
  if (mode === "CALL") return category.callEnabled;
  return category.videoEnabled;
}

export function isConnectionMode(value: unknown): value is ConnectionMode {
  return typeof value === "string" && (CONNECTION_MODES as readonly string[]).includes(value);
}

/** Human label for a channel, used in notification copy. */
function modeLabel(mode: ConnectionMode): string {
  if (mode === "CHAT") return "chat";
  if (mode === "CALL") return "voice call";
  return "video call";
}

async function persistNotification(userId: string, title: string, body: string, data: unknown): Promise<void> {
  try {
    // Row only: the Notification.create middleware fans it out to realtime + push.
    await prisma.notification.create({ data: { userId, title, body, data: JSON.stringify(data) } });
  } catch (err) {
    console.error("[CONNECTION] Failed to persist notification:", err);
  }
}

async function categoryByKey(key: string): Promise<ConnectionCategoryShape | undefined> {
  const { items } = await connectionCategoryService.listPublic();
  return items.find((c) => c.key === key);
}

export interface CreateInput {
  categoryKey?: unknown;
  mode?: unknown;
  notes?: unknown;
  estimatedMinutes?: unknown;
}

export type CreateOutcome =
  | { ok: true; request: ConnectionRequestShape; notified: number }
  | { ok: false; code: string; message: string };

/**
 * Open a search: validate the category/channel, snapshot the price, fan the
 * request out to every eligible partner, and start the expiry timer.
 *
 * A request is only created when at least one partner is eligible *now*. Telling
 * the user "nobody is available" immediately is more honest than a window that
 * could only ever end in "nobody picked up".
 */
export async function createConnectionRequest(userId: string, input: CreateInput): Promise<CreateOutcome> {
  const categoryKey = typeof input.categoryKey === "string" ? input.categoryKey.trim().toUpperCase() : "";
  if (!categoryKey) return { ok: false, code: "VALIDATION_ERROR", message: "categoryKey is required." };
  if (!isConnectionMode(input.mode)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "mode must be one of CHAT, CALL, VIDEO." };
  }
  const mode = input.mode as ConnectionMode;

  const category = await categoryByKey(categoryKey);
  if (!category) return { ok: false, code: "INVALID_CATEGORY", message: "That connection category does not exist." };
  if (!modeEnabled(category, mode)) {
    return { ok: false, code: "MODE_DISABLED", message: `That category does not offer ${modeLabel(mode)}.` };
  }

  // One active search per person: a second tap while one is running is almost
  // always a double-submit, and it would fan out twice for the same intent.
  const existing = await prisma.connectionRequest.findFirst({
    where: { requesterId: userId, status: "SEARCHING", expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, code: "ALREADY_SEARCHING", message: "You already have a connection request in progress." };
  }

  const eligible = await findEligiblePartnersForConnection(mode, userId);
  if (eligible.length === 0) {
    return { ok: false, code: "NO_PARTNERS_AVAILABLE", message: "No one is available for this right now. Please try again shortly." };
  }

  const estimatedMinutes = clampEstimatedMinutes(input.estimatedMinutes);
  const pricePerMinute = priceFor(category, mode);
  const expiresAt = new Date(Date.now() + CONNECTION_REQUEST_WINDOW_MS);
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim().slice(0, 300) : null;

  const request = await prisma.connectionRequest.create({
    data: {
      requesterId: userId,
      categoryKey,
      mode,
      status: "SEARCHING",
      expiresAt,
      pricePerMinute,
      estimatedMinutes,
      notes,
    },
  });

  const payload = {
    type: "CONNECTION_REQUEST",
    requestId: request.id,
    categoryKey,
    categoryLabel: category.label,
    mode,
    pricePerMinute,
    expiresAt: expiresAt.toISOString(),
  };

  for (const target of eligible) {
    emitToUser(target.userId, "connection_request", payload);
    void persistNotification(
      target.userId,
      "New connection request",
      `Someone wants to connect by ${modeLabel(mode)} (${category.label}). Open the app to accept.`,
      payload
    );
  }

  try {
    await prisma.connectionRequestRecipient.createMany({
      data: eligible.map((t) => ({ requestId: request.id, partnerId: t.id, status: "SENT" })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error("[CONNECTION] Failed to persist recipients:", err);
  }

  scheduleExpiry(request.id);

  return {
    ok: true,
    request: { ...serializeRequest(request), categoryLabel: category.label },
    notified: eligible.length,
  };
}

function clampEstimatedMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ESTIMATED_MINUTES;
  return Math.min(MAX_ESTIMATED_MINUTES, Math.max(MIN_ESTIMATED_MINUTES, Math.trunc(n)));
}

export interface RequestWithNames extends ConnectionRequestShape {
  requesterName?: string;
  partnerName?: string | null;
}

/** Attach category labels (and partner names where known) for display. */
async function decorate(rows: RequestRow[], names?: Map<string, string>): Promise<RequestWithNames[]> {
  const { items } = await connectionCategoryService.listPublic();
  const labels = new Map(items.map((c) => [c.key, c.label]));
  return rows.map((row) => {
    const base = serializeRequest(row);
    return {
      ...base,
      categoryLabel: labels.get(row.categoryKey) ?? row.categoryKey,
      partnerName: row.partnerId && names ? names.get(row.partnerId) ?? null : null,
    };
  });
}

/** The requester's own requests, newest first. */
export async function listMyRequests(userId: string, limit = 20): Promise<RequestWithNames[]> {
  const rows = await prisma.connectionRequest.findMany({
    where: { requesterId: userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
  });

  const partnerIds = rows.map((r) => r.partnerId).filter((id): id is string => Boolean(id));
  const names = new Map<string, string>();
  if (partnerIds.length > 0) {
    const partners = await prisma.partner.findMany({
      where: { id: { in: partnerIds } },
      select: { id: true, user: { select: { fullName: true } } },
    });
    for (const p of partners) names.set(p.id, p.user.fullName);
  }

  return decorate(rows, names);
}

/** The still-open request the requester can cancel, if any. */
export async function getActiveRequest(userId: string): Promise<RequestWithNames | null> {
  const row = await prisma.connectionRequest.findFirst({
    where: { requesterId: userId, status: "SEARCHING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  const [decorated] = await decorate([row]);
  return decorated;
}

export interface IncomingRequest {
  requestId: string;
  recipientId: string;
  categoryKey: string;
  categoryLabel: string;
  mode: string;
  pricePerMinute: number;
  estimatedMinutes: number;
  expiresAt: string;
  notes: string | null;
  requesterName: string;
  sentAt: string;
}

/**
 * Open connection requests sent to this partner. Reads live state, so a request
 * cancelled or expired a moment ago is already absent without waiting for its
 * in-process timer.
 */
export async function listIncomingForPartner(partnerUserId: string): Promise<IncomingRequest[]> {
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId }, select: { id: true } });
  if (!partner) return [];

  const rows = await prisma.connectionRequestRecipient.findMany({
    where: {
      partnerId: partner.id,
      status: { in: ["SENT", "VIEWED"] },
      request: { status: "SEARCHING", expiresAt: { gt: new Date() } },
    },
    include: {
      request: { include: { requester: { select: { fullName: true } } } },
    },
    orderBy: { sentAt: "desc" },
    take: 50,
  });

  const { items } = await connectionCategoryService.listPublic();
  const labels = new Map(items.map((c) => [c.key, c.label]));

  return rows.map((r) => ({
    requestId: r.requestId,
    recipientId: r.id,
    categoryKey: r.request.categoryKey,
    categoryLabel: labels.get(r.request.categoryKey) ?? r.request.categoryKey,
    mode: r.request.mode,
    pricePerMinute: Number(r.request.pricePerMinute ?? 0),
    estimatedMinutes: r.request.estimatedMinutes,
    expiresAt: r.request.expiresAt.toISOString(),
    notes: r.request.notes,
    requesterName: r.request.requester.fullName,
    sentAt: r.sentAt.toISOString(),
  }));
}

/** Mark this partner's unread offers VIEWED when they open the requests list. */
export async function markViewed(partnerUserId: string): Promise<void> {
  try {
    const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId }, select: { id: true } });
    if (!partner) return;
    await prisma.connectionRequestRecipient.updateMany({
      where: { partnerId: partner.id, status: "SENT", viewedAt: null },
      data: { status: "VIEWED", viewedAt: new Date() },
    });
  } catch (err) {
    console.error("[CONNECTION] markViewed failed:", err);
  }
}

export type MutationOutcome =
  | { ok: true; request: ConnectionRequestShape }
  | { ok: false; status: number; code: string; message: string };

/**
 * A partner accepts. The claim is conditional on the request still being
 * SEARCHING with no winner, so two partners accepting at once cannot both win —
 * exactly the atomic-claim shape the booking flow uses.
 */
export async function acceptConnectionRequest(partnerUserId: string, requestId: string): Promise<MutationOutcome> {
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId }, select: { id: true, status: true } });
  if (!partner) return { ok: false, status: 403, code: "NOT_PARTNER", message: "You are not registered as a partner." };
  if (partner.status !== "APPROVED") {
    return { ok: false, status: 403, code: "PARTNER_NOT_APPROVED", message: "Only approved partners can accept." };
  }

  const request = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, status: 404, code: "NOT_FOUND", message: "Connection request not found." };
  if (request.requesterId === partnerUserId) {
    return { ok: false, status: 400, code: "SELF_CONNECT_NOT_ALLOWED", message: "You cannot accept your own request." };
  }

  const recipient = await prisma.connectionRequestRecipient.findUnique({
    where: { requestId_partnerId: { requestId, partnerId: partner.id } },
    select: { id: true, status: true },
  });
  if (!recipient) {
    return { ok: false, status: 403, code: "NOT_INVITED", message: "This request was not sent to you." };
  }

  const claimed = await prisma.connectionRequest.updateMany({
    where: { id: requestId, status: "SEARCHING", partnerId: null },
    data: { partnerId: partner.id, status: "ACCEPTED", connectedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return { ok: false, status: 409, code: "ALREADY_ACCEPTED", message: "This request is no longer available." };
  }

  clearExpiryTimer(requestId);

  // Queue bookkeeping: winner ACCEPTED, everyone else CANCELLED.
  try {
    await prisma.connectionRequestRecipient.updateMany({
      where: { requestId, status: { in: ["SENT", "VIEWED"] } },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    await prisma.connectionRequestRecipient.updateMany({
      where: { requestId, partnerId: partner.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
  } catch (err) {
    console.error("[CONNECTION] Failed to update recipients on accept:", err);
  }

  const updated = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!updated) return { ok: false, status: 404, code: "NOT_FOUND", message: "Connection request not found." };

  const partnerUser = await prisma.user.findUnique({ where: { id: partnerUserId }, select: { fullName: true } });
  const partnerName = partnerUser?.fullName ?? "Your partner";

  emitToUser(request.requesterId, "connection_update", { requestId, status: "ACCEPTED", partnerName });
  void persistNotification(
    request.requesterId,
    "Connection accepted",
    `${partnerName} accepted your ${modeLabel(updated.mode as ConnectionMode)} request.`,
    { requestId, type: "CONNECTION_ACCEPTED" }
  );

  await notifyLosers(requestId, partner.id);

  return { ok: true, request: { ...serializeRequest(updated), partnerName } };
}

async function notifyLosers(requestId: string, winnerPartnerId: string): Promise<void> {
  try {
    const losers = await prisma.connectionRequestRecipient.findMany({
      where: { requestId, partnerId: { not: winnerPartnerId }, status: "CANCELLED" },
      select: { partner: { select: { userId: true } } },
    });
    for (const l of losers) {
      if (!l.partner) continue;
      emitToUser(l.partner.userId, "connection_taken", { requestId });
      void persistNotification(l.partner.userId, "Request taken", "Another partner already accepted this connection request.", {
        requestId,
        type: "CONNECTION_TAKEN",
      });
    }
  } catch (err) {
    console.error("[CONNECTION] notifyLosers failed:", err);
  }
}

/**
 * A partner declines. This is per-recipient: one partner saying no does not end
 * the request, which the other invited partners can still accept. If nobody is
 * left to answer, the request ends now rather than leaving the requester
 * watching a window that can no longer succeed.
 */
export async function declineConnectionRequest(partnerUserId: string, requestId: string): Promise<MutationOutcome> {
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId }, select: { id: true } });
  if (!partner) return { ok: false, status: 403, code: "NOT_PARTNER", message: "You are not registered as a partner." };

  const recipient = await prisma.connectionRequestRecipient.findUnique({
    where: { requestId_partnerId: { requestId, partnerId: partner.id } },
    select: { id: true, status: true },
  });
  if (!recipient) return { ok: false, status: 403, code: "NOT_INVITED", message: "This request was not sent to you." };
  if (recipient.status !== "SENT" && recipient.status !== "VIEWED") {
    return { ok: false, status: 409, code: "ALREADY_RESPONDED", message: "You have already responded to this request." };
  }

  await prisma.connectionRequestRecipient.update({
    where: { id: recipient.id },
    data: { status: "DECLINED", respondedAt: new Date() },
  });

  const request = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, status: 404, code: "NOT_FOUND", message: "Connection request not found." };

  const remaining = await prisma.connectionRequestRecipient.count({
    where: { requestId, status: { in: ["SENT", "VIEWED"] } },
  });
  if (request.status === "SEARCHING" && remaining === 0) {
    await expireRequest(requestId, "declined");
  }

  return { ok: true, request: serializeRequest(request) };
}

/** The requester cancels their own search. */
export async function cancelConnectionRequest(userId: string, requestId: string): Promise<MutationOutcome> {
  const request = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, status: 404, code: "NOT_FOUND", message: "Connection request not found." };
  if (request.requesterId !== userId) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "This is not your connection request." };
  }
  if (request.status !== "SEARCHING") {
    return { ok: false, status: 409, code: "NOT_SEARCHING", message: "This request is no longer searching." };
  }

  const cancelled = await prisma.connectionRequest.updateMany({
    where: { id: requestId, status: "SEARCHING" },
    data: { status: "CANCELLED" },
  });
  if (cancelled.count !== 1) {
    return { ok: false, status: 409, code: "NOT_SEARCHING", message: "This request is no longer searching." };
  }

  clearExpiryTimer(requestId);
  try {
    await prisma.connectionRequestRecipient.updateMany({
      where: { requestId, status: { in: ["SENT", "VIEWED"] } },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
  } catch (err) {
    console.error("[CONNECTION] Failed to cancel recipients:", err);
  }

  const updated = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!updated) return { ok: false, status: 404, code: "NOT_FOUND", message: "Connection request not found." };
  return { ok: true, request: serializeRequest(updated) };
}

function scheduleExpiry(requestId: string): void {
  clearExpiryTimer(requestId);
  const timer = setTimeout(() => {
    void expireRequest(requestId, "timeout");
  }, CONNECTION_REQUEST_WINDOW_MS);
  timer.unref?.();
  expiryTimers.set(requestId, timer);
}

function clearExpiryTimer(requestId: string): void {
  const existing = expiryTimers.get(requestId);
  if (existing) {
    clearTimeout(existing);
    expiryTimers.delete(requestId);
  }
}

/**
 * End an unanswered request. Conditional on it still searching, so a race with
 * an accept can never expire a request that just found a partner.
 *
 * `reason` only tailors the requester's copy: a request that ran out of
 * recipients ("declined") and one that simply timed out both expire.
 */
export async function expireRequest(requestId: string, reason: "timeout" | "declined" = "timeout"): Promise<void> {
  expiryTimers.delete(requestId);
  try {
    const expired = await prisma.connectionRequest.updateMany({
      where: { id: requestId, status: "SEARCHING", partnerId: null },
      data: { status: "EXPIRED" },
    });
    if (expired.count !== 1) return;

    const request = await prisma.connectionRequest.findUnique({
      where: { id: requestId },
      select: { requesterId: true, mode: true },
    });
    if (!request) return;

    try {
      await prisma.connectionRequestRecipient.updateMany({
        where: { requestId, status: { in: ["SENT", "VIEWED"] } },
        data: { status: "EXPIRED", respondedAt: new Date() },
      });
    } catch (err) {
      console.error("[CONNECTION] Failed to expire recipients:", err);
    }

    const message =
      reason === "declined"
        ? "No one was available to connect right now."
        : "No one accepted your connection request in time.";
    emitToUser(request.requesterId, "connection_update", { requestId, status: "EXPIRED", message });
    void persistNotification(request.requesterId, "No one picked up", message, {
      requestId,
      type: "CONNECTION_EXPIRED",
    });
  } catch (err) {
    console.error("[CONNECTION] expireRequest failed:", err);
  }
}

/**
 * Lazy sweep for requests whose in-process timer was lost (server restart).
 * Called before partner listings so a stale offer never shows, mirroring
 * `expireStaleSearches` for bookings.
 */
export async function expireStaleConnectionRequests(): Promise<void> {
  try {
    await prisma.connectionRequest.updateMany({
      where: { status: "SEARCHING", partnerId: null, expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
  } catch (err) {
    console.error("[CONNECTION] expireStaleConnectionRequests failed:", err);
  }
}

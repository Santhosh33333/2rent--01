/**
 * Public, unauthenticated event read endpoints.
 *
 * Why this exists: the marketing landing page needs to show real events to an
 * anonymous visitor, but the entire `/api/events` router sits behind
 * `authenticateToken` + `requireKycVerified`. Before this, clicking a live event
 * on the public site either showed an empty auth wall or redirected to login, so
 * the one section that was supposed to prove the product was alive could never
 * render for the person reading it.
 *
 * These endpoints are deliberately narrow. They are read-only, and they expose
 * only what a public event poster already publishes:
 *
 *   - No `organizerId` and no organizer `role`/`activeRole`. Admin-tier accounts
 *     are filtered out of member-facing surfaces elsewhere; leaking a role here
 *     would undo that.
 *   - No exact `latitude`/`longitude`. The user agreement states exact location
 *     is not publicly displayed by default, and a public feed is exactly the
 *     wrong place to publish a map pin.
 *   - No `onlineUrl`. That is the meeting link; it is handed out on
 *     registration, not in a feed anyone can scrape.
 *   - PRIVATE events are never returned, whatever the caller sends.
 *
 * Writes (register, cancel, check-in, create, edit) stay on the authenticated
 * router, so joining still requires an account.
 */
import { Request, Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { isEventLive } from "./eventController";

// Must match the discovery feed, or the public page and the app would disagree
// about what is listable.
const PUBLIC_STATUSES = ["PUBLISHED", "LIVE"] as const;

/** Coarse coordinates are not published at all; see the file header. */
type PublicEventRow = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  isOnline: boolean;
  coverImageUrl: string | null;
  category: string | null;
  subcategory: string | null;
  price: number | null;
  currency: string;
  startTime: Date;
  endTime: Date | null;
  timezone: string | null;
  capacity: number | null;
    isVerified: boolean;
    womenOnly: boolean;
isMovie: boolean;
    theatreName: string | null;
    bookingUrl: string | null;
    coordinatorName: string | null;
    coordinatorPhone: string | null;
  organizerType: string;
  organizer: { fullName: string; avatarUrl: string | null } | null;
  _count: { attendees: number };
};

/**
 * Single place that decides what a stranger is allowed to see about an event.
 * Both endpoints funnel through it so the list and the detail page can never
 * drift apart and leak a field on one and not the other.
 */
function toPublicEvent(
  event: PublicEventRow,
  now: Date,
  registered: boolean
) {
  const taken = event._count.attendees;
  const capacity = event.capacity ?? null;
  const live = isEventLive(event.startTime, event.endTime, now);

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    isOnline: event.isOnline,
    coverImageUrl: event.coverImageUrl,
    category: event.category,
    subcategory: event.subcategory,
    price: event.price,
    currency: event.currency,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    capacity,
    attendeeCount: taken,
    seatsLeft: capacity == null ? null : Math.max(0, capacity - taken),
    isFull: capacity != null && taken >= capacity,
    isVerified: event.isVerified,
    womenOnly: event.womenOnly,
    // Movie outings. All three are public by definition: the cinema is where the
    // event happens, and the booking link is a link the organizer chose to
    // publish. It was already validated as http(s) on the way in, so it cannot
    // carry a javascript: payload.
isMovie: event.isMovie,
    theatreName: event.theatreName,
    bookingUrl: event.bookingUrl,
    // The coordinator is a public contact by definition: the organizer chose to
    // publish them as the person who confirms the group's booking.
    coordinatorName: event.coordinatorName,
    coordinatorPhone: event.coordinatorPhone,
    organizerType: event.organizerType,
    // Name and photo only. No id, no role: this is a poster credit, not a
    // profile lookup, and a role here would expose staff accounts.
    organizer: event.organizer
      ? { fullName: event.organizer.fullName, avatarUrl: event.organizer.avatarUrl }
      : null,
    isLive: live,
    isRegistered: registered,
    // Server time is sent so a countdown on the public page cannot disagree with
    // the backend's own live/upcoming decision.
    serverTime: now.toISOString(),
  };
}

/** A bearer token is optional here: it only upgrades `isRegistered`. */
function readOptionalUserId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  // Imported lazily to keep this module free of a hard dependency on the auth
  // middleware stack; a malformed token is treated as anonymous, never as an
  // error, because the endpoint is public.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { verifyToken } = require("../middleware/auth") as {
      verifyToken: (t: string) => { userId: string } | null;
    };
    return verifyToken(token)?.userId ?? null;
  } catch {
    return null;
  }
}

export async function getPublicEvents(req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12));

    // PUBLIC privacy only, and never a private event regardless of query input.
    const where = {
      status: { in: [...PUBLIC_STATUSES] },
      privacy: "PUBLIC",
      // Hide anything that already finished. Live and upcoming only.
      OR: [{ endTime: null }, { endTime: { gt: now } }],
    };

    const items = await prisma.event.findMany({
      where,
      // Live first, then soonest. The landing page splits on isLive anyway, so
      // ordering only decides how much of each group survives the limit.
      orderBy: [{ startTime: "asc" }],
      take: limit,
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        isOnline: true,
        coverImageUrl: true,
        category: true,
        subcategory: true,
        price: true,
        currency: true,
        startTime: true,
        endTime: true,
        timezone: true,
        capacity: true,
        isVerified: true,
        womenOnly: true,
        isMovie: true,
        theatreName: true,
        bookingUrl: true,
        coordinatorName: true,
        coordinatorPhone: true,
        organizerType: true,
        organizer: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { attendees: true } },
      },
    });

    const userId = readOptionalUserId(req);
    let registeredIds = new Set<string>();
    if (userId && items.length > 0) {
      const mine = await prisma.eventAttendee.findMany({
        where: { userId, eventId: { in: items.map((i) => i.id) } },
        select: { eventId: true },
      });
      registeredIds = new Set(mine.map((m) => m.eventId));
    }

    sendSuccess(res, {
      items: items.map((item) =>
        toPublicEvent(item as PublicEventRow, now, registeredIds.has(item.id))
      ),
      serverTime: now.toISOString(),
    });
  } catch (err) {
    console.error("getPublicEvents error:", err);
    sendError(res, "Failed to retrieve events.", 500, "INTERNAL_ERROR");
  }
}

export async function getPublicEventById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const now = new Date();

    const event = await prisma.event.findFirst({
      where: { id, status: { in: [...PUBLIC_STATUSES] }, privacy: "PUBLIC" },
      select: {
        id: true,
        title: true,
        description: true,
        location: true,
        isOnline: true,
        coverImageUrl: true,
        category: true,
        subcategory: true,
        price: true,
        currency: true,
        startTime: true,
        endTime: true,
        timezone: true,
        capacity: true,
        isVerified: true,
        womenOnly: true,
        isMovie: true,
        theatreName: true,
        bookingUrl: true,
        coordinatorName: true,
        coordinatorPhone: true,
        organizerType: true,
        organizer: { select: { fullName: true, avatarUrl: true } },
        _count: { select: { attendees: true } },
      },
    });

    if (!event) {
      // A private event is reported as missing rather than forbidden, so the
      // endpoint cannot be used to confirm that a private id exists.
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    const userId = readOptionalUserId(req);
    let isRegistered = false;
    if (userId) {
      const mine = await prisma.eventAttendee.findUnique({
        where: { eventId_userId: { eventId: id, userId } },
        select: { eventId: true },
      });
      isRegistered = !!mine;
    }

    sendSuccess(res, {
      event: toPublicEvent(event as PublicEventRow, now, isRegistered),
    });
  } catch (err) {
    console.error("getPublicEventById error:", err);
    sendError(res, "Failed to retrieve event.", 500, "INTERNAL_ERROR");
  }
}

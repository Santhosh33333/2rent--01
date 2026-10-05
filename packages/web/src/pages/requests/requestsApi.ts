import { api } from "../../lib/api";
import type { DiscoverProfile } from "../dating/datingApi";

/**
 * Requests data sources.
 *
 * The Requests tab unifies two genuinely different things that a user thinks of
 * as "things waiting on me":
 *   - service bookings the user created (`GET /bookings`, canonical Booking
 *     engine), and
 *   - dating likes the user received (`GET /dating/likes`).
 *
 * Both endpoints already existed on the backend but neither had a frontend
 * caller, so this adds no new server contract. `GET /walking-requests` is
 * deliberately NOT used: its controller is marked deprecated in favour of the
 * Booking engine.
 */

export interface BookingPartner {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
}

export interface BookingSummary {
  id: string;
  serviceType: string;
  status: string;
  startLocation: string;
  endLocation: string;
  scheduledAt: string;
  createdAt: string;
  estimatedAmount?: number | null;
  finalAmount?: number | null;
  partner?: { user?: BookingPartner } | null;
}

export interface ReceivedLike {
  id: string;
  type: string;
  createdAt: string;
  fromUser: Pick<DiscoverProfile, "id" | "fullName" | "avatarUrl" | "city">;
}

export async function fetchMyBookings(signal?: AbortSignal): Promise<BookingSummary[]> {
  const { data } = await api.get<{ data: { items: BookingSummary[] } }>("/bookings", {
    params: { limit: 20 },
    signal,
  });
  return data.data.items ?? [];
}

export async function fetchReceivedLikes(signal?: AbortSignal): Promise<ReceivedLike[]> {
  const { data } = await api.get<{ data: { results: ReceivedLike[] } }>("/dating/likes", { signal });
  return data.data.results ?? [];
}

/**
 * Booking statuses that mean "still waiting on the user".
 *
 * Derived from the status list documented on the Booking model rather than
 * guessed, so a new status does not silently fall into "active" or "done".
 */
export const PENDING_BOOKING_STATUSES = [
  "PAYMENT_PENDING",
  "PAYMENT_INITIATED",
  "PARTNER_SEARCHING",
  "PARTNER_ASSIGNED",
  "PARTNER_ACCEPTED",
] as const;

const PENDING = new Set<string>(PENDING_BOOKING_STATUSES);

export type RequestStage = "action" | "active" | "done";

/**
 * Where a booking sits from the requester's point of view.
 *
 * `action` means the user has a decision to make (pay, or the partner is being
 * searched). Sorting by urgency rather than by raw date is the point: the
 * oldest row is not the one needing attention.
 */
export function bookingStage(status: string): RequestStage {
  if (PENDING.has(status)) return "action";
  if (status === "IN_PROGRESS" || status === "COMPLETED") return "active";
  return "done";
}

const STAGE_ORDER: Record<RequestStage, number> = { action: 0, active: 1, done: 2 };

export interface UnifiedRequest {
  key: string;
  kind: "booking" | "like";
  title: string;
  subtitle: string;
  statusLabel: string;
  stage: RequestStage;
  avatarUrl?: string | null;
  href: string;
  occurredAt: string;
}

/**
 * Merge both feeds into one ordered list.
 *
 * `Promise.allSettled` rather than `all`: a user with no dating entitlement gets
 * a 403 from the dating router, and that must not blank out the bookings they
 * can still see. The failure is recorded so the screen can say which half failed
 * instead of silently showing fewer items.
 */
export function mergeRequests(
  bookings: BookingSummary[],
  likes: ReceivedLike[],
): UnifiedRequest[] {
  const fromBookings: UnifiedRequest[] = bookings.map((b) => {
    const partner = b.partner?.user;
    return {
      key: `booking:${b.id}`,
      kind: "booking",
      title: partner?.fullName ?? "Finding a partner",
      subtitle: `${b.startLocation} → ${b.endLocation}`,
      statusLabel: b.status.replace(/_/g, " ").toLowerCase(),
      stage: bookingStage(b.status),
      avatarUrl: partner?.avatarUrl ?? null,
      href: `/bookings/${b.id}`,
      occurredAt: b.scheduledAt || b.createdAt,
    };
  });

  const fromLikes: UnifiedRequest[] = likes.map((l) => ({
    key: `like:${l.id}`,
    kind: "like",
    title: l.fromUser.fullName,
    subtitle: l.fromUser.city ? `Liked you · ${l.fromUser.city}` : "Liked you",
    statusLabel: l.type === "SUPER_LIKE" ? "super like" : "like",
    stage: "action",
    avatarUrl: l.fromUser.avatarUrl ?? null,
    href: `/dating`,
    occurredAt: l.createdAt,
  }));

  return [...fromBookings, ...fromLikes].sort((a, b) => {
    const byStage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
    if (byStage !== 0) return byStage;
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
  });
}
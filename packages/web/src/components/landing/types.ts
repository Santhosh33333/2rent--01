/**
 * Public landing-page data contracts.
 *
 * Shared so the hero cluster and the events section cannot drift into reading
 * different shapes out of the same `/public/events` payload.
 */

export interface LandingEvent {
  id: string;
  title: string;
  category?: string | null;
  startTime: string;
  endTime?: string | null;
  location?: string | null;
  attendeeCount?: number | null;
  capacity?: number | null;
  price?: number | null;
  currency?: string | null;
  isOnline?: boolean;
  isVerified?: boolean;
  isLive?: boolean;
}

/**
 * The endpoint answers with `{ items }`, but older deployments that predate the
 * public route returned a bare array. Both are accepted so a stale backend
 * degrades to "no events" instead of throwing on `.items`.
 */
export function readEventItems(payload: unknown): LandingEvent[] {
  const data = (payload as { data?: unknown })?.data ?? payload;
  const maybeItems = (data as { items?: unknown })?.items;
  if (Array.isArray(maybeItems)) return maybeItems as LandingEvent[];
  if (Array.isArray(data)) return data as LandingEvent[];
  return [];
}
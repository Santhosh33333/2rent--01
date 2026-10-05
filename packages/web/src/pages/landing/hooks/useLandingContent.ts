/**
 * Live content for the landing page.
 *
 * ## The rule
 *
 * **Nothing on this page is invented.** Every title, price, date, name and
 * image rendered here came out of a request this file makes. Where an
 * endpoint needs a session the page does not pretend: it shows the copy and
 * sends the visitor to sign in.
 *
 * That matters more than it sounds. A sample event title on a live landing
 * page is indistinguishable from a real one, and the first person it misleads
 * is whoever owns the product.
 *
 * ## What an anonymous visitor can actually read
 *
 *   GET /public/events               real rows, real times, real counts
 *   GET /public/events/categories    the server's own taxonomy
 *   GET /public/movies/now-playing   proxied TMDB, or `configured: false`
 *   GET /subscriptions/plans         prices and `trialDays`, so the offer
 *                                    number is the seeded number
 *
 * Everything else - communities, dating profiles, people near you - sits
 * behind `authenticateToken`, and dating additionally needs KYC and a paid
 * window. Those hooks stay wired to the real endpoints and simply refuse to
 * fire without a session, so the section reports `gated` and renders an
 * explanation rather than a 401 the visitor can do nothing with.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, assetUrl } from '../../../lib/api';
import { isSignedIn } from '../../../lib/auth';

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  /** A real, readable failure message. Null while healthy. */
  error: string | null;
  reload: () => void;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

function useResource<T>(
  path: string | null,
  options: { params?: Record<string, unknown>; isPublic?: boolean } = {},
): Resource<T> {
  const { params, isPublic = false } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const paramsKey = JSON.stringify(params ?? null);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Held in a ref so a re-render from an unrelated cause cannot restart the
  // request; the effect depends on the URL shape and the nonce only.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<Envelope<T>>(path, {
        params: paramsRef.current,
        signal: controller.signal,
        timeout: 15000,
      })
      .then((res) => {
        if (cancelled) return;
        const body = res.data;
        if (body?.success === false) {
          setError(body.message || body.error || 'The server rejected this request.');
          setData(null);
          return;
        }
        // Some handlers nest under `data`, some put the payload at the top
        // level. Both are real server shapes; accept either rather than
        // silently rendering nothing.
        setData((body?.data ?? body) as T);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (isPublic && (status === 401 || status === 403)) {
          setError('This feed is only available to signed-in members.');
        } else if (status === 429) {
          setError('Too many requests just now. Try again in a moment.');
        } else if (status && status >= 500) {
          setError('The server had a problem. Try again shortly.');
        } else if (err instanceof Error && err.message) {
          setError(err.message);
        } else {
          setError('Could not reach the server.');
        }
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, paramsKey, nonce]);

  return { data, loading, error, reload };
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** Mirrors `toPublicEvent` in publicEventsController.ts. */
export interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  /** A venue or area name an organiser typed. Never a coordinate. */
  location: string | null;
  isOnline: boolean;
  coverImageUrl: string | null;
  category: string | null;
  subcategory: string | null;
  price: number | null;
  currency: string | null;
  startTime: string;
  endTime: string | null;
  timezone: string | null;
  capacity: number | null;
  attendeeCount: number;
  seatsLeft: number | null;
  isFull: boolean;
  isVerified: boolean;
  womenOnly: boolean;
  isMovie: boolean;
  theatreName: string | null;
  bookingUrl: string | null;
  coordinatorName: string | null;
  organizerType: string | null;
  organizer: { fullName: string; avatarUrl: string | null } | null;
  /** Decided by the backend from its own clock. Never recomputed here. */
  isLive: boolean;
  isRegistered: boolean;
  serverTime: string;
}

export interface PublicEventsPayload {
  items: PublicEvent[];
  serverTime: string;
}

export function usePublicEvents(limit = 6): Resource<PublicEventsPayload> {
  return useResource<PublicEventsPayload>('/public/events', {
    params: { limit },
    isPublic: true,
  });
}

/**
 * One row of the server's event taxonomy.
 *
 * `key` is what gets written to `Event.category` on create; `subcategories`
 * are the real strings the server accepts.
 */
export interface EventCategory {
  key: string;
  label: string;
  description?: string | null;
  icon?: string | null;
  coverImageUrl?: string | null;
  sortOrder: number;
  enabled: boolean;
  subcategories: string[];
  /** True only for the synthetic "All Events" row the server prepends. */
  isPseudo?: boolean;
}

/** The endpoint answers `{ success, data: { categories: [...] } }`. */
export interface EventCategoriesPayload {
  categories: EventCategory[];
}

export function useEventCategories(): Resource<EventCategoriesPayload> {
  return useResource<EventCategoriesPayload>('/public/events/categories', { isPublic: true });
}

/* ------------------------------------------------------------------ */
/* Movies                                                              */
/* ------------------------------------------------------------------ */

/** Mirrors `MovieSummary` in movieService.ts. */
export interface MovieSummary {
  id: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  originalLanguage: string | null;
  overview: string | null;
  bookingUrl: string;
}

export interface NowPlayingPayload {
  /** False when TMDB_API_KEY is unset. Say so; never fake a grid. */
  configured: boolean;
  locationAware?: boolean;
  nowPlaying: MovieSummary[];
  comingSoon: MovieSummary[];
  upcoming: MovieSummary[];
  /** True when upstream failed and this is the last good feed. */
  stale?: boolean;
  fetchedAt?: string;
}

export function useNowPlaying(): Resource<NowPlayingPayload> {
  return useResource<NowPlayingPayload>('/public/movies/now-playing', { isPublic: true });
}

/* ------------------------------------------------------------------ */
/* Pricing - the offer                                                 */
/* ------------------------------------------------------------------ */

export interface Plan {
  id: string;
  code: string;
  name: string;
  durationDays: number;
  price: number;
  currency: string;
  /**
   * The seeded trial length. The hero offer headline is built from this, so
   * the page says whatever the database says - one day today, and if an admin
   * changes it to seven the page says seven without a code change.
   */
  trialDays: number;
  displayOrder: number;
}

/**
 * `GET /subscriptions/plans` is mounted before `authenticateToken`
 * precisely so the paywall can render before login.
 */
export function usePlans(): Resource<{ plans: Plan[] }> {
  return useResource<{ plans: Plan[] }>('/subscriptions/plans', { isPublic: true });
}

/* ------------------------------------------------------------------ */
/* Gated feeds                                                         */
/* ------------------------------------------------------------------ */

export interface GatedResource<T> extends Resource<T> {
  /** True when the request was withheld because there is no session. */
  gated: boolean;
}

function useGatedResource<T>(path: string, params?: Record<string, unknown>): GatedResource<T> {
  const signedIn = isSignedIn();
  const res = useResource<T>(signedIn ? path : null, { params });
  return { ...res, gated: !signedIn };
}

export interface Community {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  city: string | null;
  category: string | null;
  privacy: string | null;
  memberCount: number;
  isMember: boolean;
  isOwner: boolean;
}

export interface CommunitiesPayload {
  items: Community[];
  page: number;
  limit: number;
  total: number;
}

/**
 * `/communities` runs `authenticateToken` across the whole router and reads
 * `req.user!.userId` to decide Join/Leave, so an anonymous call cannot work.
 * Reporting `gated` is more honest than surfacing the 401.
 */
export function useCommunities(limit = 6): GatedResource<CommunitiesPayload> {
  return useGatedResource<CommunitiesPayload>('/communities', { limit, page: 1 });
}

export interface DiscoverProfile {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  gender?: string | null;
  /** Computed server-side. The date of birth is deliberately not sent. */
  age?: number | null;
  language?: string | null;
  mobileVerified?: boolean;
  /** An approximate band like "1-5 km", never a precise distance. */
  distance?: string | null;
}

export interface DiscoverPayload {
  results?: DiscoverProfile[];
  items?: DiscoverProfile[];
}

/**
 * `/dating/discover` sits behind `authenticateToken` -> `requireKycVerified`
 * -> `requirePaidAccess`. Three different rejections, none of which should be
 * rendered as an error banner on a marketing page.
 */
export function useDiscoverProfiles(limit = 4): GatedResource<DiscoverPayload> {
  return useGatedResource<DiscoverPayload>('/dating/discover', { limit });
}

/* ------------------------------------------------------------------ */
/* Formatters - read server values, never assume them                  */
/* ------------------------------------------------------------------ */

/** Free renders as "Free"; a paid event uses the currency the server sent. */
export function formatPrice(price: number | null, currency: string | null): string | null {
  if (price === null || price === undefined) return null;
  if (price === 0) return 'Free';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: price % 1 === 0 ? 0 : 2,
    }).format(price);
  } catch {
    // An unrecognised currency code must not blank the card.
    return `${price} ${currency ?? ''}`.trim();
  }
}

export function formatPlanPrice(plan: Plan): string {
  return formatPrice(plan.price, plan.currency) ?? `${plan.price}`;
}

/** "Sat 4 Oct, 7:30 pm" in the viewer's locale, from the server's timestamp. */
export function formatEventDate(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone ?? undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }
}

export function formatReleaseDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** First letters of a real name, for the avatar placeholder. */
export function initialsOf(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** Resolves a server image path to something an `<img>` can load. */
export function imageUrl(path?: string | null): string | null {
  const resolved = assetUrl(path);
  return resolved ?? null;
}

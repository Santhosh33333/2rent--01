import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { NOT_PRIVILEGED } from "../rbac/privilegedUsers";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import {
  EVENT_LATE_END_MESSAGE,
  isEventEndWithinHours,
} from "../services/eventSchedulingWindow";

class EventAlreadyRegisteredError extends Error {}
class EventFullError extends Error {}

// Fallback category list, used ONLY when the EventCategory table is empty
// (fresh DB / migration not yet applied) so the filter bar is never blank.
// It mirrors the seeded migration exactly â€” including Astrology â€” because a
// fallback that quietly omits a category would make that category
// unfilterable and uncreatable on an un-migrated database.
export const EVENT_CATEGORIES = [
  "walking",
  "running",
  "cycling",
  "football",
  "cricket",
  "badminton",
  "tennis",
  "basketball",
  "volleyball",
  "gym-fitness",
  "yoga",
  "travel",
  "movies",
  "music",
  "concerts",
  "photography",
  "gaming",
  "esports",
  "chess",
  "food",
  "coffee",
  "cooking",
  "shopping",
  "technology",
  "coding",
  "business",
  "startups",
  "study",
  "books",
  "education",
  "art",
  "dance",
  "nature",
  "beach",
  "hiking",
  "volunteering",
  "pets",
  "cars",
  "bikes",
  "fashion",
  "networking",
  "local-events",
  "community",
  "workshops",
  "astrology",
  "other",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Legacy keys that predate the EventCategory table, mapped to current slugs. */
const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  sports: "football",
  hobbies: "other",
  meetups: "community",
  events: "local-events",
};

const DEFAULT_CATEGORY_LABELS: Record<string, string> = {
  sports: "Sports",
  movies: "Movies",
  walking: "Walking",
  running: "Running",
  cycling: "Cycling",
  football: "Football",
  cricket: "Cricket",
  badminton: "Badminton",
  tennis: "Tennis",
  basketball: "Basketball",
  volleyball: "Volleyball",
  "gym-fitness": "Gym & Fitness",
  yoga: "Yoga",
  travel: "Travel",
  music: "Music",
  concerts: "Concerts",
  photography: "Photography",
  gaming: "Gaming",
  esports: "Esports",
  chess: "Chess",
  food: "Food",
  coffee: "Coffee",
  cooking: "Cooking",
  shopping: "Shopping",
  technology: "Technology",
  coding: "Coding",
  business: "Business",
  startups: "Startups",
  study: "Study",
  books: "Books",
  education: "Education",
  art: "Art",
  dance: "Dance",
  nature: "Nature",
  beach: "Beach",
  hiking: "Hiking",
  volunteering: "Volunteering",
  pets: "Pets",
  cars: "Cars",
  bikes: "Bikes",
  fashion: "Fashion",
  networking: "Networking",
  "local-events": "Local Events",
  community: "Community",
  workshops: "Workshops",
  astrology: "Astrology",
  hobbies: "Hobbies",
  meetups: "Meetups",
  other: "Other",
};

const DEFAULT_CATEGORY_ICONS: Record<string, string> = {
  walking: "ðŸš¶",
  running: "ðŸƒ",
  cycling: "ðŸš´",
  football: "âš½",
  cricket: "ðŸ",
  badminton: "ðŸ¸",
  tennis: "ðŸŽ¾",
  basketball: "ðŸ€",
  volleyball: "ðŸ",
  "gym-fitness": "ðŸ‹ï¸",
  yoga: "ðŸ§˜",
  travel: "âœˆï¸",
  movies: "ðŸŽ¬",
  music: "ðŸŽµ",
  concerts: "ðŸŽ¤",
  photography: "ðŸ“·",
  gaming: "ðŸŽ®",
  esports: "ðŸ•¹ï¸",
  chess: "â™Ÿï¸",
  food: "ðŸ½ï¸",
  coffee: "â˜•",
  cooking: "ðŸ³",
  shopping: "ðŸ›ï¸",
  technology: "ðŸ’»",
  coding: "ðŸ‘¨â€ðŸ’»",
  business: "ðŸ“ˆ",
  startups: "ðŸš€",
  study: "ðŸ“š",
  books: "ðŸ“–",
  education: "ðŸŽ“",
  art: "ðŸŽ¨",
  dance: "ðŸ’ƒ",
  nature: "ðŸŒ¿",
  beach: "ðŸ–ï¸",
  hiking: "ðŸ¥¾",
  volunteering: "ðŸ¤",
  pets: "ðŸ¾",
  cars: "ðŸš—",
  bikes: "ðŸï¸",
  fashion: "ðŸ‘—",
  networking: "ðŸ¤",
  "local-events": "ðŸ“",
  community: "ðŸ˜ï¸",
  workshops: "ðŸ› ï¸",
  astrology: "ðŸ”®",
  other: "ðŸ“¦",
};

async function getDisabledCategories(): Promise<Set<string>> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { key: "event.categories.disabled" } });
    if (!row) return new Set();
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

export interface EventCategoryRow {
  key: string;
  label: string;
  description: string | null;
  icon: string | null;
  coverImageUrl: string | null;
  sortOrder: number;
  enabled: boolean;
  subcategories: string[];
}

/**
 * Categories come from the EventCategory table, in admin-controlled order.
 *
 * The old hardcoded const is kept only as a seed/fallback: if the table is
 * empty (fresh DB, migration not yet run) the endpoint still returns the full
 * default list rather than an empty filter bar.
 */
export async function loadEventCategories(): Promise<EventCategoryRow[]> {
  try {
    const rows = await prisma.eventCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
    if (rows.length > 0) {
      return rows.map((r) => ({
        key: r.key,
        label: r.label,
        description: r.description,
        icon: r.icon,
        coverImageUrl: r.coverImageUrl,
        sortOrder: r.sortOrder,
        enabled: r.enabled,
        subcategories: Array.isArray(r.subcategories) ? r.subcategories : [],
      }));
    }
  } catch {
    // Table missing (migration not applied yet) â€” fall through to defaults.
  }
  return EVENT_CATEGORIES.map((key, i) => ({
    key,
    label: DEFAULT_CATEGORY_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
    description: null,
    icon: DEFAULT_CATEGORY_ICONS[key] || "ðŸ“…",
    coverImageUrl: null,
    sortOrder: (i + 1) * 10,
    enabled: true,
    subcategories: [],
  }));
}

export async function getEventCategories(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const rows = await loadEventCategories();
    // "All Events" is a pseudo-category, always first, never persisted.
    const all: EventCategoryRow = {
      key: "all",
      label: "All Events",
      description: "Every live and upcoming event",
      icon: "ðŸŒ",
      coverImageUrl: null,
      sortOrder: 0,
      enabled: true,
      subcategories: [],
    };
    sendSuccess(
      res,
      { categories: [all, ...rows].map((c) => ({ ...c, isPseudo: c.key === "all" })) },
      "Event categories."
    );
  } catch (err: any) {
    sendError(res, "Failed to load categories.", 500, "INTERNAL_ERROR");
  }
}

async function isKnownCategory(key: string): Promise<boolean> {
  const rows = await loadEventCategories();
  return rows.some((c) => c.key === key);
}

async function normalizeCategory(raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  const key = String(raw).toLowerCase().trim();
  if (key === "all") return null;
  if ((await isKnownCategory(key))) return key;
  // Tolerate the legacy slugs that predate the EventCategory table so old
  // clients and existing rows keep validating.
  if (LEGACY_CATEGORY_ALIASES[key]) return LEGACY_CATEGORY_ALIASES[key];
  return null;
}

function datePresetRange(preset: string): { from?: Date; to?: Date } | null {
  // Always server time, never a client-supplied "now": Live Now and the
  // relative presets have to agree across every device in the fleet.
  const now = new Date();
  const startOfDay = (d: Date) => {
    const c = new Date(d);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
  switch (preset) {
    case "today": {
      const s = startOfDay(now);
      return { from: s, to: addDays(s, 1) };
    }
    case "tomorrow": {
      const s = addDays(startOfDay(now), 1);
      return { from: s, to: addDays(s, 1) };
    }
    case "week": {
      // This week = the next 7 days from now, which is what users mean by
      // "this week" in a discovery feed.
      return { from: now, to: addDays(now, 7) };
    }
    case "weekend": {
      // Upcoming Saturday 00:00 -> Monday 00:00. If today is already Saturday
      // or Sunday, "this weekend" means the one that is still ahead.
      const day = now.getDay();
      const toSat = (6 - day + 7) % 7;
      const sat = addDays(startOfDay(now), toSat);
      return { from: sat, to: addDays(sat, 2) };
    }
    case "month": {
      return { from: now, to: addDays(now, 30) };
    }
    case "next7": {
      return { from: now, to: addDays(now, 7) };
    }
    case "upcoming": {
      return { from: now };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Distance helpers (Near Me / radius filter)
// ---------------------------------------------------------------------------
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Bounding box so the radius becomes an indexed range scan, not a full scan. */
function boundingBox(lat: number, lon: number, radiusKm: number) {
  const latDelta = radiusKm / 110.574;
  const lonDelta = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    latitude: { gte: lat - latDelta, lte: lat + latDelta },
    longitude: { gte: lon - lonDelta, lte: lon + lonDelta },
  };
}

// ---------------------------------------------------------------------------
// Time-of-day filter (Morning / Afternoon / Evening / Night)
// ---------------------------------------------------------------------------
const TIME_WINDOWS: Record<string, [number, number]> = {
  morning: [5, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  night: [21, 29], // wraps past midnight via the OR below
};

/**
 * Boundaries are built with Date.UTC, not `new Date(y, m, d, h)`.
 *
 * The local-time constructor resolves against the *server's* zone, so the same
 * filter produced 17:00 local == 11:30Z on this box and would shift again on a
 * host in another region â€” the filter would silently mean different hours in
 * different deployments. Hours are therefore evaluated in UTC.
 *
 * Known limitation: this buckets by UTC hour, not by each event's own
 * `timezone` column. Doing that per-row needs a generated column or a
 * functional index; until that exists the filter is a UTC-day view, which is
 * correct and stable but not per-event local time.
 */
const dayStartUtc = (hour: number) => new Date(Date.UTC(1970, 0, 1, hour, 0, 0));

function timeWindowCondition(win: string): Prisma.EventWhereInput | null {
  const range = TIME_WINDOWS[win];
  if (!range) return null;
  const [startHour, endHour] = range;
  if (endHour <= 24) {
    return {
      AND: [{ startTime: { gte: dayStartUtc(startHour) } }, { startTime: { lt: dayStartUtc(endHour) } }],
    };
  }
  // Night wraps midnight: >= 21:00 OR < 05:00.
  return {
    OR: [{ startTime: { gte: dayStartUtc(startHour) } }, { startTime: { lt: dayStartUtc(endHour - 24) } }],
  };
}

export type EventScope = "all" | "live" | "upcoming" | "completed";

/**
 * Scope predicates. `live` is strictly server-time based:
 *   startTime <= now < endTime
 * so an event leaves "Live Now" the moment it ends, with no client involvement.
 */
/**
 * Scope filters, all evaluated against the server clock.
 *
 * "Live Now" means the event has provably started AND provably not finished:
 * `startTime <= now < endTime`. It used to also treat an event with no
 * `endTime` as live, which invented activity - an event with no known end has
 * no evidence it is running right now, and displaying it under "Live Now"
 * claimed something the data does not support.
 *
 * The default "all" scope returns only events that have not finished yet, so
 * a months-old event cannot sit in the main feed looking current. Callers that
 * genuinely want history must ask for `completed` explicitly.
 */
function scopeCondition(scope: EventScope, now: Date): Prisma.EventWhereInput | null {
  switch (scope) {
    case "live":
      return {
        AND: [{ startTime: { lte: now } }, { endTime: { gt: now } }],
      };
    case "upcoming":
      return { startTime: { gt: now } };
    case "completed":
      return { OR: [{ status: "COMPLETED" }, { endTime: { lte: now } }] };
    case "all":
    default:
      // Not finished. `endTime: null` is excluded because an event with no end
      // cannot be shown as still current.
      return { endTime: { gt: now } };
  }
}

/** Never surface cancelled / rejected / hidden events in discovery. */
const DISCOVERY_STATUSES = ["PUBLISHED", "LIVE"];

export interface EventFilterInput {
  scope: EventScope;
  categories: string[];
  communityId?: string;
  privacy?: string;
  from?: Date;
  to?: Date;
  timeOfDay?: string;
  timeFromHour?: number;
  timeToHour?: number;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  free?: boolean;
  minPrice?: number;
  maxPrice?: number;
  organizerTypes?: string[];
  verifiedOnly?: boolean;
  online?: boolean;
  womenOnly?: boolean;
  seats?: "available" | "almost_full" | "full";
  q?: string;
  sort: string;
}

/** Radius below which an event counts as "almost full" (>=80% taken). */
const ALMOST_FULL_RATIO = 0.8;

/**
 * Whether an event is happening right now, decided against the server clock.
 *
 * An event only counts as live when there is proof both ways: it has started,
 * and it has not finished. A missing endTime is deliberately NOT treated as
 * "still going" - it is the absence of evidence, and it must not be rendered as
 * a "Live Now" badge. Exported so the badge and the `live` scope cannot drift
 * apart, and so this is unit-testable without a database.
 */
export function isEventLive(
  startTime: Date,
  endTime: Date | null,
  now: Date
): boolean {
  return startTime <= now && endTime != null && endTime > now;
}

export function buildEventWhere(f: EventFilterInput, now: Date): Prisma.EventWhereInput {
  const and: Prisma.EventWhereInput[] = [{ status: { in: DISCOVERY_STATUSES } }];

  const scope = scopeCondition(f.scope, now);
  if (scope) and.push(scope);

  if (f.categories.length > 0) and.push({ category: { in: f.categories } });
  if (f.communityId) and.push({ communityId: f.communityId });
  if (f.privacy) and.push({ privacy: f.privacy });

  // Date range applies to startTime, except for "live"/"completed" where the
  // scope window is authoritative and a from/to would fight it.
  if (f.scope === "upcoming" || f.scope === "all") {
    if (f.from && !Number.isNaN(f.from.getTime())) and.push({ startTime: { gte: f.from } });
    if (f.to && !Number.isNaN(f.to.getTime())) and.push({ startTime: { lt: f.to } });
  }

  if (f.timeOfDay) {
    const cond = timeWindowCondition(f.timeOfDay);
    if (cond) and.push(cond);
  } else if (typeof f.timeFromHour === "number" || typeof f.timeToHour === "number") {
    const lo = typeof f.timeFromHour === "number" ? f.timeFromHour : 0;
    const hi = typeof f.timeToHour === "number" ? f.timeToHour : 24;
    and.push({ startTime: { gte: dayStartUtc(lo), lt: dayStartUtc(hi) } });
  }

  if (typeof f.lat === "number" && typeof f.lon === "number" && typeof f.radiusKm === "number") {
    // Bounding box narrows the scan to an indexed range; the exact haversine
    // distance is then applied in memory after the page is fetched.
    and.push(boundingBox(f.lat, f.lon, f.radiusKm));
  }

  if (f.free === true) and.push({ OR: [{ price: null }, { price: 0 }] });
  else if (f.free === false) and.push({ price: { gt: 0 } });
  else if (typeof f.minPrice === "number" || typeof f.maxPrice === "number") {
    and.push({
      price: {
        ...(typeof f.minPrice === "number" ? { gte: f.minPrice } : {}),
        ...(typeof f.maxPrice === "number" ? { lte: f.maxPrice } : {}),
      },
    });
  }

  if (f.organizerTypes && f.organizerTypes.length > 0) and.push({ organizerType: { in: f.organizerTypes } });
  if (f.verifiedOnly) and.push({ isVerified: true });
  if (f.online === true) and.push({ isOnline: true });
  else if (f.online === false) and.push({ isOnline: false });
  if (f.womenOnly) and.push({ womenOnly: true });

  if (f.seats === "full") and.push({ NOT: { capacity: null } });
  if (f.q) {
    // Case-insensitive contains across the fields a user would search by.
    // Postgres trigram/full-text indexes can back this later; correctness first.
    const term = f.q.replace(/[%_\\]/g, (m) => `\\${m}`);
    and.push({
      OR: [
        { title: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
        { subcategory: { contains: term, mode: "insensitive" } },
        { location: { contains: term, mode: "insensitive" } },
        { organizer: { is: { fullName: { contains: term, mode: "insensitive" } } } },
      ],
    });
  }

  return { AND: and };
}

export function eventOrderBy(sort: string, lat?: number, lon?: number): Prisma.EventOrderByWithRelationInput[] {
  switch (sort) {
    case "recently_created":
      return [{ createdAt: "desc" }];
    case "most_joined":
      return [{ attendeeCount: "desc" }, { startTime: "asc" }];
    case "available_seats":
      // Events with no capacity are treated as unbounded, so they sort last.
      return [{ capacity: { sort: "asc", nulls: "last" } }, { startTime: "asc" }];
    case "free_first":
      return [{ price: { sort: "asc", nulls: "first" } }, { startTime: "asc" }];
    case "ending_soon":
      return [{ endTime: { sort: "asc", nulls: "last" } }];
    case "soonest":
    case "recommended":
    default:
      // "Recommended" is deliberately Soonest, not an invented score: a fake
      // ranking would be a lie. Nearest needs post-filtering by distance, so
      // it falls back to soonest here and is re-sorted after the distance pass.
      if (sort === "nearest" && (typeof lat === "number" && typeof lon === "number")) {
        return [{ startTime: "asc" }];
      }
      return [{ startTime: "asc" }];
  }
}

// ============================================================================
// CREATE EVENT
// ============================================================================

export async function createEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
      const { title, description, communityId, location, startTime, endTime, capacity, coverImageUrl, category, subcategory, privacy, price, latitude, longitude, onlineUrl, isOnline, currency, timezone, womenOnly, theatreName, bookingUrl, isMovie, coordinatorName, coordinatorPhone } = req.body;

    if (!title || !startTime) {
      sendError(res, "Title and startTime are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (category !== undefined && category !== null && category !== "" && !(await normalizeCategory(category))) {
      sendError(res, `Unknown category. Use GET /events/categories for the list.`, 400, "INVALID_CATEGORY");
      return;
    }
    if (privacy !== undefined && privacy !== "PUBLIC" && privacy !== "PRIVATE") {
      sendError(res, "Privacy must be PUBLIC or PRIVATE.", 400, "VALIDATION_ERROR");
      return;
    }
    const priceValue = price === undefined || price === null || price === "" ? null : Number(price);
    if (priceValue !== null && (!Number.isFinite(priceValue) || priceValue < 0)) {
      sendError(res, "Price must be a non-negative number.", 400, "VALIDATION_ERROR");
      return;
    }
      const subcategoryValue =
        subcategory === undefined || subcategory === null ? undefined : String(subcategory).toLowerCase().trim().slice(0, 32) || null;

      // --- Movie outings -------------------------------------------------
      // The movie name is `title` and the showtime is `startTime`; only the
      // venue and an optional external checkout need their own columns.
      const isMovieFlag = isMovie === true || isMovie === "true";
      const theatreValue =
        theatreName === undefined || theatreName === null || theatreName === ""
          ? null
          : String(theatreName).trim().slice(0, 160) || null;

      // bookingUrl is rendered as an outbound link, so a `javascript:` or
      // `data:` payload here would be stored XSS. Only real http(s) survives.
      let bookingValue: string | null = null;
      if (bookingUrl !== undefined && bookingUrl !== null && String(bookingUrl).trim() !== "") {
        const raw = String(bookingUrl).trim();
        if (raw.length > 1000) {
          sendError(res, "bookingUrl is too long.", 400, "VALIDATION_ERROR");
          return;
        }
        let parsed: URL | null = null;
        try {
          parsed = new URL(raw);
        } catch {
          parsed = null;
        }
        if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
          sendError(res, "bookingUrl must be a full http(s) URL.", 400, "VALIDATION_ERROR");
          return;
        }
        bookingValue = parsed.toString();
      }

      // A movie event with a cinema but no address is unusable, and one with an
      // address but no cinema is just an event. Require the pair.
      if (isMovieFlag && !theatreValue && !location) {
        sendError(res, "A movie event needs the theatre name and where to meet.", 400, "VALIDATION_ERROR");
        return;
      }

      // The coordinator is the one person added to the event who does NOT buy a
      // seat - they confirm the group's booking. Name + phone only, never tied
      // to an account, so the person can be anyone the organizer trusts.
      const coordinatorNameValue =
        coordinatorName === undefined || coordinatorName === null || String(coordinatorName).trim() === ""
          ? null
          : String(coordinatorName).trim().slice(0, 100) || null;
      const coordinatorPhoneRaw =
        coordinatorPhone === undefined || coordinatorPhone === null || String(coordinatorPhone).trim() === ""
          ? ""
          : String(coordinatorPhone).trim().slice(0, 20);
      if (coordinatorPhoneRaw && !/^\+?[0-9\s\-()]{6,20}$/.test(coordinatorPhoneRaw)) {
        sendError(res, "Coordinator phone does not look like a phone number.", 400, "VALIDATION_ERROR");
        return;
      }
      if (coordinatorPhoneRaw && !coordinatorNameValue) {
        sendError(res, "Add the coordinator's name with their phone number.", 400, "VALIDATION_ERROR");
        return;
      }
      const coordinatorPhoneValue = coordinatorPhoneRaw || null;


    // Coordinates are optional, but a radius search is meaningless without
    // them, so they must be a valid pair rather than a half-set pin.
    const lat = latitude === undefined || latitude === null || latitude === "" ? null : Number(latitude);
    const lon = longitude === undefined || longitude === null || longitude === "" ? null : Number(longitude);
    if ((lat === null) !== (lon === null)) {
      sendError(res, "Provide both latitude and longitude, or neither.", 400, "VALIDATION_ERROR");
      return;
    }
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      sendError(res, "latitude must be between -90 and 90.", 400, "VALIDATION_ERROR");
      return;
    }
    if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) {
      sendError(res, "longitude must be between -180 and 180.", 400, "VALIDATION_ERROR");
      return;
    }
    if (endTime && new Date(endTime) <= new Date(startTime)) {
      sendError(res, "endTime must be after startTime.", 400, "VALIDATION_ERROR");
      return;
    }
    // An event with no end time can never satisfy the LIVE window
    // (start <= now < end), so it would silently never appear in Live Now.
    // Give it a sensible default rather than a broken record.
    const resolvedEnd = endTime ? new Date(endTime) : new Date(new Date(startTime).getTime() + 2 * 60 * 60 * 1000);
    if (!isEventEndWithinHours(new Date(startTime), resolvedEnd)) {
      sendError(res, EVENT_LATE_END_MESSAGE, 400, "EVENT_AFTER_HOURS");
      return;
    }

    const event = await prisma.event.create({
      data: {
        title,
        description: description || "",
        communityId: communityId || null,
        location: location || "",
        latitude: lat,
        longitude: lon,
        isOnline: isOnline === true || Boolean(onlineUrl),
        onlineUrl: onlineUrl || null,
        startTime: new Date(startTime),
        endTime: resolvedEnd,
        capacity: capacity || null,
        coverImageUrl: coverImageUrl || null,
        category: await normalizeCategory(category),
        subcategory: subcategoryValue,
        privacy: privacy || "PUBLIC",
        price: priceValue,
        currency: currency || "INR",
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          womenOnly: womenOnly === true,
          isMovie: isMovieFlag,
          theatreName: theatreValue,
          bookingUrl: bookingValue,
          coordinatorName: coordinatorNameValue,
          coordinatorPhone: coordinatorPhoneValue,
        // Only a user can self-declare themselves a verified organizer; a
        // partner/community event is marked verified by an admin, so a client
        // can never set this itself.
        isVerified: false,
        organizerType: communityId ? "COMMUNITY" : "USER",
        organizerId: req.user!.userId,
        status: "PUBLISHED",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_CREATE",
        entityType: "Event",
        entityId: event.id,
        metadata: JSON.stringify({ title }),
      },
    });

    sendSuccess(res, event, "Event created.", 201);
  } catch (err: any) {
    sendError(res, "Failed to create event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EVENTS
// ============================================================================

export async function getEvents(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const q = req.query as Record<string, string | undefined>;
    const now = new Date();

    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const scope = (["all", "live", "upcoming", "completed"] as const).includes(q.scope as EventScope)
      ? (q.scope as EventScope)
      : "all";

    // Multi-value: ?category=a&category=b or comma-joined.
    const categories = String(q.category || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== "all");

    const organizerTypes = String(q.organizerType || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => ["USER", "PARTNER", "COMMUNITY", "ORGANIZER"].includes(s));

    const preset = typeof q.preset === "string" ? datePresetRange(q.preset) : null;
    const parseDate = (v?: string) => (v ? new Date(v) : undefined);
    const num = (v?: string) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

    const input: EventFilterInput = {
      scope,
      categories,
      communityId: q.communityId || undefined,
      privacy: q.privacy || undefined,
      from: parseDate(q.from) ?? preset?.from,
      to: parseDate(q.to) ?? preset?.to,
      timeOfDay: q.timeOfDay || undefined,
      timeFromHour: num(q.timeFromHour),
      timeToHour: num(q.timeToHour),
      lat: num(q.lat),
      lon: num(q.lng ?? q.lon),
      radiusKm: num(q.radiusKm),
      free: q.free === "true" ? true : q.free === "false" ? false : undefined,
      minPrice: num(q.minPrice),
      maxPrice: num(q.maxPrice),
      organizerTypes,
      verifiedOnly: q.verified === "true",
      online: q.online === "true" ? true : q.online === "false" ? false : undefined,
      womenOnly: q.womenOnly === "true",
      seats: (["available", "almost_full", "full"] as const).includes(q.seats as any) ? (q.seats as any) : undefined,
      q: (q.q || q.search || "").trim() || undefined,
      sort: q.sort || "recommended",
    };

    const where = buildEventWhere(input, now);

    // Cursor pagination: ?cursor=<startTime ISO>&cursorId=<id>. Stable and cheap
    // compared to OFFSET, which degrades badly once the feed is large. Falls
    // back to page/limit for the PDF export and older clients.
    const cursorIso = q.cursor;
    let cursorWhere: Prisma.EventWhereInput | undefined;
    if (cursorIso) {
      const cursorDate = new Date(cursorIso);
      const cursorId = q.cursorId;
      if (!Number.isNaN(cursorDate.getTime())) {
        cursorWhere = cursorId
          ? {
              OR: [
                { startTime: { gt: cursorDate } },
                { startTime: cursorDate, id: { gt: cursorId } },
              ],
            }
          : { startTime: { gt: cursorDate } };
      }
    }
    const finalWhere: Prisma.EventWhereInput = cursorWhere
      ? { AND: [where, cursorWhere] }
      : where;

    // Over-fetch when a radius is in play so the exact-distance pass has enough
    // candidates to fill a full page.
    const useRadius = typeof input.lat === "number" && typeof input.lon === "number" && typeof input.radiusKm === "number";
    const take = useRadius ? limit * 4 : limit;

    const items = await prisma.event.findMany({
      where: finalWhere,
      orderBy: eventOrderBy(input.sort, input.lat, input.lon),
      ...(cursorIso ? { cursor: undefined, skip: 0 } : { skip: Math.max(0, (Number(q.page) || 1) - 1) * limit }),
      take,
      include: {
        organizer: { select: { id: true, fullName: true, avatarUrl: true, role: true } },
        _count: { select: { attendees: true } },
      },
    });

    // ---- Post-filters that SQL cannot express cheaply --------------------
    let rows = items.map((item) => {
      const distanceKm =
        useRadius && item.latitude != null && item.longitude != null
          ? haversineKm(input.lat!, input.lon!, item.latitude, item.longitude)
          : null;
      const taken = item._count.attendees;
      const capacity = item.capacity ?? null;
      const seatsLeft = capacity == null ? null : Math.max(0, capacity - taken);
      return {
        ...item,
        attendeeCount: taken,
        seatsLeft,
        isFull: capacity != null && taken >= capacity,
        isAlmostFull:
          capacity != null && taken < capacity && taken / Math.max(1, capacity) >= ALMOST_FULL_RATIO,
        // Strictly live, matching the `scope=live` predicate exactly.
        isLive: isEventLive(item.startTime, item.endTime, now),
        distanceKm: distanceKm == null ? null : Math.round(distanceKm * 10) / 10,
        // Server time is returned so the client can render countdowns that
        // agree with the backend's live/upcoming decision.
        serverTime: now.toISOString(),
      };
    });

    if (useRadius) {
      rows = rows.filter((r) => r.distanceKm != null && r.distanceKm <= (input.radiusKm as number));
      if (input.sort === "nearest") rows.sort((a, b) => (a.distanceKm! - b.distanceKm!));
    }
    if (input.seats === "available") rows = rows.filter((r) => !r.isFull);
    else if (input.seats === "almost_full") rows = rows.filter((r) => r.isAlmostFull);
    else if (input.seats === "full") rows = rows.filter((r) => r.isFull);

    // Cursor is only trustworthy when nothing was dropped after the fetch.
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const truncated = hasMore;

    // Per-user registration flags so clients can render RSVP state in lists.
    let registeredEventIds = new Set<string>();
    if (page.length > 0) {
      const mine = await prisma.eventAttendee.findMany({
        where: { userId: req.user!.userId, eventId: { in: page.map((i) => i.id) } },
        select: { eventId: true },
      });
      registeredEventIds = new Set(mine.map((m) => m.eventId));
    }

    const last = page[page.length - 1];
    const nextCursor = truncated && last ? { cursor: last.startTime.toISOString(), cursorId: last.id } : null;

    sendSuccess(res, {
      items: page.map((i) => ({ ...i, isRegistered: registeredEventIds.has(i.id) })),
      limit,
      hasMore: truncated,
      nextCursor,
      scope,
      serverTime: now.toISOString(),
    });
  } catch (err: any) {
    console.error("getEvents error:", err);
    sendError(res, "Failed to retrieve events.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EVENT BY ID
// ============================================================================

export async function getEventById(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizer: { select: { id: true, fullName: true, avatarUrl: true } },
        _count: { select: { attendees: true } },
      },
    });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Check if user is registered
    const isRegistered = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    const response = {
      ...event,
      attendeeCount: event._count.attendees,
      isRegistered: !!isRegistered,
      isOrganizer: event.organizerId === req.user!.userId,
    };

    sendSuccess(res, response, "Event retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// UPDATE EVENT
// ============================================================================

export async function updateEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { title, description, location, startTime, endTime, capacity, status, coverImageUrl, category, subcategory, privacy, price } = req.body;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Only organizer can update
    if (event.organizerId !== req.user!.userId) {
      sendError(res, "Only event organizer can update.", 403, "FORBIDDEN");
      return;
    }
    if (category !== undefined && category !== null && category !== "" && !(await normalizeCategory(category))) {
      sendError(res, `Unknown category. Use GET /events/categories for the list.`, 400, "INVALID_CATEGORY");
      return;
    }
    if (privacy !== undefined && privacy !== "PUBLIC" && privacy !== "PRIVATE") {
      sendError(res, "Privacy must be PUBLIC or PRIVATE.", 400, "VALIDATION_ERROR");
      return;
    }
    const priceValue =
      price === undefined ? undefined : price === null || price === "" ? null : Number(price);
    if (priceValue !== undefined && (priceValue === null ? false : !Number.isFinite(priceValue) || (priceValue as number) < 0)) {
      sendError(res, "Price must be a non-negative number.", 400, "VALIDATION_ERROR");
      return;
    }
    const subcategoryValue =
      subcategory === undefined
        ? undefined
        : subcategory === null || subcategory === ""
          ? null
          : String(subcategory).toLowerCase().trim().slice(0, 32) || null;

    const nextStart = startTime ? new Date(startTime) : event.startTime;
    const nextEnd = endTime ? new Date(endTime) : event.endTime;
    // Re-check on update so an event cannot be pushed past 10 PM after creation.
    if (nextEnd && !isEventEndWithinHours(nextStart, nextEnd)) {
      sendError(res, EVENT_LATE_END_MESSAGE, 400, "EVENT_AFTER_HOURS");
      return;
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        title: title || event.title,
        description: description !== undefined ? description : event.description,
        location: location !== undefined ? location : event.location,
        startTime: nextStart,
        endTime: nextEnd,
        capacity: capacity !== undefined ? capacity : event.capacity,
        status: status || event.status,
        coverImageUrl: coverImageUrl !== undefined ? coverImageUrl || null : event.coverImageUrl,
        category: category !== undefined ? await normalizeCategory(category) : event.category,
        subcategory: subcategoryValue !== undefined ? subcategoryValue : (event as any).subcategory ?? null,
        privacy: privacy || event.privacy,
        price: priceValue !== undefined ? priceValue : event.price,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_UPDATE",
        entityType: "Event",
        entityId: id,
        metadata: JSON.stringify({ title, status }),
      },
    });

    sendSuccess(res, updated, "Event updated.");
  } catch (err: any) {
    sendError(res, "Failed to update event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// UPLOAD EVENT COVER (organizer only, public image)
// ============================================================================

export async function uploadEventCover(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    if (!req.file) {
      sendError(res, "No cover image uploaded.", 400, "NO_FILE");
      return;
    }
    const event = await prisma.event.findUnique({ where: { id }, select: { id: true, organizerId: true } });
    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }
    if (event.organizerId !== req.user!.userId) {
      sendError(res, "Only event organizer can change the cover.", 403, "FORBIDDEN");
      return;
    }
    const coverImageUrl = `/uploads/${(req.file as Express.Multer.File).filename}`;
    const updated = await prisma.event.update({ where: { id }, data: { coverImageUrl } });
    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: "USER", action: "EVENT_COVER_UPLOAD", entityType: "Event", entityId: id },
    });
    sendSuccess(res, { coverImageUrl, event: updated }, "Cover image updated.");
  } catch (err: any) {
    sendError(res, "Failed to upload cover image.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DELETE EVENT
// ============================================================================

export async function deleteEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Only organizer can delete
    if (event.organizerId !== req.user!.userId) {
      sendError(res, "Only event organizer can delete.", 403, "FORBIDDEN");
      return;
    }

    await prisma.$transaction([
      prisma.eventAttendee.deleteMany({ where: { eventId: id } }),
      prisma.event.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "EVENT_DELETE",
          entityType: "Event",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Event deleted.");
  } catch (err: any) {
    sendError(res, "Failed to delete event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REGISTER FOR EVENT
// ============================================================================

export async function registerForEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    if (event.status === "CANCELLED") {
      sendError(res, "This event has been cancelled.", 400, "EVENT_CANCELLED");
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.eventAttendee.findUnique({
          where: { eventId_userId: { eventId: id, userId } },
        });
        if (existing) throw new EventAlreadyRegisteredError();

        // Atomic capacity claim: the row only increments while below capacity,
        // so concurrent registrations can never overbook.
        const claimed = await tx.event.updateMany({
          where: {
            id,
            ...(event.capacity !== null ? { attendeeCount: { lt: event.capacity } } : {}),
          },
          data: { attendeeCount: { increment: 1 } },
        });
        if (claimed.count === 0) throw new EventFullError();

        await tx.eventAttendee.create({
          data: { eventId: id, userId, status: "REGISTERED" },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorType: "USER",
            action: "EVENT_REGISTER",
            entityType: "Event",
            entityId: id,
          },
        });
      });
    } catch (txErr: any) {
      if (txErr instanceof EventAlreadyRegisteredError || txErr?.code === "P2002") {
        sendError(res, "Already registered for this event.", 409, "ALREADY_REGISTERED");
        return;
      }
      if (txErr instanceof EventFullError) {
        sendError(res, "Event is at full capacity.", 400, "EVENT_FULL");
        return;
      }
      throw txErr;
    }

    sendSuccess(res, undefined, "Registered for event.");
  } catch (err) {
    sendError(res, "Failed to register for event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// CANCEL REGISTRATION
// ============================================================================

export async function cancelRegistration(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    if (!attendee) {
      sendError(res, "Not registered for this event.", 404, "NOT_REGISTERED");
      return;
    }

    await prisma.$transaction([
      prisma.eventAttendee.delete({
        where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
      }),
      prisma.event.update({ where: { id }, data: { attendeeCount: { decrement: 1 } } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "EVENT_UNREGISTER",
          entityType: "Event",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Registration cancelled.");
  } catch (err: any) {
    sendError(res, "Failed to cancel registration.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// CHECK IN TO EVENT
// ============================================================================

export async function checkInEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    if (!attendee) {
      sendError(res, "Not registered for this event.", 404, "NOT_REGISTERED");
      return;
    }

    const updated = await prisma.eventAttendee.update({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_CHECK_IN",
        entityType: "Event",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Checked in to event.");
  } catch (err: any) {
    sendError(res, "Failed to check in.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET ATTENDEES
// ============================================================================

export async function getEventAttendees(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string;

    const where: any = { eventId: id };
    if (status) where.status = status;

      // An attendee roster is reachable by any KYC-verified member, so it must
      // not be an email directory, and a staff account that registered for an
      // event must not appear in it at all. The filter goes on the query
      // because Prisma does not accept a filter inside a to-one select.
      const attendeeWhere: any = { ...where, user: { is: NOT_PRIVILEGED } };

      const [items, total] = await Promise.all([
        prisma.eventAttendee.findMany({
          where: attendeeWhere,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            eventId: true,
            status: true,
            createdAt: true,
            // email was exposed here to every member who could read the roster.
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        }),
        prisma.eventAttendee.count({ where: attendeeWhere }),
      ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve attendees.", 500, "INTERNAL_ERROR");
  }
}

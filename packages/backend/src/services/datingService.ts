import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";
import * as preferenceService from "./preferenceService";
// The in-app + push pair is what every other user-to-user flow uses
// (friendshipController being the closest analogue). Importing createNotification
// from the controller mirrors that precedent; the alternative, socketService's
// sendNotificationToUser, has no callers at all, so it is not a real option.
import { createNotification } from "../controllers/notificationController";
import { sendPushNotification } from "./notificationService";

export const DATING_NEW_USER_HOURS = 48;

/**
 * Admin-editable price of sending one dating request.
 *
 * Lives in PricingConfig under this key, so it can be changed from the admin
 * pricing screen without a deploy - the same mechanism as BASE_FEE. The default
 * is ₹0.50. Set it to 0 to make requests free (useful for a launch promotion
 * without touching code), which is treated as a real zero rather than "missing
 * config", so an admin can genuinely switch charging off.
 */
export const DATING_REQUEST_CHARGE_KEY = "DATING_REQUEST_CHARGE";
export const DEFAULT_DATING_REQUEST_CHARGE = 0.5;

/** Ledger type for the debit. Anything other than CREDIT renders as -₹ in the wallet. */
export const DATING_REQUEST_TRANSACTION_TYPE = "DATING_REQUEST";

/** Carries the 402 + how much is needed, so the client can say something useful. */
export class InsufficientDatingBalanceError extends Error {
  readonly code = "INSUFFICIENT_BALANCE";
  readonly required: number;
  readonly available: number;
  constructor(required: number, available: number) {
    super(
      `Sending a request costs \u20b9${required.toFixed(2)} and your wallet has \u20b9${available.toFixed(2)}. Please top up first.`,
    );
    this.name = "InsufficientDatingBalanceError";
    this.required = required;
    this.available = available;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Current per-request price, from admin config with the ₹0.50 default. */
export async function getDatingRequestCharge(): Promise<number> {
  const raw = await getConfig(DATING_REQUEST_CHARGE_KEY, DEFAULT_DATING_REQUEST_CHARGE);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? round2(n) : DEFAULT_DATING_REQUEST_CHARGE;
}

export type SwipeType = "LIKE" | "PASS" | "SUPER_LIKE";

export interface DiscoveryFilters {
  minAge?: number;
  maxAge?: number;
  city?: string;
  gender?: string;
  limit?: number;
}

export interface SwipeResult {
  swipe: SwipeType;
  match: { id: string; matchedAt: Date } | null;
}

/**
 * Match rows are unique on the ordered pair, so the lower id must always be
 * stored first. Without this, A likes B and B likes A would produce two
 * separate Match rows instead of one.
 */
function canonicalPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

/**
 * Turn an age range into a date-of-birth window.
 *
 * The two bounds are deliberately not symmetric, because the two errors are not
 * equally bad.
 *
 * `lte` (the youngest a candidate may be) is exact. Somebody whose birthday is
 * today turns the minimum age today, so the cutoff is precisely "today minus
 * minAge years" and anyone born after it is genuinely underage and must not
 * appear.
 *
 * `gte` (the oldest a candidate may be) is generous by up to a year. Somebody who
 * turned maxAge earlier this year was born in the calendar year maxAge+1 years
 * ago, and their exact birthday is not knowable from a year alone, so the window
 * opens at 1 January of that year. Being a year too generous here can only show
 * someone slightly older than asked; being a year too strict would hide people
 * who are exactly the age the user asked for.
 *
 * The bounds are NOT interchangeable and the order matters: `gte` comes from
 * maxAge and `lte` from minAge. They used to be the other way round, which
 * produced an impossible range (for the default 18-100, "born after 2007 and
 * before 1926") and silently emptied the entire discovery feed.
 *
 * Returns undefined for an absent bound so a caller can omit that side of the
 * range entirely rather than sending a nonsense date.
 */
function ageBounds(minAge?: number, maxAge?: number) {
  const now = new Date();
  // Oldest allowed: from 1 January of the year in which maxAge was reached.
  const gte =
    maxAge && maxAge > 0 ? new Date(now.getFullYear() - maxAge - 1, 0, 1) : undefined;
  // Youngest allowed: anyone at or above minAge today.
  const lte =
    minAge && minAge > 0
      ? new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate())
      : undefined;
  return { gte, lte };
}

/**
 * IDs the viewer must never see again: anyone they already acted on,
 * and anyone involved in a block in either direction.
 */
async function excludedIds(viewerId: string): Promise<string[]> {
  const [likes, passes, blocks] = await Promise.all([
    prisma.like.findMany({ where: { fromUserId: viewerId }, select: { toUserId: true } }),
    prisma.pass.findMany({ where: { fromUserId: viewerId }, select: { toUserId: true } }),
    prisma.userBlock.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    }),
  ]);

  return [
    ...likes.map((r) => r.toUserId),
    ...passes.map((r) => r.toUserId),
    ...blocks.flatMap((b) => [b.blockerId, b.blockedId]),
  ];
}

/**
 * Tell a user about something, in-app and by push, without ever failing the
 * caller's request.
 *
 * Both halves are already non-blocking on their own - createNotification catches
 * its own errors and returns null, and sendPushNotification returns immediately
 * when Firebase is not configured. The catch here is belt and braces, and it
 * matters more than usual in this file: by the time a notification is sent the
 * request has already been charged for, so a thrown error must never turn a
 * successful paid request into a 500. Losing a notification is survivable;
 * charging someone and then telling them it failed is not.
 */
async function announce(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  try {
    await createNotification(userId, title, body, data);
    void sendPushNotification(userId, title, body, data);
  } catch (err) {
    console.error(
      "dating notification failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function recordSwipe(
  fromUserId: string,
  toUserId: string,
  type: SwipeType,
): Promise<SwipeResult> {
  if (fromUserId === toUserId) {
    throw new Error("INVALID_TARGET");
  }
  if (!String(toUserId).trim()) {
    throw new Error("INVALID_TARGET");
  }

  const target = await prisma.user.findFirst({
    where: { id: toUserId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!target) {
    throw new Error("TARGET_NOT_FOUND");
  }

  const blockedEitherWay = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: fromUserId, blockedId: toUserId },
        { blockerId: toUserId, blockedId: fromUserId },
      ],
    },
    select: { id: true },
  });
  if (blockedEitherWay) {
    throw new Error("BLOCKED");
  }

  if (type === "PASS") {
    await prisma.$transaction(async (tx) => {
      await tx.pass.upsert({
        where: { fromUserId_toUserId: { fromUserId, toUserId } },
        create: { fromUserId, toUserId },
        update: {},
      });
      // Changing your mind: a pass clears any like you had recorded.
      await tx.like.deleteMany({ where: { fromUserId, toUserId } });
    });
    return { swipe: "PASS", match: null };
  }

  // LIKE / SUPER_LIKE
  //
  // Charge and record in ONE transaction. Two separate writes would allow a
  // user to be debited for a request that was never saved (if the like insert
  // failed) or to get a free request (if the debit failed) - and the whole
  // point of the charge is that it is not optional.
  //
  // The existing unique constraint on (fromUserId, toUserId) is what makes the
  // "already requested" case safe: we read the row inside the transaction and
  // skip the charge when it is already there, so a user cannot drain their own
  // wallet by re-swiping the same profile, and upgrading LIKE -> SUPER_LIKE
  // stays free. A genuine new request is charged exactly once.
  const charge = await getDatingRequestCharge();

  const swipeResult = await prisma.$transaction(async (tx) => {
    const existing = await tx.like.findUnique({
      where: { fromUserId_toUserId: { fromUserId, toUserId } },
      select: { id: true },
    });

    if (charge > 0 && !existing) {
      const wallet = await tx.wallet.upsert({
        where: { userId: fromUserId },
        update: {},
        create: { userId: fromUserId },
      });
      const available = Math.max(0, Number(wallet.balance?.toString() ?? 0));

      // Blocked rather than allowed to go negative, so the wallet can never
      // drift below zero and quietly forgive a charge nobody agreed to.
      if (available < charge) {
        throw new InsufficientDatingBalanceError(charge, available);
      }

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: { decrement: charge } },
      });
      await tx.transaction.create({
        data: {
          userId: fromUserId,
          walletId: wallet.id,
          type: DATING_REQUEST_TRANSACTION_TYPE,
          status: "COMPLETED",
          amount: charge,
          description: `Dating request sent${charge === DEFAULT_DATING_REQUEST_CHARGE ? "" : " (custom rate)"}`,
          referenceId: toUserId,
        },
      });
    }

    await tx.like.upsert({
      where: { fromUserId_toUserId: { fromUserId, toUserId } },
      create: { fromUserId, toUserId, type },
      update: { type },
    });
    await tx.pass.deleteMany({ where: { fromUserId, toUserId } });

    const reciprocal = await tx.like.findFirst({
      where: { fromUserId: toUserId, toUserId: fromUserId },
      select: { id: true },
    });

    // Names for the notification copy. Fetched only on the paths that actually
    // need them - a re-swipe and a plain pass send nothing, so paying for a name
    // lookup on every request would be a query spent for nothing.
    const senderName = existing
      ? null
      : (await tx.user.findUnique({
          where: { id: fromUserId },
          select: { fullName: true },
        }))?.fullName ?? null;
    const targetName = reciprocal
      ? (await tx.user.findUnique({
          where: { id: toUserId },
          select: { fullName: true },
        }))?.fullName ?? null
      : null;

    return { reciprocal: !!reciprocal, isNewLike: !existing, senderName, targetName };
  });

  // Notifications run AFTER the transaction commits, never inside it.
  //
  // createNotification writes through the shared prisma client, which is a
  // different connection from this transaction's tx. Putting it inside would
  // either expose the notification before the charge commits, or leave a
  // notification behind for a request that rolled back - a user told they had a
  // new request, billed for it in one place and not the other.
  const superLike = type === "SUPER_LIKE";
  const likeVerb = superLike ? "super liked you" : "liked you";

  if (!swipeResult.reciprocal) {
    // Only a genuinely new request is news. A re-swipe has already been
    // announced, and announcing it again would let a user farm their own inbox.
    if (swipeResult.isNewLike) {
      await announce(
        toUserId,
        superLike ? "New super like" : "Someone likes you",
        `${swipeResult.senderName ?? "Someone"} ${likeVerb}.`,
        { type: "DATING_LIKE", fromUserId },
      );
    }
    return { swipe: type, match: null };
  }

  const pair = canonicalPair(fromUserId, toUserId);
  const match = await prisma.match.upsert({
    where: { userAId_userBId: pair },
    create: pair,
    update: {},
  });

  // On a match both sides are told about the match and neither is told about the
  // like. Sending "someone likes you" first and "it's a match" second delivers
  // two notifications for one event, and by the time the first lands it is
  // already out of date.
  await Promise.all([
    announce(
      toUserId,
      "It's a match",
      `${swipeResult.senderName ?? "Someone"} and you liked each other. Say hello.`,
      { type: "DATING_MATCH", matchId: match.id },
    ),
    announce(
      fromUserId,
      "It's a match",
      `${swipeResult.targetName ?? "Someone"} and you liked each other. Say hello.`,
      { type: "DATING_MATCH", matchId: match.id },
    ),
  ]);

  return { swipe: type, match: { id: match.id, matchedAt: match.matchedAt } };
}

export async function listMatches(userId: string) {
  return prisma.match.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }], isActive: true },
    orderBy: [{ lastMessageAt: "desc" }, { matchedAt: "desc" }],
    select: {
      id: true,
      matchedAt: true,
      lastMessageAt: true,
      userA: { select: { id: true, fullName: true, avatarUrl: true } },
      userB: { select: { id: true, fullName: true, avatarUrl: true } },
    },
  });
}

export async function likesReceived(userId: string, limit = 50) {
  return prisma.like.findMany({
    // Exclude self-likes: the unique index permits fromUserId === toUserId,
    // so a bad client could otherwise read its own row back.
    where: { toUserId: userId, fromUserId: { not: userId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      createdAt: true,
      fromUser: {
        select: { id: true, fullName: true, avatarUrl: true, city: true },
      },
    },
  });
}

/**
 * How many candidates are pulled back for scoring before the feed is cut to
 * `limit`.
 *
 * Scoring happens in application code, because the dimensions are a weighted
 * combination of overlap ratios and compatibility rules that Postgres cannot
 * express without either earthdistance/PostGIS or a pile of lateral joins. Rather
 * than add a database extension as a side effect of a discovery feature, the
 * window is bounded and the trade-off is explicit: this ranks the most recent N
 * eligible profiles, not the global best N. Raising this constant trades latency
 * for depth; it is the first thing to revisit if discovery feels shallow.
 */
const CANDIDATE_WINDOW = 200;

/**
 * Approximate distance, for display.
 *
 * Bands, never a number with a decimal. A precise "3.4 km" tells a viewer far more
 * about someone else's movements than they need in order to decide whether to
 * swipe, and a rounded figure is equally useful for the decision the band
 * actually supports.
 */
function distanceBand(km: number | null): string | null {
  if (km === null) return null;
  if (km < 1) return "Under 1 km";
  if (km < 5) return "1-5 km";
  if (km < 10) return "5-10 km";
  if (km < 25) return "10-25 km";
  if (km < 50) return "25-50 km";
  if (km < 100) return "50-100 km";
  return "Over 100 km";
}

/**
 * Discovery feed. Never returns contact fields: phone, email and exact
 * location stay server-side until a user explicitly shares them.
 *
 * Two stages, deliberately separated:
 *
 *   1. SQL applies the *filters* - who is eligible at all. Age, gender, city,
 *      distance band. A candidate outside these is never scored.
 *   2. Application code applies the *ranking* - how eligible candidates are
 *      ordered. Interests, languages, lifestyle, closeness.
 *
 * The split is the safety property. A future change to the weights can only
 * reorder the feed; it cannot add someone the viewer filtered out, because the
 * filtering already happened and the scoring function has no say in it.
 *
 * Explicit filters in the query string override saved preferences, which is what
 * makes "show me Chennai only, just this once" possible without editing and
 * re-saving the preference form.
 */
export async function discover(viewerId: string, filters: DiscoveryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const excluded = await excludedIds(viewerId);

  const saved = await preferenceService.getPreferences(viewerId);
  const effective: preferenceService.NormalisedPreferences = {
    ...saved,
    ageMin: filters.minAge ?? saved.ageMin,
    ageMax: filters.maxAge ?? saved.ageMax,
  };
  const gender = filters.gender ?? undefined;
  const city = filters.city ?? undefined;

  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { latitude: true, longitude: true },
  });
  const viewerLocation = {
    latitude: viewer?.latitude ?? null,
    longitude: viewer?.longitude ?? null,
  };

  const { gte, lte } = ageBounds(effective.ageMin, effective.ageMax);

  // Bounding box for the radius. A box, not the circle: it is what can be indexed,
  // and the exact circle is re-checked in JavaScript below, so the corners the box
  // admits are filtered out rather than shown.
  //
  // The latitude null branch is essential. Without it the box would silently drop
  // every profile that has not shared a location - which is most of them, and all
  // of the accounts that explicitly chose not to. "No location" has to mean
  // "not distance-sorted", never "invisible".
  const radius = effective.distanceKm;
  const useBox =
    radius !== preferenceService.ANYWHERE_KM &&
    viewerLocation.latitude !== null &&
    viewerLocation.longitude !== null;

  let locationClause: Record<string, unknown> | undefined;
  if (useBox) {
    const latDelta = radius / 111.32;
    const lngDenom = 111.32 * Math.cos((viewerLocation.latitude! * Math.PI) / 180);
    // Near the poles a degree of longitude collapses; without this floor the box
    // width explodes or goes NaN and the query returns nothing.
    const lngDelta = Math.abs(lngDenom) < 0.01 ? 180 : radius / Math.abs(lngDenom);
    locationClause = {
      OR: [
        {
          latitude: {
            gte: viewerLocation.latitude! - latDelta,
            lte: viewerLocation.latitude! + latDelta,
          },
          longitude: {
            gte: viewerLocation.longitude! - lngDelta,
            lte: viewerLocation.longitude! + lngDelta,
          },
        },
        { latitude: null },
      ],
    };
  }

  const rows = await prisma.user.findMany({
    where: {
      id: { notIn: [...excluded, viewerId] },
      status: "ACTIVE",
      role: "USER",
      ...(gender ? { gender } : {}),
      ...(city ? { city } : {}),
      ...(gte || lte
        ? { dateOfBirth: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
        : {}),
      ...(locationClause ?? {}),
    },
    take: CANDIDATE_WINDOW,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
      bio: true,
      city: true,
      gender: true,
      dateOfBirth: true,
      language: true,
      mobileVerified: true,
      latitude: true,
      longitude: true,
    },
  });

  if (rows.length === 0) {
    return { results: [], count: 0, totalEligible: 0, windowTruncated: false };
  }

  // One query for every candidate's preferences. Doing this per candidate would be
  // the N+1 this feature could easily have shipped with.
  const preferenceRows = await prisma.userPreferences.findMany({
    where: { userId: { in: rows.map((r) => r.id) } },
    select: { userId: true, interests: true, languages: true, lifestyle: true },
  });
  const byUser = new Map(preferenceRows.map((p) => [p.userId, p]));

  const weights = await preferenceService.getMatchingWeights();

  const scored = rows.map((row) => {
    const theirPrefs = byUser.get(row.id);
    const result = preferenceService.scoreCandidate(
      effective,
      viewerLocation,
      {
        id: row.id,
        dateOfBirth: row.dateOfBirth,
        // Fall back to the single User.language field, which predates the
        // multi-select and is still what most accounts have set.
        language: row.language,
        latitude: row.latitude,
        longitude: row.longitude,
        interests: theirPrefs?.interests ?? [],
        // Parenthesised deliberately. Without the brackets, `??` binds tighter
        // than the conditional and this silently becomes
        // "(languages ?? language) ? [language] : []" - which replaces a
        // candidate's real saved languages with a single-element list whenever
        // that list happened to be non-empty.
        //
        // normaliseLanguage, not the raw value: User.language has always held
        // codes like "ta" while the catalogue holds names like "tamil", so using
        // the field verbatim would make every legacy account look like it speaks a
        // language nobody else selected.
        languages:
          theirPrefs?.languages ??
          (row.language ? [preferenceService.normaliseLanguage(row.language)] : []),
        lifestyle: preferenceService.parseLifestyle(theirPrefs?.lifestyle),
      },
      weights,
    );

    // Exact circle check. The bounding box admitted corners; this removes them.
    const beyondRadius =
      useBox &&
      result.distanceKm !== null &&
      result.distanceKm > radius * 1.0000001;

    return { row, result, beyondRadius };
  });

  const eligible = scored.filter((s) => !s.beyondRadius);

  const results = eligible
    .sort((a, b) => b.result.score - a.result.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map(({ row, result }) => ({
      id: row.id,
      fullName: row.fullName,
      avatarUrl: row.avatarUrl,
      bio: row.bio,
      city: row.city,
      gender: row.gender,
      age: preferenceService.ageFrom(row.dateOfBirth),
      language: row.language,
      mobileVerified: row.mobileVerified,
      // Coordinates are deliberately absent from this projection.
      distance: distanceBand(result.distanceKm),
      matchScore: result.score,
      reasons: result.reasons,
    }));

  return {
    results,
    count: results.length,
    totalEligible: eligible.length,
    // Surfaced so a thin feed is diagnosable rather than just looking broken.
    windowTruncated: rows.length === CANDIDATE_WINDOW,
  };
}
import { prisma } from "../config/database";

export const DATING_NEW_USER_HOURS = 48;

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

function ageBounds(minAge?: number, maxAge?: number) {
  const now = new Date();
  const gte = minAge
    ? new Date(now.getFullYear() - minAge - 1, now.getMonth(), now.getDate())
    : undefined;
  const lte = maxAge
    ? new Date(now.getFullYear() - maxAge, now.getMonth(), now.getDate())
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
  await prisma.like.upsert({
    where: { fromUserId_toUserId: { fromUserId, toUserId } },
    create: { fromUserId, toUserId, type },
    update: { type },
  });
  await prisma.pass.deleteMany({ where: { fromUserId, toUserId } });

  const reciprocal = await prisma.like.findFirst({
    where: { fromUserId: toUserId, toUserId: fromUserId },
    select: { id: true },
  });

  if (!reciprocal) {
    return { swipe: type, match: null };
  }

  const pair = canonicalPair(fromUserId, toUserId);
  const match = await prisma.match.upsert({
    where: { userAId_userBId: pair },
    create: pair,
    update: {},
  });

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
 * Discovery feed. Never returns contact fields: phone, email and exact
 * location stay server-side until a user explicitly shares them.
 */
export async function discover(viewerId: string, filters: DiscoveryFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
  const excluded = await excludedIds(viewerId);
  const { gte, lte } = ageBounds(filters.minAge, filters.maxAge);

  return prisma.user.findMany({
    where: {
      id: { notIn: [...excluded, viewerId] },
      status: "ACTIVE",
      role: "USER",
      ...(filters.gender ? { gender: filters.gender } : {}),
      ...(filters.city ? { city: filters.city } : {}),
      ...(gte || lte
        ? { dateOfBirth: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
        : {}),
    },
    take: limit,
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
    },
  });
}
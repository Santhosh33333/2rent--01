import { prisma } from "../config/database";
import { ensureConversation } from "./conversation";
import { notifyNewMessage } from "./messageNotifications";

/**
 * The one official "Nabri Community".
 *
 * Every account is a member: existing accounts are joined lazily the first time
 * they load their community list, and new accounts are joined at registration.
 * Regular members are read-only; only SUPER_ADMIN/ADMIN accounts may post,
 * comment or run polls there. Everything here is best-effort — none of it may
 * ever fail a signup or a community read, so callers catch and ignore.
 */

export const OFFICIAL_COMMUNITY_NAME = "Nabri Community";

export const OFFICIAL_COMMUNITY_DESCRIPTION =
  "The official Nabri community. Product news, announcements and updates from the Nabri team. Read along, and reach us from Support any time.";

/** Where the built-in welcome image lives once stored in Postgres. */
export const OFFICIAL_WELCOME_IMAGE_PATH = "/uploads/nabri-community-welcome.svg";
const OFFICIAL_WELCOME_IMAGE_KEY = "nabri-community-welcome.svg";

export const OFFICIAL_WELCOME_BODY = [
  "Welcome to Nabri — good to have you here!",
  "",
  "This is the official community. We post product news, new features and important updates here.",
  "",
  "Before you dive in:",
  "• Complete your profile and verification to unlock everything.",
  "• Be kind. Treat every member with respect.",
  "• Never share your phone number, address or financial details with anyone.",
  "• Report anything that feels wrong — the Nabri team reviews every report.",
  "",
  "Questions? Reach us any time from Support. Enjoy Nabri!",
].join("\n");

/**
 * A small branded banner, stored as a built-in asset. Kept as a constant so the
 * welcome image can never be edited away by an admin, and so it exists on a
 * fresh database without shipping a binary file through the deploy pipeline.
 */
const WELCOME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512" role="img" aria-label="Welcome to Nabri">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#9333ea"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.1" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="512" rx="48" fill="url(#bg)"/>
  <rect width="1024" height="512" rx="48" fill="url(#glow)"/>
  <circle cx="852" cy="120" r="140" fill="#ffffff" fill-opacity="0.08"/>
  <circle cx="140" cy="430" r="180" fill="#ffffff" fill-opacity="0.06"/>
  <text x="96" y="236" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">Welcome to Nabri</text>
  <text x="98" y="300" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="34" fill="#e9d5ff">Meet people, join communities, make plans.</text>
  <text x="98" y="356" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="26" fill="#c4b5fd">This is the official community — announcements live here.</text>
</svg>`;

/** Only these account roles may post, comment or poll in the official community. */
export function canPostInOfficialCommunity(role?: string | null): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * Store the built-in welcome image once and return its public path. Idempotent:
 * the key is unique, so a second call (or a racing first call) is a no-op.
 */
async function ensureWelcomeImage(): Promise<string> {
  try {
    const existing = await prisma.uploadedFile.findUnique({
      where: { key: OFFICIAL_WELCOME_IMAGE_KEY },
      select: { key: true },
    });
    if (!existing) {
      const data = Buffer.from(WELCOME_SVG, "utf8");
      await prisma.uploadedFile.create({
        data: {
          key: OFFICIAL_WELCOME_IMAGE_KEY,
          filename: OFFICIAL_WELCOME_IMAGE_KEY,
          mimeType: "image/svg+xml",
          size: data.length,
          data,
        },
      }).catch(() => {});
    }
  } catch {
    // A missing image must never stop the community from existing.
  }
  return OFFICIAL_WELCOME_IMAGE_PATH;
}

/** The account that owns the official community — the earliest super admin. */
async function resolveOwnerId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: { in: ["SUPER_ADMIN", "ADMIN"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/**
 * Find the official community, creating it (with its pinned welcome post) on
 * first use. Returns null when the database has no administrator yet, which is
 * the case on a brand-new install before any account exists.
 */
export async function getOrCreateOfficialCommunity() {
  const existing = await prisma.community.findFirst({ where: { isOfficial: true } });
  if (existing) return existing;

  const ownerId = await resolveOwnerId();
  if (!ownerId) return null;

  const imageUrl = await ensureWelcomeImage();

  // The community, its owner membership and the pinned welcome post must land
  // together: a community with no welcome post would leave every new member
  // staring at an empty page.
  const created = await prisma.$transaction(async (tx) => {
    const community = await tx.community.create({
      data: {
        name: OFFICIAL_COMMUNITY_NAME,
        description: OFFICIAL_COMMUNITY_DESCRIPTION,
        privacy: "PUBLIC",
        ownerId,
        memberCount: 1,
        isOfficial: true,
      },
    });
    await tx.communityMember.create({
      data: { communityId: community.id, userId: ownerId, role: "ADMIN" },
    });
    await tx.communityPost.create({
      data: {
        communityId: community.id,
        authorId: ownerId,
        content: OFFICIAL_WELCOME_BODY,
        imageUrl,
        isPinned: true,
      },
    });
    return community;
  }).catch(async () => {
    // A racing creator won the insert; adopt theirs.
    return prisma.community.findFirst({ where: { isOfficial: true } });
  });

  return created ?? null;
}

/**
 * Join a user to the official community if they are not already a member.
 *
 * Safe to call on every community-list read: the membership unique key makes a
 * repeat a no-op. Returns the community id (or null when none exists yet).
 */
export async function ensureOfficialMembership(userId: string): Promise<string | null> {
  try {
    const community = await getOrCreateOfficialCommunity();
    if (!community) return null;

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: community.id, userId } },
      select: { id: true },
    });
    if (existing) return community.id;

    await prisma.$transaction([
      prisma.communityMember.create({ data: { communityId: community.id, userId, role: "MEMBER" } }),
      prisma.community.update({ where: { id: community.id }, data: { memberCount: { increment: 1 } } }),
    ]).catch(() => {});
    return community.id;
  } catch {
    return null;
  }
}

/**
 * Send the built-in welcome as a private 1:1 message (text + image) from the
 * official Nabri account.
 *
 * Deliberately NOT a group thread and NOT tied to the community: the new user
 * simply gets a normal DM in Messages. Written directly rather than through the
 * messaging controller because there is no "ask before you message" gate to
 * clear here - this is the platform greeting its own new member.
 */
export async function sendOfficialWelcomeDM(userId: string): Promise<void> {
  try {
    const senderId = await resolveOwnerId();
    if (!senderId || senderId === userId) return;

    const imageUrl = await ensureWelcomeImage();
    const conversation = await ensureConversation(senderId, userId);

    // Two bubbles: the welcome words, then the branded banner. Explicit,
    // increasing createdAt so the thread always renders in that order even
    // though both rows land within the same millisecond.
    const base = Date.now();
    const textMessage = await prisma.message.create({
      data: {
        senderId,
        receiverId: userId,
        conversationId: conversation.id,
        content: OFFICIAL_WELCOME_BODY,
        messageType: "TEXT",
        status: "SENT",
        createdAt: new Date(base),
      },
      include: { sender: { select: { id: true, fullName: true, avatarUrl: true } } },
    });
    const imageMessage = await prisma.message.create({
      data: {
        senderId,
        receiverId: userId,
        conversationId: conversation.id,
        content: "",
        messageType: "IMAGE",
        mediaUrl: imageUrl,
        status: "SENT",
        createdAt: new Date(base + 1),
      },
    });

    // Keep the conversation list ordered; lastMessageId powers the preview.
    await prisma.conversation
      .update({
        where: { id: conversation.id },
        data: { updatedAt: new Date(base + 1), lastMessageId: imageMessage.id },
      })
      .catch(() => {});

    // Inbox entry + push. The Notification row is fanned out by the
    // Notification.create middleware to the realtime event and FCM, so an open
    // app still learns about the greeting without this module importing the
    // socket layer. Routes to /messages/<senderId>, i.e. this DM.
    void notifyNewMessage(userId, textMessage.sender, conversation.id, OFFICIAL_WELCOME_BODY);
  } catch {
    // Never let the welcome break a signup.
  }
}

/**
 * Welcome a new member: join them to the official community, then send the
 * built-in welcome text + image as a private 1:1 message. Best-effort
 * throughout - neither half may fail a signup.
 */
export async function welcomeToOfficialCommunity(userId: string): Promise<void> {
  try {
    await ensureOfficialMembership(userId);
  } catch {
    /* ignore */
  }
  await sendOfficialWelcomeDM(userId);
}

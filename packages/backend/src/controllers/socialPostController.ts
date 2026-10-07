import { Response } from "express";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

// ============================================================================
// SOCIAL FEED — GLOBAL POSTS
// ============================================================================
// The global feed, independent of the community walls. Post types:
// TEXT | PHOTO | VIDEO | QUESTION. Visibility: PUBLIC (any authenticated
// user), FOLLOWERS (accepted Friendship pairs), PRIVATE (author alone).
// Gifts move wallet money atomically: sender is debited inside the same
// transaction the recipient is credited, guarded by the sender's spendable
// balance (balance - heldBalance). Money is never created in the process.
// ============================================================================

const AUTHOR_SELECT = { id: true, fullName: true, avatarUrl: true } as const;

const POST_TYPES = ["TEXT", "PHOTO", "VIDEO", "QUESTION"] as const;
const VISIBILITIES = ["PUBLIC", "FOLLOWERS", "PRIVATE"] as const;

const GIFT_MIN = 5;
const GIFT_MAX = 500;

const POST_INCLUDE = {
  author: { select: AUTHOR_SELECT },
  _count: { select: { likes: true, comments: true, gifts: true } },
} satisfies Prisma.PostInclude;

class GiftAbort extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "GiftAbort";
  }
}

/** All users this user is in an ACCEPTED friendship with (either direction). */
async function acceptedFriendIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.requesterId);
    ids.add(r.addresseeId);
  }
  return ids;
}

async function canView(post: { authorId: string; visibility: string }, userId: string): Promise<boolean> {
  if (post.authorId === userId || post.visibility === "PUBLIC") return true;
  if (post.visibility !== "FOLLOWERS") return false; // PRIVATE → author only
  const friends = await acceptedFriendIds(userId);
  return friends.has(post.authorId);
}

// Best-effort notification. A failed write must never break the action that
// triggered it, so it wraps in its own try/catch (same pattern as the
// community comments). One row is enough for both delivery states: the
// Notification.create middleware in server.ts fans every row out to the
// user's live socket (`notification` event) and to FCM push, so an open app
// sees it instantly and a backgrounded app gets the tray notification.
function notify(userId: string, title: string, body: string, data: Record<string, unknown>): void {
  if (!userId) return;
  void (async () => {
    try {
      await prisma.notification.create({ data: { userId, title, body, data: JSON.stringify(data) } });
    } catch {
      /* never fail the action */
    }
  })();
}

/** Best-effort actor display name for notification copy ("Someone" when unknown). */
async function actorName(userId: string): Promise<string | null> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return u?.fullName?.trim() || null;
  } catch {
    return null;
  }
}

// ============================================================================
// POSTS
// ============================================================================

export async function createPost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { content, imageUrl, videoUrl } = req.body;
    const text = typeof content === "string" ? content.trim().slice(0, 2000) : "";
    const img = typeof imageUrl === "string" ? imageUrl.trim().slice(0, 500) : "";
    const vid = typeof videoUrl === "string" ? videoUrl.trim().slice(0, 500) : "";

    if (!text && !img && !vid) {
      sendError(res, "Add some text, a photo or a video.", 400, "VALIDATION_ERROR");
      return;
    }

    let type = typeof req.body.type === "string" ? String(req.body.type).toUpperCase() : "";
    if (!type) type = vid ? "VIDEO" : img ? "PHOTO" : "TEXT";
    if (!(POST_TYPES as readonly string[]).includes(type)) {
      sendError(res, `Post type must be one of: ${POST_TYPES.join(", ")}.`, 400, "VALIDATION_ERROR");
      return;
    }

    let visibility = typeof req.body.visibility === "string" ? String(req.body.visibility).toUpperCase() : "PUBLIC";
    if (!(VISIBILITIES as readonly string[]).includes(visibility)) {
      sendError(res, `Visibility must be one of: ${VISIBILITIES.join(", ")}.`, 400, "VALIDATION_ERROR");
      return;
    }

    const post = await prisma.post.create({
      data: {
        authorId: req.user!.userId,
        type,
        content: text || null,
        imageUrl: img || null,
        videoUrl: vid || null,
        visibility,
        publishedAt: new Date(),
      },
      include: POST_INCLUDE,
    });
    sendSuccess(res, { ...post, likedByMe: false, savedByMe: false, giftTotal: 0 }, "Post published.", 201);
  } catch {
    sendError(res, "Failed to publish post.", 500, "INTERNAL_ERROR");
  }
}

export async function uploadPostImage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "No image uploaded.", 400, "NO_FILE");
      return;
    }
    sendSuccess(res, { imageUrl: `/uploads/${(req.file as Express.Multer.File).filename}` }, "Image uploaded. Attach it when publishing the post.");
  } catch {
    sendError(res, "Failed to upload image.", 500, "INTERNAL_ERROR");
  }
}

export async function uploadPostVideo(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!req.file) {
      sendError(res, "No video uploaded.", 400, "NO_FILE");
      return;
    }
    sendSuccess(res, { videoUrl: `/uploads/${(req.file as Express.Multer.File).filename}` }, "Video uploaded. Attach it when publishing the post.");
  } catch {
    sendError(res, "Failed to upload video.", 500, "INTERNAL_ERROR");
  }
}

export async function listFeed(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const friends = await acceptedFriendIds(me);
    const friendIds = [...friends];
    const where = {
      status: "ACTIVE",
      OR: [
        { authorId: me },
        { visibility: "PUBLIC" },
        // FOLLOWERS posts are only in the feed when the author is an accepted
        // friend of the reader. Empty friend list makes that clause match
        // nothing, which is correct.
        { AND: [{ visibility: "FOLLOWERS" }, { authorId: { in: friendIds } }] },
      ],
    };

    const [items, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: POST_INCLUDE,
      }),
      prisma.post.count({ where }),
    ]);

    const ids = items.map((p) => p.id);
    const [likes, saves, giftAggs] = await Promise.all([
      ids.length ? prisma.postLike.findMany({ where: { postId: { in: ids }, userId: me }, select: { postId: true } }) : ([] as { postId: string }[]),
      ids.length ? prisma.postSave.findMany({ where: { postId: { in: ids }, userId: me }, select: { postId: true } }) : ([] as { postId: string }[]),
      ids.length
        ? prisma.gift.groupBy({ by: ["postId"], _sum: { amount: true }, where: { postId: { in: ids } } })
        : ([] as { postId: string; _sum: { amount: Prisma.Decimal | null } | null }[]),
    ]);
    const liked = new Set(likes.map((l) => l.postId));
    const saved = new Set(saves.map((s) => s.postId));
    const giftTotalByPost = new Map(
      giftAggs.map((g): [string, number] => [g.postId, Number(g._sum.amount ?? 0)])
    );

    sendSuccess(res, {
      items: items.map((p) => ({
        ...p,
        likedByMe: liked.has(p.id),
        savedByMe: saved.has(p.id),
        giftTotal: giftTotalByPost.get(p.id) ?? 0,
      })),
      page,
      limit,
      total,
    });
  } catch {
    sendError(res, "Failed to retrieve feed.", 500, "INTERNAL_ERROR");
  }
}

export async function getPost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id }, include: POST_INCLUDE });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (!(await canView(post, me))) {
      sendError(res, "You cannot view this post.", 403, "FORBIDDEN");
      return;
    }
    const [like, save, giftAgg] = await Promise.all([
      prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: me } } }),
      prisma.postSave.findUnique({ where: { postId_userId: { postId: id, userId: me } } }),
      prisma.gift.aggregate({ where: { postId: id }, _sum: { amount: true } }),
    ]);
    sendSuccess(res, { ...post, likedByMe: !!like, savedByMe: !!save, giftTotal: Number(giftAgg._sum.amount ?? 0) });
  } catch {
    sendError(res, "Failed to retrieve post.", 500, "INTERNAL_ERROR");
  }
}

export async function deletePost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true } });
    if (!post) {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (post.authorId !== req.user!.userId) {
      sendError(res, "Only the author can delete this post.", 403, "FORBIDDEN");
      return;
    }
    // Soft removal keeps comment/like/save rows intact for moderation audits
    // while hiding it from every public read (all reads filter status ACTIVE).
    await prisma.post.update({ where: { id }, data: { status: "REMOVED" } });
    sendSuccess(res, undefined, "Post deleted.");
  } catch {
    sendError(res, "Failed to delete post.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// LIKES + SAVES
// ============================================================================

export async function toggleLike(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    const existing = await prisma.postLike.findUnique({ where: { postId_userId: { postId: id, userId: me } } });
    let liked: boolean;
    if (existing) {
      await prisma.postLike.delete({ where: { id: existing.id } });
      liked = false;
    } else {
      // `type` is the reaction slot; only LIKE is accepted until the
      // REACTIONS feature flag turns richer reactions on.
      await prisma.postLike.create({ data: { postId: id, userId: me, type: "LIKE" } });
      liked = true;
      if (post.authorId !== me) {
        const name = (await actorName(me)) || "Someone";
        notify(post.authorId, "New like on your post", `${name} liked your post`, {
          postId: id,
          actorId: me,
          actorName: name,
          type: "POST_LIKE",
        });
      }
    }
    const likeCount = await prisma.postLike.count({ where: { postId: id } });
    sendSuccess(res, { liked, likeCount });
  } catch {
    sendError(res, "Failed to update like.", 500, "INTERNAL_ERROR");
  }
}

export async function toggleSave(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    const existing = await prisma.postSave.findUnique({ where: { postId_userId: { postId: id, userId: me } } });
    let saved: boolean;
    if (existing) {
      await prisma.postSave.delete({ where: { id: existing.id } });
      saved = false;
    } else {
      await prisma.postSave.create({ data: { postId: id, userId: me } });
      saved = true;
    }
    const saveCount = await prisma.postSave.count({ where: { postId: id } });
    sendSuccess(res, { saved, saveCount });
  } catch {
    sendError(res, "Failed to update saved state.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// COMMENTS
// ============================================================================

export async function createComment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const content = typeof req.body.content === "string" ? req.body.content.trim().slice(0, 1000) : "";
    if (!content) {
      sendError(res, "Comment content is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, visibility: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (!(await canView(post, me))) {
      sendError(res, "You cannot comment on this post.", 403, "FORBIDDEN");
      return;
    }
    const parentId = typeof req.body.parentId === "string" && req.body.parentId.trim() ? req.body.parentId.trim() : null;
    let parentAuthorId: string | null = null;
    if (parentId) {
      const parent = await prisma.postComment.findFirst({ where: { id: parentId, postId: id } });
      if (!parent) {
        sendError(res, "The comment you are replying to was not found.", 404, "COMMENT_NOT_FOUND");
        return;
      }
      parentAuthorId = parent.authorId;
    }
    const comment = await prisma.postComment.create({
      data: { postId: id, authorId: me, content, parentId },
      include: { author: { select: AUTHOR_SELECT } },
    });
    const commenter = comment.author?.fullName?.trim() || "Someone";
    if (post.authorId !== me) {
      notify(post.authorId, "New comment on your post", `${commenter} commented: ${content.slice(0, 120)}`, {
        postId: id,
        commentId: comment.id,
        parentId,
        actorId: me,
        actorName: commenter,
        type: "POST_COMMENT",
      });
    }
    // A reply also pings the person the reply answers, unless they are the post
    // author (already notified above) or themselves (self-replies are noise).
    if (parentId && parentAuthorId && parentAuthorId !== me && parentAuthorId !== post.authorId) {
      notify(parentAuthorId, "New reply to your comment", `${commenter} replied to your comment: ${content.slice(0, 120)}`, {
        postId: id,
        commentId: comment.id,
        parentCommentId: parentId,
        actorId: me,
        actorName: commenter,
        type: "POST_REPLY",
      });
    }
    sendSuccess(res, { ...comment, isMine: true }, "Comment added.", 201);
  } catch {
    sendError(res, "Failed to add comment.", 500, "INTERNAL_ERROR");
  }
}

export async function listComments(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, visibility: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (!(await canView(post, me))) {
      sendError(res, "You cannot view this post.", 403, "FORBIDDEN");
      return;
    }
    const [items, total] = await Promise.all([
      prisma.postComment.findMany({
        where: { postId: id, parentId: null, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: AUTHOR_SELECT }, _count: { select: { replies: true } } },
      }),
      prisma.postComment.count({ where: { postId: id, parentId: null, status: "ACTIVE" } }),
    ]);
    sendSuccess(res, {
      items: items.map((c) => ({ ...c, isMine: c.authorId === me })),
      page,
      limit,
      total,
    });
  } catch {
    sendError(res, "Failed to retrieve comments.", 500, "INTERNAL_ERROR");
  }
}

export async function listCommentReplies(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id, commentId } = req.params;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true, visibility: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (!(await canView(post, me))) {
      sendError(res, "You cannot view this post.", 403, "FORBIDDEN");
      return;
    }
    const [items, total] = await Promise.all([
      prisma.postComment.findMany({
        where: { postId: id, parentId: commentId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: AUTHOR_SELECT } },
      }),
      prisma.postComment.count({ where: { postId: id, parentId: commentId, status: "ACTIVE" } }),
    ]);
    sendSuccess(res, {
      items: items.map((c) => ({ ...c, isMine: c.authorId === me })),
      page,
      limit,
      total,
    });
  } catch {
    sendError(res, "Failed to retrieve replies.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteComment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, commentId } = req.params;
    const comment = await prisma.postComment.findFirst({ where: { id: commentId, postId: id } });
    if (!comment) {
      sendError(res, "Comment not found.", 404, "COMMENT_NOT_FOUND");
      return;
    }
    if (comment.authorId !== req.user!.userId) {
      sendError(res, "Only the author can delete this comment.", 403, "FORBIDDEN");
      return;
    }
    // Soft-delete keeps the reply tree coherent.
    await prisma.postComment.update({ where: { id: commentId }, data: { status: "REMOVED" } });
    sendSuccess(res, undefined, "Comment deleted.");
  } catch {
    sendError(res, "Failed to delete comment.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REPORTING
// ============================================================================

export async function reportPost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 500) : null;
    if (!reason) {
      sendError(res, "A reason is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, content: true, status: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (post.authorId === me) {
      sendError(res, "You cannot report your own post.", 400, "INVALID_ACTION");
      return;
    }
    const dupe = await prisma.postReport.findFirst({ where: { postId: id, reporterId: me, status: "PENDING" } });
    if (dupe) {
      sendError(res, "You already reported this post. Admins will review it.", 409, "ALREADY_REPORTED");
      return;
    }
    const report = await prisma.postReport.create({
      data: {
        postId: id,
        reporterId: me,
        reason,
        description:
          description ?? JSON.stringify({ excerpt: post.content?.slice(0, 300) ?? "", note: "Reported from the feed." }),
      },
    });
    sendSuccess(res, { id: report.id }, "Post reported. Admins will review it.", 201);
  } catch {
    sendError(res, "Failed to report post.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GIFTS — atomic wallet transfer
// ============================================================================

export async function sendGift(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;

    const amountNum = Number(req.body.amount);
    if (!Number.isFinite(amountNum) || amountNum < GIFT_MIN || amountNum > GIFT_MAX) {
      sendError(res, `Gift amount must be between ₹${GIFT_MIN} and ₹${GIFT_MAX}.`, 400, "VALIDATION_ERROR");
      return;
    }
    // Two decimal places max — reject anything finer before it reaches a wallet.
    if (Math.abs(amountNum * 100 - Math.round(amountNum * 100)) > 1e-6) {
      sendError(res, "Gift amount can have at most two decimal places.", 400, "VALIDATION_ERROR");
      return;
    }
    const amount = new Prisma.Decimal(amountNum.toFixed(2));

    const ref =
      typeof req.body.referenceId === "string" && req.body.referenceId.trim()
        ? req.body.referenceId.trim().slice(0, 64)
        : randomUUID();

    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (post.authorId === me) {
      sendError(res, "You cannot gift your own post.", 400, "INVALID_ACTION");
      return;
    }

    // Idempotency: a retried request with the same referenceId must not charge
    // twice. The pre-check covers the normal case; the unique constraint inside
    // the transaction absorbs the race and rolls the money move back.
    const before = await prisma.gift.findUnique({ where: { referenceId: ref } });
    if (before) {
      if (before.senderId !== me) {
        sendError(res, "This reference is already in use.", 409, "REFERENCE_IN_USE");
        return;
      }
      sendSuccess(res, { gift: before, reused: true }, "Gift already sent for this reference.");
      return;
    }

    try {
      const gift = await prisma.$transaction(async (tx) => {
        const senderWallet = await tx.wallet.upsert({
          where: { userId: me },
          update: {},
          create: { userId: me, balance: 0, promotionalBalance: 0, heldBalance: 0, currency: "INR" },
        });
        const recipientWallet = await tx.wallet.upsert({
          where: { userId: post.authorId },
          update: {},
          create: { userId: post.authorId, balance: 0, promotionalBalance: 0, heldBalance: 0, currency: "INR" },
        });

        // Spendable = balance - heldBalance (held = metered-call reservation).
        // The balance test lives in the WHERE so the debit can never outrun
        // the funds behind it, even under concurrent requests.
        const required = new Prisma.Decimal(senderWallet.heldBalance).plus(amount);
        const debited = await tx.wallet.updateMany({
          where: { id: senderWallet.id, balance: { gte: required } },
          data: { balance: { decrement: amount } },
        });
        if (debited.count !== 1) {
          throw new GiftAbort("INSUFFICIENT_BALANCE", "Insufficient wallet balance.");
        }

        await tx.wallet.update({ where: { id: recipientWallet.id }, data: { balance: { increment: amount } } });

        const giftRow = await tx.gift.create({
          data: { postId: id, senderId: me, recipientId: post.authorId, amount, referenceId: ref },
        });

        // Ledger convention: amount is always positive; `type` decides
        // direction. Both rows share the gift's referenceId so the transfer is
        // traceable end to end.
        await tx.transaction.createMany({
          data: [
            {
              walletId: senderWallet.id,
              userId: me,
              type: "GIFT_SENT",
              amount,
              description: `Gift on a post (${giftRow.id.slice(0, 8)})`,
              referenceId: ref,
            },
            {
              walletId: recipientWallet.id,
              userId: post.authorId,
              type: "GIFT_RECEIVED",
              amount,
              description: "Gift on your post",
              referenceId: ref,
            },
          ],
        });

        return giftRow;
      });

      if (post.authorId !== me) {
        const senderName = (await actorName(me)) || "Someone";
        notify(post.authorId, "You received a gift", `${senderName} sent you ₹${amountNum.toFixed(2)} on your post`, {
          postId: id,
          giftId: gift.id,
          amount: Number(amount),
          actorId: me,
          actorName: senderName,
          type: "POST_GIFT",
        });
      }
      sendSuccess(res, { gift, reused: false }, "Gift sent. The post author's wallet was credited.", 201);
    } catch (err) {
      if (err instanceof GiftAbort) {
        if (err.code === "INSUFFICIENT_BALANCE") {
          sendError(res, "Your wallet balance is too low for this gift.", 409, "INSUFFICIENT_BALANCE");
          return;
        }
        sendError(res, err.message, 400, "INVALID_ACTION");
        return;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Concurrent retry with the same referenceId: the winner's row already
        // committed. Return it as the result instead of a second charge.
        const winner = await prisma.gift.findUnique({ where: { referenceId: ref } });
        if (winner && winner.senderId === me) {
          sendSuccess(res, { gift: winner, reused: true }, "Gift already sent for this reference.");
          return;
        }
        sendError(res, "This reference is already in use.", 409, "REFERENCE_IN_USE");
        return;
      }
      sendError(res, "Failed to send gift.", 500, "INTERNAL_ERROR");
    }
  } catch {
    sendError(res, "Failed to send gift.", 500, "INTERNAL_ERROR");
  }
}

/** Who gifted a post, and how much — visible to the post author only. */
export async function listGifts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const me = req.user!.userId;
    const { id } = req.params;
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, status: true } });
    if (!post || post.status !== "ACTIVE") {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (post.authorId !== me) {
      sendError(res, "Only the post author can see gifts.", 403, "FORBIDDEN");
      return;
    }
    const [items, total, agg] = await Promise.all([
      prisma.gift.findMany({
        where: { postId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { sender: { select: AUTHOR_SELECT } },
      }),
      prisma.gift.count({ where: { postId: id } }),
      prisma.gift.aggregate({ where: { postId: id }, _sum: { amount: true } }),
    ]);
    sendSuccess(res, { items, total, totalAmount: Number(agg._sum.amount ?? 0) });
  } catch {
    sendError(res, "Failed to retrieve gifts.", 500, "INTERNAL_ERROR");
  }
}
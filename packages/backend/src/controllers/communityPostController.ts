import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

// ============================================================================
// COMMUNITY POSTS + COMMENTS (spec 104-105) — real DB rows, backend-enforced
// roles: OWNER (community.ownerId) > ADMIN > MODERATOR > MEMBER.
// - Read: PUBLIC open to authed users; PRIVATE members-only.
// - Post/comment: members only.
// - Delete post/comment: author, MODERATOR+, or owner.
// - Roles: owner or ADMIN may assign MODERATOR/MEMBER; only owner may
//   assign ADMIN or remove members.
// ============================================================================

const AUTHOR_SELECT = { id: true, fullName: true, avatarUrl: true } as const;

type Role = "OWNER" | "ADMIN" | "MODERATOR" | "MEMBER";

async function membership(communityId: string, userId: string) {
  const [community, member] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId } }),
    prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } } }),
  ]);
  return { community, member };
}

function roleOf(community: { ownerId: string } | null, member: { role: string } | null, userId: string): Role | null {
  if (!community) return null;
  if (community.ownerId === userId) return "OWNER";
  if (!member) return null;
  if (member.role === "ADMIN" || member.role === "MODERATOR" || member.role === "MEMBER") return member.role;
  return "MEMBER";
}

export function canRead(privacy: string, role: Role | null): boolean {
  if (privacy !== "PRIVATE") return true;
  return role !== null;
}

export async function createPost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { content, imageUrl } = req.body;
    if (!content || !String(content).trim()) {
      sendError(res, "Post content is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    if (!role) {
      sendError(res, "Join this community to post.", 403, "NOT_MEMBER");
      return;
    }
    const post = await prisma.communityPost.create({
      data: {
        communityId: id,
        authorId: req.user!.userId,
        content: String(content).trim().slice(0, 2000),
        imageUrl: typeof imageUrl === "string" ? imageUrl.slice(0, 500) : null,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });
    sendSuccess(res, post, "Post published.", 201);
  } catch {
    sendError(res, "Failed to publish post.", 500, "INTERNAL_ERROR");
  }
}

export async function listPosts(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    if (!canRead(community.privacy, role)) {
      sendError(res, "This is a private community.", 403, "FORBIDDEN");
      return;
    }
    const [items, total] = await Promise.all([
      prisma.communityPost.findMany({
        where: { communityId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: { select: AUTHOR_SELECT },
          _count: { select: { comments: true } },
        },
      }),
      prisma.communityPost.count({ where: { communityId: id } }),
    ]);
    // Mark posts authored by the owner/admins as announcements (spec 104).
    const authorIds = [...new Set(items.map((p) => p.authorId))];
    const authorMembers = authorIds.length
      ? await prisma.communityMember.findMany({ where: { communityId: id, userId: { in: authorIds } } })
      : [];
    const roleByUser = new Map(authorMembers.map((m) => [m.userId, m.role]));
    sendSuccess(res, {
      items: items.map((p) => ({
        ...p,
        authorRole: p.authorId === community.ownerId ? "OWNER" : roleByUser.get(p.authorId) ?? "MEMBER",
        isAnnouncement: p.authorId === community.ownerId || roleByUser.get(p.authorId) === "ADMIN",
      })),
      page, limit, total,
    });
  } catch {
    sendError(res, "Failed to retrieve posts.", 500, "INTERNAL_ERROR");
  }
}

export async function deletePost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId } = req.params;
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const post = await prisma.communityPost.findFirst({ where: { id: postId, communityId: id } });
    if (!post) {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    const isAuthor = post.authorId === req.user!.userId;
    if (!isAuthor && !(role === "OWNER" || role === "ADMIN" || role === "MODERATOR")) {
      sendError(res, "Only the author or a moderator can delete this post.", 403, "FORBIDDEN");
      return;
    }
    await prisma.communityPost.delete({ where: { id: postId } });
    sendSuccess(res, undefined, "Post deleted.");
  } catch {
    sendError(res, "Failed to delete post.", 500, "INTERNAL_ERROR");
  }
}

export async function createComment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId } = req.params;
    const { content } = req.body;
    if (!content || !String(content).trim()) {
      sendError(res, "Comment content is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    if (!role) {
      sendError(res, "Join this community to comment.", 403, "NOT_MEMBER");
      return;
    }
    const post = await prisma.communityPost.findFirst({ where: { id: postId, communityId: id }, select: { id: true } });
    if (!post) {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    const comment = await prisma.communityComment.create({
      data: { postId, authorId: req.user!.userId, content: String(content).trim().slice(0, 1000) },
      include: { author: { select: AUTHOR_SELECT } },
    });
    // Notify the post author (not for self-comments). Best-effort.
    void (async () => {
      try {
        const post = await prisma.communityPost.findUnique({ where: { id: postId }, select: { authorId: true, communityId: true } });
        if (post && post.authorId !== req.user!.userId) {
          await prisma.notification.create({
            data: {
              userId: post.authorId,
              title: "New comment on your post",
              body: `${comment.author?.fullName || "Someone"} commented: ${comment.content.slice(0, 120)}`,
              data: JSON.stringify({ communityId: post.communityId, postId, type: "COMMUNITY_COMMENT" }),
            },
          });
        }
      } catch { /* never fail the comment */ }
    })();
    sendSuccess(res, comment, "Comment added.", 201);
  } catch {
    sendError(res, "Failed to add comment.", 500, "INTERNAL_ERROR");
  }
}

export async function listComments(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    if (!canRead(community.privacy, role)) {
      sendError(res, "This is a private community.", 403, "FORBIDDEN");
      return;
    }
    const post = await prisma.communityPost.findFirst({ where: { id: postId, communityId: id }, select: { id: true } });
    if (!post) {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    const [items, total] = await Promise.all([
      prisma.communityComment.findMany({
        where: { postId },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: AUTHOR_SELECT } },
      }),
      prisma.communityComment.count({ where: { postId } }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch {
    sendError(res, "Failed to retrieve comments.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteComment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId, commentId } = req.params;
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const comment = await prisma.communityComment.findFirst({
      where: { id: commentId, postId, post: { communityId: id } },
    });
    if (!comment) {
      sendError(res, "Comment not found.", 404, "COMMENT_NOT_FOUND");
      return;
    }
    const role = roleOf(community, member, req.user!.userId);
    const isAuthor = comment.authorId === req.user!.userId;
    if (!isAuthor && !(role === "OWNER" || role === "ADMIN" || role === "MODERATOR")) {
      sendError(res, "Only the author or a moderator can delete this comment.", 403, "FORBIDDEN");
      return;
    }
    await prisma.communityComment.delete({ where: { id: commentId } });
    sendSuccess(res, undefined, "Comment deleted.");
  } catch {
    sendError(res, "Failed to delete comment.", 500, "INTERNAL_ERROR");
  }
}

// --- Content reporting (spec 106) ------------------------------------------------
// Reports land in the general Report queue (targetType COMMUNITY_POST /
// COMMUNITY_COMMENT) that admins already review and resolve. No separate
// moderation silo, no new tables.

export async function reportPost(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId } = req.params;
    const { reason, description } = req.body;
    if (!reason || !String(reason).trim()) {
      sendError(res, "A reason is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const post = await prisma.communityPost.findFirst({
      where: { id: postId, communityId: id },
      select: { id: true, authorId: true, content: true },
    });
    if (!post) {
      sendError(res, "Post not found.", 404, "POST_NOT_FOUND");
      return;
    }
    if (post.authorId === req.user!.userId) {
      sendError(res, "You cannot report your own post.", 400, "INVALID_ACTION");
      return;
    }
    const dupe = await prisma.report.findFirst({
      where: {
        reporterId: req.user!.userId,
        targetId: postId,
        targetType: "COMMUNITY_POST",
        status: "PENDING",
      },
    });
    if (dupe) {
      sendError(res, "You already reported this post. Admins will review it.", 409, "ALREADY_REPORTED");
      return;
    }
    const report = await prisma.report.create({
      data: {
        reporterId: req.user!.userId,
        targetId: postId,
        targetType: "COMMUNITY_POST",
        reason: String(reason).trim().slice(0, 200),
        description: JSON.stringify({
          postId,
          communityId: id,
          excerpt: post.content.slice(0, 300),
          note: typeof description === "string" ? description.slice(0, 500) : null,
        }),
      },
    });
    sendSuccess(res, { id: report.id }, "Post reported. Admins will review it.", 201);
  } catch {
    sendError(res, "Failed to report post.", 500, "INTERNAL_ERROR");
  }
}

export async function reportComment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, postId, commentId } = req.params;
    const { reason, description } = req.body;
    if (!reason || !String(reason).trim()) {
      sendError(res, "A reason is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const comment = await prisma.communityComment.findFirst({
      where: { id: commentId, postId, post: { communityId: id } },
      select: { id: true, authorId: true, content: true },
    });
    if (!comment) {
      sendError(res, "Comment not found.", 404, "COMMENT_NOT_FOUND");
      return;
    }
    if (comment.authorId === req.user!.userId) {
      sendError(res, "You cannot report your own comment.", 400, "INVALID_ACTION");
      return;
    }
    const dupe = await prisma.report.findFirst({
      where: {
        reporterId: req.user!.userId,
        targetId: commentId,
        targetType: "COMMUNITY_COMMENT",
        status: "PENDING",
      },
    });
    if (dupe) {
      sendError(res, "You already reported this comment. Admins will review it.", 409, "ALREADY_REPORTED");
      return;
    }
    const report = await prisma.report.create({
      data: {
        reporterId: req.user!.userId,
        targetId: commentId,
        targetType: "COMMUNITY_COMMENT",
        reason: String(reason).trim().slice(0, 200),
        description: JSON.stringify({
          commentId,
          postId,
          communityId: id,
          excerpt: comment.content.slice(0, 300),
          note: typeof description === "string" ? description.slice(0, 500) : null,
        }),
      },
    });
    sendSuccess(res, { id: report.id }, "Comment reported. Admins will review it.", 201);
  } catch {
    sendError(res, "Failed to report comment.", 500, "INTERNAL_ERROR");
  }
}

// --- Polls (spec 104) ----------------------------------------------------------
// Members create polls (2-6 options); members vote exactly once per poll but
// may change their vote — counts move transactionally with the vote rows.

async function requireMembership(communityId: string, userId: string) {
  const community = await prisma.community.findUnique({ where: { id: communityId } });
  if (!community) return { error: "COMMUNITY_NOT_FOUND" as const };
  const member = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });
  const role = roleOf(community, member, userId);
  if (!role) return { error: "NOT_MEMBER" as const };
  return { community, member, role };
}

export async function createPoll(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { question, options, closesAt } = req.body;
    if (!question || !String(question).trim()) {
      sendError(res, "A question is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const texts = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (texts.length < 2 || texts.length > 6) {
      sendError(res, "Provide 2 to 6 options.", 400, "VALIDATION_ERROR");
      return;
    }
    const membership = await requireMembership(id, req.user!.userId);
    if ("error" in membership) {
      sendError(res, membership.error === "COMMUNITY_NOT_FOUND" ? "Community not found." : "Join this community to create polls.", membership.error === "COMMUNITY_NOT_FOUND" ? 404 : 403, membership.error);
      return;
    }
    let closes: Date | null = null;
    if (closesAt) {
      closes = new Date(closesAt);
      if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) {
        sendError(res, "Closing time must be in the future.", 400, "VALIDATION_ERROR");
        return;
      }
    }
    const poll = await prisma.communityPoll.create({
      data: {
        communityId: id,
        authorId: req.user!.userId,
        question: String(question).trim().slice(0, 500),
        closesAt: closes,
        options: { create: texts.map((t) => ({ text: t.slice(0, 200) })) },
      },
      include: { author: { select: AUTHOR_SELECT }, options: true },
    });
    sendSuccess(res, poll, "Poll created.", 201);
  } catch {
    sendError(res, "Failed to create poll.", 500, "INTERNAL_ERROR");
  }
}

export async function listPolls(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const community = await prisma.community.findUnique({ where: { id } });
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const member = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: req.user!.userId } },
    });
    if (!canRead(community.privacy, roleOf(community, member, req.user!.userId))) {
      sendError(res, "This is a private community.", 403, "FORBIDDEN");
      return;
    }
    const [items, total] = await Promise.all([
      prisma.communityPoll.findMany({
        where: { communityId: id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: AUTHOR_SELECT }, options: { orderBy: { text: "asc" } } },
      }),
      prisma.communityPoll.count({ where: { communityId: id } }),
    ]);
    const pollIds = items.map((p) => p.id);
    const mine = pollIds.length
      ? await prisma.communityPollVote.findMany({ where: { pollId: { in: pollIds }, userId: req.user!.userId } })
      : [];
    const myVotes = new Map(mine.map((v) => [v.pollId, v.optionId]));
    sendSuccess(res, {
      items: items.map((p) => ({ ...p, myOptionId: myVotes.get(p.id) ?? null })),
      page, limit, total,
    });
  } catch {
    sendError(res, "Failed to retrieve polls.", 500, "INTERNAL_ERROR");
  }
}

export async function votePoll(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, pollId } = req.params;
    const { optionId } = req.body;
    if (!optionId) {
      sendError(res, "An option is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const membership = await requireMembership(id, req.user!.userId);
    if ("error" in membership) {
      sendError(res, "Join this community to vote.", 403, "NOT_MEMBER");
      return;
    }
    const poll = await prisma.communityPoll.findFirst({
      where: { id: pollId, communityId: id },
      include: { options: true },
    });
    if (!poll) {
      sendError(res, "Poll not found.", 404, "POLL_NOT_FOUND");
      return;
    }
    if (poll.closesAt && new Date(poll.closesAt).getTime() <= Date.now()) {
      sendError(res, "This poll is closed.", 409, "POLL_CLOSED");
      return;
    }
    if (!poll.options.some((o) => o.id === optionId)) {
      sendError(res, "Invalid option.", 400, "VALIDATION_ERROR");
      return;
    }
    await prisma.$transaction(async (tx) => {
      const existing = await tx.communityPollVote.findUnique({
        where: { pollId_userId: { pollId, userId: req.user!.userId } },
      });
      if (existing && existing.optionId === optionId) return;
      if (existing) {
        await tx.communityPollOption.update({ where: { id: existing.optionId }, data: { voteCount: { decrement: 1 } } });
        await tx.communityPollVote.update({ where: { id: existing.id }, data: { optionId } });
      } else {
        await tx.communityPollVote.create({ data: { pollId, optionId, userId: req.user!.userId } });
      }
      await tx.communityPollOption.update({ where: { id: optionId }, data: { voteCount: { increment: 1 } } });
    });
    const updated = await prisma.communityPoll.findUnique({
      where: { id: pollId },
      include: { options: { orderBy: { text: "asc" } } },
    });
    sendSuccess(res, updated, "Vote recorded.");
  } catch {
    sendError(res, "Failed to record vote.", 500, "INTERNAL_ERROR");
  }
}

export async function deletePoll(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, pollId } = req.params;
    const community = await prisma.community.findUnique({ where: { id } });
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const poll = await prisma.communityPoll.findFirst({ where: { id: pollId, communityId: id } });
    if (!poll) {
      sendError(res, "Poll not found.", 404, "POLL_NOT_FOUND");
      return;
    }
    const member = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: req.user!.userId } },
    });
    const role = roleOf(community, member, req.user!.userId);
    const isAuthor = poll.authorId === req.user!.userId;
    if (!isAuthor && !(role === "OWNER" || role === "ADMIN" || role === "MODERATOR")) {
      sendError(res, "Only the author or a moderator can delete this poll.", 403, "FORBIDDEN");
      return;
    }
    await prisma.communityPoll.delete({ where: { id: pollId } });
    sendSuccess(res, undefined, "Poll deleted.");
  } catch {
    sendError(res, "Failed to delete poll.", 500, "INTERNAL_ERROR");
  }
}

// --- Member management (spec 105) -------------------------------------------

export async function updateMemberRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, userId } = req.params;
    const { role } = req.body;
    if (!["ADMIN", "MODERATOR", "MEMBER"].includes(role)) {
      sendError(res, "Role must be ADMIN, MODERATOR or MEMBER.", 400, "VALIDATION_ERROR");
      return;
    }
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const actorRole = roleOf(community, member, req.user!.userId);
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      sendError(res, "Only the owner or an admin can manage roles.", 403, "FORBIDDEN");
      return;
    }
    if (role === "ADMIN" && actorRole !== "OWNER") {
      sendError(res, "Only the owner can assign ADMIN.", 403, "FORBIDDEN");
      return;
    }
    if (userId === community.ownerId) {
      sendError(res, "The owner's role cannot be changed.", 400, "INVALID_OPERATION");
      return;
    }
    const target = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId } },
    });
    if (!target) {
      sendError(res, "User is not a member.", 404, "NOT_MEMBER");
      return;
    }
    const updated = await prisma.communityMember.update({
      where: { communityId_userId: { communityId: id, userId } },
      data: { role },
    });
    sendSuccess(res, updated, "Member role updated.");
  } catch {
    sendError(res, "Failed to update member role.", 500, "INTERNAL_ERROR");
  }
}

export async function removeMember(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id, userId } = req.params;
    const { community, member } = await membership(id, req.user!.userId);
    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }
    const actorRole = roleOf(community, member, req.user!.userId);
    if (actorRole !== "OWNER" && actorRole !== "ADMIN") {
      sendError(res, "Only the owner or an admin can remove members.", 403, "FORBIDDEN");
      return;
    }
    if (userId === community.ownerId) {
      sendError(res, "The owner cannot be removed.", 400, "INVALID_OPERATION");
      return;
    }
    await prisma.$transaction([
      prisma.communityMember.delete({ where: { communityId_userId: { communityId: id, userId } } }),
      prisma.community.update({ where: { id }, data: { memberCount: { decrement: 1 } } }),
    ]);
    sendSuccess(res, undefined, "Member removed.");
  } catch {
    sendError(res, "Failed to remove member.", 500, "INTERNAL_ERROR");
  }
}

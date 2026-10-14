/**
 * General-purpose group chat.
 *
 * A group is a named, persistent set of members that anyone can create and
 * invite others into. It is deliberately built on its own tables
 * (ChatGroup/ChatGroupMember/ChatGroupMessage/ChatGroupInvite) rather than the
 * strictly two-party Conversation model — see the schema note on
 * EventGroupMessage for why retrofitting was avoided.
 *
 * Access rule throughout: you must be a member to read or post. Invitations are
 * the only way in besides the creator adding you at creation time.
 */
import { Response } from "express";
import { AuthedRequest } from "../middleware/authTypes";
import { prisma } from "../config/database";
import { sendError, sendSuccess } from "../utils/response";
import { emitToUser, isUserOnline } from "../services/socketService";
import { notifyGroupInvite, notifyGroupMessage } from "../services/messageNotifications";
import { classifyChatFile, resolveChatMedia, type ResolvedChatMedia } from "../services/chatUploadService";
import { removeBlob } from "../services/blobStorage";

const USER_SELECT = { id: true, fullName: true, avatarUrl: true } as const;
const ALLOWED_REACTIONS = ["love", "like", "laugh", "wow", "sad", "thanks", "fire", "clap"];
const MAX_NAME = 60;
const MAX_DESCRIPTION = 300;
const MAX_LENGTH = 5000;
const MAX_INVITE_BATCH = 100;

type Membership = NonNullable<Awaited<ReturnType<typeof findMembership>>>;

async function findMembership(groupId: string, userId: string) {
  return prisma.chatGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: { group: { select: { id: true, name: true, isActive: true, createdById: true } } },
  });
}

/** Member ids of a group, optionally excluding one user. */
async function memberIds(groupId: string, exceptUserId?: string): Promise<string[]> {
  const rows = await prisma.chatGroupMember.findMany({
    where: { groupId, ...(exceptUserId ? { userId: { not: exceptUserId } } : {}) },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Is a member reachable by the socket right now? Presence lookup only; a miss
 * (or a service not yet initialised) counts as offline so the notification is
 * sent — failing open here means one duplicate push, never a lost message.
 */
function memberIsOnline(userId: string): boolean {
  try {
    return isUserOnline(userId);
  } catch {
    return false;
  }
}

// ============================================================================
// GROUPS
// ============================================================================

export async function createGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const description =
      typeof req.body?.description === "string" ? req.body.description.trim().slice(0, MAX_DESCRIPTION) : null;
    const rawMembers: unknown = req.body?.memberIds;
    const memberIdsInput = Array.isArray(rawMembers)
      ? [...new Set(rawMembers.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== userId))]
      : [];

    if (!name) {
      sendError(res, "Group name is required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (name.length > MAX_NAME) {
      sendError(res, `Group name cannot be longer than ${MAX_NAME} characters.`, 400, "VALIDATION_ERROR");
      return;
    }
    if (memberIdsInput.length > 49) {
      sendError(res, "A group can start with at most 50 members.", 400, "VALIDATION_ERROR");
      return;
    }

    // Only real users can be added; silently dropping unknown ids would let a
    // caller believe everyone was added.
    if (memberIdsInput.length > 0) {
      const found = await prisma.user.findMany({
        where: { id: { in: memberIdsInput } },
        select: { id: true },
      });
      if (found.length !== memberIdsInput.length) {
        sendError(res, "One or more selected users do not exist.", 400, "INVALID_MEMBER");
        return;
      }
    }

    const group = await prisma.chatGroup.create({
      data: {
        name,
        description,
        createdById: userId,
        members: {
          create: [
            { userId, role: "OWNER" },
            ...memberIdsInput.map((id) => ({ userId: id, role: "MEMBER" })),
          ],
        },
      },
      include: { _count: { select: { members: true } } },
    });

    for (const id of memberIdsInput) {
      emitToUser(id, "chat_group_added", { groupId: group.id, name: group.name });
    }

    sendSuccess(res, { ...group, myRole: "OWNER" }, "Group created.", 201);
  } catch (err: any) {
    console.error("[createGroup]", err?.message);
    sendError(res, "Failed to create the group.", 500, "INTERNAL_ERROR");
  }
}

export async function getGroups(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const memberships = await prisma.chatGroupMember.findMany({
      where: { userId, group: { isActive: true } },
      include: {
        group: {
          include: {
            _count: { select: { members: true } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { sender: { select: USER_SELECT } },
            },
          },
        },
      },
    });

    const items = await Promise.all(
      memberships.map(async (m) => {
        const g = m.group;
        const last = g.messages[0] ?? null;
        const unreadCount = await prisma.chatGroupMessage.count({
          where: {
            groupId: g.id,
            senderId: { not: userId },
            status: { not: "DELETED" },
            ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
          },
        });
        return {
          groupId: g.id,
          name: g.name,
          avatarUrl: g.avatarUrl,
          memberCount: g._count.members,
          myRole: m.role,
          lastMessage: last ? (last.status === "DELETED" ? "[deleted]" : last.content) : null,
          lastMessageAt: last?.createdAt ?? null,
          lastSenderName: last?.sender?.fullName ?? null,
          unreadCount,
        };
      })
    );

    items.sort((a, b) => {
      const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return tb - ta;
    });

    sendSuccess(res, { items, total: items.length });
  } catch (err: any) {
    console.error("[getGroups]", err?.message);
    sendError(res, "Failed to load groups.", 500, "INTERNAL_ERROR");
  }
}

export async function getGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }

    const group = await prisma.chatGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
          include: { user: { select: USER_SELECT } },
        },
        _count: { select: { members: true, messages: true } },
      },
    });
    if (!group) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }

    sendSuccess(res, {
      id: group.id,
      name: group.name,
      description: group.description,
      avatarUrl: group.avatarUrl,
      createdById: group.createdById,
      createdAt: group.createdAt,
      myRole: membership.role,
      memberCount: group._count.members,
      messageCount: group._count.messages,
      members: group.members.map((mem) => ({
        userId: mem.userId,
        role: mem.role,
        joinedAt: mem.joinedAt,
        user: mem.user,
      })),
    });
  } catch (err: any) {
    console.error("[getGroup]", err?.message);
    sendError(res, "Failed to load the group.", 500, "INTERNAL_ERROR");
  }
}

export async function updateGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      sendError(res, "Only group admins can edit the group.", 403, "FORBIDDEN");
      return;
    }

    const data: { name?: string; description?: string | null; avatarUrl?: string | null } = {};
    if (typeof req.body?.name === "string") {
      const name = req.body.name.trim();
      if (!name || name.length > MAX_NAME) {
        sendError(res, `Group name must be 1-${MAX_NAME} characters.`, 400, "VALIDATION_ERROR");
        return;
      }
      data.name = name;
    }
    if (typeof req.body?.description === "string") {
      data.description = req.body.description.trim().slice(0, MAX_DESCRIPTION) || null;
    }
    if (typeof req.body?.avatarUrl === "string") {
      data.avatarUrl = req.body.avatarUrl.trim() || null;
    }

    const updated = await prisma.chatGroup.update({ where: { id: groupId }, data });

    for (const id of await memberIds(groupId, userId)) {
      emitToUser(id, "chat_group_updated", { groupId, name: updated.name, avatarUrl: updated.avatarUrl });
    }

    sendSuccess(res, updated, "Group updated.");
  } catch (err: any) {
    console.error("[updateGroup]", err?.message);
    sendError(res, "Failed to update the group.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    if (membership.role !== "OWNER") {
      sendError(res, "Only the group owner can delete the group.", 403, "FORBIDDEN");
      return;
    }

    const others = await memberIds(groupId, userId);
    // Hard delete cascades members/messages/invites.
    await prisma.chatGroup.delete({ where: { id: groupId } });
    for (const id of others) {
      emitToUser(id, "chat_group_deleted", { groupId });
    }
    sendSuccess(res, { id: groupId, deleted: true }, "Group deleted.");
  } catch (err: any) {
    console.error("[deleteGroup]", err?.message);
    sendError(res, "Failed to delete the group.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MEMBERS
// ============================================================================

export async function addMembers(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      sendError(res, "Only group admins can add members directly.", 403, "FORBIDDEN");
      return;
    }

    const raw: unknown = req.body?.userIds;
    const ids = Array.isArray(raw)
      ? [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== userId))]
      : [];
    if (ids.length === 0) {
      sendError(res, "Select at least one user to add.", 400, "VALIDATION_ERROR");
      return;
    }

    const found = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      sendError(res, "One or more selected users do not exist.", 400, "INVALID_MEMBER");
      return;
    }

    await prisma.$transaction(
      ids.map((id) =>
        prisma.chatGroupMember.upsert({
          where: { groupId_userId: { groupId, userId: id } },
          create: { groupId, userId: id, role: "MEMBER" },
          update: {},
        })
      )
    );
    // A direct add resolves any pending invite for that person.
    await prisma.chatGroupInvite.updateMany({
      where: { groupId, inviteeId: { in: ids }, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });

    for (const id of ids) {
      emitToUser(id, "chat_group_added", { groupId, name: membership.group.name });
    }
    for (const id of await memberIds(groupId, userId)) {
      emitToUser(id, "chat_group_member_added", { groupId });
    }

    sendSuccess(res, { added: ids.length }, "Members added.");
  } catch (err: any) {
    console.error("[addMembers]", err?.message);
    sendError(res, "Failed to add members.", 500, "INTERNAL_ERROR");
  }
}

export async function removeMember(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const targetId = req.params.userId;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      sendError(res, "Only group admins can remove members.", 403, "FORBIDDEN");
      return;
    }
    const target = await findMembership(groupId, targetId);
    if (!target) {
      sendError(res, "That person is not in this group.", 404, "MEMBER_NOT_FOUND");
      return;
    }
    // The owner cannot be removed by an admin; they must leave (which transfers
    // ownership) or delete the group.
    if (target.role === "OWNER") {
      sendError(res, "The group owner cannot be removed.", 403, "FORBIDDEN");
      return;
    }
    if (target.role === "ADMIN" && membership.role !== "OWNER") {
      sendError(res, "Only the owner can remove another admin.", 403, "FORBIDDEN");
      return;
    }

    await prisma.chatGroupMember.delete({ where: { groupId_userId: { groupId, userId: targetId } } });
    emitToUser(targetId, "chat_group_removed", { groupId });
    for (const id of await memberIds(groupId, userId)) {
      emitToUser(id, "chat_group_member_removed", { groupId, userId: targetId });
    }
    sendSuccess(res, { userId: targetId, removed: true }, "Member removed.");
  } catch (err: any) {
    console.error("[removeMember]", err?.message);
    sendError(res, "Failed to remove the member.", 500, "INTERNAL_ERROR");
  }
}

export async function leaveGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }

    const remaining = await memberIds(groupId, userId);
    // Last member out dissolves the group rather than leaving an orphan row no
    // one can ever see or delete.
    if (remaining.length === 0) {
      await prisma.chatGroup.delete({ where: { id: groupId } });
      sendSuccess(res, { groupId, left: true, dissolved: true }, "You left the group.");
      return;
    }

    await prisma.chatGroupMember.delete({ where: { groupId_userId: { groupId, userId } } });

    // An owner leaving hands ownership to an admin, else the earliest member, so
    // the group is never ownerless (which would make it unmanageable).
    if (membership.role === "OWNER") {
      const successor = await prisma.chatGroupMember.findFirst({
        where: { groupId },
        orderBy: [{ role: "desc" }, { joinedAt: "asc" }],
        select: { userId: true, role: true },
      });
      if (successor) {
        await prisma.chatGroupMember.update({
          where: { groupId_userId: { groupId, userId: successor.userId } },
          data: { role: "OWNER" },
        });
        await prisma.chatGroup.update({ where: { id: groupId }, data: { createdById: successor.userId } });
      }
    }

    for (const id of remaining) {
      emitToUser(id, "chat_group_member_removed", { groupId, userId });
    }
    sendSuccess(res, { groupId, left: true }, "You left the group.");
  } catch (err: any) {
    console.error("[leaveGroup]", err?.message);
    sendError(res, "Failed to leave the group.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// INVITES
// ============================================================================

export async function inviteToGroup(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }

    const raw: unknown = req.body?.userIds;
    const ids = Array.isArray(raw)
      ? [...new Set(raw.filter((v): v is string => typeof v === "string" && v.length > 0 && v !== userId))]
      : [];
    if (ids.length === 0) {
      sendError(res, "Select at least one person to invite.", 400, "VALIDATION_ERROR");
      return;
    }
    if (ids.length > MAX_INVITE_BATCH) {
      sendError(res, `You can invite at most ${MAX_INVITE_BATCH} people at once.`, 400, "VALIDATION_ERROR");
      return;
    }
    const message =
      typeof req.body?.message === "string" ? req.body.message.trim().slice(0, MAX_DESCRIPTION) : null;

    const found = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
    if (found.length !== ids.length) {
      sendError(res, "One or more selected users do not exist.", 400, "INVALID_MEMBER");
      return;
    }

    const existingMembers = await prisma.chatGroupMember.findMany({
      where: { groupId, userId: { in: ids } },
      select: { userId: true },
    });
    const alreadyIn = new Set(existingMembers.map((m) => m.userId));

    const inviter = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    const created: string[] = [];
    const skipped: string[] = [];

    for (const id of ids) {
      if (alreadyIn.has(id)) {
        skipped.push(id);
        continue;
      }
      // A prior DECLINED/CANCELLED invite is re-opened rather than duplicated
      // (the pair is unique), so re-inviting someone actually works.
      const invite = await prisma.chatGroupInvite.upsert({
        where: { groupId_inviteeId: { groupId, inviteeId: id } },
        create: { groupId, inviterId: userId, inviteeId: id, status: "PENDING", message },
        update:
          // Never downgrade an ACCEPTED invite; re-inviting an accepted member is
          // handled by the alreadyIn check above.
          { status: "PENDING", inviterId: userId, message, respondedAt: null },
      });
      created.push(invite.id);
      emitToUser(id, "chat_group_invite", {
        inviteId: invite.id,
        groupId,
        groupName: membership.group.name,
        inviter,
      });
      void notifyGroupInvite(id, inviter, groupId, membership.group.name);
    }

    sendSuccess(res, { invited: created.length, skipped, inviteIds: created }, "Invitation sent.");
  } catch (err: any) {
    console.error("[inviteToGroup]", err?.message);
    sendError(res, "Failed to send invitations.", 500, "INTERNAL_ERROR");
  }
}

export async function getMyInvites(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const invites = await prisma.chatGroupInvite.findMany({
      where: { inviteeId: userId, status: "PENDING", group: { isActive: true } },
      orderBy: { createdAt: "desc" },
      include: {
        group: { select: { id: true, name: true, avatarUrl: true, _count: { select: { members: true } } } },
        inviter: { select: USER_SELECT },
      },
    });
    const items = invites.map((inv) => ({
      inviteId: inv.id,
      groupId: inv.groupId,
      groupName: inv.group.name,
      groupAvatar: inv.group.avatarUrl,
      memberCount: inv.group._count.members,
      message: inv.message,
      inviter: inv.inviter,
      createdAt: inv.createdAt,
    }));
    sendSuccess(res, { items, total: items.length });
  } catch (err: any) {
    console.error("[getMyInvites]", err?.message);
    sendError(res, "Failed to load invitations.", 500, "INTERNAL_ERROR");
  }
}

export async function respondToInvite(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const inviteId = req.params.inviteId;
    const action = req.body?.action;
    if (action !== "accept" && action !== "decline") {
      sendError(res, "action must be 'accept' or 'decline'.", 400, "VALIDATION_ERROR");
      return;
    }

    const invite = await prisma.chatGroupInvite.findUnique({
      where: { id: inviteId },
      include: { group: { select: { id: true, name: true, isActive: true } } },
    });
    if (!invite || invite.inviteeId !== userId) {
      sendError(res, "Invitation not found.", 404, "INVITE_NOT_FOUND");
      return;
    }
    if (invite.status !== "PENDING") {
      sendError(res, "This invitation has already been answered.", 409, "ALREADY_ANSWERED");
      return;
    }

    if (action === "decline") {
      await prisma.chatGroupInvite.update({
        where: { id: inviteId },
        data: { status: "DECLINED", respondedAt: new Date() },
      });
      // Let the inviter know, if anyone is watching the group.
      emitToUser(invite.inviterId, "chat_group_invite_declined", {
        groupId: invite.groupId,
        userId,
      });
      sendSuccess(res, { status: "DECLINED" }, "Invitation declined.");
      return;
    }

    if (!invite.group.isActive) {
      sendError(res, "This group no longer exists.", 410, "GROUP_GONE");
      return;
    }

    const member = await prisma.$transaction(async (tx) => {
      const m = await tx.chatGroupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId } },
        create: { groupId: invite.groupId, userId, role: "MEMBER" },
        update: {},
      });
      await tx.chatGroupInvite.update({
        where: { id: inviteId },
        data: { status: "ACCEPTED", respondedAt: new Date() },
      });
      return m;
    });

    for (const id of await memberIds(invite.groupId, userId)) {
      emitToUser(id, "chat_group_member_added", { groupId: invite.groupId, userId });
    }

    sendSuccess(res, { status: "ACCEPTED", groupId: invite.groupId, memberId: member.id }, "You joined the group.");
  } catch (err: any) {
    console.error("[respondToInvite]", err?.message);
    sendError(res, "Failed to answer the invitation.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// MESSAGES
// ============================================================================

export async function getMessages(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const [rows, total] = await Promise.all([
      prisma.chatGroupMessage.findMany({
        where: { groupId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sender: { select: USER_SELECT },
          replyTo: { select: { id: true, content: true, senderId: true, messageType: true, status: true } },
        },
      }),
      prisma.chatGroupMessage.count({ where: { groupId } }),
    ]);
    const items = rows.reverse().map((m) => ({
      id: m.id,
      groupId: m.groupId,
      content: m.status === "DELETED" ? "[deleted]" : m.content,
      messageType: m.messageType,
      mediaUrl: m.status === "DELETED" ? null : m.mediaUrl,
      replyToId: m.replyToId,
      replyTo: (m as any).replyTo
        ? {
            id: (m as any).replyTo.id,
            content: (m as any).replyTo.status === "DELETED" ? "[deleted]" : (m as any).replyTo.content,
            senderId: (m as any).replyTo.senderId,
            messageType: (m as any).replyTo.messageType,
          }
        : null,
      reactions: m.reactions ?? {},
      status: m.status,
      createdAt: m.createdAt,
      sender: m.sender,
      isMine: m.senderId === userId,
    }));

    // Reading the thread clears the unread watermark (like the 1:1 messenger's
    // open-marks-read). Backgrounded so it never delays the response.
    void prisma.chatGroupMember
      .update({ where: { groupId_userId: { groupId, userId } }, data: { lastReadAt: new Date() } })
      .catch(() => {});

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    console.error("[getGroupMessages]", err?.message);
    sendError(res, "Failed to load the group chat.", 500, "INTERNAL_ERROR");
  }
}

export async function sendMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership || !membership.group.isActive) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }

    const rawType = typeof req.body?.messageType === "string" ? req.body.messageType.toUpperCase() : "TEXT";
    const type = ["TEXT", "IMAGE", "VOICE"].includes(rawType) ? rawType : "TEXT";
    let content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

    let resolvedMedia: ResolvedChatMedia | null = null;
    if (type === "IMAGE" || type === "VOICE") {
      resolvedMedia = resolveChatMedia(typeof req.body?.mediaUrl === "string" ? req.body.mediaUrl : null);
      if (!resolvedMedia) {
        sendError(res, "Upload the file first, then send with its mediaUrl.", 400, "MEDIA_REQUIRED");
        return;
      }
      const actual = classifyChatFile(resolvedMedia.filename);
      if ((type === "IMAGE" && actual !== "IMAGE") || (type === "VOICE" && actual !== "VOICE")) {
        sendError(res, "Media type does not match messageType.", 400, "MEDIA_MISMATCH");
        return;
      }
      if (content.length > 1000) {
        sendError(res, "Caption is too long (max 1000).", 400, "VALIDATION_ERROR");
        return;
      }
    } else {
      if (!content) {
        sendError(res, "Message cannot be empty.", 400, "VALIDATION_ERROR");
        return;
      }
      if (content.length > MAX_LENGTH) {
        sendError(res, `Message cannot be longer than ${MAX_LENGTH} characters.`, 400, "VALIDATION_ERROR");
        return;
      }
    }
    content = content.slice(0, type === "TEXT" ? MAX_LENGTH : 1000);

    // Replies must target a real, non-deleted message in the SAME group.
    let replyToId: string | null = null;
    if (typeof req.body?.replyToId === "string" && req.body.replyToId.trim()) {
      const parent = await prisma.chatGroupMessage.findUnique({
        where: { id: req.body.replyToId.trim() },
        select: { id: true, groupId: true, status: true },
      });
      if (!parent || parent.groupId !== groupId || parent.status === "DELETED") {
        sendError(res, "The message being replied to no longer exists.", 400, "INVALID_REPLY");
        return;
      }
      replyToId = parent.id;
    }

    const saved = await prisma.chatGroupMessage.create({
      data: {
        groupId,
        senderId: userId,
        content,
        messageType: type,
        mediaUrl: resolvedMedia ? (typeof req.body?.mediaUrl === "string" ? req.body.mediaUrl : null) : null,
        replyToId,
        status: "SENT",
      },
      include: {
        sender: { select: USER_SELECT },
        replyTo: { select: { id: true, content: true, senderId: true, messageType: true, status: true } },
      },
    });

    // Bump ordering; also move the sender's own read watermark forward.
    prisma.chatGroup
      .update({ where: { id: groupId }, data: { updatedAt: new Date() } })
      .catch(() => {});
    prisma.chatGroupMember
      .update({ where: { groupId_userId: { groupId, userId } }, data: { lastReadAt: new Date() } })
      .catch(() => {});

    const payload = {
      groupId,
      id: saved.id,
      messageId: saved.id,
      senderId: userId,
      content: saved.content,
      messageType: saved.messageType,
      mediaUrl: saved.mediaUrl,
      replyToId: saved.replyToId,
      replyTo: (saved as any).replyTo
        ? {
            id: (saved as any).replyTo.id,
            content: (saved as any).replyTo.content,
            senderId: (saved as any).replyTo.senderId,
            messageType: (saved as any).replyTo.messageType,
          }
        : null,
      reactions: saved.reactions ?? {},
      sender: saved.sender,
      timestamp: saved.createdAt,
    };

    const others = await memberIds(groupId, userId);
    for (const id of others) {
      // Live for anyone connected; only a member the socket could not reach
      // needs the inbox row + push. Notifying connected members as well would
      // double every group message as a push notification.
      emitToUser(id, "group_message", payload);
      if (!memberIsOnline(id)) {
        void notifyGroupMessage(id, saved.sender, groupId, membership.group.name, saved.content);
      }
    }

    sendSuccess(res, { ...payload, isMine: true }, "Message sent.", 201);
  } catch (err: any) {
    console.error("[sendGroupMessage]", err?.message);
    sendError(res, "Failed to send the message.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const messageId = req.params.messageId;
    const membership = await findMembership(groupId, userId);
    if (!membership) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    const existing = await prisma.chatGroupMessage.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, groupId: true, status: true, mediaUrl: true },
    });
    // Sender only: admins moderate membership, not speech, matching the 1:1
    // messenger and the event thread.
    if (!existing || existing.groupId !== groupId || existing.senderId !== userId || existing.status === "DELETED") {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }

    await prisma.chatGroupMessage.update({
      where: { id: messageId },
      data: { status: "DELETED", content: "[deleted]", mediaUrl: null },
    });
    if (existing.mediaUrl) {
      await removeBlob(existing.mediaUrl).catch(() => {});
    }

    for (const id of await memberIds(groupId, userId)) {
      emitToUser(id, "group_message_deleted", { groupId, messageId });
    }
    sendSuccess(res, { id: messageId, deleted: true }, "Message deleted.");
  } catch (err: any) {
    console.error("[deleteGroupMessage]", err?.message);
    sendError(res, "Failed to delete the message.", 500, "INTERNAL_ERROR");
  }
}

export async function toggleReaction(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const messageId = req.params.messageId;
    const emoji = req.body?.emoji;
    if (typeof emoji !== "string" || !ALLOWED_REACTIONS.includes(emoji)) {
      sendError(res, "Reaction must be one of: " + ALLOWED_REACTIONS.join(", ") + ".", 400, "VALIDATION_ERROR");
      return;
    }
    const membership = await findMembership(groupId, userId);
    if (!membership) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    const message = await prisma.chatGroupMessage.findUnique({ where: { id: messageId } });
    if (!message || message.groupId !== groupId || message.status === "DELETED") {
      sendError(res, "Message not found.", 404, "MESSAGE_NOT_FOUND");
      return;
    }

    const current = (message.reactions || {}) as Record<string, string[]>;
    const voters = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
    const has = voters.includes(userId);
    const next = { ...current, [emoji]: has ? voters.filter((v) => v !== userId) : [...voters, userId] };
    if (next[emoji].length === 0) delete (next as any)[emoji];

    const updated = await prisma.chatGroupMessage.update({ where: { id: messageId }, data: { reactions: next } });
    for (const id of await memberIds(groupId, userId)) {
      emitToUser(id, "group_message_reacted", { groupId, messageId, reactions: updated.reactions ?? {} });
    }
    sendSuccess(res, { reactions: updated.reactions ?? {} }, has ? "Reaction removed." : "Reaction added.");
  } catch (err: any) {
    console.error("[toggleGroupReaction]", err?.message);
    sendError(res, "Failed to react to the message.", 500, "INTERNAL_ERROR");
  }
}

export async function markRead(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const groupId = req.params.id;
    const membership = await findMembership(groupId, userId);
    if (!membership) {
      sendError(res, "Group not found.", 404, "GROUP_NOT_FOUND");
      return;
    }
    await prisma.chatGroupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { lastReadAt: new Date() },
    });
    sendSuccess(res, { groupId, read: true }, "Marked as read.");
  } catch (err: any) {
    console.error("[markGroupRead]", err?.message);
    sendError(res, "Failed to mark the group as read.", 500, "INTERNAL_ERROR");
  }
}

export type { Membership };

import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

// ============================================================================
// CREATE COMMUNITY
// ============================================================================

export async function createCommunity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { name, description, privacy, city } = req.body;

    if (!name) {
      sendError(res, "Community name is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const community = await prisma.community.create({
      data: {
        name,
        description: description || "",
        privacy: privacy ?? "PUBLIC",
        city: city || null,
        ownerId: req.user!.userId,
        memberCount: 1,
      },
    });

    // Add owner as admin member
    await prisma.communityMember.create({
      data: { communityId: community.id, userId: req.user!.userId, role: "ADMIN" },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "COMMUNITY_CREATE",
        entityType: "Community",
        entityId: community.id,
        metadata: JSON.stringify({ name }),
      },
    });

    sendSuccess(res, community, "Community created.", 201);
  } catch (err: any) {
    sendError(res, "Failed to create community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET COMMUNITIES
// ============================================================================

export async function getCommunities(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};

    if (req.query.privacy) where.privacy = req.query.privacy;
    if (req.query.city) where.city = req.query.city;

    const [items, total] = await Promise.all([
      prisma.community.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { select: { id: true, fullName: true, avatarUrl: true } },
          _count: { select: { members: true } },
        },
      }),
      prisma.community.count({ where }),
    ]);

    const itemsWithMemberCount = items.map(item => ({
      ...item,
      memberCount: item._count.members,
    }));

    sendSuccess(res, { items: itemsWithMemberCount, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve communities.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET COMMUNITY DETAIL
// ============================================================================

export async function getCommunityById(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const community = await prisma.community.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, fullName: true, avatarUrl: true } },
        _count: { select: { members: true } },
      },
    });

    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }

    // Check if user is member
    const isMember = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: req.user!.userId } },
    });

    const response = {
      ...community,
      memberCount: community._count.members,
      isMember: !!isMember,
      isOwner: community.ownerId === req.user!.userId,
    };

    sendSuccess(res, response, "Community retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// UPDATE COMMUNITY
// ============================================================================

export async function updateCommunity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, description, privacy, city } = req.body;

    const community = await prisma.community.findUnique({ where: { id } });

    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }

    // Only owner can update
    if (community.ownerId !== req.user!.userId) {
      sendError(res, "Only community owner can update.", 403, "FORBIDDEN");
      return;
    }

    const updated = await prisma.community.update({
      where: { id },
      data: {
        name: name || community.name,
        description: description !== undefined ? description : community.description,
        privacy: privacy || community.privacy,
        city: city !== undefined ? city : community.city,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "COMMUNITY_UPDATE",
        entityType: "Community",
        entityId: id,
        metadata: JSON.stringify({ name, description, privacy, city }),
      },
    });

    sendSuccess(res, updated, "Community updated.");
  } catch (err: any) {
    sendError(res, "Failed to update community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DELETE COMMUNITY
// ============================================================================

export async function deleteCommunity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const community = await prisma.community.findUnique({ where: { id } });

    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }

    // Only owner can delete
    if (community.ownerId !== req.user!.userId) {
      sendError(res, "Only community owner can delete.", 403, "FORBIDDEN");
      return;
    }

    await prisma.$transaction([
      prisma.communityMember.deleteMany({ where: { communityId: id } }),
      prisma.community.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "COMMUNITY_DELETE",
          entityType: "Community",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Community deleted.");
  } catch (err: any) {
    sendError(res, "Failed to delete community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// JOIN COMMUNITY
// ============================================================================

export async function joinCommunity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const community = await prisma.community.findUnique({ where: { id } });

    if (!community) {
      sendError(res, "Community not found.", 404, "COMMUNITY_NOT_FOUND");
      return;
    }

    const existing = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: req.user!.userId } },
    });

    if (existing) {
      sendError(res, "Already a member.", 409, "ALREADY_MEMBER");
      return;
    }

    await prisma.$transaction([
      prisma.communityMember.create({ data: { communityId: id, userId: req.user!.userId, role: "MEMBER" } }),
      prisma.community.update({ where: { id }, data: { memberCount: { increment: 1 } } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "COMMUNITY_JOIN",
          entityType: "Community",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Joined community.");
  } catch (err: any) {
    sendError(res, "Failed to join community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// LEAVE COMMUNITY
// ============================================================================

export async function leaveCommunity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const member = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: id, userId: req.user!.userId } },
    });

    if (!member) {
      sendError(res, "Not a member of this community.", 404, "NOT_MEMBER");
      return;
    }

    // Can't leave if you're the only owner
    const community = await prisma.community.findUnique({ where: { id } });
    if (community?.ownerId === req.user!.userId) {
      const adminCount = await prisma.communityMember.count({
        where: { communityId: id, role: "ADMIN" },
      });
      if (adminCount <= 1) {
        sendError(res, "Must have at least one admin. Transfer ownership before leaving.", 400, "INVALID_OPERATION");
        return;
      }
    }

    await prisma.$transaction([
      prisma.communityMember.delete({ where: { communityId_userId: { communityId: id, userId: req.user!.userId } } }),
      prisma.community.update({ where: { id }, data: { memberCount: { decrement: 1 } } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "COMMUNITY_LEAVE",
          entityType: "Community",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Left community.");
  } catch (err: any) {
    sendError(res, "Failed to leave community.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET COMMUNITY MEMBERS
// ============================================================================

export async function getCommunityMembers(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const [items, total] = await Promise.all([
      prisma.communityMember.findMany({
        where: { communityId: id },
        orderBy: { role: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
      }),
      prisma.communityMember.count({ where: { communityId: id } }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve community members.", 500, "INTERNAL_ERROR");
  }
}

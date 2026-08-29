import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { createNotification } from "./notificationController";
import { sendPushNotification } from "../services/notificationService";

export async function sendRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { addresseeId } = req.body;
    const userId = req.user!.userId;
    if (addresseeId === userId) {
      sendError(res, "Cannot send friend request to yourself.", 400, "INVALID_ACTION");
      return;
    }
    const addressee = await prisma.user.findUnique({ where: { id: addresseeId }, select: { id: true } });
    if (!addressee) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND");
      return;
    }
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: userId, addresseeId },
          { requesterId: addresseeId, addresseeId: userId },
        ],
      },
    });
    if (existing) {
      sendError(res, "Friend request already exists.", 400, "REQUEST_EXISTS");
      return;
    }
    const friendship = await prisma.friendship.create({
      data: { requesterId: userId, addresseeId, status: "PENDING" },
    });
    const reqName = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    void createNotification(
      addresseeId,
      "New friend request",
      `${reqName?.fullName ?? "Someone"} sent you a friend request.`,
      { type: "FRIEND_REQUEST", friendshipId: friendship.id }
    );
    void sendPushNotification(addresseeId, "New friend request", `${reqName?.fullName ?? "Someone"} sent you a friend request.`, { type: "FRIEND_REQUEST" });
    sendSuccess(res, friendship, "Friend request sent.", 201);
  } catch (err) {
    sendError(res, "Failed to send friend request.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) {
      sendError(res, "Friend request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (friendship.addresseeId !== req.user!.userId) {
      sendError(res, "Only the addressee can accept a friend request.", 403, "FORBIDDEN");
      return;
    }
    if (friendship.status !== "PENDING") {
      sendError(res, "Request is no longer pending.", 400, "INVALID_STATUS");
      return;
    }
    const updated = await prisma.friendship.update({
      where: { id },
      data: { status: "ACCEPTED" },
    });
    const addName = await prisma.user.findUnique({
      where: { id: friendship.addresseeId },
      select: { fullName: true },
    });
    void createNotification(
      friendship.requesterId,
      "Friend request accepted",
      `${addName?.fullName ?? "Someone"} accepted your friend request.`,
      { type: "FRIEND_ACCEPTED", friendshipId: friendship.id }
    );
    void sendPushNotification(friendship.requesterId, "Friend request accepted", `${addName?.fullName ?? "Someone"} accepted your friend request.`, { type: "FRIEND_ACCEPTED" });
    sendSuccess(res, updated, "Friend request accepted.");
  } catch (err) {
    sendError(res, "Failed to accept friend request.", 500, "INTERNAL_ERROR");
  }
}

export async function rejectRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) {
      sendError(res, "Friend request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (friendship.addresseeId !== req.user!.userId) {
      sendError(res, "Only the addressee can reject a friend request.", 403, "FORBIDDEN");
      return;
    }
    if (friendship.status !== "PENDING") {
      sendError(res, "Request is no longer pending.", 400, "INVALID_STATUS");
      return;
    }
    const updated = await prisma.friendship.update({
      where: { id },
      data: { status: "REJECTED" },
    });
    sendSuccess(res, updated, "Friend request rejected.");
  } catch (err) {
    sendError(res, "Failed to reject friend request.", 500, "INTERNAL_ERROR");
  }
}

export async function removeFriend(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const friendship = await prisma.friendship.findUnique({ where: { id } });
    if (!friendship) {
      sendError(res, "Friendship not found.", 404, "FRIENDSHIP_NOT_FOUND");
      return;
    }
    const userId = req.user!.userId;
    if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
      sendError(res, "Not part of this friendship.", 403, "FORBIDDEN");
      return;
    }
    await prisma.friendship.delete({ where: { id } });
    sendSuccess(res, undefined, "Friend removed.");
  } catch (err) {
    sendError(res, "Failed to remove friend.", 500, "INTERNAL_ERROR");
  }
}

export async function getFriends(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: userId, status: "ACCEPTED" },
          { addresseeId: userId, status: "ACCEPTED" },
        ],
      },
      include: {
        requester: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
        addressee: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
      },
    });
    sendSuccess(res, friendships, "Friends retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve friends.", 500, "INTERNAL_ERROR");
  }
}

export async function getFriendRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const requests = await prisma.friendship.findMany({
      where: { addresseeId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        requester: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
      },
    });
    sendSuccess(res, requests, "Friend requests retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve friend requests.", 500, "INTERNAL_ERROR");
  }
}

export async function getSuggestedFriends(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const existingFriendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
      select: { requesterId: true, addresseeId: true },
    });
    const excludeIds = new Set<string>([userId]);
    existingFriendships.forEach((f) => {
      excludeIds.add(f.requesterId);
      excludeIds.add(f.addresseeId);
    });
    const suggestions = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        status: "ACTIVE",
      },
      select: { id: true, fullName: true, avatarUrl: true, city: true, bio: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, suggestions, "Suggested friends retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve suggested friends.", 500, "INTERNAL_ERROR");
  }
}

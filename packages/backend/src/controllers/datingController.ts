import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import * as datingService from "../services/datingService";

function viewerId(req: AuthedRequest): string | undefined {
  return req.user?.userId;
}

export async function swipe(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const fromUserId = viewerId(req);
    if (!fromUserId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const { targetUserId, type } = req.body;
    const normalized = String(type ?? "").toUpperCase();

    if (!targetUserId || typeof targetUserId !== "string") {
      sendError(res, "Target user is required.", 400, "TARGET_REQUIRED");
      return;
    }
    if (!["LIKE", "PASS", "SUPER_LIKE"].includes(normalized)) {
      sendError(res, "Invalid swipe type.", 400, "INVALID_SWIPE_TYPE");
      return;
    }

    const result = await datingService.recordSwipe(
      fromUserId,
      targetUserId,
      normalized as "LIKE" | "PASS" | "SUPER_LIKE",
    );

    sendSuccess(
      res,
      { ...result, isMatch: Boolean(result.match) },
      result.match ? "It's a match!" : undefined,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "SWIPE_FAILED";
    if (code === "INVALID_TARGET") {
      sendError(res, "Invalid target.", 400, code);
      return;
    }
    if (code === "TARGET_NOT_FOUND") {
      sendError(res, "User not found.", 404, code);
      return;
    }
    if (code === "BLOCKED") {
      sendError(res, "Action not permitted.", 403, code);
      return;
    }
    sendError(res, "Could not record swipe.", 500, "SWIPE_FAILED");
  }
}

export async function discover(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = viewerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const { minAge, maxAge, city, gender, limit } = req.query;
    const num = (v: unknown) => (v === undefined ? undefined : Number(v));

    const results = await datingService.discover(userId, {
      minAge: num(minAge),
      maxAge: num(maxAge),
      city: city as string | undefined,
      gender: gender as string | undefined,
      limit: num(limit),
    });

    sendSuccess(res, { results, count: results.length });
  } catch {
    sendError(res, "Could not load discovery.", 500, "DISCOVERY_FAILED");
  }
}

export async function matches(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = viewerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const results = await datingService.listMatches(userId);
    sendSuccess(res, { results, count: results.length });
  } catch {
    sendError(res, "Could not load matches.", 500, "MATCHES_FAILED");
  }
}

export async function likes(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = viewerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const results = await datingService.likesReceived(userId);
    sendSuccess(res, { results, count: results.length });
  } catch {
    sendError(res, "Could not load likes.", 500, "LIKES_FAILED");
  }
}

export async function unmatch(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = viewerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const { matchId } = req.body;
    if (!matchId) {
      sendError(res, "Match id is required.", 400, "MATCH_REQUIRED");
      return;
    }

    const match = await prisma.match.findFirst({
      where: { id: matchId, OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!match) {
      sendError(res, "Match not found.", 404, "MATCH_NOT_FOUND");
      return;
    }

    await prisma.$transaction([
      prisma.match.update({ where: { id: matchId }, data: { isActive: false } }),
      prisma.like.deleteMany({
        where: {
          OR: [
            { fromUserId: match.userAId, toUserId: match.userBId },
            { fromUserId: match.userBId, toUserId: match.userAId },
          ],
        },
      }),
    ]);

    sendSuccess(res, { unmatch: true }, "Unmatched.");
  } catch {
    sendError(res, "Could not unmatch.", 500, "UNMATCH_FAILED");
  }
}
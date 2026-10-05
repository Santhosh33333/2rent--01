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
    // A request costs money, so "you cannot afford it" is a distinct outcome
    // from "something broke". 402 Payment Required says exactly that, and the
    // required/available figures let the client show what to top up rather than
    // a bare failure. Checked before the string codes below because this error
    // carries a message a user should read rather than a machine code.
    if (error instanceof datingService.InsufficientDatingBalanceError) {
      // The 4th parameter of sendError is `error` and the 5th is `extra`; the
      // figures go in `extra` because the 4th slot before it (_data) is
      // discarded by the helper, so passing them there would lose them silently.
      sendError(res, error.message, 402, error.code, undefined, {
        required: error.required,
        available: error.available,
        currency: "INR",
      });
      return;
    }
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

    // Number() accepts anything, so "abc" becomes NaN and -5 becomes a real bound.
    // The route already restricts these to integers in range, but the service is
    // also called from the agent tools and tests, so the coercion is made explicit
    // here rather than assumed. An unparseable value becomes undefined, which means
    // "no opinion" - the saved preference then applies instead of a NaN filter that
    // would match nobody.
    const num = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

    const discovered = await datingService.discover(userId, {
      minAge: num(minAge),
      maxAge: num(maxAge),
      city: typeof city === "string" && city.trim() ? city.trim() : undefined,
      gender: typeof gender === "string" && gender.trim() ? gender.trim() : undefined,
      limit: num(limit),
    });

    sendSuccess(res, discovered);
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
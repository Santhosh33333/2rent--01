import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

export async function createCall(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { receiverId, type } = req.body;
    if (receiverId === req.user!.userId) {
      sendError(res, "Cannot call yourself.", 400, "INVALID_RECEIVER");
      return;
    }
    const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true } });
    if (!receiver) {
      sendError(res, "Receiver not found.", 404, "RECEIVER_NOT_FOUND");
      return;
    }
    const call = await prisma.callLog.create({
      data: {
        callerId: req.user!.userId,
        receiverId,
        type: type || "VOICE",
        status: "MISSED",
        startedAt: new Date(),
      },
    });
    sendSuccess(res, call, "Call created.", 201);
  } catch (err) {
    sendError(res, "Failed to create call.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptCall(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const call = await prisma.callLog.findUnique({ where: { id } });
    if (!call) {
      sendError(res, "Call not found.", 404, "CALL_NOT_FOUND");
      return;
    }
    if (call.receiverId !== req.user!.userId) {
      sendError(res, "Only the receiver can accept a call.", 403, "FORBIDDEN");
      return;
    }
    if (call.status !== "MISSED") {
      sendError(res, "Call already has a status.", 400, "INVALID_STATUS");
      return;
    }
    const updated = await prisma.callLog.update({
      where: { id },
      data: { status: "ACCEPTED", startedAt: new Date() },
    });
    sendSuccess(res, updated, "Call accepted.");
  } catch (err) {
    sendError(res, "Failed to accept call.", 500, "INTERNAL_ERROR");
  }
}

export async function endCall(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const call = await prisma.callLog.findUnique({ where: { id } });
    if (!call) {
      sendError(res, "Call not found.", 404, "CALL_NOT_FOUND");
      return;
    }
    const userId = req.user!.userId;
    if (call.callerId !== userId && call.receiverId !== userId) {
      sendError(res, "Not part of this call.", 403, "FORBIDDEN");
      return;
    }
    const endedAt = new Date();
    const duration = call.startedAt
      ? Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000)
      : null;
    const updated = await prisma.callLog.update({
      where: { id },
      data: { status: "ENDED", endedAt, duration },
    });
    sendSuccess(res, updated, "Call ended.");
  } catch (err) {
    sendError(res, "Failed to end call.", 500, "INTERNAL_ERROR");
  }
}

export async function getCallHistory(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const [items, total] = await Promise.all([
      prisma.callLog.findMany({
        where: { OR: [{ callerId: userId }, { receiverId: userId }] },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          caller: { select: { id: true, fullName: true, avatarUrl: true } },
          receiver: { select: { id: true, fullName: true, avatarUrl: true } },
        },
      }),
      prisma.callLog.count({
        where: { OR: [{ callerId: userId }, { receiverId: userId }] },
      }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve call history.", 500, "INTERNAL_ERROR");
  }
}

export async function getCallLog(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const call = await prisma.callLog.findFirst({
      where: {
        id,
        OR: [{ callerId: userId }, { receiverId: userId }],
      },
      include: {
        caller: { select: { id: true, fullName: true, avatarUrl: true } },
        receiver: { select: { id: true, fullName: true, avatarUrl: true } },
      },
    });
    if (!call) {
      sendError(res, "Call log not found.", 404, "CALL_NOT_FOUND");
      return;
    }
    sendSuccess(res, call, "Call log retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve call log.", 500, "INTERNAL_ERROR");
  }
}

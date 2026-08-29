import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

function getPagination(req: AuthedRequest) {
  return { page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20 };
}

export async function createWalkingRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { startLocation, endLocation, startTime, durationMinutes, notes, fare } = req.body;
    const request = await prisma.walkingRequest.create({
      data: {
        requesterId: req.user!.userId,
        startLocation,
        endLocation,
        startTime: new Date(startTime),
        durationMinutes,
        notes,
        fare,
        status: "OPEN",
      },
    });
    sendSuccess(res, request, "Walking request created.", 201);
  } catch (err) {
    sendError(res, "Failed to create walking request.", 500, "INTERNAL_ERROR");
  }
}

export async function getWalkingRequests(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { page, limit } = getPagination(req);
    const where = req.query.status ? { status: req.query.status as any } : {};
    const [items, total] = await Promise.all([
      prisma.walkingRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { requester: { select: { id: true, fullName: true, avatarUrl: true } } },
      }),
      prisma.walkingRequest.count({ where }),
    ]);
    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve walking requests.", 500, "INTERNAL_ERROR");
  }
}

export async function getWalkingRequestById(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.walkingRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true, avatarUrl: true } },
        acceptedBy: { select: { id: true, fullName: true, avatarUrl: true } },
        applications: { include: { applicant: { select: { id: true, rating: true } } } },
      },
    });
    if (!request) {
      sendError(res, "Walking request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    sendSuccess(res, request, "Walking request retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve walking request.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptWalkingRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.walkingRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Walking request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.status !== "OPEN") {
      sendError(res, "Walking request is no longer open.", 400, "INVALID_STATUS");
      return;
    }
    if (request.requesterId === req.user!.userId) {
      sendError(res, "Cannot accept your own request.", 400, "INVALID_ACTION");
      return;
    }
    const partner = await prisma.partner.findUnique({ where: { userId: req.user!.userId }, select: { status: true, providesWalking: true } });
    if (!partner || partner.status !== "APPROVED") {
      sendError(res, "Approved partner status required.", 403, "PARTNER_REQUIRED");
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Atomic claim: only the first accepting partner wins
      const claimed = await tx.walkingRequest.updateMany({
        where: { id, status: "OPEN" },
        data: { status: "ACCEPTED", acceptedById: req.user!.userId },
      });
      if (claimed.count !== 1) {
        throw new Error("ALREADY_ACCEPTED");
      }
      await tx.walkingRequestApplication.upsert({
        where: { requestId_applicantId: { requestId: id, applicantId: req.user!.userId } },
        create: { requestId: id, applicantId: req.user!.userId, status: "ACCEPTED" },
        update: { status: "ACCEPTED" },
      });
    });
    sendSuccess(res, undefined, "Walking request accepted.");
  } catch (err: any) {
    if (err?.message === "ALREADY_ACCEPTED") {
      sendError(res, "Walking request is no longer open.", 409, "ALREADY_ACCEPTED");
    } else {
      sendError(res, "Failed to accept walking request.", 500, "INTERNAL_ERROR");
    }
  }
}

export async function withdrawApplication(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.walkingRequestApplication.updateMany({
      where: { requestId: id, applicantId: req.user!.userId, status: "PENDING" },
      data: { status: "WITHDRAWN" },
    });
    const open = await prisma.walkingRequestApplication.findFirst({
      where: { requestId: id, status: "ACCEPTED" },
    });
    if (!open) {
      await prisma.walkingRequest.update({ where: { id }, data: { status: "OPEN", acceptedById: null } });
    }
    sendSuccess(res, undefined, "Application withdrawn.");
  } catch (err) {
    sendError(res, "Failed to withdraw application.", 500, "INTERNAL_ERROR");
  }
}

export async function completeWalk(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.walkingRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Walking request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.acceptedById !== req.user!.userId) {
      sendError(res, "Only the assigned walking partner can complete the walk.", 403, "FORBIDDEN");
      return;
    }
    await prisma.walkingRequest.update({
      where: { id },
      data: { status: "COMPLETED", completedById: req.user!.userId, completedAt: new Date() },
    });
    if (request.fare) {
      await prisma.walkingPartner.update({
        where: { userId: req.user!.userId },
        data: { totalWalks: { increment: 1 }, totalEarnings: { increment: request.fare } },
      });
    }
    sendSuccess(res, undefined, "Walk marked complete.");
  } catch (err) {
    sendError(res, "Failed to complete walk.", 500, "INTERNAL_ERROR");
  }
}

export async function confirmWalkCompletion(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.walkingRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Walking request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.requesterId !== req.user!.userId) {
      sendError(res, "Only the requester can confirm completion.", 403, "FORBIDDEN");
      return;
    }
    if (request.fare && request.completedById) {
      // Atomic: credit wallet AND mark completed in a single transaction to
      // prevent double-credit from concurrent confirmations.
      const fare = request.fare;
      const partnerUserId = request.completedById;
      const wallet = await prisma.wallet.findUnique({ where: { userId: partnerUserId }, select: { id: true } });
      if (wallet) {
        const result = await prisma.$transaction(async (tx) => {
          // Latch: only the first confirmation wins
          const claimed = await tx.walkingRequest.updateMany({
            where: { id, confirmedAt: null },
            data: { confirmedAt: new Date(), status: "COMPLETED" },
          });
          if (claimed.count !== 1) return null;

          await tx.wallet.update({
            where: { userId: partnerUserId },
            data: { balance: { increment: fare } },
          });
          await tx.transaction.create({
            data: {
              walletId: wallet.id,
              userId: partnerUserId,
              type: "CREDIT",
              amount: fare,
              description: `Walk payout for request ${id}`,
            },
          });
          return true;
        });
        if (!result) {
          sendSuccess(res, undefined, "Walk completion already confirmed.");
          return;
        }
      } else {
        // No wallet found — still mark completed
        await prisma.walkingRequest.update({ where: { id }, data: { confirmedAt: new Date(), status: "COMPLETED" } });
      }
    } else {
      await prisma.walkingRequest.update({ where: { id }, data: { confirmedAt: new Date(), status: "COMPLETED" } });
    }
    sendSuccess(res, undefined, "Walk completion confirmed.");
  } catch (err) {
    sendError(res, "Failed to confirm walk completion.", 500, "INTERNAL_ERROR");
  }
}

export async function cancelWalkingRequest(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const request = await prisma.walkingRequest.findUnique({ where: { id } });
    if (!request) {
      sendError(res, "Walking request not found.", 404, "REQUEST_NOT_FOUND");
      return;
    }
    if (request.requesterId !== req.user!.userId) {
      sendError(res, "Only the requester can cancel the request.", 403, "FORBIDDEN");
      return;
    }
    if (request.status === "COMPLETED") {
      sendError(res, "Cannot cancel a completed request.", 400, "INVALID_STATUS");
      return;
    }
    await prisma.walkingRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    sendSuccess(res, undefined, "Walking request cancelled.");
  } catch (err) {
    sendError(res, "Failed to cancel walking request.", 500, "INTERNAL_ERROR");
  }
}

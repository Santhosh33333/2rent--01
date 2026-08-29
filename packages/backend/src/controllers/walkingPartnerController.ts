import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

export async function applyAsWalkingPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const existing = await prisma.walkingPartner.findUnique({ where: { userId: req.user!.userId } });
    if (existing && (existing.status === "APPROVED" || existing.status === "APPLIED")) {
      sendError(res, "Already applied or approved as walking partner.", 409, "ALREADY_APPLIED");
      return;
    }

    const verification = await prisma.verification.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true },
    });
    if (!verification || verification.status !== "VERIFIED") {
      sendError(res, "Complete identity verification before applying.", 403, "VERIFICATION_REQUIRED");
      return;
    }

    const data = existing
      ? { status: "APPLIED" as const }
      : { userId: req.user!.userId, status: "APPLIED" as const };

    await prisma.walkingPartner.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, status: "APPLIED" },
      update: data,
    });

    // Surface this applicant in the standard admin Partner pipeline so it can be
    // reviewed and approved. Without this, walking-partner applications were
    // orphaned (admins only see the Partner table) and could never be approved.
    await prisma.partner.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, status: "APPLIED", providesWalking: true, providesCarry: false },
      update: { status: "APPLIED", providesWalking: true },
    });

    sendSuccess(res, undefined, "Application submitted for review.");
  } catch (err) {
    sendError(res, "Failed to apply as walking partner.", 500, "INTERNAL_ERROR");
  }
}

export async function getWalkingPartnerStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.walkingPartner.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!partner) {
      sendSuccess(res, { status: "NONE" }, "Walking partner status retrieved.");
      return;
    }
    sendSuccess(res, partner, "Walking partner status retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve walking partner status.", 500, "INTERNAL_ERROR");
  }
}

export async function updateBankDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { accountName, accountNumber, ifsc } = req.body;
    await prisma.walkingPartner.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, status: "NONE", bankAccountName: accountName, bankAccountNumber: accountNumber, bankIfsc: ifsc },
      update: { bankAccountName: accountName, bankAccountNumber: accountNumber, bankIfsc: ifsc },
    });
    sendSuccess(res, undefined, "Bank details updated.");
  } catch (err) {
    sendError(res, "Failed to update bank details.", 500, "INTERNAL_ERROR");
  }
}

export async function updateUpiDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { upiId } = req.body;
    await prisma.walkingPartner.upsert({
      where: { userId: req.user!.userId },
      create: { userId: req.user!.userId, status: "NONE", upiId },
      update: { upiId },
    });
    sendSuccess(res, undefined, "UPI details updated.");
  } catch (err) {
    sendError(res, "Failed to update UPI details.", 500, "INTERNAL_ERROR");
  }
}

export async function getWalkingPartnerEarnings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const partner = await prisma.walkingPartner.findUnique({
      where: { userId: req.user!.userId },
      select: { totalWalks: true, totalEarnings: true, rating: true },
    });
    const completed = await prisma.walkingRequest.count({
      where: { completedById: req.user!.userId, status: "COMPLETED" },
    });
    sendSuccess(
      res,
      {
        totalEarnings: partner?.totalEarnings ?? 0,
        totalWalks: partner?.totalWalks ?? 0,
        rating: partner?.rating ?? 0,
        completedWalks: completed,
      },
      "Earnings retrieved."
    );
  } catch (err) {
    sendError(res, "Failed to retrieve earnings.", 500, "INTERNAL_ERROR");
  }
}

// User-facing Agreements API. Agreement rows are created server-side the moment
// a KYC is approved (see agreementService.createAndSendAgreements). Members may
// list/view their own agreements, accept them (a legally-bound acceptance with a
// timestamp) and receive the confirmation email.
import { AuthedRequest } from "../middleware/authTypes";
import { Response } from "express";
import { prisma } from "../config/database";
import { sendError, sendSuccess } from "../utils/response";
import { acceptAgreement } from "../services/agreementService";

export async function getMyAgreements(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const items = await prisma.agreement.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, kind: true, title: true, status: true,
        sentAt: true, acceptedAt: true, createdAt: true,
      },
    });
    sendSuccess(res, { items });
  } catch {
    sendError(res, "Failed to load agreements.", 500, "INTERNAL_ERROR");
  }
}

export async function getAgreementDetail(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const agreement = await prisma.agreement.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!agreement) {
      sendError(res, "Agreement not found.", 404, "NOT_FOUND");
      return;
    }
    sendSuccess(res, { agreement });
  } catch {
    sendError(res, "Failed to load agreement.", 500, "INTERNAL_ERROR");
  }
}

export async function acceptMyAgreement(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const result = await acceptAgreement(req.user!.userId, req.params.id);
    if (!result.ok) {
      sendError(res, result.error === "NOT_FOUND" ? "Agreement not found." : "Failed to accept agreement.", result.error === "NOT_FOUND" ? 404 : 500, result.error === "NOT_FOUND" ? "NOT_FOUND" : "INTERNAL_ERROR");
      return;
    }
    sendSuccess(res, undefined, "Agreement accepted. A confirmation has been emailed to you.");
  } catch {
    sendError(res, "Failed to accept agreement.", 500, "INTERNAL_ERROR");
  }
}
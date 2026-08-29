import { Response } from "express";
import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";

export async function getMyRoles(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        role: true,
        activeRole: true,
      },
    });

    if (!user) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    const approvedRoles: string[] = ["USER"];

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true, providesWalking: true, providesCarry: true },
    });

    if (partner && partner.status === "APPROVED") {
      approvedRoles.push("PARTNER");
    }

    const adminRoles = ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"];
    if (adminRoles.includes(user.role || "")) approvedRoles.push(user.role!);

    sendSuccess(res, {
      approvedRoles,
      activeRole: user.activeRole || user.role || "USER",
      baseRole: user.role,
    });
  } catch (err) {
    console.error("getMyRoles error:", err);
    sendError(res, "Failed to fetch roles.", 500, "INTERNAL_ERROR");
  }
}

export async function switchRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { role } = req.body;

    if (!role) {
      sendError(res, "Role is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        role: true,
        activeRole: true,
      },
    });

    if (!user) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    const allowedRoles: string[] = ["USER"];

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true, providesWalking: true, providesCarry: true },
    });

    if (partner && partner.status === "APPROVED") {
      allowedRoles.push("PARTNER");
    }

    const adminRoles = ["ADMIN", "SUPER_ADMIN", "MODERATOR", "SUPPORT", "FINANCE"];
    const isAdminTier = adminRoles.includes(user.role || "");
    if (isAdminTier) allowedRoles.push(user.role!);

    // Admin-tier accounts switching into the PARTNER view get a provisioned
    // APPROVED partner profile so they can inspect the full partner
    // experience without going through the public application flow.
    if (isAdminTier && role === "PARTNER" && (!partner || partner.status !== "APPROVED")) {
      await prisma.partner.upsert({
        where: { userId: req.user!.userId },
        update: { status: "APPROVED" },
        create: { userId: req.user!.userId, status: "APPROVED", providesWalking: true, providesCarry: true },
      });
    }

    if (!allowedRoles.includes(role)) {
      sendError(res, "Role not approved for this account.", 403, "FORBIDDEN");
      return;
    }

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { activeRole: role },
    });

    sendSuccess(res, { activeRole: role, message: `Switched to ${role}` });
  } catch (err) {
    console.error("switchRole error:", err);
    sendError(res, "Failed to switch role.", 500, "INTERNAL_ERROR");
  }
}

export async function applyForRole(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { role } = req.body;

    if (!role) {
      sendError(res, "Role is required.", 400, "VALIDATION_ERROR");
      return;
    }

    const validRoles = ["PARTNER"] as const;
    if (!(validRoles as readonly string[]).includes(role)) {
      sendError(res, "Invalid role for application.", 400, "VALIDATION_ERROR");
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
      select: { status: true },
    });

    if (partner && ["PENDING", "APPROVED"].includes(partner.status)) {
      sendError(res, "Partner application already exists.", 409, "CONFLICT");
      return;
    }

    await prisma.partner.upsert({
      where: { userId: req.user!.userId },
      update: { status: "PENDING" },
      create: {
        userId: req.user!.userId,
        status: "PENDING",
        providesWalking: true,
        providesCarry: true,
      },
    });

    sendSuccess(res, {
      message: "Your partner application has been submitted and is pending admin review. You will be notified once a decision is made.",
      status: "PENDING",
    });
  } catch (err) {
    console.error("applyForRole error:", err);
    sendError(res, "Failed to apply for role.", 500, "INTERNAL_ERROR");
  }
}

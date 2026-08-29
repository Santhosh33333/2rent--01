import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { ZodError } from "zod";

interface RoleApplicationCreateData {
  role: "PARTNER";
  data: any;
}

export async function submitRoleApplication(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { role, data } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      sendError(res, "User not found.", 401, "UNAUTHORIZED");
      return;
    }

    // Check if user already has a pending application for this role
    const existingApplication = await prisma.roleApplication.findFirst({
      where: { 
        userId, 
        role,
        status: "PENDING"
      }
    });

    if (existingApplication) {
      sendError(res, "You already have a pending application for this role.", 409, "DUPLICATE_APPLICATION");
      return;
    }

    // Validate role
    const validRoles = ["PARTNER"] as const;
    if (!validRoles.includes(role)) {
      sendError(res, "Invalid role specified.", 400, "INVALID_ROLE");
      return;
    }

    // Create role application
    const roleApplication = await prisma.roleApplication.create({
      data: {
        userId,
        role,
        data: JSON.stringify(data),
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            city: true,
          }
        }
      }
    });

    sendSuccess(res, { 
      application: roleApplication,
      id: roleApplication.id,
      status: "PENDING",
    }, "Role application submitted successfully.", 201);
  } catch (error) {
    console.error("Error submitting role application:", error);
    if (error instanceof ZodError) {
      sendError(res, "Invalid request data: " + error.errors.map(e => e.message).join(", "), 400, "VALIDATION_ERROR");
      return;
    }
    sendError(res, "Failed to submit role application.", 500, "INTERNAL_ERROR");
  }
}

export async function getUserRoleApplications(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      sendError(res, "User not found.", 401, "UNAUTHORIZED");
      return;
    }

    const roleApplications = await prisma.roleApplication.findMany({
      where: { userId },
      select: {
        id: true,
        role: true,
        status: true,
        data: true,
        reviewedBy: true,
        reviewedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    sendSuccess(res, { applications: roleApplications }, "User role applications retrieved successfully.");
  } catch (error) {
    console.error("Error getting user role applications:", error);
    sendError(res, "Failed to retrieve user role applications.", 500, "INTERNAL_ERROR");
  }
}

export async function getRoleApplications(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { status, role } = req.query;

    const where: any = {};
    if (status && typeof status === "string") {
      where.status = status;
    }
    if (role && typeof role === "string") {
      where.role = role;
    }

    const roleApplications = await prisma.roleApplication.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            city: true,
            status: true,
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    sendSuccess(res, { applications: roleApplications }, "Role applications retrieved successfully.");
  } catch (error) {
    console.error("Error getting role applications:", error);
    sendError(res, "Failed to retrieve role applications.", 500, "INTERNAL_ERROR");
  }
}

export async function getRoleApplication(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      sendError(res, "User not found.", 401, "UNAUTHORIZED");
      return;
    }

    const roleApplication = await prisma.roleApplication.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            city: true,
            role: true,
            status: true,
          }
        }
      }
    });

    if (!roleApplication) {
      sendError(res, "Role application not found.", 404, "NOT_FOUND");
      return;
    }

    // Check permissions — verify the REQUESTING user's role, not the applicant's
    const requestingUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, activeRole: true } });
    const isAdmin = ["ADMIN", "SUPER_ADMIN", "MODERATOR"].includes(requestingUser?.activeRole || requestingUser?.role || "");
    if (!isAdmin && roleApplication.userId !== userId) {
      sendError(res, "Access denied.", 403, "FORBIDDEN");
      return;
    }

    sendSuccess(res, { application: roleApplication }, "Role application retrieved successfully.");
  } catch (error) {
    console.error("Error getting role application:", error);
    sendError(res, "Failed to retrieve role application.", 500, "INTERNAL_ERROR");
  }
}

export async function approveRoleApplication(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reviewerId, reviewerNotes } = req.body;

    if (!reviewerId) {
      sendError(res, "Reviewer information required.", 400, "MISSING_FIELDS");
      return;
    }

    const roleApplication = await prisma.roleApplication.findUnique({
      where: { id },
      include: {
        user: true
      }
    });

    if (!roleApplication) {
      sendError(res, "Role application not found.", 404, "NOT_FOUND");
      return;
    }

    if (roleApplication.status !== "PENDING") {
      sendError(res, "Only pending applications can be approved.", 400, "INVALID_STATUS");
      return;
    }

    // Atomic: all three operations in a single transaction to prevent
    // inconsistent state if the process crashes between steps.
    let activeRole: string | undefined;
    if (roleApplication.role === "PARTNER") {
      activeRole = "PARTNER";
    }

    await prisma.$transaction(async (tx) => {
      if (activeRole) {
        await tx.partner.upsert({
          where: { userId: roleApplication.userId },
          update: { status: "APPROVED", providesWalking: true, providesCarry: true },
          create: { userId: roleApplication.userId, status: "APPROVED", providesWalking: true, providesCarry: true },
        });
      }

      await tx.roleApplication.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          rejectionReason: null,
        }
      });

      if (activeRole) {
        await tx.user.update({
          where: { id: roleApplication.userId },
          data: { activeRole },
          select: { id: true, activeRole: true, role: true }
        });
      }
    });

    sendSuccess(res, { 
      application: roleApplication,
      userId: roleApplication.userId,
      newRole: roleApplication.role,
    }, "Role application approved successfully.");
  } catch (error) {
    console.error("Error approving role application:", error);
    sendError(res, "Failed to approve role application.", 500, "INTERNAL_ERROR");
  }
}

export async function rejectRoleApplication(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reviewerId, rejectionReason } = req.body;

    if (!reviewerId || !rejectionReason) {
      sendError(res, "Reviewer information and rejection reason required.", 400, "MISSING_FIELDS");
      return;
    }

    const roleApplication = await prisma.roleApplication.findUnique({
      where: { id },
      include: {
        user: true
      }
    });

    if (!roleApplication) {
      sendError(res, "Role application not found.", 404, "NOT_FOUND");
      return;
    }

    if (roleApplication.status !== "PENDING") {
      sendError(res, "Only pending applications can be rejected.", 400, "INVALID_STATUS");
      return;
    }

    // Update role application
    await prisma.roleApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        rejectionReason,
      }
    });

    sendSuccess(res, { 
      application: roleApplication,
      rejectionReason,
    }, "Role application rejected successfully.");
  } catch (error) {
    console.error("Error rejecting role application:", error);
    sendError(res, "Failed to reject role application.", 500, "INTERNAL_ERROR");
  }
}

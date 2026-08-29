import { Request, Response, NextFunction } from "express";
import { authenticateToken } from "./auth";
import { AuthedRequest } from "./authTypes";
import { prisma } from "../config/database";
import { sendError } from "../utils/response";

const PRIVATE_PREFIX = "/private/";
// multer writes files as "<uuid><ext>"; restrict to that shape to block traversal.
const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp|gif)$/i;
const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT"];

function runAuthenticate(req: Request, res: Response): Promise<void> {
  return new Promise((resolve) => {
    authenticateToken(req as AuthedRequest, res, () => resolve());
  });
}

export async function requireDocumentAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.path.startsWith(PRIVATE_PREFIX)) {
    next();
    return;
  }

  await runAuthenticate(req, res);
  if (res.headersSent) return;

  try {
    const authed = req as AuthedRequest;
    if (!authed.user) {
      sendError(res, "Authentication required to view this document.", 401, "UNAUTHORIZED");
      return;
    }

    const filename = req.path.slice(PRIVATE_PREFIX.length);
    if (!FILENAME_RE.test(filename)) {
      sendError(res, "Invalid file.", 400, "INVALID_FILE");
      return;
    }

    const documentUrl = `/uploads/private/${filename}`;
    const verification = await prisma.verification.findFirst({
      where: { OR: [{ govIdUrl: documentUrl }, { selfieUrl: documentUrl }, { addressProofUrl: documentUrl }] },
      select: { userId: true },
    });

    const isOwner = verification?.userId === authed.user.userId;
    const isPrivileged = !!authed.user.activeRole && PRIVILEGED_ROLES.includes(authed.user.activeRole);

    if (!verification || (!isOwner && !isPrivileged)) {
      sendError(res, "You do not have access to this document.", 403, "FORBIDDEN");
      return;
    }

    next();
  } catch {
    sendError(res, "File access check failed.", 500, "INTERNAL_ERROR");
  }
}

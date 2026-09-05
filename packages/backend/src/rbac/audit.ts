import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { Request } from "express";

/**
 * Records a security-relevant admin action. Every financial, pricing, account,
 * KYC and security action must be traceable to the admin who performed it.
 *
 * Fields (spec section 5):
 *   Admin ID, Action, Section, Target ID, Old value, New value, Timestamp,
 *   IP/device information, Reason
 */
export async function auditAdminAction(params: {
  req?: AuthedRequest | Request;
  actorId: string;
  actorType?: string;
  action: string;
  section?: string;
  targetType?: string;
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const ip =
      (params.req?.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      (params.req as any)?.ip ||
      null;
    const userAgent = (params.req?.headers["user-agent"] as string) || null;
    const meta: Record<string, unknown> = {
      ...(params.metadata ?? {}),
      ip,
      userAgent,
      section: params.section,
      oldValue: params.oldValue,
      newValue: params.newValue,
      reason: params.reason,
    };
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        actorType: params.actorType ?? "ADMIN",
        action: params.action,
        entityType: params.targetType,
        entityId: params.targetId,
        metadata: JSON.stringify(meta),
        ipAddress: ip,
      },
    });
  } catch {
    // Audit must never break the primary operation.
  }
}

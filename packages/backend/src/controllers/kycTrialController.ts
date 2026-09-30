/**
 * Admin KYC trial grants.
 *
 * Lets an admin give one named user a bounded period of app access without
 * completed KYC, and take it back. Deliberately per-user and manual: a trial
 * that grants itself at signup is not a trial, it is a hole in KYC, and the
 * people worth admitting (testers, partners being onboarded, demo accounts)
 * are a small set the admin already knows by name.
 *
 * Every grant and revocation is written to the audit log, because "who let this
 * account in without KYC, and when" is exactly the question that gets asked
 * after an incident.
 */
import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { resolveTrialExpiry, MAX_TRIAL_DAYS, DEFAULT_TRIAL_DAYS } from "../services/kycTrialService";

/** Lists users an admin can pick from, with their current KYC/trial state. */
export async function listTrialCandidates(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const q = (req.query.q as string | undefined)?.trim() ?? "";
    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { fullName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        status: true,
        createdAt: true,
        verification: { select: { id: true, status: true, trialEndsAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const now = Date.now();
    sendSuccess(
      res,
      {
        defaultDays: DEFAULT_TRIAL_DAYS,
        maxDays: MAX_TRIAL_DAYS,
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          phone: u.phone,
          status: u.status,
          createdAt: u.createdAt,
          kycStatus: u.verification?.status ?? "NOT_STARTED",
          // Echoed as an ISO string; the admin UI needs to distinguish "trial
          // active until X" from "trial already over" without date math.
          trialEndsAt: u.verification?.trialEndsAt?.toISOString() ?? null,
          trialActive: !!u.verification?.trialEndsAt && u.verification.trialEndsAt.getTime() > now,
        })),
      },
      "Trial candidates loaded."
    );
  } catch (err) {
    console.error("[KYC_TRIAL] list failed:", err);
    sendError(res, "Could not load users.", 500, "INTERNAL_ERROR");
  }
}

/** Grants or extends a trial for one user. */
export async function grantKycTrial(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.params.id;
    const days = req.body?.days;
    const now = new Date();
    const trialEndsAt = resolveTrialExpiry(days, now);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, verification: { select: { id: true, status: true } } },
    });
    if (!user) {
      sendError(res, "User not found.", 404, "NOT_FOUND");
      return;
    }

    // An approved account does not need a trial; granting one would be a
    // no-op that looks like it did something in the audit log.
    if (user.verification && ["VERIFIED", "APPROVED"].includes(user.verification.status)) {
      sendError(res, "This user is already KYC verified.", 400, "ALREADY_VERIFIED");
      return;
    }

    // Upsert: a trial for someone who never opened the KYC flow still has to
    // work, otherwise the grant would need two code paths.
    const verification = await prisma.verification.upsert({
      where: { userId },
      create: { userId, status: "NOT_STARTED", trialEndsAt },
      update: { trialEndsAt },
      select: { id: true, status: true, trialEndsAt: true },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "ADMIN",
        action: "KYC_TRIAL_GRANT",
        entityType: "Verification",
        entityId: verification.id,
        metadata: JSON.stringify({ userId, email: user.email, days: req.body?.days ?? DEFAULT_TRIAL_DAYS, trialEndsAt: trialEndsAt.toISOString() }),
      },
    });

    sendSuccess(
      res,
      { userId, trialEndsAt: verification.trialEndsAt?.toISOString() ?? null },
      `Trial granted to ${user.email}.`
    );
  } catch (err: any) {
    if (err?.message === "TRIAL_DAYS_INVALID") {
      sendError(res, "Trial length must be a whole number of days, at least 1.", 400, "TRIAL_DAYS_INVALID");
      return;
    }
    if (typeof err?.message === "string" && err.message.startsWith("TRIAL_DAYS_MAX_")) {
      sendError(res, `Trial cannot exceed ${MAX_TRIAL_DAYS} days.`, 400, "TRIAL_DAYS_TOO_LONG");
      return;
    }
    console.error("[KYC_TRIAL] grant failed:", err);
    sendError(res, "Could not grant the trial.", 500, "INTERNAL_ERROR");
  }
}

/** Removes a trial immediately, putting the user back under the KYC gate. */
export async function revokeKycTrial(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.params.id;
    const verification = await prisma.verification.findUnique({
      where: { userId },
      select: { id: true, trialEndsAt: true },
    });
    if (!verification?.trialEndsAt) {
      sendError(res, "This user has no active trial.", 400, "NO_ACTIVE_TRIAL");
      return;
    }

    await prisma.verification.update({ where: { id: verification.id }, data: { trialEndsAt: null } });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "ADMIN",
        action: "KYC_TRIAL_REVOKE",
        entityType: "Verification",
        entityId: verification.id,
        metadata: JSON.stringify({ userId }),
      },
    });

    sendSuccess(res, { userId, trialEndsAt: null }, "Trial removed.");
  } catch (err) {
    console.error("[KYC_TRIAL] revoke failed:", err);
    sendError(res, "Could not remove the trial.", 500, "INTERNAL_ERROR");
  }
}

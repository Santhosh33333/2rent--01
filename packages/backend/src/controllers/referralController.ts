import { Request, Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

const DEFAULT_REFERRER_BONUS = 100;
const DEFAULT_REFEREE_BONUS = 50;

// Deterministic per-user code: "RB-" + first 8 chars of the user's UUID.
// Stable, collision-free at realistic scale, needs no extra storage, and the
// referrer can be resolved with an indexed primary-key prefix lookup.
function deriveCode(userId: string): string {
  return `RB-${userId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function readBonusConfig(key: string, fallback: number): Promise<number> {
  const config = await prisma.pricingConfig.findUnique({ where: { key } });
  const parsed = Number(config?.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function getMyReferralProfile(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const [invited, completed] = await Promise.all([
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.count({ where: { referrerId: userId, rewardClaimed: true } }),
    ]);
    sendSuccess(res, {
      code: deriveCode(userId),
      stats: { invited, completed },
    }, "Referral profile retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve referral profile.", 500, "INTERNAL_ERROR");
  }
}

export async function applyReferralCode(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const rawCode = String(req.body?.code ?? "").trim().toUpperCase();
    if (!/^RB-[0-9A-F]{8}$/.test(rawCode)) {
      sendError(res, "Invalid referral code format.", 400, "INVALID_CODE");
      return;
    }

    const existing = await prisma.referral.findUnique({ where: { referredId: userId } });
    if (existing) {
      sendError(res, "Your account has already used a referral code.", 409, "ALREADY_REFERRED");
      return;
    }

    // The 8 code chars are exactly the first segment of the referrer's UUID,
    // so an indexed primary-key prefix scan resolves them back to one user.
    const segment = rawCode.slice(3).toLowerCase();
    const matches = await prisma.user.findMany({
      where: { id: { startsWith: segment } },
      select: { id: true },
    });
    if (matches.length === 0) {
      sendError(res, "Referral code not found.", 404, "CODE_NOT_FOUND");
      return;
    }
    if (matches.length > 1) {
      sendError(res, "Ambiguous referral code.", 400, "AMBIGUOUS_CODE");
      return;
    }
    const referrerId = matches[0].id;

    if (referrerId === userId) {
      sendError(res, "You cannot use your own referral code.", 400, "SELF_REFERRAL");
      return;
    }

    const referral = await prisma.referral.create({
      data: { referrerId, referredId: userId, code: rawCode },
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "REFERRAL_APPLY",
        entityType: "Referral",
        entityId: referral.id,
        metadata: JSON.stringify({ referrerId }),
      },
    });

    sendSuccess(res, { referralId: referral.id, status: "PENDING" }, "Referral applied. Rewards unlock after your first completed booking.", 201);
  } catch (err: any) {
    if (err?.code === "P2002") {
      sendError(res, "Your account has already used a referral code.", 409, "ALREADY_REFERRED");
      return;
    }
    sendError(res, "Failed to apply referral code.", 500, "INTERNAL_ERROR");
  }
}

export async function listMyReferrals(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const referrals = await prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: { select: { id: true, fullName: true, avatarUrl: true, createdAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, {
      items: referrals.map((r) => ({
        id: r.id,
        user: r.referred,
        rewardClaimed: r.rewardClaimed,
        joinedAt: r.createdAt,
      })),
    }, "Referrals retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve referrals.", 500, "INTERNAL_ERROR");
  }
}

export function buildReferralRewardService(defaults: { referrer?: number; referee?: number } = {}) {
  return async function settleReferralRewardForUser(userId: string): Promise<void> {
    try {
      const referral = await prisma.referral.findUnique({ where: { referredId: userId } });
      if (!referral || referral.rewardClaimed) return;

      // Conditional claim: rewards settle exactly once even across concurrent
      // completions or replays.
      const claimed = await prisma.referral.updateMany({
        where: { id: referral.id, rewardClaimed: false },
        data: { rewardClaimed: true },
      });
      if (claimed.count !== 1) return;

      const referrerBonus = await readBonusConfig("REFERRAL_BONUS_REFERRER", defaults.referrer ?? DEFAULT_REFERRER_BONUS);
      const refereeBonus = await readBonusConfig("REFERRAL_BONUS_REFEREE", defaults.referee ?? DEFAULT_REFEREE_BONUS);

      const payouts: Array<{ userId: string; amount: number; role: string }> = [
        { userId: referral.referrerId, amount: referrerBonus, role: "REFERRER" },
        { userId: referral.referredId, amount: refereeBonus, role: "REFEREE" },
      ];

      for (const payout of payouts) {
        if (payout.amount <= 0) continue;
        let wallet = await prisma.wallet.findUnique({ where: { userId: payout.userId } });
        if (!wallet) wallet = await prisma.wallet.create({ data: { userId: payout.userId } });
        await prisma.$transaction([
          prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: payout.amount } } }),
          prisma.transaction.create({
            data: {
              userId: payout.userId,
              walletId: wallet.id,
              type: "CREDIT",
              status: "COMPLETED",
              amount: payout.amount,
              description: `Referral bonus (${payout.role.toLowerCase()})`,
              referenceId: `${referral.id}:${payout.role}`,
            },
          }),
        ]);
        await prisma.notification.create({
          data: {
            userId: payout.userId,
            title: "Referral bonus credited",
            body: `You received ₹${payout.amount} as a referral ${payout.role.toLowerCase()} bonus.`,
            data: JSON.stringify({ kind: "REFERRAL_BONUS", referralId: referral.id, role: payout.role }),
          },
        }).catch(() => {});
      }
    } catch (err) {
      // Reward settlement must never fail the booking completion path.
      console.error("settleReferralRewardForUser error:", err);
    }
  };
}

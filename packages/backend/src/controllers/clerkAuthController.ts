import { Request, Response } from "express";
import crypto from "crypto";
import { verifyClerkToken } from "../services/clerkService";
import { prisma } from "../config/database";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt";
import { sendSuccess, sendError } from "../utils/response";
import bcrypt from "bcryptjs";
import { env } from "../config/env";

export async function clerkSync(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.body;
    if (!token) {
      sendError(res, "Clerk session token is required.", 400, "MISSING_TOKEN");
      return;
    }

    const payload = await verifyClerkToken(token);
    if (!payload) {
      sendError(res, "Invalid or expired Clerk token.", 401, "INVALID_CLERK_TOKEN");
      return;
    }

    const clerkId = payload.sub as string;
    const email = (payload.email as string) || undefined;
    const phone = (payload.phone_number as string) || undefined;
    const fullName = ((payload.first_name as string) || "") + " " + ((payload.last_name as string) || "");
    const avatarUrl = (payload.image_url as string) || undefined;

    if (!clerkId) {
      sendError(res, "Clerk token missing user ID.", 401, "INVALID_CLERK_TOKEN");
      return;
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { clerkId },
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
    });

    if (user) {
      const updates: Record<string, any> = {};
      if (!user.clerkId) updates.clerkId = clerkId;
      if (email && !user.email) updates.email = email;
      if (phone && !user.phone) updates.phone = phone;
      if (avatarUrl && !user.avatarUrl) updates.avatarUrl = avatarUrl;

      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    } else {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), env.BCRYPT_SALT_ROUNDS);
      user = await prisma.user.create({
        data: {
          clerkId,
          email: email || `clerk-${clerkId}@rentbuddy.app`,
          phone: phone || `+91${clerkId.slice(0, 10)}`,
          passwordHash,
          fullName: fullName.trim() || "User",
          dateOfBirth: new Date("2000-01-01"),
          gender: "OTHER",
          emailVerified: !!email,
          mobileVerified: !!phone,
          avatarUrl,
        },
      });
      await prisma.wallet.create({ data: { userId: user.id } });
    }

    if (user.status !== "ACTIVE") {
      sendError(res, "Account is not active.", 403, "ACCOUNT_INACTIVE");
      return;
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken(user.id);
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    sendSuccess(
      res,
      {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          activeRole: user.activeRole,
          avatarUrl: user.avatarUrl,
        },
      },
      "Clerk sync successful."
    );
  } catch (err) {
    console.error("clerkSync error:", err);
    sendError(res, "Clerk sync failed.", 500, "INTERNAL_ERROR");
  }
}

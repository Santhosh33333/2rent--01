import { Request, Response } from "express";
import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";

// Real, privacy-safe discovery: surfaces actual platform members (public profile
// only) for the dating / movies / people categories. No fake or seeded profiles.
export async function getPeople(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const category = (req.query.category as string) || "people";
    const city = req.query.city as string | undefined;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const selfId = req.user!.userId;

    const where: any = {
      id: { not: selfId },
      role: { notIn: ["ADMIN", "SUPER_ADMIN"] },
      status: "ACTIVE",
    };
    if (city) where.city = { equals: city, mode: "insensitive" };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        city: true,
        bio: true,
        gender: true,
        dateOfBirth: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const people = users.map((u: any) => ({
      id: u.id,
      name: u.fullName,
      avatarUrl: u.avatarUrl,
      city: u.city,
      bio: u.bio,
      gender: u.gender,
      dateOfBirth: u.dateOfBirth,
      joinedAt: u.createdAt,
    }));

    sendSuccess(res, { category, count: people.length, people }, "Discovery results.");
  } catch (err: any) {
    sendError(res, "Failed to load discovery results.", 500, "INTERNAL_ERROR");
  }
}

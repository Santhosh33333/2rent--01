import { Request, Response } from "express";
import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";
import { isDemoEmail, DEMO_EMAILS } from "../utils/demo";

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
      // Demo sandbox fence: demos only ever see demos, real users never do.
      ...(isDemoEmail(req.user!.email)
        ? { email: { in: DEMO_EMAILS } }
        : { email: { notIn: DEMO_EMAILS } }),
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

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Nearby available partners. Privacy-first: callers learn a rounded
 * distance ("2.4 km away") and the partner's city — NEVER the partner's
 * exact coordinates. Distances use the partner's declared service-area
 * position, not live GPS.
 *
 * Query: lat, lon (caller position, never stored), radiusKm (default 10,
 * max 50), city, service=walking|carry, limit (max 50).
 */
export async function getNearbyPartners(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : NaN;
    const lon = req.query.lon !== undefined ? Number(req.query.lon) : NaN;
    const hasPosition = Number.isFinite(lat) && Number.isFinite(lon);
    const radiusKm = Math.min(50, Math.max(1, Number(req.query.radiusKm) || 10));
    const city = (req.query.city as string | undefined)?.trim();
    const service = (req.query.service as string | undefined)?.toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const where: any = { status: "APPROVED", isAvailable: true };
    if (service === "walking") where.providesWalking = true;
    else if (service === "carry") where.providesCarry = true;
    if (city) where.user = { city: { equals: city, mode: "insensitive" } };

    const partners = await prisma.partner.findMany({
      where,
      select: {
        id: true,
        providesWalking: true,
        providesCarry: true,
        rating: true,
        averageRating: true,
        completedJobs: true,
        latitude: true,
        longitude: true,
        user: { select: { id: true, fullName: true, avatarUrl: true, city: true, email: true } },
      },
      orderBy: { rating: "desc" },
      take: 200,
    });

    // Demo sandbox fence (privacy-safe: decided on emails, never exposed).
    const requesterIsDemo = isDemoEmail(req.user!.email);
    const visible = partners.filter((p: any) =>
      requesterIsDemo ? isDemoEmail(p.user?.email) : !isDemoEmail(p.user?.email)
    );

    const items = visible
      .map((p: any) => {
        const services: string[] = [];
        if (p.providesWalking) services.push("walking");
        if (p.providesCarry) services.push("carry");
        const item: any = {
          id: p.id,
          userId: p.user?.id ?? null,
          name: p.user?.fullName ?? "Partner",
          avatarUrl: p.user?.avatarUrl ?? null,
          city: p.user?.city ?? null,
          services,
          rating: p.averageRating || p.rating || 0,
          completedJobs: p.completedJobs || 0,
        };
        if (hasPosition && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
          item.distanceKm = Math.round(haversineKm(lat, lon, p.latitude, p.longitude) * 10) / 10;
        }
        return item;
      })
      .filter((item: any) => !hasPosition || item.distanceKm === undefined || item.distanceKm <= radiusKm)
      .sort((a: any, b: any) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999))
      .slice(0, limit);

    sendSuccess(
      res,
      { count: items.length, radiusKm: hasPosition ? radiusKm : undefined, partners: items },
      "Nearby partners."
    );
  } catch (err: any) {
    sendError(res, "Failed to load nearby partners.", 500, "INTERNAL_ERROR");
  }
}

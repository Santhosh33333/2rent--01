import { prisma } from "../config/database";
import { calculateDistance } from "../utils/location";
import { getServiceDef } from "./serviceCatalog";

function serviceLabel(type: string): string {
  return getServiceDef(type)?.label ?? type;
}

interface MatchingCriteria {
  serviceType: string;
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  startLocation: string;
  endLocation: string;
  durationMinutes?: number;
  userId: string; // booking user ID for blocking
}

interface PartnerScore {
  partnerId: string;
  userId: string;
  fullName: string;
  distance: number;
  rating: number;
  completedJobs: number;
  responseTime: number; // avg response time in seconds
  acceptanceRate: number; // percentage 0-100
  totalScore: number; // weighted final score
  availabilityMatch: boolean;
}

/**
 * Find best-matched partners for a booking using smart criteria:
 * 1. Distance proximity (within 5km radius)
 * 2. Service type availability
 * 3. Minimum rating (4.0+)
 * 4. High acceptance rate (80%+)
 * 5. Active and available
 * 6. Not currently with a user
 * 7. Not blocked by user
 */
export async function findMatchingPartners(
  bookingId: string,
  criteria: MatchingCriteria,
  limit: number = 5
): Promise<PartnerScore[]> {
  try {
    // Get the booking user to check blocks
    const bookingUser = await prisma.user.findUnique({
      where: { id: criteria.userId },
      include: { blocksInitiated: true, blocksReceived: true },
    });

    if (!bookingUser) {
      throw new Error("Booking user not found");
    }

    // Build list of blocked user IDs
    const blockedUserIds = new Set<string>();
    bookingUser.blocksInitiated.forEach((b) => blockedUserIds.add(b.blockedId));
    bookingUser.blocksReceived.forEach((b) => blockedUserIds.add(b.blockerId));

    // Query partners who:
    // - Provide the service type (WALKING/CARRY_BUDDY honour capability flags;
    //   other Expanded-Ecosystem services match any approved, available partner)
    // - Are active and approved
    // - Are currently available
    // - Haven't been blocked
    const capabilityFilter =
      criteria.serviceType === "WALKING"
        ? { providesWalking: true }
        : criteria.serviceType === "CARRY_BUDDY"
          ? { providesCarry: true }
          : {};
    const partners = await prisma.partner.findMany({
      where: {
        ...capabilityFilter,
        status: "APPROVED",
        isAvailable: true,
        user: {
          status: "ACTIVE",
          id: { notIn: Array.from(blockedUserIds) },
        },
        // Exclude partner if they have ongoing bookings (status not in completed/cancelled)
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            city: true,
          },
        },
      },
    });

    if (partners.length === 0) {
      return [];
    }

    // Score and rank partners
    const scoredPartners: PartnerScore[] = partners
      .map((partner) => {
        // Calculate distance (default to 0 if no coords provided)
        const distance =
          criteria.startLatitude && criteria.startLongitude
            ? calculateDistance(
                criteria.startLatitude,
                criteria.startLongitude,
                partner.latitude || 0,
                partner.longitude || 0
              )
            : 0;

        // Distance score (closer = higher, 5km is sweet spot)
        const distanceScore = Math.max(0, 100 - distance * 5); // 100 at 0km, 75 at 5km, 0 at 20km

        // Rating score (0-100, min 4.0 required)
        const minRating = 4.0;
        const ratingScore = partner.rating >= minRating
          ? Math.min(100, (partner.rating / 5) * 100)
          : 0;

        // Job completion score (more jobs = more reliable)
        const completionRate = partner.totalJobs > 0
          ? (partner.completedJobs / partner.totalJobs) * 100
          : 50; // Default to 50 for new partners
        const jobScore = Math.min(100, completionRate);

        // Response time (assume faster for higher-rated partners, slower for newer ones)
        const avgResponseTime = partner.completedJobs > 10 ? 30 : 60; // seconds

        // Acceptance rate (cancelled vs accepted)
        const acceptanceRate = partner.totalJobs > 0
          ? ((partner.totalJobs - partner.cancelledJobs) / partner.totalJobs) * 100
          : 80; // Default to 80 for new partners
        const acceptanceScore = acceptanceRate;

        // Availability match (time slots available)
        let availabilityMatch = true;
        if (partner.availabilityJson) {
          try {
            const availability = JSON.parse(partner.availabilityJson);
            const now = new Date();
            const dayOfWeek = now.getDay();
            const daysMap = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            const currentDay = daysMap[dayOfWeek].toLowerCase();
            const currentHour = now.getHours();
            const dayAvailability = availability[currentDay];
            availabilityMatch = dayAvailability && dayAvailability.includes(currentHour);
          } catch {
            availabilityMatch = true; // Assume available if parsing fails
          }
        }

        // Weighted scoring
        const weights = {
          distance: 0.3,
          rating: 0.25,
          jobCompletion: 0.2,
          acceptance: 0.15,
          availability: 0.1,
        };

        const totalScore =
          distanceScore * weights.distance +
          ratingScore * weights.rating +
          jobScore * weights.jobCompletion +
          acceptanceScore * weights.acceptance +
          (availabilityMatch ? 100 : 0) * weights.availability;

        return {
          partnerId: partner.id,
          userId: partner.userId,
          fullName: partner.user.fullName,
          distance,
          rating: partner.rating,
          completedJobs: partner.completedJobs,
          responseTime: avgResponseTime,
          acceptanceRate,
          totalScore,
          availabilityMatch,
        };
      })
      .filter((p) => p.totalScore > 40) // Filter out very poor matches
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit);

    return scoredPartners;
  } catch (err) {
    console.error("[MATCHING] Error finding partners:", err);
    return [];
  }
}

/**
 * Assign the best partner to a booking or trigger push notifications to multiple candidates
 * Returns the assigned partner or null if no suitable match found
 */
export async function assignPartnerToBooking(
  bookingId: string,
  criteria: MatchingCriteria
): Promise<{ partnerId: string; userId: string } | null> {
  try {
    // Find matching partners
    const matches = await findMatchingPartners(bookingId, criteria, 3);

    if (matches.length === 0) {
      return null;
    }

    // Get the booking
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new Error("Booking not found");
    }

    // Try direct assignment to best partner first (if score > 80).
    // Conditional update: never clobbers a booking that a partner already
    // accepted manually while matching was in flight.
    if (matches[0].totalScore > 80) {
      const bestMatch = matches[0];
      const claimed = await prisma.booking.updateMany({
        where: { id: bookingId, status: "PARTNER_SEARCHING", partnerId: null },
        data: {
          partnerId: bestMatch.partnerId,
          status: "PARTNER_ASSIGNED", // New status
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      const assigned = await prisma.booking.findUnique({ where: { id: bookingId } });

      // Send notification to partner
      await prisma.notification.create({
        data: {
          userId: bestMatch.userId,
          title: "New Booking Available",
          body: `${serviceLabel(booking.serviceType)} request from ${criteria.startLocation} to ${criteria.endLocation}`,
          data: JSON.stringify({
            bookingId,
            type: "BOOKING_REQUEST",
            estimatedEarning: booking.partnerEarning,
          }),
        },
      });

      return { partnerId: bestMatch.partnerId, userId: bestMatch.userId };
    }

    // Multi-candidate approach: Send push notifications to top 3 partners
    // They can accept/reject, first to accept wins
    for (const match of matches) {
      await prisma.notification.create({
        data: {
          userId: match.userId,
          title: `${serviceLabel(booking.serviceType)} Request Nearby`,
          body: `${match.distance.toFixed(1)}km away • ₹${booking.partnerEarning?.toFixed(0)} • ${criteria.durationMinutes ?? 30} min`,
          data: JSON.stringify({
            bookingId,
            type: "BOOKING_OFFER",
            estimatedEarning: booking.partnerEarning,
            distance: match.distance,
            score: match.totalScore,
          }),
        },
      });
    }

    // Create a matching request window (30 seconds for partners to respond)
    await prisma.bookingTimeout.upsert({
      where: { bookingId },
      update: {
        timeoutAt: new Date(Date.now() + 30000), // 30 second window
      },
      create: {
        bookingId,
        timeoutAt: new Date(Date.now() + 30000),
        isProcessed: false,
      },
    });

    return null; // Waiting for partner to accept
  } catch (err) {
    console.error("[ASSIGNMENT] Error assigning partner:", err);
    return null;
  }
}

/**
 * Get partner statistics for scoring
 */
export async function getPartnerStats(userId: string) {
  const partner = await prisma.partner.findUnique({
    where: { userId },
  });

  if (!partner) {
    return null;
  }

  const bookings = await prisma.booking.findMany({
    where: {
      partnerId: partner.id,
      status: { in: ["COMPLETED", "CANCELLED"] },
    },
  });

  const completedCount = bookings.filter((b) => b.status === "COMPLETED").length;
  const cancelledCount = bookings.filter((b) => b.status === "CANCELLED").length;

  return {
    completedJobs: completedCount,
    cancelledJobs: cancelledCount,
    totalJobs: bookings.length,
    acceptanceRate: bookings.length > 0 ? (completedCount / bookings.length) * 100 : 0,
  };
}

/**
 * Helper function to calculate haversine distance
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

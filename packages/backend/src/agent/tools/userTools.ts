import { z } from "zod";
import { prisma } from "../../config/database";
import { AgentToolError, registerTools, type AgentToolDef } from "../toolRegistry";

/**
 * Read-only user tools.
 *
 * Every handler reads live rows through the app's own Prisma client and returns
 * only fields the signed-in user is entitled to see about themselves. Nothing is
 * invented: when a record does not exist the tool says so, and the agent reports
 * that instead of filling the gap.
 *
 * Mutating and financial tools live in separate files and are added later, once
 * these read paths, the confirmation gate and the audit log are proven.
 */

const noArgs = z.object({}).strict();

function requireUser(ctx: { userId: string }): string {
  if (!ctx.userId) throw new AgentToolError("You need to be signed in.", "UNAUTHENTICATED", 401);
  return ctx.userId;
}

/** Age in whole years, or null when the DOB is absent or implausible. */
function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * WalkingRequest lifecycle as implemented in walkingRequestController:
 * OPEN -> ACCEPTED -> COMPLETED, with rejection returning it to OPEN.
 */
const ACTIVE_REQUEST_STATUSES = ["ACCEPTED"];

const userTools: AgentToolDef[] = [
  {
    name: "get_my_profile",
    description:
      "Get the signed-in user's own profile: name, city, gender, age, verification flags and account status. Returns only their own data.",
    inputSchema: noArgs,
    permission: "user",
    confirmationRequired: false,
    category: "profile",
    handler: async (ctx) => {
      const userId = requireUser(ctx);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          fullName: true,
          email: true,
          phone: true,
          city: true,
          gender: true,
          dateOfBirth: true,
          avatarUrl: true,
          bio: true,
          status: true,
          role: true,
          activeRole: true,
          emailVerified: true,
          mobileVerified: true,
        },
      });
      if (!user) throw new AgentToolError("No profile was found for this account.", "PROFILE_NOT_FOUND", 404);
      return {
        name: user.fullName,
        email: user.email,
        phone: user.phone,
        city: user.city,
        gender: user.gender,
        age: ageFrom(user.dateOfBirth),
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        status: user.status,
        accountType: user.activeRole || user.role,
        emailVerified: user.emailVerified,
        mobileVerified: user.mobileVerified,
      };
    },
  },

  {
    name: "get_my_subscription",
    description:
      "Get the signed-in user's subscription: plan, backend-configured price, trial status and remaining trial days, access expiry and next billing date. The price comes from backend configuration and must be quoted exactly.",
    inputSchema: noArgs,
    permission: "user",
    confirmationRequired: false,
    category: "payments",
    handler: async (ctx) => {
      const userId = requireUser(ctx);
      const sub = await prisma.subscription.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      });
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { accessUntil: true },
      });

      if (!sub) {
        return {
          hasSubscription: false,
          accessUntil: user?.accessUntil?.toISOString() ?? null,
          message: "This account has no subscription record yet.",
        };
      }

      const now = Date.now();
      const trialActive = Boolean(sub.trialEndsAt && sub.trialEndsAt.getTime() > now);
      const trialDaysLeft = trialActive
        ? Math.ceil((sub.trialEndsAt!.getTime() - now) / 86400000)
        : 0;

      return {
        hasSubscription: true,
        status: sub.status,
        authorizationStatus: sub.authorizationStatus,
        planName: sub.plan?.name ?? null,
        planCode: sub.plan?.code ?? null,
        // Backend-configured. The assistant presents this figure verbatim and
        // must never substitute its own idea of the price.
        price: sub.plan?.price ?? null,
        currency: sub.plan?.currency ?? null,
        durationDays: sub.plan?.durationDays ?? null,
        trialActive,
        trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
        trialDaysLeft,
        nextBillingAt: sub.nextBillingAt?.toISOString() ?? null,
        accessUntil: user?.accessUntil?.toISOString() ?? null,
        message: trialActive ? `Trial active, ${trialDaysLeft} day(s) left.` : "No active trial.",
      };
    },
  },

  {
    name: "get_my_requests",
    description:
      "List the signed-in user's own walking/companion requests with real statuses (OPEN, ACCEPTED, COMPLETED), most recent first. Use get_active_request for the one in progress.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
    permission: "user",
    confirmationRequired: false,
    category: "requests",
    handler: async (ctx, args) => {
      const userId = requireUser(ctx);
      const rows = await prisma.walkingRequest.findMany({
        where: { requesterId: userId },
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
          id: true,
          status: true,
          startLocation: true,
          endLocation: true,
          startTime: true,
          durationMinutes: true,
          fare: true,
          createdAt: true,
        },
      });
      return {
        count: rows.length,
        requests: rows.map((r) => ({
          id: r.id,
          status: r.status,
          from: r.startLocation,
          to: r.endLocation,
          startTime: r.startTime?.toISOString() ?? null,
          durationMinutes: r.durationMinutes,
          fare: r.fare !== null ? Number(r.fare) : null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  },

  {
    name: "get_active_request",
    description:
      "Get the signed-in user's request that is currently accepted/in progress, if any. Reports none when there is no active request.",
    inputSchema: noArgs,
    permission: "user",
    confirmationRequired: false,
    category: "requests",
    handler: async (ctx) => {
      const userId = requireUser(ctx);
      const row = await prisma.walkingRequest.findFirst({
        where: { requesterId: userId, status: { in: ACTIVE_REQUEST_STATUSES } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          startLocation: true,
          endLocation: true,
          startTime: true,
          durationMinutes: true,
          fare: true,
          createdAt: true,
        },
      });
      if (!row) return { hasActiveRequest: false };
      return {
        hasActiveRequest: true,
        request: {
          id: row.id,
          status: row.status,
          from: row.startLocation,
          to: row.endLocation,
          startTime: row.startTime?.toISOString() ?? null,
          durationMinutes: row.durationMinutes,
          fare: row.fare !== null ? Number(row.fare) : null,
          createdAt: row.createdAt.toISOString(),
        },
      };
    },
  },

  {
    name: "search_partners",
    description:
      "Find currently available walking partners near a city, or near the user's location when they ask for 'near me' and location permission has been granted. Returns real availability only.",
    inputSchema: z
      .object({
        city: z.string().min(2).max(80).optional(),
        radiusKm: z.number().int().min(1).max(50).default(10),
        service: z.enum(["walking", "carry"]).optional(),
      })
      .strict(),
    permission: "user",
    confirmationRequired: false,
    category: "discovery",
    handler: async (ctx, args) => {
      // Location is only read when it was actually authorised for this request.
      // Coordinates are used for filtering and never returned to the model.
      const location = ctx.location;
      if (!args.city && !location) {
        throw new AgentToolError(
          "I need your location permission, or a city name, to search for partners.",
          "LOCATION_REQUIRED",
          400,
        );
      }

      // Same predicate the live assistant already uses: approved + available.
      const where: Record<string, unknown> = { status: "APPROVED", isAvailable: true };
      if (args.city) where.user = { city: { equals: args.city, mode: "insensitive" } };

      if (args.service === "walking") where.providesWalking = true;
      if (args.service === "carry") where.providesCarry = true;

      const rows = await prisma.partner.findMany({
        where,
        take: 20,
        orderBy: { rating: "desc" },
        select: {
          id: true,
          latitude: true,
          longitude: true,
          rating: true,
          averageRating: true,
          completedJobs: true,
          providesWalking: true,
          providesCarry: true,
          user: { select: { id: true, fullName: true, city: true } },
        },
      });

      // Radius filtering happens here because the DB has no geo index; the
      // authorised point is only used to compute distance and is not persisted.
      let matched: Array<{ p: (typeof rows)[number]; km: number | null }> = rows.map((p) => ({ p, km: null }));
      let nearestKm: number | null = null;
      // When the user asked for partners "near me", a partner without stored
      // coordinates cannot be shown to be inside the radius. Keeping them would
      // report an unverifiable distance as a real one, so they are excluded and
      // counted separately below instead of being presented as nearby matches.
      let missingLocation = 0;
      if (location) {
        const withDistance = rows.map((p) => ({
          p,
          km:
            p.latitude !== null && p.longitude !== null
              ? haversineKm(location.latitude, location.longitude, p.latitude, p.longitude)
              : null,
        }));
        missingLocation = withDistance.filter((x) => x.km === null).length;
        matched = withDistance.filter((x) => x.km !== null && x.km <= args.radiusKm);
        if (matched.length) {
          nearestKm = Math.min(...matched.map((x) => x.km as number));
        }
      }

      return {
        searchedBy: args.city ? `city "${args.city}"` : "your authorised location",
        radiusKm: location ? args.radiusKm : null,
        totalFound: matched.length,
        // Explicitly surfaced so the reply can be honest about what was withheld.
        excludedForMissingLocation: missingLocation || undefined,
        nearestKm: nearestKm !== null ? Math.round(nearestKm * 10) / 10 : null,
        partners: matched.slice(0, 10).map(({ p }) => ({
          id: p.id,
          name: p.user?.fullName ?? "Partner",
          city: p.user?.city ?? null,
          services: [p.providesWalking ? "walking" : null, p.providesCarry ? "carry" : null].filter(
            Boolean,
          ),
          rating: p.averageRating || p.rating || 0,
          completedJobs: p.completedJobs,
        })),
        note: location
          ? "Location was used for this search only and was not stored."
          : undefined,
      };
    },
  },

  {
    name: "search_events",
    description:
      "Find published events, optionally filtered by text, city or category, soonest first. Returns live events only.",
    inputSchema: z
      .object({
        query: z.string().max(80).optional(),
        city: z.string().max(80).optional(),
        category: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(20).default(5),
      })
      .strict(),
    permission: "user",
    confirmationRequired: false,
    category: "discovery",
    handler: async (ctx, args) => {
      const where: Record<string, unknown> = { status: "PUBLISHED" };
      if (args.query) {
        where.OR = [
          { title: { contains: args.query, mode: "insensitive" } },
          { description: { contains: args.query, mode: "insensitive" } },
        ];
      }
      if (args.category) where.category = { equals: args.category, mode: "insensitive" };

      const rows = await prisma.event.findMany({
        where,
        orderBy: { startTime: "asc" },
        take: args.limit,
        select: {
          id: true,
          title: true,
          category: true,
          location: true,
          startTime: true,
          capacity: true,
          attendeeCount: true,
          price: true,
          currency: true,
        },
      });

      const events = args.city
        ? rows.filter((e) => !e.location || e.location.toLowerCase().includes(args.city!.toLowerCase()))
        : rows;

      return {
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          category: e.category,
          location: e.location,
          startsAt: e.startTime?.toISOString() ?? null,
          attendeeCount: e.attendeeCount,
          capacity: e.capacity,
          price: e.price,
          currency: e.currency,
        })),
      };
    },
  },

  {
    name: "search_communities",
    description: "Find communities by name or city, with their real member counts.",
    inputSchema: z
      .object({
        query: z.string().max(80).optional(),
        city: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(20).default(5),
      })
      .strict(),
    permission: "user",
    confirmationRequired: false,
    category: "community",
    handler: async (ctx, args) => {
      const where: Record<string, unknown> = {};
      if (args.query) where.name = { contains: args.query, mode: "insensitive" };
      if (args.city) where.city = { contains: args.city, mode: "insensitive" };

      const rows = await prisma.community.findMany({
        where,
        orderBy: { memberCount: "desc" },
        take: args.limit,
        select: { id: true, name: true, city: true, description: true, privacy: true, memberCount: true },
      });

      return {
        count: rows.length,
        communities: rows.map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city,
          description: c.description,
          privacy: c.privacy,
          memberCount: c.memberCount,
        })),
      };
    },
  },

  {
    name: "get_event",
    description: "Get one event's real details by id, including whether the signed-in user is already attending.",
    inputSchema: z.object({ eventId: z.string().min(1) }).strict(),
    permission: "user",
    confirmationRequired: false,
    category: "discovery",
    handler: async (ctx, args) => {
      const userId = requireUser(ctx);
      const event = await prisma.event.findUnique({
        where: { id: args.eventId },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          location: true,
          startTime: true,
          endTime: true,
          status: true,
          capacity: true,
          attendeeCount: true,
          price: true,
          currency: true,
          isOnline: true,
          womenOnly: true,
        },
      });
      if (!event) throw new AgentToolError("That event no longer exists.", "EVENT_NOT_FOUND", 404);

      const attending = await prisma.eventAttendee.findUnique({
        where: { eventId_userId: { eventId: args.eventId, userId } },
        select: { status: true },
      });

      return {
        id: event.id,
        title: event.title,
        description: event.description,
        category: event.category,
        location: event.location,
        isOnline: event.isOnline,
        womenOnly: event.womenOnly,
        startsAt: event.startTime?.toISOString() ?? null,
        endsAt: event.endTime?.toISOString() ?? null,
        status: event.status,
        attendeeCount: event.attendeeCount,
        capacity: event.capacity,
        price: event.price,
        currency: event.currency,
        youAreAttending: Boolean(attending),
        yourAttendanceStatus: attending?.status ?? null,
      };
    },
  },

  {
    name: "get_notifications",
    description: "List the signed-in user's own notifications, newest first, with read state and unread count.",
    inputSchema: z
      .object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(30).default(10),
      })
      .strict(),
    permission: "user",
    confirmationRequired: false,
    category: "support",
    handler: async (ctx, args) => {
      const userId = requireUser(ctx);
      const rows = await prisma.notification.findMany({
        where: { userId, ...(args.unreadOnly ? { isRead: false } : {}) },
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: { id: true, title: true, body: true, isRead: true, createdAt: true },
      });
      const unread = await prisma.notification.count({ where: { userId, isRead: false } });
      return {
        unreadCount: unread,
        notifications: rows.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          read: n.isRead,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  },

  {
    name: "get_payment_history",
    description:
      "List the signed-in user's own payment orders with backend-verified statuses. Statuses come from the payment provider reconciliation, never from the assistant.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
    permission: "user",
    confirmationRequired: false,
    category: "payments",
    handler: async (ctx, args) => {
      const userId = requireUser(ctx);
      const rows = await prisma.paymentOrder.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
          id: true,
          cashfreeOrderId: true,
          amount: true,
          currency: true,
          status: true,
          type: true,
          createdAt: true,
          completedAt: true,
          refundedAmount: true,
        },
      });
      return {
        count: rows.length,
        // The assistant may only report these statuses verbatim.
        verifiedByBackend: true,
        payments: rows.map((p) => ({
          id: p.id,
          orderId: p.cashfreeOrderId,
          amount: Number(p.amount),
          currency: p.currency,
          status: p.status,
          type: p.type,
          createdAt: p.createdAt.toISOString(),
          completedAt: p.completedAt?.toISOString() ?? null,
          refundedAmount: p.refundedAmount !== null ? Number(p.refundedAmount) : null,
        })),
      };
    },
  },

  {
    name: "get_wallet",
    description: "Get the signed-in user's wallet balances and recent wallet transactions.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }).strict(),
    permission: "user",
    confirmationRequired: false,
    category: "payments",
    handler: async (ctx, args) => {
      const userId = requireUser(ctx);
      const wallet = await prisma.wallet.findFirst({
        where: { userId },
        select: {
          id: true,
          balance: true,
          promotionalBalance: true,
          heldBalance: true,
          currency: true,
        },
      });
      const transactions = await prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: args.limit,
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          description: true,
          createdAt: true,
        },
      });
      return {
        wallet: wallet
          ? {
              id: wallet.id,
              balance: Number(wallet.balance),
              promotionalBalance: Number(wallet.promotionalBalance),
              heldBalance: Number(wallet.heldBalance),
              currency: wallet.currency,
            }
          : null,
        transactions: transactions.map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          amount: Number(t.amount),
          description: t.description,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    },
  },

  {
    name: "get_support_information",
    description:
      "List the signed-in user's recent support tickets and how to reach help. Does not create a ticket.",
    inputSchema: noArgs,
    permission: "user",
    confirmationRequired: false,
    category: "support",
    handler: async (ctx) => {
      const userId = requireUser(ctx);
      const tickets = await prisma.supportTicket.findMany({
        where: { requesterId: userId },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, reference: true, subject: true, status: true, priority: true, updatedAt: true },
      });
      return {
        tickets: tickets.map((t) => ({
          id: t.id,
          reference: t.reference,
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          updatedAt: t.updatedAt.toISOString(),
        })),
        note: "Describe the problem and I can summarise it so you can raise a support ticket.",
      };
    },
  },
];

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

registerTools(userTools);
import { Response } from "express";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";
import { prisma } from "../config/database";
import { isDemoEmail } from "../utils/demo";
import {
  aiComplete,
  aiConfigInfo,
  checkAiQuota,
} from "../services/aiGateway";

// ============================================================================
// SideBud AI — assistant router (works WITHOUT any LLM key).
// Parses intent with transparent keyword rules and answers ONLY from live
// platform data (events, partners, movies, communities, bookings). Nothing
// is ever invented: zero results returns an honest empty with next steps.
// ============================================================================

type AiIntent = "events" | "sports" | "movies" | "partners" | "communities" | "bookings" | "help";

function detectIntent(message: string): AiIntent {
  const m = message.toLowerCase();
  if (/\b(sport|game|cricket|football|badminton|tennis|basketball|run|running|cycling|swim|gym|chess|player|team|match)\b/.test(m)) return "sports";
  if (/\b(movie|film|cinema|watch|watchlist)\b/.test(m)) return "movies";
  if (/\b(partner|buddy|walking|carry|service|job|helper)\b/.test(m)) return "partners";
  if (/\b(communit|group|club|poll)\b/.test(m)) return "communities";
  if (/\b(book|payment|refund|wallet|otp|job status|my job)\b/.test(m)) return "bookings";
  if (/\b(event|meetup|tomorrow|weekend|today|evening|plan|do something|anything)\b/.test(m)) return "events";
  return "help";
}

function detectPreset(message: string): string | undefined {
  const m = message.toLowerCase();
  if (/\btomorrow\b/.test(m)) return "tomorrow";
  if (/\bweekend\b/.test(m)) return "weekend";
  if (/\btoday\b|this evening|tonight\b/.test(m)) return "today";
  if (/\bthis week\b/.test(m)) return "week";
  return undefined;
}

export async function askAssistant(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const message = String(req.body?.message || "").trim().slice(0, 500);
    if (message.length < 2) {
      sendError(res, "Ask me something — events, sports, movies, partners, communities or bookings.", 400, "VALIDATION_ERROR");
      return;
    }
    const lat = req.body?.lat !== undefined ? Number(req.body.lat) : NaN;
    const lon = req.body?.lon !== undefined ? Number(req.body.lon) : NaN;
    const hasPosition = Number.isFinite(lat) && Number.isFinite(lon);
    const intent = detectIntent(message);
    const preset = detectPreset(message);
    const me = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { city: true },
    });

    const actions: Array<{ type: string; label: string; route: string }> = [];
    let reply = "";
    let results: unknown = null;

    if (intent === "events" || intent === "sports") {
      const where: any = { status: "PUBLISHED", category: intent };
      if (preset === "today" || preset === "tomorrow" || preset === "week" || preset === "weekend") {
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setUTCHours(0, 0, 0, 0);
        if (preset === "today") where.startTime = { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86400000) };
        if (preset === "tomorrow") {
          const s = new Date(startOfDay.getTime() + 86400000);
          where.startTime = { gte: s, lt: new Date(s.getTime() + 86400000) };
        }
        if (preset === "week") where.startTime = { gte: now, lt: new Date(now.getTime() + 7 * 86400000) };
        if (preset === "weekend") {
          const day = now.getUTCDay();
          const sat = new Date(startOfDay.getTime() + (((6 - day + 7) % 7) * 86400000));
          where.startTime = { gte: sat, lt: new Date(sat.getTime() + 2 * 86400000) };
        }
      }
      const items = await prisma.event.findMany({
        where,
        orderBy: { startTime: "asc" },
        take: 5,
        select: { id: true, title: true, startTime: true, location: true, attendeeCount: true, capacity: true },
      });
      results = items;
      reply =
        items.length === 0
          ? `I searched live ${intent} ${preset ? `for ${preset}` : "coming up"} and found nothing yet. Try "this week", or create one and invite others.`
          : `Here ${items.length === 1 ? "is" : "are"} ${items.length} live ${intent} option${items.length === 1 ? "" : "s"}${preset ? ` for ${preset}` : ""}:`;
      actions.push({ type: "route", label: intent === "sports" ? "Open Sports hub" : "Browse events", route: intent === "sports" ? "/sports" : "/events" });
    } else if (intent === "partners") {
      const where: any = { status: "APPROVED", isAvailable: true };
      if (me?.city) where.user = { city: { equals: me.city, mode: "insensitive" } };
      const items = await prisma.partner.findMany({
        where,
        take: 5,
        orderBy: { rating: "desc" },
        select: {
          id: true,
          providesWalking: true,
          providesCarry: true,
          rating: true,
          completedJobs: true,
          user: { select: { id: true, fullName: true, city: true } },
        },
      });
      results = items.map((p: any) => ({
        id: p.id,
        userId: p.user?.id ?? null,
        name: p.user?.fullName ?? "Partner",
        city: p.user?.city ?? null,
        services: [p.providesWalking ? "walking" : null, p.providesCarry ? "carry" : null].filter(Boolean),
        rating: p.rating || 0,
        completedJobs: p.completedJobs || 0,
      }));
      reply =
        (results as any[]).length === 0
          ? "No available partners right now. Try again later or widen your search in Discover."
          : `I found ${(results as any[]).length} available partner${(results as any[]).length === 1 ? "" : "s"}${me?.city ? ` near ${me.city}` : ""}:`;
      actions.push({ type: "route", label: "Open Discover", route: "/discover" });
    } else if (intent === "movies") {
      reply = hasPosition
        ? "For live movie listings the app needs its movie provider key — meanwhile, movie meetups below are real and joinable now."
        : "For live movie listings the app needs its movie provider key — meanwhile, movie meetups below are real and joinable now.";
      const items = await prisma.event.findMany({
        where: { status: "PUBLISHED", category: "movies" },
        orderBy: { startTime: "asc" },
        take: 5,
        select: { id: true, title: true, startTime: true, location: true, attendeeCount: true },
      });
      results = items;
      if (items.length > 0) reply += ` I found ${items.length} movie meetup${items.length === 1 ? "" : "s"}:`;
      actions.push({ type: "route", label: "Open Movies hub", route: "/movies" });
    } else if (intent === "communities") {
      const q = message.replace(/\b(communit\w*|group\w*|club\w*|find|join|show|me|any|near|the|a)\b/gi, "").trim();
      const items = await prisma.community.findMany({
        where: q ? { name: { contains: q.slice(0, 60), mode: "insensitive" } } : {},
        orderBy: { memberCount: "desc" },
        take: 5,
        select: { id: true, name: true, description: true, memberCount: true, city: true },
      });
      results = items;
      reply =
        items.length === 0
          ? "No matching communities yet — create one and invite people with the same interest."
          : `Here ${items.length === 1 ? "is a community" : "are communities"} you can join:`;
      actions.push({ type: "route", label: "Browse communities", route: "/communities" });
    } else if (intent === "bookings") {
      const active = await prisma.booking.findMany({
        where: {
          userId: req.user!.userId,
          status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED", "REFUND_COMPLETED"] },
        },
        orderBy: { scheduledAt: "asc" },
        take: 5,
        select: { id: true, serviceType: true, status: true, scheduledAt: true, paymentStatus: true },
      });
      results = active;
      reply =
        active.length === 0
          ? "You have no active bookings. Create one from Bookings and a partner will be matched."
          : `You have ${active.length} active booking${active.length === 1 ? "" : "s"}. Open Bookings to track, chat, or manage payment.`;
      actions.push({ type: "route", label: "Open my bookings", route: "/bookings" });
    } else {
      reply =
        "I can help with: finding events, sports games, movie meetups, partners, communities, or explaining your bookings and payments. Try “something to do near me tomorrow evening”.";
      actions.push(
        { type: "route", label: "Discover", route: "/discover" },
        { type: "route", label: "My bookings", route: "/bookings" }
      );
    }

    sendSuccess(res, { intent, reply, results, actions }, "Assistant answer.");
  } catch (err: any) {
    console.error("[ai] ask error:", err?.message);
    sendError(res, "Assistant is unavailable right now. Try again later.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// Matching — transparent signal scoring over real data. Every reason cites
// something that actually happened (shared city/community/event).
// ============================================================================

export async function getMatches(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    const selfId = req.user!.userId;
    const me = await prisma.user.findUnique({
      where: { id: selfId },
      select: { city: true, email: true },
    });
    const [myCommunities, myEvents] = await Promise.all([
      prisma.communityMember.findMany({ where: { userId: selfId }, select: { communityId: true } }),
      prisma.eventAttendee.findMany({ where: { userId: selfId }, select: { eventId: true } }),
    ]);
    const myCommunityIds = new Set(myCommunities.map((c) => c.communityId));
    const myEventIds = new Set(myEvents.map((e) => e.eventId));

    const candidates = await prisma.user.findMany({
      where: { id: { not: selfId }, status: "ACTIVE", role: { notIn: ["ADMIN", "SUPER_ADMIN"] } },
      select: { id: true, fullName: true, avatarUrl: true, city: true, bio: true, email: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    } as any);

    // Demo sandbox fence: demos only ever match demos.
    const requesterIsDemo = isDemoEmail(me?.email);
    const pool = (candidates as any[]).filter((c: any) =>
      requesterIsDemo ? isDemoEmail(c.email) : !isDemoEmail(c.email)
    );

    const scored = await Promise.all(
      pool.map(async (c: any) => {
        let score = 0;
        const reasons: string[] = [];
        if (me?.city && c.city && me.city.toLowerCase() === String(c.city).toLowerCase()) {
          score += 2;
          reasons.push(`You are both in ${c.city}`);
        }
        if (myCommunityIds.size > 0) {
          const shared = await prisma.communityMember.count({
            where: { userId: c.id, communityId: { in: [...myCommunityIds] } },
          });
          if (shared > 0) {
            score += Math.min(6, shared * 2);
            reasons.push(`You share ${shared} communit${shared === 1 ? "y" : "ies"}`);
          }
        }
        if (myEventIds.size > 0) {
          const shared = await prisma.eventAttendee.count({
            where: { userId: c.id, eventId: { in: [...myEventIds] } },
          });
          if (shared > 0) {
            score += Math.min(6, shared * 2);
            reasons.push(`You both joined ${shared} event${shared === 1 ? "" : "s"}`);
          }
        }
        return { id: c.id, name: c.fullName, avatarUrl: c.avatarUrl, city: c.city, bio: c.bio, score, reasons };
      })
    );

    const matches = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    sendSuccess(res, { count: matches.length, matches }, "Matches computed from your real activity.");
  } catch (err: any) {
    console.error("[ai] matches error:", err?.message);
    sendError(res, "Matching is unavailable right now.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// LLM-backed helpers (translate, draft). Honest 503 until AI_API_BASE +
// AI_API_KEY are configured. Drafts are returned for user approval —
// nothing is ever published automatically.
// ============================================================================

export async function translateMessage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 1000);
    const targetLang = String(req.body?.targetLang || "").trim().slice(0, 32);
    if (!text || !targetLang) {
      sendError(res, "Text and targetLang are required.", 400, "VALIDATION_ERROR");
      return;
    }
    try {
      const out = await aiComplete(
        req.user!.userId,
        "You are a translation engine. Translate the user text to the requested language. Reply with ONLY the translation, no commentary.",
        `Target language: ${targetLang}\nText: ${text}`,
        { maxTokens: 512, cacheKey: `tr:${targetLang}:${Buffer.from(text).toString("base64").slice(0, 64)}` }
      );
      sendSuccess(res, { original: text, translated: out.text, targetLang, model: out.model, cached: out.cached }, "Translated.");
    } catch (err: any) {
      if (err?.code === "AI_NOT_CONFIGURED") {
        const info = aiConfigInfo();
        sendError(res, `Translation needs an AI provider. Required env: ${info.requiredEnv.join(", ")}.`, 503, "AI_NOT_CONFIGURED");
        return;
      }
      if (err?.code === "AI_QUOTA_EXCEEDED") {
        sendError(res, "Translation quota exceeded. Try again later.", 429, "AI_QUOTA_EXCEEDED");
        return;
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[ai] translate error:", err?.message);
    sendError(res, "Translation is unavailable right now.", 500, "INTERNAL_ERROR");
  }
}

export async function draftText(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const kind = String(req.body?.kind || "");
    const context = String(req.body?.context || "").trim().slice(0, 500);
    if (!["bio", "event", "community"].includes(kind) || !context) {
      sendError(res, "Kind must be bio, event or community, with context text.", 400, "VALIDATION_ERROR");
      return;
    }
    try {
      const out = await aiComplete(
        req.user!.userId,
        `You help users write a short ${kind} description. Friendly, plain language, under 60 words. Reply with ONLY the draft.`,
        context,
        { maxTokens: 256 }
      );
      sendSuccess(
        res,
        { draft: out.text, kind, model: out.model, cached: out.cached, note: "Review and edit before publishing — nothing was saved." },
        "Draft ready for review."
      );
    } catch (err: any) {
      if (err?.code === "AI_NOT_CONFIGURED") {
        const info = aiConfigInfo();
        sendError(res, `Writing help needs an AI provider. Required env: ${info.requiredEnv.join(", ")}.`, 503, "AI_NOT_CONFIGURED");
        return;
      }
      if (err?.code === "AI_QUOTA_EXCEEDED") {
        sendError(res, "Writing quota exceeded. Try again later.", 429, "AI_QUOTA_EXCEEDED");
        return;
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[ai] draft error:", err?.message);
    sendError(res, "Writing help is unavailable right now.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// Safety flags — rule signals for ADMIN REVIEW ONLY. Never auto-punishes.
// Levels: LOW (watch), MEDIUM (check soon), REVIEW (needs a moderator now).
// ============================================================================

export async function getSafetyFlags(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const dayAgo = new Date(Date.now() - 86400000);

    const [reported, duplicates, cancelBursts, lowTrust] = await Promise.all([
      prisma.report.groupBy({
        by: ["targetId"],
        where: { status: "PENDING", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
        _count: { targetId: true },
      }),
      prisma.$queryRawUnsafe(
        `SELECT "senderId" AS "userId", "content", COUNT(*)::int AS "n" FROM "Message"
         WHERE "createdAt" >= NOW() - INTERVAL '1 hour' AND "content" <> ''
         GROUP BY "senderId", "content" HAVING COUNT(*) >= 5`
      ) as Promise<Array<{ userId: string; content: string; n: number }>>,
      prisma.booking.groupBy({
        by: ["userId"],
        where: { status: "CANCELLED", updatedAt: { gte: dayAgo } },
        _count: { userId: true },
      }),
      prisma.trustScore.findMany({ where: { score: { lt: 30 } }, select: { userId: true, score: true }, take: 50 }),
    ]);

    const flagMap = new Map<string, { reasons: string[]; level: "LOW" | "MEDIUM" | "REVIEW" }>();
    const add = (userId: string, level: "LOW" | "MEDIUM" | "REVIEW", reason: string) => {
      const cur = flagMap.get(userId) || { reasons: [], level: "LOW" as const };
      cur.reasons.push(reason);
      const rank = { LOW: 0, MEDIUM: 1, REVIEW: 2 };
      if (rank[level] > rank[cur.level]) cur.level = level;
      flagMap.set(userId, cur);
    };

    for (const r of reported as Array<{ targetId: string; _count: { targetId: number } }>) {
      const n = r._count.targetId;
      add(r.targetId, n >= 3 ? "REVIEW" : "MEDIUM", `${n} open report${n === 1 ? "" : "s"} in the last 7 days`);
    }
    for (const d of duplicates || []) {
      add(d.userId, "MEDIUM", `Repeated the same message ${d.n} times in the last hour (possible spam)`);
    }
    for (const c of cancelBursts as Array<{ userId: string; _count: { userId: number } }>) {
      const n = c._count.userId;
      if (n >= 5) add(c.userId, "MEDIUM", `Cancelled ${n} bookings in the last 24h (abnormal pattern)`);
    }
    for (const t of lowTrust) {
      add(t.userId, "LOW", `Trust score ${t.score} (below 30)`);
    }

    const ids = [...flagMap.keys()].slice(0, 100);
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true, status: true } })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const flags = ids.map((id) => ({
      userId: id,
      name: (byId.get(id) as any)?.fullName ?? "Unknown",
      email: (byId.get(id) as any)?.email ?? null,
      status: (byId.get(id) as any)?.status ?? null,
      level: flagMap.get(id)!.level,
      reasons: flagMap.get(id)!.reasons,
    }));

    sendSuccess(res, { count: flags.length, flags, note: "Flags need human review — nothing was actioned automatically." }, "Safety flags.");
  } catch (err: any) {
    console.error("[ai] flags error:", err?.message);
    sendError(res, "Safety flags are unavailable right now.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// Admin summary — real counts only, straight from the database.
// ============================================================================

export async function getAdminSummary(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [
      newUsers,
      partnersPending,
      partnersActive,
      activeBookings,
      upcomingEvents,
      openReports,
      failedPayments,
      revenue,
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.partner.count({ where: { status: "APPLIED" } }),
      prisma.partner.count({ where: { status: "APPROVED" } }),
      prisma.booking.count({
        where: { status: { notIn: ["COMPLETED", "CANCELLED", "EXPIRED", "REFUND_COMPLETED"] } },
      }),
      prisma.event.count({ where: { status: "PUBLISHED", startTime: { gte: new Date() } } }),
      prisma.report.count({ where: { status: "PENDING" } }),
      prisma.paymentOrder.count({ where: { status: "FAILED", createdAt: { gte: weekAgo } } }),
      prisma.transaction.aggregate({
        where: { status: "SUCCESS", createdAt: { gte: weekAgo } },
        _sum: { amount: true },
      }),
    ]);
    sendSuccess(
      res,
      {
        last7Days: {
          newUsers,
          failedPayments,
          revenue: revenue._sum.amount || 0,
        },
        current: {
          partnersPending,
          partnersActive,
          activeBookings,
          upcomingEvents,
          openReports,
        },
      },
      "Admin summary."
    );
  } catch (err: any) {
    console.error("[ai] summary error:", err?.message);
    sendError(res, "Admin summary is unavailable right now.", 500, "INTERNAL_ERROR");
  }
}

export async function getAiStatus(_req: AuthedRequest, res: Response): Promise<void> {
  const info = aiConfigInfo();
  const quota = checkAiQuota("status-probe");
  void quota;
  sendSuccess(
    res,
    {
      provider: info.provider,
      requiredEnv: info.requiredEnv,
      rulesFeatures: ["ask", "matches", "safety-flags", "admin-summary"],
      llmFeatures: ["translate", "draft"],
    },
    "AI integration status."
  );
}

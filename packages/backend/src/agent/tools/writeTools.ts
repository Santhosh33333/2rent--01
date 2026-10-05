import { z } from "zod";
import { prisma } from "../../config/database";
import { AgentToolError, registerTools, type AgentToolContext, type AgentToolDef } from "../toolRegistry";
import { resolveWalkingFare } from "../../controllers/walkingRequestController";
import { evaluateKycGate } from "../../services/kycTrialService";

/**
 * Mutating user tools.
 *
 * Every tool here changes real rows, so each is registered with
 * confirmationRequired: true. The router refuses to execute any of them until the
 * user approves a token bound to the exact arguments shown in the dialog.
 *
 * Three rules hold regardless of what the model asks for:
 *
 *  1. The signed-in user comes from ctx, never from the arguments. The model
 *     cannot act as, or on behalf of, anyone else.
 *  2. Prices and eligibility come from the same helpers the REST controllers
 *     call, so the agent cannot offer a cheaper fare or skip KYC.
 *  3. Ownership is re-checked at execution time. A confirmation token proves the
 *     user approved an action; it does not prove they still own the row.
 */

const SUMMARY_MAX = 240;

function truncate(text: string): string {
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}\u2026`;
}

function rupees(amount: number): string {
  return `\u20b9${amount.toFixed(2)}`;
}

/**
 * Mirrors the requireKycVerified middleware. The agent is a second way into the
 * paid surface, so it applies the same gate rather than assuming the REST route
 * already did.
 */
async function assertKycAllows(userId: string): Promise<void> {
  const verification = await prisma.verification.findUnique({
    where: { userId },
    select: { status: true, trialEndsAt: true },
  });
  const decision = evaluateKycGate(verification as never);
  if (decision.allowed) return;

  const trialExpired = decision.reason === "trial_expired";
  throw new AgentToolError(
    trialExpired
      ? "Your trial access has ended. Complete KYC verification to keep using app features."
      : verification
        ? "Your verification is under review. Complete it to use this action."
        : "Complete your KYC verification before using this action.",
    trialExpired ? "KYC_TRIAL_EXPIRED" : verification ? "KYC_PENDING" : "KYC_REQUIRED",
    403
  );
}

const writeTools: AgentToolDef[] = [
  // --- create a walking request -------------------------------------------
  {
    name: "create_walking_request",
    description:
      "Create a walking request for the signed-in user. Publishes the route, start time and agreed fare to nearby partners, so it always needs explicit user confirmation. Only call this once the user has agreed the details.",
    inputSchema: z
      .object({
        startLocation: z.string().trim().min(2).max(160),
        endLocation: z.string().trim().min(2).max(160),
        startTime: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/, "startTime must look like 2026-10-05T18:30"),
        durationMinutes: z.number().int().min(1).max(600).optional(),
        notes: z.string().trim().max(500).optional(),
        /** Optional. Clamped to the server estimate band, exactly like the REST route. */
        fare: z.number().positive().max(100000).optional(),
      })
      .strict(),
    permission: "user",
    confirmationRequired: true,
    category: "requests",
    handler: async (ctx, args) => {
      await assertKycAllows(ctx.userId);

      const startTime = new Date(args.startTime);
      if (Number.isNaN(startTime.getTime())) {
        throw new AgentToolError("That start time could not be read.", "INVALID_START_TIME", 400);
      }
      if (startTime.getTime() <= Date.now()) {
        // A request dated in the past can never be matched, so refuse it rather
        // than leaving a row open forever.
        throw new AgentToolError(
          "That start time is in the past. Pick a future time.",
          "START_TIME_IN_PAST",
          400
        );
      }

      let fare: number;
      try {
        fare = await resolveWalkingFare(args.fare, args.durationMinutes);
      } catch (e: any) {
        if (e?.message === "INVALID_FARE") {
          throw new AgentToolError(
            String(e.detail ?? "That fare is not accepted."),
            "INVALID_FARE",
            400
          );
        }
        throw e;
      }

      const request = await prisma.walkingRequest.create({
        data: {
          requesterId: ctx.userId,
          startLocation: args.startLocation,
          endLocation: args.endLocation,
          startTime,
          durationMinutes: args.durationMinutes ?? null,
          notes: args.notes ?? null,
          fare,
          status: "OPEN",
        },
        select: { id: true, status: true, startTime: true, fare: true },
      });

      return {
        requestId: request.id,
        status: request.status,
        startLocation: args.startLocation,
        endLocation: args.endLocation,
        startTime: request.startTime.toISOString(),
        durationMinutes: args.durationMinutes ?? null,
        notes: args.notes ?? null,
        // Always the server's settled number, never the model's suggestion.
        fare: Number(request.fare),
        fareDisplay: rupees(Number(request.fare)),
      };
    },
    confirmationSummary: (args) =>
      truncate(
        `Publish a walking request from "${args.startLocation}" to "${args.endLocation}" starting ${new Date(
          args.startTime
        ).toLocaleString("en-IN")}. Nearby partners will be able to apply for it.`
      ),
  },

  // --- cancel a walking request ------------------------------------------
  {
    name: "cancel_walking_request",
    description:
      "Cancel one of the signed-in user's own walking requests. Needs confirmation. Only works on a request the user created that is not already completed.",
    inputSchema: z.object({ requestId: z.string().uuid() }).strict(),
    permission: "user",
    confirmationRequired: true,
    category: "requests",
    handler: async (ctx, args) => {
      const request = await prisma.walkingRequest.findUnique({
        where: { id: args.requestId },
        select: { id: true, status: true, requesterId: true, startLocation: true, endLocation: true },
      });
      if (!request) {
        throw new AgentToolError("That request does not exist.", "REQUEST_NOT_FOUND", 404);
      }
      // Ownership is re-checked here rather than trusted from the dialog: the
      // token proves intent, not entitlement.
      if (request.requesterId !== ctx.userId) {
        throw new AgentToolError("Only the requester can cancel this request.", "FORBIDDEN", 403);
      }
      if (request.status === "COMPLETED") {
        throw new AgentToolError("A completed request cannot be cancelled.", "INVALID_STATUS", 400);
      }
      if (request.status === "CANCELLED") {
        // Already in the target state: report it instead of writing again.
        return { requestId: request.id, status: "CANCELLED", alreadyCancelled: true };
      }

      await prisma.walkingRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } });

      return {
        requestId: request.id,
        status: "CANCELLED",
        route: `${request.startLocation} \u2192 ${request.endLocation}`,
      };
    },
    confirmationSummary: (args) =>
      truncate(`Cancel your walking request ${args.requestId}. This cannot be undone.`),
  },

  // --- join an event ------------------------------------------------------
  {
    name: "join_event",
    description:
      "Register the signed-in user for an event. Needs confirmation because it takes one of a limited number of spots and commits the user to attend.",
    inputSchema: z.object({ eventId: z.string().uuid() }).strict(),
    permission: "user",
    confirmationRequired: true,
    category: "community",
    handler: async (ctx, args) => {
      await assertKycAllows(ctx.userId);

      const event = await prisma.event.findUnique({
        where: { id: args.eventId },
        select: { id: true, title: true, status: true, capacity: true, attendeeCount: true, startTime: true },
      });
      if (!event) {
        throw new AgentToolError("That event does not exist.", "EVENT_NOT_FOUND", 404);
      }
      if (event.status === "CANCELLED") {
        throw new AgentToolError("That event has been cancelled.", "EVENT_CANCELLED", 400);
      }

      // Same atomic capacity claim as registerForEvent: the counter only moves
      // while the event is below capacity, so two concurrent joins cannot
      // overbook the final spot.
      await prisma.$transaction(async (tx) => {
        const existing = await tx.eventAttendee.findUnique({
          where: { eventId_userId: { eventId: event.id, userId: ctx.userId } },
          select: { id: true },
        });
        if (existing) {
          throw new AgentToolError("You are already registered for this event.", "ALREADY_REGISTERED", 409);
        }

        const claimed = await tx.event.updateMany({
          where: {
            id: event.id,
            ...(event.capacity !== null ? { attendeeCount: { lt: event.capacity } } : {}),
          },
          data: { attendeeCount: { increment: 1 } },
        });
        if (claimed.count === 0) {
          throw new AgentToolError("This event is full.", "EVENT_FULL", 409);
        }

        await tx.eventAttendee.create({
          data: { eventId: event.id, userId: ctx.userId, status: "REGISTERED" },
        });
      });

      return {
        eventId: event.id,
        title: event.title,
        startTime: event.startTime ? new Date(event.startTime).toISOString() : null,
        registered: true,
        attendeeCount: event.attendeeCount + 1,
        capacity: event.capacity,
      };
    },
    confirmationSummary: (args) =>
      truncate(
        `Register you for event ${args.eventId}. This takes one of the limited spots and commits you to attend.`
      ),
  },

  // --- report a user ------------------------------------------------------
  {
    name: "report_user",
    description:
      "File a moderation report against another user. Needs confirmation. Use only when the user explicitly describes conduct they want reviewed.",
    inputSchema: z
      .object({
        targetUserId: z.string().uuid(),
        reason: z.enum([
          "HARASSMENT",
          "INAPPROPRIATE_CONTENT",
          "FRAUD_OR_SCAM",
          "FAKE_PROFILE",
          "UNDERAGE",
          "VIOLENCE_OR_THREAT",
          "OTHER",
        ]),
        description: z.string().trim().max(1000).optional(),
      })
      .strict(),
    permission: "user",
    confirmationRequired: true,
    category: "support",
    handler: async (ctx, args) => {
      if (args.targetUserId === ctx.userId) {
        throw new AgentToolError("You cannot report yourself.", "INVALID_TARGET", 400);
      }

      const target = await prisma.user.findUnique({
        where: { id: args.targetUserId },
        select: { id: true, fullName: true },
      });
      if (!target) {
        throw new AgentToolError("That user does not exist.", "USER_NOT_FOUND", 404);
      }

      // Re-reporting stays allowed, because a moderator needs the history, but
      // the count is returned so the reply can mention it.
      const previous = await prisma.report.count({
        where: { reporterId: ctx.userId, targetId: args.targetUserId },
      });

      const report = await prisma.report.create({
        data: {
          reporterId: ctx.userId,
          targetId: args.targetUserId,
          targetType: "USER",
          reason: args.reason,
          description: args.description ?? null,
          status: "PENDING",
        },
        select: { id: true, status: true, createdAt: true },
      });

      return {
        reportId: report.id,
        status: report.status,
        targetUser: target.fullName,
        reason: args.reason,
        filedAt: report.createdAt.toISOString(),
        existingReportsByYou: previous,
      };
    },
    confirmationSummary: (args) =>
      truncate(
        `File a moderation report against user ${args.targetUserId} for ${String(args.reason)
          .replace(/_/g, " ")
          .toLowerCase()}. A moderator will review it.`
      ),
  },
];

registerTools(writeTools);
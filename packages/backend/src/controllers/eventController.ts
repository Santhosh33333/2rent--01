import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

class EventAlreadyRegisteredError extends Error {}
class EventFullError extends Error {}

// ============================================================================
// CREATE EVENT
// ============================================================================

export async function createEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { title, description, communityId, location, startTime, endTime, capacity } = req.body;

    if (!title || !startTime) {
      sendError(res, "Title and startTime are required.", 400, "VALIDATION_ERROR");
      return;
    }

    const event = await prisma.event.create({
      data: {
        title,
        description: description || "",
        communityId: communityId || null,
        location: location || "",
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        capacity: capacity || null,
        organizerId: req.user!.userId,
        status: "PUBLISHED",
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_CREATE",
        entityType: "Event",
        entityId: event.id,
        metadata: JSON.stringify({ title }),
      },
    });

    sendSuccess(res, event, "Event created.", 201);
  } catch (err: any) {
    sendError(res, "Failed to create event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EVENTS
// ============================================================================

export async function getEvents(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const where: any = {};

    if (req.query.status) where.status = req.query.status;
    if (req.query.communityId) where.communityId = req.query.communityId;

    const [items, total] = await Promise.all([
      prisma.event.findMany({
        where,
        orderBy: { startTime: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organizer: { select: { id: true, fullName: true, avatarUrl: true } },
          _count: { select: { attendees: true } },
        },
      }),
      prisma.event.count({ where }),
    ]);

    const itemsWithCounts = items.map(item => ({
      ...item,
      attendeeCount: item._count.attendees,
    }));

    // Per-user registration flags so clients can render RSVP state in lists.
    let registeredEventIds = new Set<string>();
    if (items.length > 0) {
      const mine = await prisma.eventAttendee.findMany({
        where: { userId: req.user!.userId, eventId: { in: items.map(i => i.id) } },
        select: { eventId: true },
      });
      registeredEventIds = new Set(mine.map(m => m.eventId));
    }

    sendSuccess(res, {
      items: itemsWithCounts.map(i => ({ ...i, isRegistered: registeredEventIds.has(i.id) })),
      page,
      limit,
      total,
    });
  } catch (err: any) {
    sendError(res, "Failed to retrieve events.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET EVENT BY ID
// ============================================================================

export async function getEventById(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        organizer: { select: { id: true, fullName: true, avatarUrl: true } },
        _count: { select: { attendees: true } },
      },
    });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Check if user is registered
    const isRegistered = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    const response = {
      ...event,
      attendeeCount: event._count.attendees,
      isRegistered: !!isRegistered,
      isOrganizer: event.organizerId === req.user!.userId,
    };

    sendSuccess(res, response, "Event retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// UPDATE EVENT
// ============================================================================

export async function updateEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { title, description, location, startTime, endTime, capacity, status } = req.body;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Only organizer can update
    if (event.organizerId !== req.user!.userId) {
      sendError(res, "Only event organizer can update.", 403, "FORBIDDEN");
      return;
    }

    const updated = await prisma.event.update({
      where: { id },
      data: {
        title: title || event.title,
        description: description !== undefined ? description : event.description,
        location: location !== undefined ? location : event.location,
        startTime: startTime ? new Date(startTime) : event.startTime,
        endTime: endTime ? new Date(endTime) : event.endTime,
        capacity: capacity !== undefined ? capacity : event.capacity,
        status: status || event.status,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_UPDATE",
        entityType: "Event",
        entityId: id,
        metadata: JSON.stringify({ title, status }),
      },
    });

    sendSuccess(res, updated, "Event updated.");
  } catch (err: any) {
    sendError(res, "Failed to update event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// DELETE EVENT
// ============================================================================

export async function deleteEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    // Only organizer can delete
    if (event.organizerId !== req.user!.userId) {
      sendError(res, "Only event organizer can delete.", 403, "FORBIDDEN");
      return;
    }

    await prisma.$transaction([
      prisma.eventAttendee.deleteMany({ where: { eventId: id } }),
      prisma.event.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "EVENT_DELETE",
          entityType: "Event",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Event deleted.");
  } catch (err: any) {
    sendError(res, "Failed to delete event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REGISTER FOR EVENT
// ============================================================================

export async function registerForEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const event = await prisma.event.findUnique({ where: { id } });

    if (!event) {
      sendError(res, "Event not found.", 404, "EVENT_NOT_FOUND");
      return;
    }

    if (event.status === "CANCELLED") {
      sendError(res, "This event has been cancelled.", 400, "EVENT_CANCELLED");
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.eventAttendee.findUnique({
          where: { eventId_userId: { eventId: id, userId } },
        });
        if (existing) throw new EventAlreadyRegisteredError();

        // Atomic capacity claim: the row only increments while below capacity,
        // so concurrent registrations can never overbook.
        const claimed = await tx.event.updateMany({
          where: {
            id,
            ...(event.capacity !== null ? { attendeeCount: { lt: event.capacity } } : {}),
          },
          data: { attendeeCount: { increment: 1 } },
        });
        if (claimed.count === 0) throw new EventFullError();

        await tx.eventAttendee.create({
          data: { eventId: id, userId, status: "REGISTERED" },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            actorType: "USER",
            action: "EVENT_REGISTER",
            entityType: "Event",
            entityId: id,
          },
        });
      });
    } catch (txErr: any) {
      if (txErr instanceof EventAlreadyRegisteredError || txErr?.code === "P2002") {
        sendError(res, "Already registered for this event.", 409, "ALREADY_REGISTERED");
        return;
      }
      if (txErr instanceof EventFullError) {
        sendError(res, "Event is at full capacity.", 400, "EVENT_FULL");
        return;
      }
      throw txErr;
    }

    sendSuccess(res, undefined, "Registered for event.");
  } catch (err) {
    sendError(res, "Failed to register for event.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// CANCEL REGISTRATION
// ============================================================================

export async function cancelRegistration(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    if (!attendee) {
      sendError(res, "Not registered for this event.", 404, "NOT_REGISTERED");
      return;
    }

    await prisma.$transaction([
      prisma.eventAttendee.delete({
        where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
      }),
      prisma.event.update({ where: { id }, data: { attendeeCount: { decrement: 1 } } }),
      prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "EVENT_UNREGISTER",
          entityType: "Event",
          entityId: id,
        },
      }),
    ]);

    sendSuccess(res, undefined, "Registration cancelled.");
  } catch (err: any) {
    sendError(res, "Failed to cancel registration.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// CHECK IN TO EVENT
// ============================================================================

export async function checkInEvent(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
    });

    if (!attendee) {
      sendError(res, "Not registered for this event.", 404, "NOT_REGISTERED");
      return;
    }

    const updated = await prisma.eventAttendee.update({
      where: { eventId_userId: { eventId: id, userId: req.user!.userId } },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "EVENT_CHECK_IN",
        entityType: "Event",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Checked in to event.");
  } catch (err: any) {
    sendError(res, "Failed to check in.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET ATTENDEES
// ============================================================================

export async function getEventAttendees(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string;

    const where: any = { eventId: id };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.eventAttendee.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, fullName: true, avatarUrl: true, email: true } } },
      }),
      prisma.eventAttendee.count({ where }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err: any) {
    sendError(res, "Failed to retrieve attendees.", 500, "INTERNAL_ERROR");
  }
}

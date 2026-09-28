import { Response } from "express";
import { sendError, sendSuccess } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import {
  SupportError,
  createTicket,
  listTicketsForRequester,
  listTicketsForStaff,
  getTicketForViewer,
  addReply,
  transitionStatus,
  setPriority,
  assignTicket,
  countOpenTickets,
  SUPPORT_CATEGORIES,
} from "../services/supportService";
import { guardRole } from "../rbac/permissions";
import { isAdminRole } from "../rbac/adminSecurity";

/**
 * The staff flag is derived from the session, never from the request. Every
 * handler needs it, and deriving it in one place is what stops a client from
 * sending `authorIsStaff: true` and getting a support badge.
 *
 * No name is read from the session because the JWT does not carry one; the
 * display name is resolved from the author relation when the thread is read, so
 * a stale or forged name is never persisted.
 */
function staffActor(req: AuthedRequest): { userId: string; isStaff: boolean } {
  return {
    userId: req.user?.userId || "",
    isStaff: isAdminRole(guardRole(req.user)),
  };
}

/**
 * Maps a domain error onto the standard error envelope. Support returns 404
 * rather than 403 for someone else's ticket, so a SupportError carrying NOT_FOUND
 * must not be reshaped into something that reveals the ticket exists.
 */
function handle(err: unknown, res: Response): void {
  if (err instanceof SupportError) {
    sendError(res, err.message, err.status, err.code);
    return;
  }
  console.error("[SUPPORT] unhandled error:", err);
  sendError(res, "Something went wrong handling your support request.", 500, "INTERNAL_ERROR");
}

export async function createSupportTicket(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    const ticket = await createTicket({
      requesterId: actor.userId,
      category: String(req.body?.category || ""),
      subject: String(req.body?.subject || ""),
      body: String(req.body?.body || ""),
      relatedEntityType: req.body?.relatedEntityType ?? null,
      relatedEntityId: req.body?.relatedEntityId ?? null,
    });
    sendSuccess(res, ticket, "Support request created.", 201);
  } catch (err) {
    handle(err, res);
  }
}

export async function listMySupportTickets(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    sendSuccess(res, await listTicketsForRequester(actor.userId), "Support requests retrieved.", 200);
  } catch (err) {
    handle(err, res);
  }
}

export async function getMySupportTicket(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    sendSuccess(res, await getTicketForViewer(req.params.id, actor.userId, actor.isStaff), "Ticket retrieved.", 200);
  } catch (err) {
    handle(err, res);
  }
}

export async function replyToSupportTicket(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    const message = await addReply({
      ticketId: req.params.id,
      authorId: actor.userId,
      // Derived from the session, not the body: this is the whole authorisation
      // story for the message badge.
      authorIsStaff: actor.isStaff,
      body: String(req.body?.body || ""),
    });
    sendSuccess(res, message, "Reply added.", 201);
  } catch (err) {
    handle(err, res);
  }
}

export async function updateMySupportTicketStatus(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    // Staff-ness and ownership are both enforced inside the service, so this
    // handler cannot become a bypass by being routed somewhere else later.
    const ticket = await transitionStatus(req.params.id, String(req.body?.status || ""), actor.userId, actor.isStaff, {
      note: typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : undefined,
      // "Resolved" requires something to have been said, so the resolution text
      // can arrive with the status flip instead of needing a second request.
      resolution: typeof req.body?.resolution === "string" ? req.body.resolution : undefined,
    });
    sendSuccess(res, ticket, "Ticket status updated.", 200);
  } catch (err) {
    handle(err, res);
  }
}

// ---------------------------------------------------------------------------
// Staff surfaces. These sit behind requireAdmin in the router; the service still
// re-checks ownership and role so a future route change cannot open them by
// accident.
// ---------------------------------------------------------------------------

export async function listSupportQueue(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    if (!actor.isStaff) {
      sendError(res, "Support access required.", 403, "FORBIDDEN");
      return;
    }
    const tickets = await listTicketsForStaff({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      mine: req.query.mine === "true",
      assignedToId: actor.userId,
    });
    sendSuccess(res, { tickets, counts: await countOpenTickets(), categories: SUPPORT_CATEGORIES }, "Queue retrieved.", 200);
  } catch (err) {
    handle(err, res);
  }
}

export async function setSupportTicketPriority(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    if (!actor.isStaff) {
      sendError(res, "Support access required.", 403, "FORBIDDEN");
      return;
    }
    sendSuccess(res, await setPriority(req.params.id, String(req.body?.priority || ""), actor.userId), "Priority updated.", 200);
  } catch (err) {
    handle(err, res);
  }
}

export async function assignSupportTicket(req: AuthedRequest, res: Response) {
  try {
    const actor = staffActor(req);
    if (!actor.isStaff) {
      sendError(res, "Support access required.", 403, "FORBIDDEN");
      return;
    }
    // An empty string is the documented way to unassign, rather than a null
    // that a client would have to omit deliberately.
    const assignee = typeof req.body?.assigneeId === "string" && req.body.assigneeId.trim() ? req.body.assigneeId.trim() : null;
    sendSuccess(res, await assignTicket(req.params.id, assignee, actor.userId), "Ticket assignment updated.", 200);
  } catch (err) {
    handle(err, res);
  }
}

import { Response } from "express";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import * as connectionRequestService from "../services/connectionRequestService";

/**
 * Connection requests — the searching / accepting half of the connection system.
 *
 * The requester's own side (create, list, cancel) keys off the session user.
 * The partner's side (incoming, accept, decline) resolves the caller's Partner
 * row and checks approval inside the service, so authorisation never depends on
 * the client having hidden a button. Every handler derives the actor from
 * `req.user!` — no endpoint trusts a user id from the body.
 */

/** POST /api/connections/requests — open a search. */
export async function createRequest(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const outcome = await connectionRequestService.createConnectionRequest(req.user!.userId, req.body ?? {});
    if (!outcome.ok) {
      const status = outcome.code === "VALIDATION_ERROR" ? 400 : outcome.code === "NO_PARTNERS_AVAILABLE" ? 503 : 409;
      return sendError(res, outcome.message, status, outcome.code);
    }
    return sendSuccess(res, { request: outcome.request, notified: outcome.notified }, "Searching for someone to connect you.", 201);
  } catch {
    return sendError(res, "Failed to create connection request.", 500, "INTERNAL_ERROR");
  }
}

/** GET /api/connections/requests — the requester's own history. */
export async function listMyRequests(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const limit = Number(req.query.limit ?? 20);
    const items = await connectionRequestService.listMyRequests(req.user!.userId, Number.isFinite(limit) ? limit : 20);
    return sendSuccess(res, { items, total: items.length }, "Connection requests retrieved.");
  } catch {
    return sendError(res, "Failed to retrieve connection requests.", 500, "INTERNAL_ERROR");
  }
}

/** GET /api/connections/requests/active — the search the user can cancel now. */
export async function getActiveRequest(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const request = await connectionRequestService.getActiveRequest(req.user!.userId);
    return sendSuccess(res, { request }, "Active connection request retrieved.");
  } catch {
    return sendError(res, "Failed to retrieve active connection request.", 500, "INTERNAL_ERROR");
  }
}

/** POST /api/connections/requests/:id/cancel — the requester stops searching. */
export async function cancelRequest(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const outcome = await connectionRequestService.cancelConnectionRequest(req.user!.userId, req.params.id);
    if (!outcome.ok) return sendError(res, outcome.message, outcome.status, outcome.code);
    return sendSuccess(res, { request: outcome.request }, "Search cancelled.");
  } catch {
    return sendError(res, "Failed to cancel connection request.", 500, "INTERNAL_ERROR");
  }
}

/** GET /api/connections/incoming — open requests sent to the calling partner. */
export async function listIncoming(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    // Reads live state, so clearing stale rows here is safe and keeps a request
    // whose timer was lost (server restart) from showing as still open.
    await connectionRequestService.expireStaleConnectionRequests();
    const items = await connectionRequestService.listIncomingForPartner(req.user!.userId);
    return sendSuccess(res, { items, total: items.length }, "Incoming connection requests retrieved.");
  } catch {
    return sendError(res, "Failed to retrieve incoming connection requests.", 500, "INTERNAL_ERROR");
  }
}

/** POST /api/connections/incoming/seen — mark offers as viewed. */
export async function markIncomingViewed(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    await connectionRequestService.markViewed(req.user!.userId);
    return sendSuccess(res, undefined, "Incoming requests marked as seen.");
  } catch {
    return sendError(res, "Failed to mark incoming requests as seen.", 500, "INTERNAL_ERROR");
  }
}

/** POST /api/connections/requests/:id/accept — a partner wins the request. */
export async function acceptRequest(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const outcome = await connectionRequestService.acceptConnectionRequest(req.user!.userId, req.params.id);
    if (!outcome.ok) return sendError(res, outcome.message, outcome.status, outcome.code);
    return sendSuccess(res, { request: outcome.request }, "Connection accepted.");
  } catch {
    return sendError(res, "Failed to accept connection request.", 500, "INTERNAL_ERROR");
  }
}

/** POST /api/connections/requests/:id/decline — a partner passes. */
export async function declineRequest(req: AuthedRequest, res: Response): Promise<Response> {
  try {
    const outcome = await connectionRequestService.declineConnectionRequest(req.user!.userId, req.params.id);
    if (!outcome.ok) return sendError(res, outcome.message, outcome.status, outcome.code);
    return sendSuccess(res, { request: outcome.request }, "Connection request declined.");
  } catch {
    return sendError(res, "Failed to decline connection request.", 500, "INTERNAL_ERROR");
  }
}

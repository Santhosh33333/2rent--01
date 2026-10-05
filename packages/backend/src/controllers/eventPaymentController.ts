import { Response } from "express";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import {
  EventPaymentError,
  getCostSheet,
  payMyShare,
  setPerPersonAmount,
  waiveShare,
} from "../services/eventPaymentService";

/**
 * Event cost sheet HTTP surface.
 *
 * Thin on purpose: the rules about who may set an amount, what happens to money
 * that has already been collected, and what a duplicate request is allowed to
 * do all live in the service, so the agent, these routes and any future caller
 * cannot drift apart.
 */

async function handle(res: Response, fn: () => Promise<unknown>, message?: string) {
  try {
    const data = await fn();
    sendSuccess(res, data, message);
  } catch (err) {
    if (err instanceof EventPaymentError) {
      sendError(res, err.message, err.statusCode, err.code);
      return;
    }
    throw err;
  }
}

/** Who owes what, and the derived total. Visible to anyone on the event. */
export async function getEventCostSheet(req: AuthedRequest, res: Response): Promise<void> {
  await handle(res, () => getCostSheet(req.params.id, req.user!.userId));
}

/**
 * Sets the per-person amount. The organizer picks one of the presets or types
 * their own; the per-attendee total is recalculated, never typed in.
 */
export async function setEventAmount(req: AuthedRequest, res: Response): Promise<void> {
  await handle(
    res,
    () => setPerPersonAmount(req.params.id, req.user!.userId, req.body?.amount),
    "Amount set and split across everyone registered.",
  );
}

/** Organizer marks one attendee as not paying. */
export async function waiveEventShare(req: AuthedRequest, res: Response): Promise<void> {
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!userId) {
    sendError(res, "userId is required.", 400, "VALIDATION_ERROR");
    return;
  }
  await handle(res, () => waiveShare(req.params.id, req.user!.userId, userId), "Share waived.");
}

/** The attendee pays their own share from their wallet. */
export async function payEventShare(req: AuthedRequest, res: Response): Promise<void> {
  await handle(res, () => payMyShare(req.params.id, req.user!.userId), "Paid. Thank you.");
}
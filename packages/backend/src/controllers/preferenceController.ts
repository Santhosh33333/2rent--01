/**
 * Discovery preferences API.
 *
 * Five endpoints, and the shape of them matters more than the count: reads are
 * cheap and idempotent, the single write is a whole-record replace, and the
 * location is deliberately a separate pair so that saving a preference can never
 * silently persist (or delete) someone's coordinates.
 */
import type { Request, Response } from "express";
import { sendSuccess, sendError } from "../utils/response";
import * as preferenceService from "../services/preferenceService";
import { prisma } from "../config/database";

interface AuthedRequest extends Request {
  user?: { userId: string; role?: string };
}

function callerId(req: AuthedRequest): string | null {
  return req.user?.userId ?? null;
}

/**
 * GET /preferences
 *
 * Always answers, even with nothing saved. A brand-new account gets the defaults
 * and hasLocation:false, which is a complete and truthful response - not an error,
 * and not an empty object the client has to special-case.
 */
export async function getPreferences(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = callerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const [preferences, location] = await Promise.all([
      preferenceService.getPreferences(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { latitude: true, longitude: true },
      }),
    ]);
    sendSuccess(res, {
      preferences,
      // Only the fact that a location exists, never the coordinates. The client
      // has no need for them - it cannot display them and must not transmit them.
      hasLocation:
        location?.latitude !== null &&
        location?.latitude !== undefined &&
        location.longitude !== null &&
        location.longitude !== undefined,
    });
  } catch (err) {
    console.error("getPreferences error:", err);
    sendError(res, "Could not load your preferences.", 500, "PREFERENCES_LOAD_FAILED");
  }
}

/**
 * GET /preferences/options
 *
 * The catalogue the UI renders. Served from the database so an admin can add an
 * option without a client release. Public to any authenticated user - it contains
 * nothing user-specific.
 */
export async function getOptions(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const catalogue = await preferenceService.loadCatalogueView();
    sendSuccess(res, {
      options: catalogue,
      distances: preferenceService.DISTANCE_OPTIONS_KM,
      anywhereKm: preferenceService.ANYWHERE_KM,
      limits: {
        minAge: preferenceService.LEGAL_MIN_AGE,
        maxAge: preferenceService.MAX_AGE,
      },
    });
  } catch (err) {
    console.error("getOptions error:", err);
    sendError(res, "Could not load the option list.", 500, "OPTIONS_LOAD_FAILED");
  }
}

/**
 * PUT /preferences
 *
 * Whole-record replace, validated server-side. Returns 422 with a per-field issue
 * list rather than a bare "invalid", because the form has to be able to put the
 * message next to the control that caused it - "Distance must be one of 1, 3, 5,
 * 10, 25, 50, 100 km" is actionable, "validation failed" is not.
 *
 * 422 rather than 400: the request was well-formed JSON with a semantically
 * invalid value, which is the distinction clients that retry on 400 will get wrong.
 */
export async function savePreferences(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = callerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const catalogue = await preferenceService.loadCatalogue();
    const result = preferenceService.validatePreferences(req.body ?? {}, catalogue);

    if (!result.ok) {
      sendError(
        res,
        "Some preferences could not be saved.",
        422,
        "PREFERENCES_INVALID",
        undefined,
        { issues: result.issues },
      );
      return;
    }

    await preferenceService.savePreferences(userId, result.value);
    sendSuccess(res, { preferences: result.value }, "Preferences saved.");
  } catch (err) {
    console.error("savePreferences error:", err);
    sendError(res, "Could not save your preferences. Try again.", 500, "PREFERENCES_SAVE_FAILED");
  }
}

/**
 * POST /preferences/location
 *
 * A one-time, self-supplied position used only to rank results by distance.
 * Separate from PUT /preferences on purpose: it is the only endpoint that writes
 * coordinates, so it can be consented to, audited and removed independently of
 * the rest of the preference form.
 */
export async function saveLocation(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = callerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    const result = await preferenceService.saveViewerLocation(
      userId,
      req.body?.latitude,
      req.body?.longitude,
    );
    if (!result.ok) {
      sendError(res, result.message ?? "That location could not be saved.", 422, "LOCATION_INVALID");
      return;
    }
    sendSuccess(res, { hasLocation: true }, "Location saved for distance sorting.");
  } catch (err) {
    console.error("saveLocation error:", err);
    sendError(res, "Could not save that location.", 500, "LOCATION_SAVE_FAILED");
  }
}

/**
 * DELETE /preferences/location
 *
 * Supported because "I no longer want my location shared" has to be as easy as
 * setting it. Distance ranking then simply stops applying to that account, which
 * the discover endpoint already handles.
 */
export async function clearLocation(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = callerId(req);
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }
    await preferenceService.clearViewerLocation(userId);
    sendSuccess(res, { hasLocation: false }, "Location removed.");
  } catch (err) {
    console.error("clearLocation error:", err);
    sendError(res, "Could not remove that location.", 500, "LOCATION_CLEAR_FAILED");
  }
}
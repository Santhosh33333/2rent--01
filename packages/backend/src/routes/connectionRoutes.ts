import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { connectionRequestLimiter } from "../middleware/rateLimiter";
import * as connectionController from "../controllers/connectionRequestController";

/**
 * Connection requests: the user searches, eligible partners accept or decline.
 *
 * Mounted at `/api/connections`. Everything is behind auth; the partner-only
 * actions (incoming / accept / decline) resolve the caller's Partner row and
 * check approval in the service, so a user without an approved partner profile
 * is refused server-side rather than by a hidden button.
 *
 * The create endpoint carries its own limiter because it fans out to real
 * partners on every call.
 */
const router = Router();
router.use(authenticateToken);

// Requester side
router.post("/requests", connectionRequestLimiter, connectionController.createRequest);
router.get("/requests", connectionController.listMyRequests);
router.get("/requests/active", connectionController.getActiveRequest);
router.post("/requests/:id/cancel", connectionController.cancelRequest);

// Partner side
router.get("/incoming", connectionController.listIncoming);
router.post("/incoming/seen", connectionController.markIncomingViewed);
router.post("/requests/:id/accept", connectionController.acceptRequest);
router.post("/requests/:id/decline", connectionController.declineRequest);

export default router;

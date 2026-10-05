import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { aiRateLimiter } from "../middleware/rateLimiter";
import * as agentController from "../controllers/agentController";

/**
 * Agent routes.
 *
 * Every route sits behind the same authentication and rate limiting as the rest
 * of the AI surface. Authorisation is per-tool inside the agent router, not per
 * route, so adding a tool never means adding an endpoint here — and no endpoint
 * here can be used to bypass a tool's permission check.
 */
const router = Router();

router.use(authenticateToken, aiRateLimiter);

router.post("/ask", agentController.agentAsk);
router.post("/confirm", agentController.agentConfirm);
router.get("/capabilities", agentController.agentCapabilities);
router.post("/clear-history", agentController.agentClearHistory);

export default router;
import { Router } from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import { aiRateLimiter } from "../middleware/rateLimiter";
import * as aiController from "../controllers/aiController";

const router = Router();

router.use(authenticateToken, aiRateLimiter);

// Assistant + matching work without any AI provider key.
router.post("/ask", aiController.askAssistant);
router.get("/matches", aiController.getMatches);
router.get("/status", aiController.getAiStatus);

// LLM-backed: honest 503 until AI_API_BASE + AI_API_KEY are set.
router.post("/translate", aiController.translateMessage);
router.post("/draft", aiController.draftText);

// Admin only: review queues, never auto-punish.
router.get("/flags", requireAdmin, aiController.getSafetyFlags);
router.get("/admin-summary", requireAdmin, aiController.getAdminSummary);

export default router;

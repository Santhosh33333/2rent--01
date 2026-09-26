import { Router } from "express";
import rateLimit from "express-rate-limit";
import { reportAppCrash, listAppCrashReports } from "../controllers/appCrashController";
import { authenticateToken, requireAdmin } from "../middleware/auth";

const router = Router();

// POST is intentionally unauthenticated (the Android app reports crashes before
// the user signs in), but a public log-writing endpoint must not become a
// log-flood vector. A tight per-IP bucket keeps a misbehaving device from
// spamming every crash into Render logs.
export const crashReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ ok: false, reason: "Too many crash reports." });
  },
});

router.post("/", crashReportLimiter, reportAppCrash);
router.get("/", authenticateToken, requireAdmin, listAppCrashReports);

export default router;
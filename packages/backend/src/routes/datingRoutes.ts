import { Router } from "express";
import { body, query } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import * as datingController from "../controllers/datingController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// GET /dating/discover
router.get(
  "/discover",
  [
    query("minAge").optional().isInt({ min: 18, max: 120 }),
    query("maxAge").optional().isInt({ min: 18, max: 120 }),
    query("city").optional().isString().trim().isLength({ max: 120 }),
    query("gender").optional().isString().trim().isLength({ max: 40 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  validateRequest,
  datingController.discover,
);

// POST /dating/swipe
router.post(
  "/swipe",
  [
    body("targetUserId").notEmpty().withMessage("Target user is required").isString(),
    body("type").notEmpty().withMessage("Swipe type is required").isIn(["LIKE", "PASS", "SUPER_LIKE", "like", "pass", "super_like"]),
  ],
  validateRequest,
  datingController.swipe,
);

// GET /dating/matches
router.get("/matches", datingController.matches);

// GET /dating/likes
router.get("/likes", datingController.likes);

// POST /dating/unmatch
router.post(
  "/unmatch",
  [body("matchId").notEmpty().withMessage("Match id is required").isString()],
  validateRequest,
  datingController.unmatch,
);

export default router;
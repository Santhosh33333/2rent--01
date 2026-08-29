import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as communityController from "../controllers/communityController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Create community
router.post(
  "/",
  [
    body("name").notEmpty().trim().isLength({ min: 3, max: 100 }),
    body("description").optional().isString().trim().isLength({ max: 500 }),
    body("privacy").optional().isIn(["PUBLIC", "PRIVATE"]),
    body("city").optional().isString().trim(),
  ],
  sanitizeInput,
  validateRequest,
  communityController.createCommunity
);

// Get communities list
router.get("/", communityController.getCommunities);

// Get community by ID
router.get("/:id", communityController.getCommunityById);

// Update community (owner only)
router.put(
  "/:id",
  [
    body("name").optional().notEmpty().trim().isLength({ min: 3, max: 100 }),
    body("description").optional().isString().trim().isLength({ max: 500 }),
    body("privacy").optional().isIn(["PUBLIC", "PRIVATE"]),
    body("city").optional().isString().trim(),
  ],
  sanitizeInput,
  validateRequest,
  communityController.updateCommunity
);

// Delete community (owner only)
router.delete("/:id", communityController.deleteCommunity);

// Join community
router.post("/:id/join", communityController.joinCommunity);

// Leave community
router.post("/:id/leave", communityController.leaveCommunity);

// Get community members
router.get("/:id/members", communityController.getCommunityMembers);

export default router;


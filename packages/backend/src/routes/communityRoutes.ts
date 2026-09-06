import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as communityController from "../controllers/communityController";
import * as communityPostController from "../controllers/communityPostController";

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

// Posts (members only; reads open for PUBLIC, members-only for PRIVATE)
router.post(
  "/:id/posts",
  [body("content").notEmpty().trim().isLength({ min: 1, max: 2000 }), body("imageUrl").optional().isString().trim()],
  sanitizeInput,
  validateRequest,
  communityPostController.createPost
);
router.get("/:id/posts", communityPostController.listPosts);
router.delete("/:id/posts/:postId", communityPostController.deletePost);
router.post(
  "/:id/posts/:postId/report",
  [body("reason").notEmpty().trim().isLength({ min: 3, max: 200 }), body("description").optional().isString().trim().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  communityPostController.reportPost
);
// Comments (members only)
router.post(
  "/:id/posts/:postId/comments",
  [body("content").notEmpty().trim().isLength({ min: 1, max: 1000 })],
  sanitizeInput,
  validateRequest,
  communityPostController.createComment
);
router.get("/:id/posts/:postId/comments", communityPostController.listComments);
router.delete("/:id/posts/:postId/comments/:commentId", communityPostController.deleteComment);
router.post(
  "/:id/posts/:postId/comments/:commentId/report",
  [body("reason").notEmpty().trim().isLength({ min: 3, max: 200 }), body("description").optional().isString().trim().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  communityPostController.reportComment
);

// Polls (members vote; reads follow community privacy)
router.post(
  "/:id/polls",
  [
    body("question").notEmpty().trim().isLength({ min: 3, max: 500 }),
    body("options").isArray({ min: 2, max: 6 }),
    body("closesAt").optional().isISO8601(),
  ],
  sanitizeInput,
  validateRequest,
  communityPostController.createPoll
);
router.get("/:id/polls", communityPostController.listPolls);
router.post(
  "/:id/polls/:pollId/vote",
  [body("optionId").notEmpty().isString().trim()],
  sanitizeInput,
  validateRequest,
  communityPostController.votePoll
);
router.delete("/:id/polls/:pollId", communityPostController.deletePoll);

// Member management (owner/admin only — enforced in controller)
router.patch(
  "/:id/members/:userId",
  [body("role").notEmpty().isIn(["ADMIN", "MODERATOR", "MEMBER"])],
  sanitizeInput,
  validateRequest,
  communityPostController.updateMemberRole
);
router.delete("/:id/members/:userId", communityPostController.removeMember);

export default router;


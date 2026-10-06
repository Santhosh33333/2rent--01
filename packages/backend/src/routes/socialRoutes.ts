import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { upload, videoUpload } from "../middleware/upload";
import * as socialPostController from "../controllers/socialPostController";

const router = Router();

// The feed is a core authenticated surface — no KYC gate: users who are not
// KYC-verified still post/comment/like (unlike bookings, where real money flows).
router.use(authenticateToken);

// Create a post (text, image, video or question). Media URLs come from a
// previous POST /image or /video call; type/visibility are validated in the
// controller so the error code is precise.
router.post(
  "/",
  [
    body("content").optional().isString().trim().isLength({ max: 2000 }),
    body("imageUrl").optional().isString().trim().isLength({ max: 500 }),
    body("videoUrl").optional().isString().trim().isLength({ max: 500 }),
    body("type").optional().isString(),
    body("visibility").optional().isString(),
  ],
  sanitizeInput,
  validateRequest,
  socialPostController.createPost
);

// Feed
router.get("/", socialPostController.listFeed);

// Media uploads precede media attach. Video uses its own multer instance
// (larger cap, video filter) — see middleware/upload.ts.
router.post("/image", upload.single("image"), socialPostController.uploadPostImage);
router.post("/video", videoUpload.single("video"), socialPostController.uploadPostVideo);

// Single post
router.get("/:id", socialPostController.getPost);
router.delete("/:id", socialPostController.deletePost);

// Likes + saves (toggle)
router.post("/:id/like", socialPostController.toggleLike);
router.post("/:id/save", socialPostController.toggleSave);

// Comments (one level of replies)
router.post(
  "/:id/comments",
  [body("content").notEmpty().trim().isLength({ min: 1, max: 1000 }), body("parentId").optional().isString().trim()],
  sanitizeInput,
  validateRequest,
  socialPostController.createComment
);
router.get("/:id/comments", socialPostController.listComments);
router.get("/:id/comments/:commentId/replies", socialPostController.listCommentReplies);
router.delete("/:id/comments/:commentId", socialPostController.deleteComment);

// Report
router.post(
  "/:id/report",
  [body("reason").notEmpty().trim().isLength({ min: 3, max: 200 }), body("description").optional().isString().trim().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  socialPostController.reportPost
);

// Gifts — atomic wallet debit/credit
router.post(
  "/:id/gift",
  [body("amount").notEmpty().isNumeric(), body("referenceId").optional().isString().trim().isLength({ max: 64 })],
  sanitizeInput,
  validateRequest,
  socialPostController.sendGift
);
router.get("/:id/gifts", socialPostController.listGifts);

export default router;
import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as messageController from "../controllers/messageController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Send message (TEXT, or IMAGE/VOICE with a mediaUrl from POST /upload)
router.post(
  "/",
  [
    body("receiverId").notEmpty().withMessage("Receiver is required").isString(),
    body("content").optional().isString().trim().isLength({ max: 5000 }),
    body("messageType").optional().isIn(["TEXT", "IMAGE", "VOICE", "text", "image", "voice"]),
    body("mediaUrl").optional().isString().trim(),
    body("bookingId").optional().isString().trim(),
  ],
  sanitizeInput,
  validateRequest,
  messageController.sendMessage
);

// Upload one image or voice note (multipart field "file")
router.post("/upload", messageController.uploadMedia);

// Authenticated attachment download (membership-checked, never public static)
router.get("/media/:id", messageController.getMedia);

// Get conversations
router.get("/conversations", messageController.getConversations);

// Unread counts (total + per conversation)
router.get("/unread", messageController.getUnreadCounts);

// Get messages in conversation
router.get("/:conversationId", messageController.getMessages);

// Mark message as read
router.post("/:id/read", messageController.markAsRead);

// Delete message
router.delete("/:id", messageController.deleteMessage);

export default router;


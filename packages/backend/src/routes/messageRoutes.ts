import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as messageController from "../controllers/messageController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Send message
router.post(
  "/",
  [
    body("receiverId").notEmpty().withMessage("Receiver is required").isString(),
    body("content").notEmpty().isString().trim().isLength({ max: 5000 }),
  ],
  sanitizeInput,
  validateRequest,
  messageController.sendMessage
);

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


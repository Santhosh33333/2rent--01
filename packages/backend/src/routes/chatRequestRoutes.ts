import express from "express";
import { authenticateToken } from "../middleware/auth";
import {
  sendChatRequest,
  acceptChatRequest,
  rejectChatRequest,
  getSentRequests,
  getReceivedRequests,
  getChatRequestCounts,
  expireStaleRequests,
} from "../controllers/chatRequestController";

const router = express.Router();

router.post("/", authenticateToken, sendChatRequest);
router.put("/:id/accept", authenticateToken, acceptChatRequest);
router.put("/:id/reject", authenticateToken, rejectChatRequest);
router.get("/sent", authenticateToken, getSentRequests);
router.get("/received", authenticateToken, getReceivedRequests);
router.get("/counts", authenticateToken, getChatRequestCounts);
router.post("/expire-stale", authenticateToken, expireStaleRequests);

export default router;

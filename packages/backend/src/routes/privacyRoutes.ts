import express from "express";
import { authenticateToken } from "../middleware/auth";
import {
  getChatRequestSettings,
  updateChatRequestSettings,
  blockUser,
  unblockUser,
  getBlockedList,
  muteUser,
  unmuteUser,
  getMutedList,
  reportChat,
  getPrivacyPreferences,
  updatePrivacyPreferences,
} from "../controllers/privacyController";

const router = express.Router();

router.get("/preferences", authenticateToken, getPrivacyPreferences);
router.put("/preferences", authenticateToken, updatePrivacyPreferences);

router.get("/chat-settings", authenticateToken, getChatRequestSettings);
router.put("/chat-settings", authenticateToken, updateChatRequestSettings);
router.post("/block", authenticateToken, blockUser);
router.delete("/block/:blockedId", authenticateToken, unblockUser);
router.get("/blocks", authenticateToken, getBlockedList);
router.post("/mute", authenticateToken, muteUser);
router.delete("/mute/:mutedId", authenticateToken, unmuteUser);
router.get("/mutes", authenticateToken, getMutedList);
router.post("/report", authenticateToken, reportChat);

export default router;

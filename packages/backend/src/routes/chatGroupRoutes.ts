import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput } from "../middleware/validation";
import * as chatGroupController from "../controllers/chatGroupController";

const router = Router();

// Group messaging is open to every authenticated member, like the 1:1
// messenger. Access inside each handler is membership-based: only members of a
// group may read or post, and only the invitee may answer an invitation.
router.use(authenticateToken);

// Create a group (creator becomes OWNER; optional memberIds are added up front)
router.post("/", sanitizeInput, chatGroupController.createGroup);

// List my groups (last message + unread count per group)
router.get("/", chatGroupController.getGroups);

// My pending invitations. Declared before "/:id" so "invites" is not read as a
// group id.
router.get("/invites", chatGroupController.getMyInvites);
router.post("/invites/:inviteId/respond", sanitizeInput, chatGroupController.respondToInvite);

// Add members directly (OWNER/ADMIN)
router.post("/:id/members", sanitizeInput, chatGroupController.addMembers);
// Remove a member (OWNER/ADMIN)
router.delete("/:id/members/:userId", chatGroupController.removeMember);
// Invite people (any member)
router.post("/:id/invites", sanitizeInput, chatGroupController.inviteToGroup);
// Leave the group (self); transfers ownership if the owner leaves
router.post("/:id/leave", chatGroupController.leaveGroup);

// Group messages
router.get("/:id/messages", chatGroupController.getMessages);
router.post("/:id/messages", sanitizeInput, chatGroupController.sendMessage);
router.delete("/:id/messages/:messageId", chatGroupController.deleteMessage);
router.post("/:id/messages/:messageId/react", sanitizeInput, chatGroupController.toggleReaction);

// Clear the unread watermark
router.post("/:id/read", chatGroupController.markRead);

// Group detail / edit / delete
router.get("/:id", chatGroupController.getGroup);
router.patch("/:id", sanitizeInput, chatGroupController.updateGroup);
router.delete("/:id", chatGroupController.deleteGroup);

export default router;

import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as friendshipController from "../controllers/friendshipController";

const router = Router();

router.use(authenticateToken);

router.post(
  "/",
  [body("addresseeId").notEmpty().withMessage("Addressee is required")],
  sanitizeInput,
  validateRequest,
  friendshipController.sendRequest
);
router.get("/", friendshipController.getFriends);
router.get("/requests", friendshipController.getFriendRequests);
router.get("/suggested", friendshipController.getSuggestedFriends);
router.post("/:id/accept", friendshipController.acceptRequest);
router.post("/:id/reject", friendshipController.rejectRequest);
router.delete("/:id", friendshipController.removeFriend);

export default router;

import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { requireReConsent } from "../middleware/legalConsent";
import * as callController from "../controllers/callController";

const router = Router();

router.use(authenticateToken);

router.post(
  "/",
  [body("receiverId").notEmpty().withMessage("Receiver is required"), body("type").optional().isString()],
  sanitizeInput,
  validateRequest,
  // Only ringing someone new is gated. Accepting or ending a call that is
  // already ringing is not, because leaving a ringing call unanswered while the
  // callee is blocked would strand the caller with no way to clear it.
  requireReConsent(),
  callController.createCall
);
router.post("/:id/accept", callController.acceptCall);
router.post("/:id/end", callController.endCall);
router.get("/", callController.getCallHistory);
router.get("/:id", callController.getCallLog);

export default router;

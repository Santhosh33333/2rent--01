import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as callController from "../controllers/callController";

const router = Router();

router.use(authenticateToken);

router.post(
  "/",
  [body("receiverId").notEmpty().withMessage("Receiver is required"), body("type").optional().isString()],
  sanitizeInput,
  validateRequest,
  callController.createCall
);
router.post("/:id/accept", callController.acceptCall);
router.post("/:id/end", callController.endCall);
router.get("/", callController.getCallHistory);
router.get("/:id", callController.getCallLog);

export default router;

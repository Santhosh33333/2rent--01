import { Router } from "express";
import { body, param } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { requireWalkingPartner } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as walkingRequestController from "../controllers/walkingRequestController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

router.post(
  "/",
  [
    body("startLocation").notEmpty(),
    body("endLocation").notEmpty(),
    body("startTime").isISO8601(),
    body("durationMinutes").optional().isInt({ min: 1 }),
    body("fare").optional().isFloat({ min: 0 }),
  ],
  sanitizeInput,
  validateRequest,
  walkingRequestController.createWalkingRequest
);

router.get("/", walkingRequestController.getWalkingRequests);
router.get("/:id", walkingRequestController.getWalkingRequestById);
router.post("/:id/accept", requireWalkingPartner, walkingRequestController.acceptWalkingRequest);
router.post("/:id/withdraw", walkingRequestController.withdrawApplication);
router.post("/:id/complete", requireWalkingPartner, walkingRequestController.completeWalk);
router.post("/:id/confirm", walkingRequestController.confirmWalkCompletion);
router.delete("/:id", walkingRequestController.cancelWalkingRequest);

export default router;


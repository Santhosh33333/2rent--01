import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as walkingPartnerController from "../controllers/walkingPartnerController";

const router = Router();

router.use(authenticateToken);

router.post("/apply", walkingPartnerController.applyAsWalkingPartner);
router.get("/status", walkingPartnerController.getWalkingPartnerStatus);
router.put(
  "/bank-details",
  [body("accountName").notEmpty(), body("accountNumber").notEmpty(), body("ifsc").notEmpty()],
  sanitizeInput,
  validateRequest,
  walkingPartnerController.updateBankDetails
);
router.put(
  "/upi",
  [body("upiId").matches(/^[\w.-]+@[\w.-]+$/).withMessage("Valid UPI ID required")],
  validateRequest,
  walkingPartnerController.updateUpiDetails
);
router.get("/earnings", walkingPartnerController.getWalkingPartnerEarnings);

export default router;
